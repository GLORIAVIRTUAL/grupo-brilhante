#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCommercialAdjustment, selectCommercialApprovalPolicy } from '../base44/shared/commercialApproval.js';
import { postPaymentLoyaltyEarn, reversePaymentLoyalty } from '../base44/shared/loyaltySettlement.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const expectError = (code, fn) => assert.throws(fn, (error) => error?.message === code);

function testCommercialPolicies() {
  const now = Date.parse('2026-09-05T12:00:00Z');
  const globalPolicy = { id: 'global', active: true, version: 5, max_discount_percent: 8 };
  const unitPolicy = { id: 'unit-a-v2', active: true, unit_id: 'unit-a', version: 2, max_discount_percent: 15 };
  const expiredPolicy = { id: 'expired', active: true, unit_id: 'unit-a', version: 99, max_discount_percent: 90, valid_until: '2026-01-01T00:00:00Z' };
  assert.equal(selectCommercialApprovalPolicy([globalPolicy, expiredPolicy, unitPolicy], 'unit-a', now)?.id, 'unit-a-v2');
  assert.equal(selectCommercialApprovalPolicy([globalPolicy, expiredPolicy], 'unit-b', now)?.id, 'global');

  const base = {
    role: 'attendant', permissions: [], mfaStatus: 'verified', subtotalCents: 10_000,
    discountCents: 1_000, additionCents: 0, reason: 'Ajuste autorizado no atendimento',
    policy: { active: true, max_discount_percent: 10, max_addition_percent: 5, requires_reason_above_percent: 0, require_mfa_above_percent: 20 },
  };
  assert.equal(evaluateCommercialAdjustment(base).discountPercent, 10);
  expectError('commercial_approval_required', () => evaluateCommercialAdjustment({ ...base, discountCents: 1_100 }));
  expectError('commercial_approval_required', () => evaluateCommercialAdjustment({ ...base, discountCents: 0, additionCents: 600 }));
  expectError('adjustment_reason_required', () => evaluateCommercialAdjustment({ ...base, reason: 'curto' }));
  expectError('mfa_required_for_adjustment', () => evaluateCommercialAdjustment({ ...base, discountCents: 2_000, policy: { ...base.policy, max_discount_percent: 25 }, mfaStatus: 'pending' }));
  assert.doesNotThrow(() => evaluateCommercialAdjustment({ ...base, discountCents: 5_000, role: 'admin', mfaStatus: 'verified' }));
  assert.doesNotThrow(() => evaluateCommercialAdjustment({ ...base, discountCents: 5_000, permissions: ['quotes.discount_override'], mfaStatus: 'verified' }));
  assert.doesNotThrow(() => evaluateCommercialAdjustment({ ...base, policy: null, discountCents: 1_000 }));
  expectError('commercial_approval_required', () => evaluateCommercialAdjustment({ ...base, policy: null, discountCents: 1_100 }));
}

