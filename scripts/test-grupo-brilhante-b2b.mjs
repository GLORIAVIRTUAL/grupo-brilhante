import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(path.join(root, 'base44/shared/businessCore.js'));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('normaliza empresa e valida CNPJ', () => {
  const party = core.normalizePartyInput({ party_type: 'company', legal_name: 'Hospital Exemplo S.A.', tax_id: '11.222.333/0001-81' });
  assert.equal(party.tax_id, '11222333000181');
  assert.equal(party.tax_id_type, 'cnpj');
  assert.throws(() => core.normalizePartyInput({ party_type: 'company', legal_name: 'Inválida', tax_id: '11.111.111/1111-11' }), /invalid_cnpj/);
});

test('normaliza contatos sem expor formatos divergentes', () => {
  assert.equal(core.canonicalContact('whatsapp', '(51) 99999-0000'), '51999990000');
  assert.equal(core.canonicalContact('email', ' Financeiro@Exemplo.COM '), 'financeiro@exemplo.com');
  assert.throws(() => core.canonicalContact('email', 'invalido'), /invalid_email/);
});

test('arredonda dinheiro e limita score comercial', () => {
  assert.equal(core.roundMoney(10.005), 10.01);
  assert.equal(core.calculateOpportunityScore({ has_valid_tax_id: true, has_primary_contact: true, has_service_address: true, estimated_value: 1000, expected_close_date: '2026-10-01', next_action_at: '2026-09-10', stage: 'approval', temperature: 'hot' }), 100);
});

test('lifecycle contratual bloqueia saltos', () => {
  assert.equal(core.assertTransition('draft', 'pending_approval', core.CONTRACT_TRANSITIONS).idempotent, false);
  assert.throws(() => core.assertTransition('draft', 'active', core.CONTRACT_TRANSITIONS), /invalid_status_transition/);
  assert.equal(core.assertTransition('active', 'suspended', core.CONTRACT_TRANSITIONS).idempotent, false);
});

test('lifecycle da OS exige qualidade antes da conclusão', () => {
  assert.throws(() => core.assertTransition('in_progress', 'completed', core.SERVICE_ORDER_TRANSITIONS), /invalid_status_transition/);
  assert.equal(core.assertTransition('quality_review', 'completed', core.SERVICE_ORDER_TRANSITIONS).idempotent, false);
});

test('numeração empresarial é legível e determinística', () => {
  const date = new Date('2026-09-09T12:00:00Z');
  assert.equal(core.nextContractNumber(42, 'GB-01', date), 'GB01-2026-000042');
  assert.equal(core.nextServiceOrderNumber(42, 'GB-01', date), 'GB01-OS-2026-0000042');
});

test('schemas B2B são válidos e contêm escopo obrigatório', () => {
  const names = ['BusinessParty', 'PartyRole', 'PartyContact', 'PartyAddress', 'PartyDocument', 'SalesOpportunity', 'BusinessActivity', 'BusinessContract', 'ContractVersion', 'ContractPriceItem', 'ServiceOrder'];
  for (const name of names) {
    const schema = JSON.parse(read(`base44/entities/${name}.jsonc`));
    assert.equal(schema.name, name);
  }
  const contract = JSON.parse(read('base44/entities/BusinessContract.jsonc'));
  assert(contract.required.includes('legal_entity_id'));
  assert(contract.properties.idempotency_key);
  const order = JSON.parse(read('base44/entities/ServiceOrder.jsonc'));
  assert(order.required.includes('legal_entity_id'));
  assert(order.properties.idempotency_key);
});

test('endpoints B2B usam guard, service role e auditoria', () => {
  for (const fn of ['manage_business_parties', 'manage_business_contracts', 'manage_service_orders']) {
    const source = read(`base44/functions/${fn}/entry.ts`);
    assert(source.includes('authorizeUserOrInternal'));
    assert(source.includes('enforceAuthenticatedUser'));
    assert(source.includes('asServiceRole.entities'));
    assert(source.includes('AuditLog.create'));
    assert(source.includes("req.method !== 'POST'"));
  }
});

test('aprovação contratual e conclusão de OS exigem MFA', () => {
  const contracts = read('base44/functions/manage_business_contracts/entry.ts');
  assert(contracts.includes("'contracts.approve', legalEntityId, unitId, true"));
  const orders = read('base44/functions/manage_service_orders/entry.ts');
  assert(orders.includes("principalFor(base44, req, auth.user, permission, legalEntityId, unitId, approval)"));
  assert(orders.includes('service_evidence_required'));
});

test('interfaces B2B não gravam entidades críticas diretamente', () => {
  for (const page of ['BusinessRegistry.jsx', 'CommercialOperations.jsx']) {
    const source = read(`src/pages/${page}`);
    assert.equal(/base44\.entities\.(BusinessParty|BusinessContract|ServiceOrder)\.(create|update|delete)/.test(source), false);
  }
});

test('rotas e menu B2B usam permissões canônicas', () => {
  const app = read('src/App.jsx');
  const layout = read('src/Layout.jsx');
  assert(app.includes('/business-registry'));
  assert(app.includes('/commercial-operations'));
  assert(app.includes("BusinessRegistry: ['parties.view', 'parties.manage']"));
  assert(layout.includes("permissions: ['parties.view', 'parties.manage']"));
  assert(layout.includes("permissions: ['crm.manage', 'contracts.view', 'contracts.manage', 'service_orders.view', 'service_orders.execute']"));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); console.error(error); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} testes B2B aprovados.`);
if (passed !== tests.length) process.exit(1);
