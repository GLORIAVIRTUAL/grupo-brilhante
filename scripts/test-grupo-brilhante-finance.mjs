import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const finance = await import(path.join(root, 'base44/shared/financeCore.js'));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('normaliza datas e valores brasileiros', () => {
  assert.equal(finance.normalizeDate('31/01/2026'), '2026-01-31');
  assert.equal(finance.normalizeDate('2026-12-15'), '2026-12-15');
  assert.equal(finance.normalizeAmount('R$ 1.234,56'), 1234.56);
  assert.equal(finance.normalizeAmount('inválido'), null);
});

test('gera competência e limites mensais', () => {
  assert.equal(finance.financialPeriodKey('company-1', 2026, 2), 'company-1:2026-02');
  assert.deepEqual(finance.financialPeriodBounds(2024, 2), { start: '2024-02-01', end: '2024-02-29' });
  assert.throws(() => finance.financialPeriodKey('', 2026, 2), /invalid_financial_period/);
});

test('período fechado bloqueia novas gravações', () => {
  assert.equal(finance.isPeriodWritable(null), true);
  assert.equal(finance.isPeriodWritable({ status: 'open' }), true);
  assert.equal(finance.isPeriodWritable({ status: 'reopened' }), true);
  assert.equal(finance.isPeriodWritable({ status: 'closed' }), false);
});

test('projeção ponderada respeita probabilidade', () => {
  assert.equal(finance.weightedProjection(1000, 35), 350);
  assert.equal(finance.weightedProjection(1000, 150), 1000);
});

test('normaliza linhas Conta Azul por tipo', () => {
  const payable = finance.normalizeMigrationRow('accounts_payable', { id: 'AP-1', descricao: 'Energia', valor: '1.250,50', vencimento: '15/10/2026' });
  assert.equal(payable.valid, true);
  assert.equal(payable.normalized.amount, 1250.5);
  const invalid = finance.normalizeMigrationRow('accounts_receivable', { id: 'AR-1', descricao: '', valor: 'x' });
  assert.equal(invalid.valid, false);
  assert(invalid.messages.includes('valid_amount_required'));
  const bank = finance.normalizeMigrationRow('bank_transactions', { id: 'BB-1', descricao: 'Tarifa', valor: '-15,90', data: '01/09/2026' });
  assert.equal(bank.normalized.transaction_type, 'debit');
});

test('transição intercompany exige aprovação antes da postagem', () => {
  assert.deepEqual(finance.INTERCOMPANY_TRANSITIONS.draft, ['pending_approval', 'cancelled']);
  assert.deepEqual(finance.INTERCOMPANY_TRANSITIONS.pending_approval, ['posted', 'cancelled']);
});

test('schemas financeiros multiempresa contêm rastreabilidade', () => {
  const names = ['FinancialPeriod', 'IntercompanyEntry', 'FinancialProjection', 'ReconciliationBatch', 'MigrationBatch', 'MigrationRecord'];
  for (const name of names) assert.equal(JSON.parse(read(`base44/entities/${name}.jsonc`)).name, name);
  for (const name of ['AccountsPayable', 'AccountsReceivable', 'PaymentReceipt', 'PaymentAllocation', 'CashSession', 'CashMovement', 'BankTransaction', 'BillingAgreement', 'BillingStatement', 'FinancialDocument', 'RecurringExpense']) {
    const schema = JSON.parse(read(`base44/entities/${name}.jsonc`));
    assert(schema.properties.legal_entity_id, `${name} sem legal_entity_id`);
  }
});

test('núcleo financeiro usa escopo, MFA, auditoria e reparo', () => {
  const source = read('base44/functions/manage_financial_core/entry.ts');
  assert(source.includes('authorizeUserOrInternal'));
  assert(source.includes("'finance.close_period'"));
  assert(source.includes("'finance.approve'"));
  assert(source.includes('RepairTask.create'));
  assert(source.includes('financial_period_closed'));
  assert(source.includes('intercompany_repair_required'));
});

test('migração permanece desativada por padrão e exige aprovação', () => {
  const source = read('base44/functions/manage_conta_azul_migration/entry.ts');
  assert(source.includes("Deno.env.get('CONTA_AZUL_MIGRATION_ENABLED')"));
  assert(source.includes("'migration_execution_disabled'"));
  assert(source.includes("'migration.approve'"));
  assert(source.includes("batch.status !== 'approved'"));
  assert(source.includes('dry_run'));
  assert(source.includes('source_hash'));
});

test('upload de migração aceita somente formatos textuais auditáveis', () => {
  const secureFiles = read('src/lib/secureFiles.js');
  assert(secureFiles.includes("migration_source: { types: ['text/csv', 'text/plain', 'application/json', 'application/xml', 'text/xml']"));
  const documents = read('base44/functions/manage_document_assets/entry.ts');
  assert(documents.includes("'text/csv'"));
  assert(documents.includes("action: 'status_change'"));
  assert.equal(documents.includes("action: 'archive'"), false);
});

test('rotas financeiras e migração possuem permissões alinhadas', () => {
  const app = read('src/App.jsx');
  const layout = read('src/Layout.jsx');
  const backendRoles = read('base44/shared/accessGovernance.js');
  const frontendRoles = read('src/lib/roleDefinitions.js');
  assert(app.includes('/enterprise-finance'));
  assert(app.includes('/conta-azul-migration'));
  assert(layout.includes("permissions: ['finance.view', 'finance.manage', 'finance.approve']"));
  assert(layout.includes("permissions: ['migration.view', 'migration.execute', 'migration.approve']"));
  assert(backendRoles.includes("'migration.execute'"));
  assert(frontendRoles.includes("'migration.execute'"));
});

test('interfaces críticas não gravam finanças diretamente', () => {
  for (const page of ['EnterpriseFinance.jsx', 'ContaAzulMigration.jsx']) {
    const source = read(`src/pages/${page}`);
    assert.equal(/base44\.entities\.(AccountsPayable|AccountsReceivable|MigrationBatch|IntercompanyEntry|FinancialPeriod)\.(create|update|delete)/.test(source), false);
  }
});

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); console.error(error); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} testes financeiros aprovados.`);
if (passed !== tests.length) process.exit(1);
