import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assertExternalFiscalAllowed,
  buildFocusNfePayload,
  buildFocusReference,
  fiscalRuntimeConfig,
  focusStatusToDocumentStatus,
  sanitizeFocusNfeResponse,
  validateFiscalProfile,
} from '../base44/shared/fiscalProviderContract.js';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const profile = {
  legal_entity_id: 'company-1', unit_id: 'unit-1', unit_ids: ['unit-1'], legal_name: 'Grupo Brilhante', tax_id: '12.345.678/0001-90', municipality_code: '4314902', municipal_registration: '123', service_code: '14.10', service_description: 'Serviços de lavanderia', rps_series: 'A', next_rps_number: 10, provider: 'focusnfe', environment: 'homologation', external_requests_enabled: false, production_enabled: false, iss_rate: 5, iss_withheld: false,
};
assert.equal(validateFiscalProfile(profile).valid, true, 'perfil completo deve ser válido');
assert.equal(validateFiscalProfile({ ...profile, tax_id: '' }).valid, false, 'CNPJ ausente deve bloquear');
const reference = buildFocusReference({ legalEntityId: 'company-1', taxId: profile.tax_id, series: 'A/1', number: 10, documentId: 'doc-123' });
assert.match(reference, /^[a-zA-Z0-9]+$/, 'referência Focus deve ser estritamente alfanumérica');
assert.ok(reference.length <= 60, 'referência Focus deve respeitar limite seguro');
const payload = buildFocusNfePayload({ document: { recipient: { legal_name: 'Hospital A', tax_id: '11.222.333/0001-44', email: 'fiscal@example.com', address: 'Rua A', address_number: '1', district: 'Centro', municipality_code: '4314902', state: 'RS', zip_code: '90000000' }, subtotal: 100, deduction_amount: 0, iss_amount: 5, total_amount: 100, taxable_amount: 100, iss_withheld: false, discount_amount: 0, service_city_code: '4314902', service_description: 'Lavanderia', items: [{ description: 'Lavagem hospitalar' }] }, profile });
assert.equal(payload.ref, undefined, 'ref deve ir na query e não no corpo');
assert.equal(payload.servico.iss_retido, false, 'ISS retido deve ser booleano');
assert.equal(payload.servico.codigo_municipio, '4314902');
assert.equal(payload.tomador.endereco.codigo_municipio, '4314902');
assert.equal(payload.prestador.cnpj, '12345678000190');
const disabled = fiscalRuntimeConfig((name) => ({ FOCUSNFE_HOMOLOGATION_TOKEN: 'secret' }[name] || ''), profile);
assert.equal(disabled.externalRequestsEnabled, false, 'perfil desligado deve vencer secret presente');
assert.throws(() => assertExternalFiscalAllowed(disabled), /fiscal_external_requests_disabled/);
const enabledHomologation = fiscalRuntimeConfig((name) => ({ FOCUSNFE_HOMOLOGATION_TOKEN: 'secret', FOCUSNFE_EXTERNAL_REQUESTS_ENABLED: 'true' }[name] || ''), { ...profile, external_requests_enabled: true });
assert.doesNotThrow(() => assertExternalFiscalAllowed(enabledHomologation));
const blockedProduction = fiscalRuntimeConfig((name) => ({ FOCUSNFE_PRODUCTION_TOKEN: 'secret', FOCUSNFE_EXTERNAL_REQUESTS_ENABLED: 'true' }[name] || ''), { ...profile, environment: 'production', external_requests_enabled: true, production_enabled: true });
assert.throws(() => assertExternalFiscalAllowed(blockedProduction), /fiscal_production_disabled/);
assert.equal(focusStatusToDocumentStatus('autorizado'), 'authorized');
assert.equal(focusStatusToDocumentStatus('cancelado'), 'cancelled');
assert.equal(focusStatusToDocumentStatus('erro_autorizacao'), 'rejected');
const safe = sanitizeFocusNfeResponse({ status: 'autorizado', ref: 'abc', numero: '7', codigo_verificacao: 'XYZ', url_danfse: 'https://focus.example/doc.pdf', token: 'must-not-survive' });
assert.equal(safe.nfseNumber, '7');
assert.equal('token' in safe, false, 'snapshot não pode preservar campos arbitrários');

for (const schema of ['FiscalProfile', 'FiscalDocument', 'FiscalEvent', 'FiscalWebhookEvent', 'FiscalSequenceReservation']) JSON.parse(read(`base44/entities/${schema}.jsonc`));
const lifecycle = read('base44/functions/manage_fiscal_document/entry.ts');
assert.ok(lifecycle.includes("IntegrationJob.create"), 'comando humano deve criar job');
assert.equal(/\bfetch\s*\(/.test(lifecycle), false, 'lifecycle humano não pode chamar provedor externo');
assert.ok(lifecycle.includes("action === 'set_activation'"), 'ativação precisa de gate explícito');
assert.ok(lifecycle.includes("'fiscal.transmit'"), 'transmissão e ativação exigem permissão crítica');
const gateway = read('base44/functions/focus_nfe_gateway/entry.ts');
assert.ok(gateway.includes('requireInternalRequest(req)'), 'gateway deve ser exclusivamente interno');
assert.ok(gateway.includes('AbortSignal.timeout(20000)'), 'gateway deve aplicar timeout');
assert.ok(gateway.includes('assertExternalFiscalAllowed(runtime)'), 'gateway deve aplicar gates cumulativos');
assert.ok(gateway.includes("Authorization: authHeader(runtime.token)"), 'gateway deve usar Basic Auth no servidor');
const webhook = read('base44/functions/focus_nfe_webhook/entry.ts');
assert.ok(webhook.includes('FOCUSNFE_WEBHOOK_TOKEN'), 'webhook deve falhar sem token dedicado');
assert.ok(webhook.includes('timingSafeEqual'), 'token do webhook deve usar comparação constante');
assert.ok(webhook.includes('FiscalWebhookEvent'), 'webhook deve ter idempotência persistente');
assert.equal(webhook.includes('searchParams'), false, 'webhook não pode aceitar segredo por query string');
const ui = read('src/components/management/FiscalReadinessPanel.jsx');
assert.ok(ui.includes("action: 'queue_transmission'"), 'UI deve apenas enfileirar emissão');
assert.ok(ui.includes("action: 'queue_cancel'"), 'UI deve apenas enfileirar cancelamento');
assert.equal(ui.includes('api.focusnfe.com.br'), false, 'UI não pode construir URL direta do provedor');
assert.equal(ui.includes("action: 'import_ref'"), false, 'consulta externa direta deve estar aposentada');
const app = read('src/App.jsx'); const layout = read('src/Layout.jsx');
assert.ok(app.includes('EnterpriseFiscal') && app.includes("['fiscal.view', 'fiscal.manage', 'fiscal.transmit']"));
assert.ok(layout.includes("path: '/enterprise-fiscal'") && layout.includes("permissions: ['fiscal.view', 'fiscal.manage', 'fiscal.transmit']"));
const env = read('.env.example');
assert.ok(env.includes('FOCUSNFE_EXTERNAL_REQUESTS_ENABLED=false'));
assert.ok(env.includes('FOCUSNFE_PRODUCTION_ENABLED=false'));
assert.ok(read('docs/focus-nfe-homologation.md').includes('A implementação permanece **preparada, mas desativada**'));
console.log('Grupo Brilhante fiscal tests: OK');
