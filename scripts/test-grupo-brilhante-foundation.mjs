import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.Deno = { env: { get: (name) => process.env[name] } };

const enterprise = await import(path.join(root, 'base44/shared/enterpriseCore.js'));
const widget = await import(path.join(root, 'base44/shared/publicWidgetSecurity.js'));

function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

process.env.PUBLIC_WIDGET_ORIGIN_ALLOWLIST = 'https://erp.grupobrilhante.com.br,https://www.grupobrilhante.com.br';
process.env.PUBLIC_WIDGET_HASH_PEPPER = 'test-only-pepper-not-a-production-secret';
process.env.PUBLIC_WIDGET_SESSION_TTL_MINUTES = '30';
process.env.PUBLIC_WIDGET_MAX_MESSAGES = '20';
process.env.PUBLIC_WIDGET_STARTS_PER_HOUR = '5';

test('normaliza códigos empresariais', () => {
  assert.equal(enterprise.normalizeEnterpriseCode(' Grupo Brilhante / Matriz '), 'GRUPO-BRILHANTE-MATRIZ');
});

test('valida CNPJ e rejeita sequências inválidas', () => {
  assert.equal(enterprise.isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(enterprise.isValidCnpj('11.111.111/1111-11'), false);
  assert.equal(enterprise.validateTaxId('11.222.333/0001-81', 'company').normalized, '11222333000181');
});

test('integrações só produzem efeitos em produção', () => {
  for (const state of ['disabled', 'configured', 'homologation', 'approved', 'suspended']) assert.equal(enterprise.integrationCanProduceRealEffects(state), false);
  assert.equal(enterprise.integrationCanProduceRealEffects('production'), true);
  assert.equal(enterprise.normalizeIntegrationStatus('qualquer'), 'disabled');
});

test('token público é opaco e hash não expõe o token', async () => {
  const token = widget.randomWidgetToken();
  assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
  const hash = await widget.sha256Hex(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
});

test('origem pública é obrigatoriamente permitida', () => {
  const allowed = new Request('https://api.exemplo.test', { headers: { origin: 'https://erp.grupobrilhante.com.br' } });
  assert.equal(widget.requireWidgetOrigin(allowed), 'https://erp.grupobrilhante.com.br');
  const denied = new Request('https://api.exemplo.test', { headers: { origin: 'https://malicioso.test' } });
  assert.throws(() => widget.requireWidgetOrigin(denied), (error) => error.code === 'WIDGET_ORIGIN_DENIED');
});

test('sessão pública vincula token, conversa, origem, empresa e unidade', async () => {
  const sessions = [];
  let sequence = 0;
  const base44 = { asServiceRole: { entities: { PublicConversationSession: {
    filter: async (query) => sessions.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value)),
    create: async (payload) => { const row = { id: `session-${++sequence}`, created_date: new Date().toISOString(), ...payload }; sessions.push(row); return row; },
    update: async (id, patch) => { const row = sessions.find((item) => item.id === id); Object.assign(row, patch); return row; },
  } } } };
  const req = new Request('https://api.exemplo.test', { headers: { origin: 'https://erp.grupobrilhante.com.br', 'x-forwarded-for': '203.0.113.10', 'user-agent': 'Teste ERP' } });
  const created = await widget.createWidgetSession(base44, req, { conversationId: 'conv-1', customerId: 'customer-1', legalEntityId: 'company-1', unitId: 'unit-1' });
  assert.equal(created.session.legal_entity_id, 'company-1');
  assert.equal(created.session.unit_id, 'unit-1');
  const authorized = await widget.authorizeWidgetSession(base44, req, { session_key: created.session.session_key, session_token: created.token, conversation_id: 'conv-1' });
  assert.equal(authorized.id, created.session.id);
  await assert.rejects(
    widget.authorizeWidgetSession(base44, req, { session_key: created.session.session_key, session_token: created.token, conversation_id: 'conv-2' }),
    (error) => error.code === 'WIDGET_CONVERSATION_DENIED',
  );
});

test('schemas novos e ampliados são JSON válido', () => {
  const schemas = [
    'BusinessGroup', 'LegalEntity', 'CostCenter', 'BankAccount', 'Warehouse', 'CompanyAccessGrant',
    'PublicConversationSession', 'IntegrationJob', 'RepairTask', 'DomainEvent', 'DocumentAsset',
    'Unit', 'User', 'Order', 'Quote', 'Payment', 'Pickup',
  ];
  for (const schema of schemas) JSON.parse(read(`base44/entities/${schema}.jsonc`));
});

test('nenhum fallback usa app id ou domínio do sistema antigo', () => {
  const targets = ['base44/functions', 'base44/shared', 'src/App.jsx', 'src/Layout.jsx', 'src/components/landing/QuoteWidget.jsx'];
  const queue = targets.flatMap((target) => {
    const absolute = path.join(root, target);
    if (fs.statSync(absolute).isFile()) return [absolute];
    return fs.readdirSync(absolute, { recursive: true }).filter((entry) => /\.(js|jsx|ts|tsx)$/.test(entry)).map((entry) => path.join(absolute, entry));
  });
  const combined = queue.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.equal(combined.includes('6a99e42ee48200f5d8ddd176'), false);
  assert.equal(combined.includes('lavanderia-5asec-connect-copy-d8ddd176.base44.app'), false);
  assert.equal(combined.includes('chat5asec.com.br'), false);
});

test('webhook Asaas não aceita segredo em query string', () => {
  const source = read('base44/functions/asaas_webhook/entry.ts');
  assert.equal(source.includes("searchParams.get('token')"), false);
  assert.equal(source.includes('requireProviderToken'), true);
});

test('agenda exige unidade e limita dois encaixes por dia', () => {
  const source = read('base44/shared/encaixeScheduler.js');
  assert.equal(source.includes('unit_scope_required'), true);
  assert.equal(source.includes('unit_id: scope.unitId'), true);
  assert.equal(source.includes('encaixeCount >= 2'), true);
});

test('autenticação do frontend permanece fail-closed', () => {
  const source = read('src/lib/AuthContext.jsx');
  assert.equal(source.includes('usando papel do usuário'), false);
  assert.equal(source.includes('effective_legal_entity_ids'), true);
});

test('documentos são registrados server-side', () => {
  const source = read('src/lib/secureFiles.js');
  assert.equal(source.includes("base44.entities.DocumentAsset.create"), false);
  assert.equal(source.includes("manage_document_assets"), true);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} testes da fundação aprovados.`);
if (passed !== tests.length) process.exit(1);
