import assert from 'node:assert/strict';
import {
  ROLE_DEFINITIONS,
  VALID_PERMISSIONS,
  normalizeLegacyRole,
  effectivePermissions,
} from '../base44/shared/accessGovernance.js';
import {
  money,
  groupSum,
  groupCount,
  dailySeries,
  percent,
  openStatus,
  reportEnvelope,
} from '../base44/shared/reportAnalytics.js';
import {
  calculateEarnedPoints,
  validateRedemption,
  voucherValue,
  consumePackageBalance,
} from '../base44/shared/loyaltyMath.js';

function expectError(code, operation) {
  assert.throws(operation, (error) => error instanceof Error && error.message === code);
}

// Governança: papéis legados são normalizados e políticas podem conceder/negar por unidade.
assert.equal(normalizeLegacyRole('user'), 'attendant');
assert.equal(normalizeLegacyRole('entregador'), 'driver');
assert.equal(normalizeLegacyRole('papel_inexistente'), 'attendant');
assert.equal(ROLE_DEFINITIONS.admin.mfaRequired, true);
assert.equal(ROLE_DEFINITIONS.driver.mfaRequired, false);
assert.equal(VALID_PERMISSIONS.has('audit.export'), true);
assert.equal(VALID_PERMISSIONS.has('reports.view_all'), true);

const governedUser = { role: 'manager', primary_unit_id: 'unit-a', allowed_unit_ids: ['unit-b'], permissions: ['reports.export'] };
const permissions = effectivePermissions(governedUser, [
  { status: 'active', role: 'manager', unit_id: 'unit-a', permissions: ['prices.activate'], denied_permissions: ['audit.export'] },
  { status: 'active', role: 'manager', unit_id: 'unit-c', permissions: ['users.manage'], denied_permissions: [] },
]);
assert.equal(permissions.includes('reports.export'), true);
assert.equal(permissions.includes('prices.activate'), true);
assert.equal(permissions.includes('users.manage'), false);
assert.equal(permissions.includes('audit.export'), false);

// Analytics: somas, agrupamentos, séries e percentuais mantêm consistência monetária.
assert.equal(money(10.005), 10.01);
assert.deepEqual(groupSum([
  { unit: 'A', amount: 10.1 },
  { unit: 'A', amount: 2.2 },
  { unit: 'B', amount: 5 },
], (row) => row.unit, (row) => row.amount), [
  { label: 'A', value: 12.3 },
  { label: 'B', value: 5 },
]);
assert.deepEqual(groupCount([{ status: 'late' }, { status: 'late' }, { status: 'ok' }], (row) => row.status), [
  { label: 'late', value: 2 },
  { label: 'ok', value: 1 },
]);
assert.deepEqual(dailySeries([
  { occurred_at: '2026-09-01T10:00:00Z', value: 10 },
  { occurred_at: '2026-09-01T15:00:00Z', value: 2.5 },
  { occurred_at: '2026-09-02T10:00:00Z', value: 3 },
], (row) => row.value), [
  { date: '2026-09-01', value: 12.5 },
  { date: '2026-09-02', value: 3 },
]);
assert.equal(percent(25, 40), 62.5);
assert.equal(openStatus('in_progress'), true);
assert.equal(openStatus('completed'), false);
const envelope = reportEnvelope('production', { total: 2 }, [], [], [{ id: 1 }, { id: 2 }], ['definição']);
assert.equal(envelope.report_type, 'production');
assert.equal(envelope.data_quality.rows_considered, 2);

// Fidelidade: acúmulo, resgate, limites, vouchers e pacotes nunca geram saldo negativo.
const loyaltyProgram = {
  status: 'active',
  earning_type: 'amount',
  points_per_currency: 1.5,
  currency_per_point: 0.1,
  minimum_redeem_points: 20,
  maximum_redeem_percent: 50,
};
assert.equal(calculateEarnedPoints(loyaltyProgram, 100), 150);
assert.deepEqual(validateRedemption({ balance: 200, points: 50, program: loyaltyProgram, orderAmount: 20 }), { points: 50, value: 5 });
expectError('insufficient_points', () => validateRedemption({ balance: 10, points: 50, program: loyaltyProgram, orderAmount: 100 }));
expectError('maximum_redeem_exceeded', () => validateRedemption({ balance: 200, points: 150, program: loyaltyProgram, orderAmount: 20 }));
assert.equal(voucherValue({ status: 'active', voucher_type: 'percent', percent: 30, usage_limit: 1, usage_count: 0, maximum_discount_amount: 25 }, 100), 25);
expectError('voucher_expired', () => voucherValue({ status: 'active', voucher_type: 'fixed_amount', amount: 10, usage_limit: 1, usage_count: 0, valid_until: '2020-01-01T00:00:00Z' }, 50));
const packageResult = consumePackageBalance({ service_balances: [{ service_id: 'wash', remaining_quantity: 3 }] }, 'wash', 2);
assert.equal(packageResult.balanceAfter, 1);
assert.equal(packageResult.exhausted, false);
expectError('insufficient_package_balance', () => consumePackageBalance({ service_balances: [{ service_id: 'wash', remaining_quantity: 1 }] }, 'wash', 2));

console.log('TESTES OK: governança, analytics, fidelidade, vouchers e pacotes da Onda 4.');
