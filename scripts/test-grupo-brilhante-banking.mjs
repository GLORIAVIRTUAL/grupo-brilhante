import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const banking = await import(path.join(root, 'base44/shared/bankingProviderContract.js'));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const schema = (name) => JSON.parse(read(`base44/entities/${name}.jsonc`));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('configuração bancária inicia desativada', () => {
  const config = banking.bankingRuntimeConfig(() => '');
  assert.equal(config.environment, 'disabled');
  assert.equal(config.externalRequestsEnabled, false);
  assert.throws(() => banking.assertExternalBankingAllowed(config), /banking_external_requests_disabled/);
});

test('produção exige gate adicional', () => {
  const values = { BB_ENVIRONMENT: 'production', BB_EXTERNAL_REQUESTS_ENABLED: 'true', BB_PRODUCTION_ENABLED: 'false', BB_API_BASE_URL: 'https://api.example', BB_OAUTH_URL: 'https://oauth.example', BB_DEVELOPER_APPLICATION_KEY: 'app', BB_CLIENT_ID: 'id', BB_CLIENT_SECRET: 'secret' };
  const config = banking.bankingRuntimeConfig((name) => values[name] || '');
  assert.throws(() => banking.assertExternalBankingAllowed(config), /banking_production_disabled/);
});

test('payload de boleto exige convênio e pagador válido', () => {
  const config = { agreementNumber: '123', walletNumber: '17', walletVariation: '35' };
  const payload = banking.buildBoletoPayload({ amount: '125,50', issue_date: '01/09/2026', due_date: '15/09/2026', internal_reference: 'GB-1', payer: { name: 'Cliente Teste', tax_id: '11144477735', address: {} } }, config);
  assert.equal(payload.valorOriginal, 125.5);
  assert.equal(payload.numeroConvenio, 123);
  assert.equal(payload.pagador.tipoInscricao, 1);
});

test('payload Pix diferencia imediato e vencimento', () => {
  const config = { pixKey: 'chave-homologacao' };
  const immediate = banking.buildPixPayload({ charge_type: 'pix_immediate', amount: 50, internal_reference: 'PX-1', payer: { name: 'Empresa Teste', tax_id: '11222333000181' } }, config);
  assert(immediate.calendario.expiracao >= 60);
  const due = banking.buildPixPayload({ charge_type: 'pix_due_date', amount: 60, due_date: '2026-09-30', internal_reference: 'PX-2', payer: { name: 'Empresa Teste', tax_id: '11222333000181' } }, config);
  assert.equal(due.calendario.dataDeVencimento, '2026-09-30');
});

test('resposta do provedor é reduzida a campos permitidos', () => {
  const safe = banking.sanitizedBankResponse({ numero: '123', txid: 'ABC', linhaDigitavel: '00190.00009', token: 'não pode sair', pix: { emv: '000201' } });
  assert.equal(safe.providerChargeId, '123');
  assert.equal('token' in safe, false);
});

test('webhook extrai liquidação Pix e boleto', () => {
  const pix = banking.extractSettlementEvent({ pix: [{ txid: 'TX1', valor: '10.25', horario: '2026-09-09T10:00:00Z', endToEndId: 'E2E1' }] });
  assert.equal(pix.eventType, 'settlement');
  assert.equal(pix.amount, 10.25);
  const boleto = banking.extractSettlementEvent({ numeroTituloCliente: 'B1', valorRecebido: '20,00', dataLiquidacao: '2026-09-09T11:00:00Z' });
  assert.equal(boleto.providerChargeId, 'B1');
});

test('matching pondera valor, data e referência', () => {
  const score = banking.reconciliationScore({ amount: 100, transaction_date: '2026-09-09', description: 'Liquidação GB-123' }, { amount: 100, due_date: '2026-09-09', internal_reference: 'GB-123' });
  assert.equal(score.confidencePercent, 100);
  assert(score.reasons.includes('exact_amount'));
});

test('schemas bancários preservam escopo e idempotência', () => {
  for (const name of ['BankCharge', 'BankWebhookEvent', 'BankReconciliationMatch', 'BankFileLayoutProfile']) assert.equal(schema(name).name, name);
  assert(schema('BankCharge').properties.legal_entity_id);
  assert(schema('BankCharge').properties.idempotency_key);
  assert(schema('BankWebhookEvent').properties.payload_hash);
  assert(schema('BankFileLayoutProfile').properties.field_map);
});

test('gateway é exclusivamente interno e possui timeout', () => {
  const source = read('base44/functions/bb_banking_gateway/entry.ts');
  assert(source.includes('requireInternalRequest(req)'));
  assert(source.includes('assertExternalBankingAllowed'));
  assert(source.includes('AbortSignal.timeout'));
  assert(source.includes("BB_PRODUCTION_ENABLED" ) === false);
});

test('webhook usa cabeçalho, HMAC e não aceita segredo em query', () => {
  const source = read('base44/functions/bb_webhook_receiver/entry.ts');
  assert(source.includes("req.headers.get('x-bb-webhook-token')"));
  assert(source.includes("Deno.env.get('BB_WEBHOOK_HMAC_SECRET')"));
  assert.equal(source.includes('searchParams.get'), false);
  assert(source.includes('payload_hash'));
  assert(source.includes('partially_paid'));
});

test('conciliação não baixa financeiro automaticamente', () => {
  const source = read('base44/functions/manage_bank_reconciliation/entry.ts');
  assert(source.includes('financial_settlement_pending: true'));
  assert.equal(/Accounts(Receivable|Payable)\.update/.test(source), false);
  assert(source.includes("'banking.reconcile'"));
});

test('interfaces e rotas usam backend protegido', () => {
  const app = read('src/App.jsx'); const layout = read('src/Layout.jsx'); const page = read('src/pages/BankingOperations.jsx');
  assert(app.includes('/banking-operations'));
  assert(layout.includes("permissions: ['banking.view', 'banking.manage', 'banking.reconcile']"));
  assert.equal(/base44\.entities\.(BankCharge|BankTransaction|ReconciliationBatch)\.(create|update|delete)/.test(page), false);
});

test('modelo de ambiente não contém credenciais e mantém gates fechados', () => {
  const env = read('.env.example');
  assert(env.includes('BB_ENVIRONMENT=disabled'));
  assert(env.includes('BB_EXTERNAL_REQUESTS_ENABLED=false'));
  assert(env.includes('BB_PRODUCTION_ENABLED=false'));
  assert.match(env, /BB_CLIENT_SECRET=\n/);
});

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); console.error(error); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} testes bancários aprovados.`);
if (passed !== tests.length) process.exit(1);
