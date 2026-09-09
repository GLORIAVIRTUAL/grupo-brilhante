import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { toCents, fromCents } from '../../shared/paymentMath.js';

const CASH_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance', 'cashier']);
const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);
const SENSITIVE_MOVEMENTS = new Set(['withdrawal', 'refund', 'adjustment_in', 'adjustment_out']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

function signedMovementCents(movement: any) {
  const amount = toCents(movement.amount || 0);
  return ['withdrawal', 'refund', 'adjustment_out'].includes(movement.movement_type) ? -Math.abs(amount) : Math.abs(amount);
}

async function position(base44: any, session: any) {
  const [movements, receipts] = await Promise.all([
    base44.asServiceRole.entities.CashMovement.filter({ cash_session_id: session.id }),
    base44.asServiceRole.entities.PaymentReceipt.filter({ cash_session_id: session.id }),
  ]);
  const expectedCents = toCents(session.opening_amount || 0) + movements.reduce((sum: number, item: any) => sum + signedMovementCents(item), 0);
  const totals = {
    income_amount: fromCents(movements.filter((item: any) => item.movement_type === 'sale').reduce((sum: number, item: any) => sum + toCents(item.amount || 0), 0)),
    supply_amount: fromCents(movements.filter((item: any) => ['supply', 'deposit', 'adjustment_in'].includes(item.movement_type)).reduce((sum: number, item: any) => sum + toCents(item.amount || 0), 0)),
    withdrawal_amount: fromCents(movements.filter((item: any) => ['withdrawal', 'adjustment_out'].includes(item.movement_type)).reduce((sum: number, item: any) => sum + toCents(item.amount || 0), 0)),
    refund_amount: fromCents(movements.filter((item: any) => item.movement_type === 'refund').reduce((sum: number, item: any) => sum + toCents(item.amount || 0), 0)),
  };
  const paymentSummary: Record<string, number> = { cash: 0, pix: 0, credit: 0, debit: 0, bank_transfer: 0, customer_balance: 0, invoiced: 0, other: 0 };
  let paymentCount = 0;
  let pendingCents = 0;
  for (const receipt of receipts) {
    pendingCents += toCents(receipt.pending_amount || 0);
    for (const tender of receipt.tenders || []) {
      paymentCount += 1;
      const key = Object.prototype.hasOwnProperty.call(paymentSummary, tender.method) ? tender.method : 'other';
      if (tender.status === 'succeeded') paymentSummary[key] += Number(tender.applied_amount || 0);
    }
  }
  for (const key of Object.keys(paymentSummary)) paymentSummary[key] = fromCents(toCents(paymentSummary[key]));
  return {
    expected_cash_amount: fromCents(expectedCents),
    ...totals,
    payment_summary: paymentSummary,
    receipt_count: receipts.length,
    payment_count: paymentCount,
    pending_reconciliation_amount: fromCents(pendingCents),
    movements,
    receipts,
  };
}

async function audit(base44: any, user: any, session: any, requestId: string, reason: string, before: any, after: any, amount = 0) {
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'status_change', entity_type: 'cash_session', entity_id: session.id,
    item_label: session.session_number || 'Caixa', amount, reason,
    user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role,
    unit_id: session.unit_id, request_id: requestId, before_data: before, after_data: after, success: true,
  });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_cash_session' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!CASH_ROLES.has(user.role || 'cashier') && !(user.permissions || []).includes('cash.manage')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const body = await req.json();
    const action = body.action;

    if (action === 'open') {
      const unitId = body.unit_id || user.primary_unit_id;
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const existing = await base44.asServiceRole.entities.CashSession.filter({ unit_id: unitId, operator_user_id: user.id });
      const active = existing.find((item: any) => ['open', 'counting', 'pending_approval'].includes(item.status));
      if (active) return Response.json({ cash_session: active, duplicate: true, request_id: requestId });
      const openingAmount = Math.max(0, Number(body.opening_amount || 0));
      const session = await base44.asServiceRole.entities.CashSession.create({
        unit_id: unitId,
        session_number: `CX-${Date.now().toString(36).toUpperCase()}`,
        operator_user_id: user.id,
        operator_name: user.full_name || user.display_name || user.email,
        status: 'open', opened_at: new Date().toISOString(),
        opening_amount: openingAmount, expected_cash_amount: openingAmount,
        income_amount: 0, supply_amount: 0, withdrawal_amount: 0, refund_amount: 0,
        payment_summary: { cash: 0, pix: 0, credit: 0, debit: 0, bank_transfer: 0, customer_balance: 0, invoiced: 0, other: 0 },
        receipt_count: 0, payment_count: 0, pending_reconciliation_amount: 0,
        previous_session_id: body.previous_session_id,
        notes: body.notes || '', request_id: requestId,
      });
      await audit(base44, user, session, requestId, 'cash_session_opened', null, { status: 'open', opening_amount: openingAmount }, openingAmount);
      return Response.json({ cash_session: session, request_id: requestId });
    }

    const sessionId = body.cash_session_id;
    if (!sessionId) return Response.json({ error: 'cash_session_id_required', request_id: requestId }, { status: 400 });
    const session = await base44.asServiceRole.entities.CashSession.get(sessionId);
    if (!session || !canAccessUnit(user, session.unit_id)) return Response.json({ error: 'cash_session_not_found', request_id: requestId }, { status: 404 });

    if (action === 'position') {
      const current = await position(base44, session);
      const updated = await base44.asServiceRole.entities.CashSession.update(session.id, {
        expected_cash_amount: current.expected_cash_amount,
        income_amount: current.income_amount,
        supply_amount: current.supply_amount,
        withdrawal_amount: current.withdrawal_amount,
        refund_amount: current.refund_amount,
        payment_summary: current.payment_summary,
        receipt_count: current.receipt_count,
        payment_count: current.payment_count,
        pending_reconciliation_amount: current.pending_reconciliation_amount,
      });
      return Response.json({ cash_session: updated, position: current, request_id: requestId });
    }

    if (action === 'movement') {
      if (session.status !== 'open') return Response.json({ error: 'cash_session_not_open', request_id: requestId }, { status: 409 });
      const movementType = body.movement_type;
      const amount = Math.abs(Number(body.amount || 0));
      if (!movementType || amount <= 0) return Response.json({ error: 'movement_type_and_amount_required', request_id: requestId }, { status: 422 });
      if (SENSITIVE_MOVEMENTS.has(movementType) && !String(body.reason || '').trim()) return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
      if (SENSITIVE_MOVEMENTS.has(movementType) && !MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('cash.sensitive_movement')) {
        return Response.json({ error: 'manager_approval_required', request_id: requestId }, { status: 403 });
      }
      const movement = await base44.asServiceRole.entities.CashMovement.create({
        cash_session_id: session.id, unit_id: session.unit_id, movement_type: movementType, amount,
        payment_method: body.payment_method || 'cash', payment_id: body.payment_id,
        payment_receipt_id: body.payment_receipt_id, order_id: body.order_id, customer_id: body.customer_id,
        supplier_id: body.supplier_id, category: body.category, reason: body.reason || 'cash_movement',
        operator_user_id: user.id, approved_by_user_id: SENSITIVE_MOVEMENTS.has(movementType) ? user.id : undefined,
        occurred_at: new Date().toISOString(), request_id: requestId,
      });
      const current = await position(base44, session);
      const updated = await base44.asServiceRole.entities.CashSession.update(session.id, {
        expected_cash_amount: current.expected_cash_amount, income_amount: current.income_amount,
        supply_amount: current.supply_amount, withdrawal_amount: current.withdrawal_amount,
        refund_amount: current.refund_amount, payment_summary: current.payment_summary,
        receipt_count: current.receipt_count, payment_count: current.payment_count,
        pending_reconciliation_amount: current.pending_reconciliation_amount,
      });
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'create', entity_type: 'cash_movement', entity_id: movement.id, item_label: movementType, amount,
        reason: body.reason || 'cash_movement', user_email: user.email, user_name: user.full_name || user.display_name,
        user_role: user.role, unit_id: session.unit_id, request_id: requestId, success: true,
      });
      return Response.json({ cash_session: updated, cash_movement: movement, position: current, request_id: requestId });
    }

    if (action === 'close') {
      if (!['open', 'counting'].includes(session.status)) return Response.json({ error: 'cash_session_not_open', request_id: requestId }, { status: 409 });
      const countedAmount = Number(body.counted_cash_amount);
      if (!Number.isFinite(countedAmount) || countedAmount < 0) return Response.json({ error: 'counted_amount_required', request_id: requestId }, { status: 422 });
      const current = await position(base44, session);
      const difference = fromCents(toCents(countedAmount) - toCents(current.expected_cash_amount));
      const hasDifference = Math.abs(difference) >= 0.01;
      if (hasDifference && String(body.difference_reason || '').trim().length < 8) return Response.json({ error: 'difference_reason_required', expected: current.expected_cash_amount, counted: countedAmount, difference, request_id: requestId }, { status: 422 });
      const requiresApproval = hasDifference && !MANAGER_ROLES.has(user.role);
      const now = new Date().toISOString();
      const closureSnapshot = {
        session_number: session.session_number,
        opened_at: session.opened_at,
        closed_at: now,
        opening_amount: Number(session.opening_amount || 0),
        expected_cash_amount: current.expected_cash_amount,
        counted_cash_amount: countedAmount,
        difference_amount: difference,
        payment_summary: current.payment_summary,
        receipt_count: current.receipt_count,
        payment_count: current.payment_count,
        pending_reconciliation_amount: current.pending_reconciliation_amount,
        movement_ids: current.movements.map((item: any) => item.id),
        receipt_ids: current.receipts.map((item: any) => item.id),
      };
      const updated = await base44.asServiceRole.entities.CashSession.update(session.id, {
        status: requiresApproval ? 'pending_approval' : 'closed',
        counted_cash_amount: countedAmount,
        expected_cash_amount: current.expected_cash_amount,
        difference_amount: difference,
        difference_reason: body.difference_reason || '',
        payment_summary: current.payment_summary,
        receipt_count: current.receipt_count,
        payment_count: current.payment_count,
        pending_reconciliation_amount: current.pending_reconciliation_amount,
        closure_snapshot: closureSnapshot,
        closed_at: requiresApproval ? undefined : now,
        approved_by_user_id: requiresApproval ? undefined : user.id,
        approved_at: requiresApproval ? undefined : now,
      });
      await audit(base44, user, session, requestId, body.difference_reason || 'cash_session_closed', { status: session.status }, { status: updated.status, ...closureSnapshot }, countedAmount);
      return Response.json({ cash_session: updated, position: current, requires_approval: requiresApproval, request_id: requestId });
    }

    if (action === 'approve') {
      if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('cash.approve')) return Response.json({ error: 'manager_approval_required', request_id: requestId }, { status: 403 });
      if (session.status !== 'pending_approval') return Response.json({ error: 'cash_session_not_pending_approval', request_id: requestId }, { status: 409 });
      const reason = String(body.approval_reason || '').trim();
      if (Math.abs(Number(session.difference_amount || 0)) >= 0.01 && reason.length < 8) return Response.json({ error: 'approval_reason_required', request_id: requestId }, { status: 422 });
      const now = new Date().toISOString();
      const updated = await base44.asServiceRole.entities.CashSession.update(session.id, {
        status: 'closed', approved_by_user_id: user.id, approved_at: now, closed_at: now, approval_reason: reason,
      });
      await audit(base44, user, session, requestId, reason || 'cash_difference_approved', { status: session.status }, { status: 'closed', approved_by_user_id: user.id }, session.counted_cash_amount);
      return Response.json({ cash_session: updated, request_id: requestId });
    }

    if (action === 'reopen') {
      if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('cash.reopen')) return Response.json({ error: 'manager_approval_required', request_id: requestId }, { status: 403 });
      if (!['closed', 'pending_approval'].includes(session.status)) return Response.json({ error: 'cash_session_not_reopenable', request_id: requestId }, { status: 409 });
      const reason = String(body.reopen_reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'reopen_reason_required', request_id: requestId }, { status: 422 });
      const existing = await base44.asServiceRole.entities.CashSession.filter({ unit_id: session.unit_id, operator_user_id: session.operator_user_id });
      const active = existing.find((item: any) => ['open', 'counting', 'pending_approval'].includes(item.status) && item.id !== session.id);
      if (active) return Response.json({ error: 'operator_already_has_active_session', request_id: requestId }, { status: 409 });
      const now = new Date().toISOString();
      const openingAmount = Math.max(0, Number(body.opening_amount ?? session.counted_cash_amount ?? session.expected_cash_amount ?? 0));
      const next = await base44.asServiceRole.entities.CashSession.create({
        unit_id: session.unit_id, session_number: `CX-${Date.now().toString(36).toUpperCase()}`,
        operator_user_id: session.operator_user_id, operator_name: session.operator_name,
        status: 'open', opened_at: now, opening_amount: openingAmount, expected_cash_amount: openingAmount,
        income_amount: 0, supply_amount: 0, withdrawal_amount: 0, refund_amount: 0,
        payment_summary: { cash: 0, pix: 0, credit: 0, debit: 0, bank_transfer: 0, customer_balance: 0, invoiced: 0, other: 0 },
        receipt_count: 0, payment_count: 0, pending_reconciliation_amount: 0,
        previous_session_id: session.id, reopened_at: now, reopened_by_user_id: user.id, reopen_reason: reason,
        notes: `Reabertura controlada da sessão ${session.session_number || session.id}.`, request_id: requestId,
      });
      await audit(base44, user, session, requestId, reason, { status: session.status }, { new_session_id: next.id, opening_amount: openingAmount }, openingAmount);
      return Response.json({ cash_session: next, previous_session: session, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[manage_cash_session:${requestId}]`, error);
    const message = error instanceof Error ? error.message : 'cash_session_operation_failed';
    return Response.json({ error: message, request_id: requestId }, { status: message === 'invalid_money_value' ? 422 : 500 });
  }
});
