import assert from 'node:assert/strict';
import { calculateReceiptPlan, toCents } from '../base44/shared/paymentMath.js';
import { buildFiscalDraft, getFiscalReadiness, validateFiscalProfile } from '../base44/shared/fiscalProviderContract.js';

function shouldThrow(fn, expected) {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `Era esperado erro ${expected}`);
  assert.equal(thrown.message, expected);
}

const mixed = calculateReceiptPlan({
  targets: [{ key: 'order:o1', type: 'order', id: 'o1', open_amount: 80 }, { key: 'receivable:r1', type: 'receivable', id: 'r1', open_amount: 20 }],
  tenders: [{ method: 'pix', amount: 60, confirmed: true }, { method: 'cash', amount: 50, confirmed: true }],
});
assert.equal(mixed.amount_due, 100);
assert.equal(mixed.amount_tendered, 110);
assert.equal(mixed.amount_applied, 100);
assert.equal(mixed.change_amount, 10);
assert.equal(mixed.pending_amount, 0);
assert.equal(mixed.tenders[0].allocations[0].amount, 60);
assert.equal(mixed.tenders[1].applied_amount, 40);

const partial = calculateReceiptPlan({
  targets: [{ key: 'order:o1', type: 'order', id: 'o1', open_amount: 100 }],
  tenders: [{ method: 'cash', amount: 35, confirmed: true }],
});
assert.equal(partial.amount_applied, 35);
assert.equal(partial.change_amount, 0);

const pending = calculateReceiptPlan({
  targets: [{ key: 'order:o1', type: 'order', id: 'o1', open_amount: 100 }],
  tenders: [{ method: 'pix', amount: 75, confirmed: false }],
});
assert.equal(pending.amount_applied, 0);
assert.equal(pending.pending_amount, 75);
assert.equal(pending.tenders[0].allocations.length, 0);

shouldThrow(() => calculateReceiptPlan({
  targets: [{ key: 'order:o1', type: 'order', id: 'o1', open_amount: 50 }],
  tenders: [{ method: 'pix', amount: 60, confirmed: true }],
}), 'non_cash_overpayment_not_allowed');

assert.equal(toCents(10.005), 1001);

const profile = {
  id: 'profile-1', unit_id: 'unit-1', environment: 'disabled', provider: 'national_nfse', municipality_code: '4314902', municipality_name: 'Porto Alegre',
  legal_name: 'Lavanderia Teste Ltda', tax_id: '12345678000199', municipal_registration: '1234567', service_code: '14.10',
  service_description: 'Serviços de lavanderia', municipal_tax_code: '141001', iss_rate: 5, iss_withheld: false, rps_series: '1', next_rps_number: 1,
};
assert.deepEqual(validateFiscalProfile(profile), { valid: true, missing: [] });
const document = buildFiscalDraft({
  profile,
  customer: { id: 'c1', full_name: 'Cliente Teste', tax_id: '12345678901', email: 'cliente@example.com', phone: '51999999999' },
  orders: [{ id: 'o1', ticket_number: 'ORD-1', customer_id: 'c1', total_amount: 100, items: [{ garment_type: 'Camisa', qty: 1, total_amount: 100, services: [{ name: 'Lavagem' }] }] }],
  competenceDate: '2026-09-04',
});
assert.equal(document.provider, 'national_nfse');
assert.equal(document.environment, 'disabled');
assert.equal(document.total_amount, 100);
assert.equal(document.iss_amount, 5);
assert.equal(document.metadata.transmission_enabled, false);
const readiness = getFiscalReadiness(profile, { ...document, order_ids: ['o1'] });
assert.equal(readiness.structurally_ready, true);
assert.equal(readiness.transmission_ready, false);
assert.equal(readiness.transmission_block_reason, 'fiscal_adapter_not_activated');

console.log('TESTES ONDA 2 OK: pagamentos, alocação, troco, pendência e estrutura fiscal.');
