import { calculateEarnedPoints, pointsMonetaryValue, roundPoints } from './loyaltyMath.js';

function isProgramActive(program, now = Date.now()) {
  return Boolean(program)
    && program.status === 'active'
    && (!program.valid_from || new Date(program.valid_from).getTime() <= now)
    && (!program.valid_until || new Date(program.valid_until).getTime() >= now);
}

function isCustomerEligible(program, customer) {
  const eligibleGroups = Array.isArray(program?.eligible_customer_groups) ? program.eligible_customer_groups.filter(Boolean) : [];
  return eligibleGroups.length === 0 || eligibleGroups.includes(customer?.customer_group) || eligibleGroups.includes(customer?.segment);
}

async function selectProgram(base44, customer, unitId) {
  if (customer?.loyalty_program_id) {
    const enrolled = await base44.asServiceRole.entities.LoyaltyProgram.get(customer.loyalty_program_id);
    if (isProgramActive(enrolled) && (!enrolled.unit_id || enrolled.unit_id === unitId) && isCustomerEligible(enrolled, customer)) return enrolled;
  }

  const programs = await base44.asServiceRole.entities.LoyaltyProgram.filter({ status: 'active' }, '-version', 100);
  return programs
    .filter((program) => isProgramActive(program) && (!program.unit_id || program.unit_id === unitId) && isCustomerEligible(program, customer))
    .sort((left, right) => Number(Boolean(right.unit_id)) - Number(Boolean(left.unit_id)) || Number(right.version || 0) - Number(left.version || 0))[0] || null;
}

async function currentBalance(base44, customerId, programId) {
  const entries = await base44.asServiceRole.entities.LoyaltyLedger.filter({ customer_id: customerId, program_id: programId }, 'occurred_at', 5000);
  return roundPoints(entries.reduce((sum, entry) => sum + Number(entry.points || 0), 0));
}

async function audit(base44, user, requestId, entity, action, reason, beforeData) {
  await base44.asServiceRole.entities.AuditLog.create({
    action,
    entity_type: 'loyalty_ledger',
    entity_id: entity.id,
    item_label: entity.id,
    reason,
    user_email: user?.email,
    user_name: user?.full_name || user?.display_name,
    user_role: user?.role,
    unit_id: entity.unit_id,
    request_id: requestId,
    before_data: beforeData,
    after_data: entity,
    domain: 'loyalty',
    severity: action === 'refund' ? 'notice' : 'info',
    result: 'success',
    occurred_at: new Date().toISOString(),
    success: true,
  });
}