async function testFunctionSecurity() {
  const env = new Map([['INTERNAL_FUNCTION_TOKEN', 'internal-test-token']]);
  globalThis.Deno = { env: { get: (key) => env.get(key) } };
  const { authorizeUserOrInternal, requireInternalRequest } = await import('../base44/shared/functionSecurity.js');
  const events = [];
  const makeBase44 = (user, policies = []) => ({
    auth: { me: async () => user },
    asServiceRole: { entities: {
      AccessPolicy: { filter: async () => policies },
      UserSessionEvent: { create: async (data) => { events.push(data); return data; } },
    } },
  });
  const request = (headers = {}) => new Request('https://example.invalid/function', { method: 'POST', headers });

  assert.equal(requireInternalRequest(request({ 'x-internal-token': 'internal-test-token' })).kind, 'internal');
  expectError('Chamada interna não autorizada.', () => requireInternalRequest(request({ 'x-internal-token': 'wrong' })));
  const internal = await authorizeUserOrInternal(makeBase44(null), request({ 'x-internal-token': 'internal-test-token' }), {});
  assert.equal(internal.kind, 'internal');

  await assert.rejects(
    authorizeUserOrInternal(makeBase44({ id: 'u1', role: 'attendant', status: 'suspended' }), request(), {}, { allowInternal: false }),
    (error) => error?.code === 'ACCOUNT_BLOCKED',
  );
  await assert.rejects(
    authorizeUserOrInternal(makeBase44({ id: 'u2', role: 'attendant', status: 'active', primary_unit_id: 'unit-a' }), request(), {}, { allowInternal: false, unitId: 'unit-b' }),
    (error) => error?.code === 'UNIT_SCOPE_DENIED',
  );
  await assert.rejects(
    authorizeUserOrInternal(makeBase44({ id: 'u3', role: 'manager', status: 'active', require_mfa: true, mfa_status: 'pending' }), request(), {}, { allowInternal: false }),
    (error) => error?.code === 'MFA_REQUIRED',
  );
  await assert.rejects(
    authorizeUserOrInternal(makeBase44({ id: 'u3-role', role: 'admin', status: 'active', require_mfa: false, mfa_status: 'pending' }), request(), {}, { allowInternal: false }),
    (error) => error?.code === 'MFA_REQUIRED',
  );

  const jwt = (iat) => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ iat })).toString('base64url')}.test`;
  const revokedUser = { id: 'u4', role: 'manager', status: 'active', mfa_status: 'verified', session_revoked_after: '2026-09-05T12:00:00Z' };
  await assert.rejects(
    authorizeUserOrInternal(makeBase44(revokedUser), request({ authorization: `Bearer ${jwt(Date.parse('2026-09-05T11:59:00Z') / 1000)}` }), {}, { allowInternal: false }),
    (error) => error?.code === 'SESSION_REVOKED',
  );
  const current = await authorizeUserOrInternal(makeBase44(revokedUser), request({ authorization: `Bearer ${jwt(Date.parse('2026-09-05T12:01:00Z') / 1000)}` }), {}, { allowInternal: false });
  assert.equal(current.kind, 'user');
  assert.ok(events.length >= 3);
}

function createLoyaltyMock() {
  const store = {
    customers: [{ id: 'customer-1', unit_id: 'unit-1', loyalty_points_balance: 0 }],
    programs: [{ id: 'program-1', unit_id: 'unit-1', status: 'active', earning_type: 'amount', points_per_currency: 2, currency_per_point: 0.01, expiration_days: 365, version: 1 }],
    ledgers: [], audits: [],
  };
  let sequence = 0;
  const filter = (rows, query) => rows.filter((row) => Object.entries(query || {}).every(([key, value]) => row[key] === value));
  const base44 = { asServiceRole: { entities: {
    Customer: {
      get: async (id) => store.customers.find((row) => row.id === id) || null,
      update: async (id, patch) => Object.assign(store.customers.find((row) => row.id === id), patch),
    },
    LoyaltyProgram: {
      get: async (id) => store.programs.find((row) => row.id === id) || null,
      filter: async (query) => filter(store.programs, query),
    },
    LoyaltyLedger: {
      filter: async (query) => filter(store.ledgers, query),
      create: async (data) => { const row = { id: `ledger-${++sequence}`, ...data }; store.ledgers.push(row); return row; },
    },
    AuditLog: { create: async (data) => { store.audits.push(data); return data; } },
  } } };
  return { base44, store };
}

async function testLoyaltySettlement() {
  const { base44, store } = createLoyaltyMock();
  const params = {
    customerId: 'customer-1', unitId: 'unit-1', orderIds: ['order-1'], receiptId: 'receipt-1', receiptNumber: 'REC-1',
    paymentId: 'payment-1', amount: 100, serviceCount: 2, receiptSettled: true,
    user: { id: 'user-1', role: 'cashier', email: 'operator@example.invalid' }, requestId: 'request-1',
  };
  const posted = await postPaymentLoyaltyEarn(base44, params);
  assert.equal(posted.status, 'posted');
  assert.equal(posted.ledger.points, 200);
  assert.equal(store.customers[0].loyalty_points_balance, 200);

  const duplicate = await postPaymentLoyaltyEarn(base44, params);
  assert.equal(duplicate.status, 'idempotent');
  assert.equal(store.ledgers.length, 1);

  const reversed = await reversePaymentLoyalty(base44, { customerId: 'customer-1', receiptId: 'receipt-1', reason: 'Estorno integral autorizado', user: params.user, requestId: 'request-2' });
  assert.equal(reversed.status, 'reversed');
  assert.equal(store.customers[0].loyalty_points_balance, 0);
  assert.equal(store.ledgers.filter((entry) => entry.entry_type === 'reverse').length, 1);

  const duplicateReversal = await reversePaymentLoyalty(base44, { customerId: 'customer-1', receiptId: 'receipt-1', reason: 'Estorno integral autorizado', user: params.user, requestId: 'request-3' });
  assert.equal(duplicateReversal.status, 'idempotent');
  assert.equal(store.ledgers.length, 2);
}

function assertStaticSecurityContracts() {
  const guardedFunctions = {
    'base44/functions/aiReplyTrigger/entry.ts': 'requireInternalRequest',
    'base44/functions/orchestrator/entry.ts': 'requireInternalRequest',
    'base44/functions/scheduled_automations/entry.ts': 'requireInternalRequest',
    'base44/functions/recoverUnansweredMessages/entry.ts': 'authorizeUserOrInternal',
    'base44/functions/checkInactiveNewCustomers/entry.ts': 'requireInternalRequest',
    'base44/functions/zapi_webhook_receiver/entry.ts': 'requireProviderToken',
    'base44/functions/zapi_moinhos_webhook/entry.ts': 'requireProviderToken',
    'base44/functions/whatsapp_moinhos_webhook/entry.ts': 'requireMetaSignature',
    'base44/functions/openai_vision/entry.ts': 'authorizeUserOrInternal',
    'base44/functions/zapi_media_downloader/entry.ts': 'requireInternalRequest',
  };
  for (const [file, marker] of Object.entries(guardedFunctions)) assert.match(read(file), new RegExp(marker), `${file} sem ${marker}`);

  const functionsRoot = path.join(ROOT, 'base44/functions');
  const serviceRoleFunctions = fs.readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(functionsRoot, entry.name, 'entry.ts')))
    .map((entry) => `base44/functions/${entry.name}/entry.ts`)
    .filter((file) => read(file).includes('asServiceRole'));
  assert.ok(serviceRoleFunctions.length >= 80, 'Cobertura inesperadamente baixa de funções com service role.');
  for (const file of serviceRoleFunctions) {
    assert.match(
      read(file),
      /authorizeUserOrInternal|enforceExistingUserSecurity|requireInternalRequest|requireProviderToken|requireMetaSignature|stripe\.webhooks\.constructEvent/,
      `${file} usa service role sem guard explícito`,
    );
  }

  const recurringExpenses = read('base44/functions/generateRecurringExpenses/entry.ts');
  assert.match(recurringExpenses, /authorizeUserOrInternal/);
  assert.doesNotMatch(recurringExpenses, /AUTOMATION_INTERNAL_TOKEN/);
  const integrationStatus = read('base44/functions/integration_status/entry.ts');
  assert.match(integrationStatus, /authorizeUserOrInternal/);
  assert.match(integrationStatus, /INTERNAL_FUNCTION_TOKEN/);
  assert.doesNotMatch(integrationStatus, /AUTOMATION_INTERNAL_TOKEN|ASAAS_WEBHOOK_SECRET/);

  const mediaDownloader = read('base44/functions/zapi_media_downloader/entry.ts');
  for (const marker of ['Deno.resolveDns', 'MEDIA_DNS_BLOCKED', 'redirect: \'error\'', 'MAX_MEDIA_BYTES']) assert.match(mediaDownloader, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const orchestrator = read('base44/functions/orchestrator/entry.ts');
  assert.match(orchestrator, /_internal_token:\s*Deno\.env\.get\('INTERNAL_FUNCTION_TOKEN'\)/);
  assert.match(read('base44/functions/schedulePickupTool/entry.ts'), /requireInternalRequest/);
  assert.match(read('base44/functions/processDispatchQueue/entry.ts'), /authorizeUserOrInternal/);
  assert.doesNotMatch(orchestrator, /const invokeSender = \(payload\) => invokeSender\(/);

  const report = read('base44/functions/generateReport/entry.ts');
  assert.match(report, /legacy_report_retired/);
  assert.match(report, /status:\s*410/);
  assert.doesNotMatch(report, /Cristiano|Marla|17\/04\/2026|\.\.\.\d{8}/);

  const layout = read('src/Layout.jsx');
  assert.match(layout, /logout\(true\)/);
  assert.doesNotMatch(layout, /cachedLayoutUser|base44\.auth\.me\(\)/);
  const app = read('src/App.jsx');
  assert.match(app, /PageAccessGuard/);
  assert.match(app, /register-unit/);
  const auth = read('src/lib/AuthContext.jsx');
  assert.match(auth, /check_access_session/);
  assert.match(auth, /effective_permissions/);
  assert.match(auth, /access_unavailable/);
  assert.doesNotMatch(auth, /keeping session and retrying/i);
  const accessControl = read('src/lib/accessControl.js');
  assert.match(accessControl, /ROLE_DEFINITIONS/);
  assert.match(accessControl, /normalizeLegacyRole/);

  const quoteLifecycle = read('base44/functions/manage_quote_lifecycle/entry.ts');
  for (const marker of ['CommercialApprovalPolicy', 'selectCommercialApprovalPolicy', 'evaluateCommercialAdjustment', 'approval_policy_id']) assert.match(quoteLifecycle, new RegExp(marker));
  const quoteReview = read('src/components/crm/QuoteReviewModal.jsx');
  assert.match(quoteReview, /manage_quote_lifecycle/);
  assert.doesNotMatch(quoteReview, /entities\.Quote\.update/);
  assert.match(quoteReview, /adjustmentReason/);

  for (const senderFile of ['base44/functions/zapi_sender/entry.ts', 'base44/functions/zapi_moinhos_sender/entry.ts', 'base44/functions/whatsapp_moinhos_sender/entry.ts']) {
    const sender = read(senderFile);
    for (const marker of ['CUSTOMER_CONTEXT_REQUIRED', 'PHONE_CONTEXT_MISMATCH', 'UNIT_SCOPE_DENIED', 'AbortSignal.timeout']) assert.match(sender, new RegExp(marker));
    assert.doesNotMatch(sender, /console\.(?:log|warn|error)[^\n]*(?:zapiUrl|graphPayload|JSON\.stringify\(payload\)|\bphone\b)/i);
  }

  const quoteSchema = JSON.parse(read('base44/entities/Quote.jsonc'));
  const adjustmentFields = quoteSchema.properties.price_adjustments.items.properties;
  assert.ok(adjustmentFields.approval_policy_id && adjustmentFields.approval_policy_version);

  const orderBenefits = read('base44/functions/manage_order_benefits/entry.ts');
  for (const marker of ['applyVoucher', 'applyPackage', 'restoreBenefits', 'ProcessedEvent', 'benefit_requires_unpaid_order', 'voucherValue', 'consumePackageBalance', 'benefit_restore_keys', 'package_restore_conflict', 'package_value_exceeds_order_balance', 'benefit_use_forbidden']) assert.match(orderBenefits, new RegExp(marker));
  const receiptDialog = read('src/components/management/PaymentReceiptDialog.jsx');
  for (const marker of ['manage_order_benefits', 'apply_voucher', 'apply_package', 'voucherCode', 'packageChoice']) assert.match(receiptDialog, new RegExp(marker));

  for (const file of ['base44/functions/manage_payment_receipt/entry.ts', 'base44/functions/confirm_payment_tender/entry.ts', 'base44/functions/record_counter_payment/entry.ts', 'base44/functions/reconcile_payment/entry.ts', 'base44/functions/stripe_webhook/entry.ts']) {
    assert.match(read(file), /postPaymentLoyaltyEarn/, `${file} sem sincronização de pontos`);
  }
  const confirmationEngine = read('base44/functions/confirm_payment_tender/entry.ts');
  for (const marker of ['confirmation_processing_repair_required', 'idempotency_conflict', 'priorAllocations']) assert.match(confirmationEngine, new RegExp(marker));
  const counterPayment = read('base44/functions/record_counter_payment/entry.ts');
  for (const marker of ['counter_payment_processing_repair_required', 'idempotency_conflict', "status: 'open'", "payment_status: 'pending_confirmation'"]) assert.match(counterPayment, new RegExp(marker));
  assert.doesNotMatch(counterPayment, /payment_status:\s*'pending'/);
  const reconciliation = read('base44/functions/reconcile_payment/entry.ts');
  for (const marker of ['reconciliation_processing_repair_required', 'payment_already_reconciled', 'payment_receipt_requires_tender_confirmation', 'priorAllocations', 'idempotency_conflict']) assert.match(reconciliation, new RegExp(marker));
  const receiptEngine = read('base44/functions/manage_payment_receipt/entry.ts');
  for (const marker of ['reversePaymentLoyalty', 'manage_order_benefits', 'benefitRestorations', 'receipt_processing_repair_required', 'customer_balance_applied', 'customer_credit_repair_conflict', 'payment_reversal_repair_conflict']) assert.match(receiptEngine, new RegExp(marker));
  assert.match(receiptEngine, /existingEvents\[0\].*payload_hash/);
  assert.match(receiptEngine, /Number\(item\.applied_amount \?\? item\.amount \?\? 0\) > 0/);

  const selectedSources = [
    'base44/shared/functionSecurity.js', 'base44/shared/loyaltySettlement.js', 'base44/shared/commercialApproval.js',
    ...Object.keys(guardedFunctions),
  ].map(read).join('\n');
  assert.doesNotMatch(selectedSources, /(sk_live_|whsec_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{24,})/);
}

testCommercialPolicies();
await testFunctionSecurity();
await testLoyaltySettlement();
assertStaticSecurityContracts();
console.log('AUDIT SECURITY TESTS OK: alçadas, fidelidade, guards, logout e relatório legado verificados.');