export async function postPaymentLoyaltyEarn(base44, params) {
  const amount = Math.max(0, Number(params.amount || 0));
  if (!params.customerId || (!params.receiptId && !params.paymentId) || amount <= 0) return { status: 'skipped', reason: 'no_eligible_amount' };

  const customer = await base44.asServiceRole.entities.Customer.get(params.customerId);
  if (!customer) return { status: 'skipped', reason: 'customer_not_found' };
  const program = await selectProgram(base44, customer, params.unitId);
  if (!program) return { status: 'skipped', reason: 'no_active_program' };

  const earningType = String(program.earning_type || 'amount');
  if (earningType === 'manual') return { status: 'skipped', reason: 'manual_program' };
  if (earningType !== 'amount' && !params.receiptSettled) return { status: 'skipped', reason: 'awaiting_full_settlement' };

  const sourceKey = earningType === 'amount'
    ? `payment:${params.paymentId || params.receiptId}`
    : `receipt:${params.receiptId || params.paymentId}`;
  const idempotencyKey = `loyalty-earn:${program.id}:${sourceKey}`;
  const existing = await base44.asServiceRole.entities.LoyaltyLedger.filter({ idempotency_key: idempotencyKey }, '-occurred_at', 1);
  if (existing[0]) return { status: 'idempotent', ledger: existing[0] };

  const points = calculateEarnedPoints(program, amount, Number(params.serviceCount || 0), 1);
  if (points <= 0) return { status: 'skipped', reason: 'zero_points' };
  const balanceBefore = await currentBalance(base44, customer.id, program.id);
  const balanceAfter = roundPoints(balanceBefore + points);
  const now = new Date().toISOString();
  const ledger = await base44.asServiceRole.entities.LoyaltyLedger.create({
    customer_id: customer.id,
    program_id: program.id,
    unit_id: params.unitId || customer.unit_id || program.unit_id,
    entry_type: 'earn',
    points,
    balance_after: balanceAfter,
    monetary_value: pointsMonetaryValue(program, points),
    order_id: params.orderIds?.length === 1 ? params.orderIds[0] : undefined,
    payment_receipt_id: params.receiptId || undefined,
    expires_at: Number(program.expiration_days || 0) > 0 ? new Date(Date.now() + Number(program.expiration_days) * 86400000).toISOString() : undefined,
    occurred_at: now,
    created_by_user_id: params.user?.id,
    reason: `Pontos por pagamento confirmado ${params.receiptNumber || params.receiptId || params.paymentId}`,
    idempotency_key: idempotencyKey,
    metadata: {
      source: 'payment_settlement',
      payment_id: params.paymentId,
      receipt_status: params.receiptSettled ? 'settled' : 'partially_settled',
      amount,
      request_id: params.requestId,
    },
  });
  await base44.asServiceRole.entities.Customer.update(customer.id, {
    loyalty_points_balance: balanceAfter,
    loyalty_program_id: program.id,
    last_crm_snapshot_at: now,
  });
  await audit(base44, params.user, params.requestId, ledger, 'create', ledger.reason, { balance: balanceBefore });
  return { status: 'posted', ledger, balance: balanceAfter };
}

export async function reversePaymentLoyalty(base44, params) {
  if (!params.customerId || !params.receiptId) return { status: 'skipped', reason: 'receipt_customer_required' };
  const earningEntries = await base44.asServiceRole.entities.LoyaltyLedger.filter({ payment_receipt_id: params.receiptId }, 'occurred_at', 5000);
  const earnEntries = earningEntries.filter((entry) => entry.entry_type === 'earn' && Number(entry.points || 0) > 0);
  if (earnEntries.length === 0) return { status: 'skipped', reason: 'no_earnings' };

  const customer = await base44.asServiceRole.entities.Customer.get(params.customerId);
  const created = [];
  let finalBalance = Number(customer?.loyalty_points_balance || 0);
  for (const earning of earnEntries) {
    const idempotencyKey = `loyalty-reverse:${earning.id}:${params.receiptId}`;
    const existing = await base44.asServiceRole.entities.LoyaltyLedger.filter({ idempotency_key: idempotencyKey }, '-occurred_at', 1);
    if (existing[0]) {
      finalBalance = Number(existing[0].balance_after || finalBalance);
      continue;
    }
    const balanceBefore = await currentBalance(base44, earning.customer_id, earning.program_id);
    const points = -Math.abs(Number(earning.points || 0));
    finalBalance = roundPoints(balanceBefore + points);
    const ledger = await base44.asServiceRole.entities.LoyaltyLedger.create({
      customer_id: earning.customer_id,
      program_id: earning.program_id,
      unit_id: earning.unit_id,
      entry_type: 'reverse',
      points,
      balance_after: finalBalance,
      monetary_value: earning.monetary_value || 0,
      order_id: earning.order_id,
      payment_receipt_id: params.receiptId,
      reference_entry_id: earning.id,
      occurred_at: new Date().toISOString(),
      created_by_user_id: params.user?.id,
      reason: params.reason,
      idempotency_key: idempotencyKey,
      metadata: { source: 'payment_reversal', request_id: params.requestId },
    });
    created.push(ledger);
    await audit(base44, params.user, params.requestId, ledger, 'refund', params.reason, { balance: balanceBefore, earning_entry_id: earning.id });
  }

  if (customer && created.length > 0) {
    await base44.asServiceRole.entities.Customer.update(customer.id, { loyalty_points_balance: finalBalance, last_crm_snapshot_at: new Date().toISOString() });
  }
  return { status: created.length > 0 ? 'reversed' : 'idempotent', ledgers: created, balance: finalBalance };
}
