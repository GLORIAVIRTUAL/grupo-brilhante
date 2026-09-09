import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { toCents, fromCents } from '../../shared/paymentMath.js';

const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_customer_credit' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('customer_credit.manage')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const body = await req.json();
    const action = String(body.action || 'grant');
    const allowedActions = new Set(['grant', 'adjustment_in', 'adjustment_out', 'expiration']);
    if (!allowedActions.has(action)) return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
    const amountCents = toCents(body.amount);
    const reason = String(body.reason || '').trim();
    const idempotencyKey = String(body.idempotency_key || '').trim();
    if (!body.customer_id || amountCents <= 0 || reason.length < 8 || !idempotencyKey) {
      return Response.json({ error: 'customer_amount_reason_and_idempotency_required', request_id: requestId }, { status: 422 });
    }

    const customer = await base44.asServiceRole.entities.Customer.get(body.customer_id);
    if (!customer || !canAccessUnit(user, customer.unit_id)) return Response.json({ error: 'customer_not_found', request_id: requestId }, { status: 404 });
    const eventKey = `customer_credit:${idempotencyKey}`;
    const events = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
    if (events.some((event: any) => event.status === 'completed')) {
      const entries = await base44.asServiceRole.entities.CustomerCreditLedger.filter({ idempotency_key: idempotencyKey });
      return Response.json({ credit_entry: entries[0] || null, duplicate: true, request_id: requestId });
    }
    const event = events[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: eventKey, event_type: 'customer_credit', source: 'user_command', status: 'processing',
      payload_hash: `${customer.id}:${action}:${fromCents(amountCents)}:${reason}`, attempts: 1,
      started_at: new Date().toISOString(), unit_id: customer.unit_id,
    });

    const negative = ['adjustment_out', 'expiration'].includes(action);
    const currentCents = toCents(customer.credit_balance || 0);
    const nextCents = currentCents + (negative ? -amountCents : amountCents);
    if (nextCents < 0) return Response.json({ error: 'insufficient_customer_balance', available: fromCents(currentCents), request_id: requestId }, { status: 422 });

    const now = new Date().toISOString();
    const entry = await base44.asServiceRole.entities.CustomerCreditLedger.create({
      unit_id: customer.unit_id,
      customer_id: customer.id,
      entry_type: action,
      amount: fromCents(amountCents),
      signed_amount: fromCents(negative ? -amountCents : amountCents),
      balance_after: fromCents(nextCents),
      status: 'posted',
      expires_at: action === 'grant' ? body.expires_at : undefined,
      occurred_at: now,
      operator_user_id: user.id,
      reason,
      idempotency_key: idempotencyKey,
      request_id: requestId,
      metadata: { source: body.source || 'management' },
    });
    const updatedCustomer = await base44.asServiceRole.entities.Customer.update(customer.id, {
      credit_balance: fromCents(nextCents),
      credit_available: fromCents(Math.max(0, toCents(customer.credit_limit || 0) - toCents(customer.credit_used || 0))),
      credit_reviewed_at: now,
      credit_reviewed_by_user_id: user.id,
    });

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'payment', entity_type: 'customer_credit', entity_id: entry.id,
      item_label: customer.full_name || customer.id, amount: fromCents(amountCents), reason,
      user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role,
      unit_id: customer.unit_id, request_id: requestId,
      before_data: { credit_balance: fromCents(currentCents) }, after_data: { credit_balance: fromCents(nextCents), action }, success: true,
    });
    await base44.asServiceRole.entities.ProcessedEvent.update(event.id, {
      status: 'completed', entity_type: 'customer_credit', entity_id: entry.id,
      result: { entry_id: entry.id, balance_after: fromCents(nextCents) }, completed_at: now,
    });

    return Response.json({ credit_entry: entry, customer: updatedCustomer, request_id: requestId });
  } catch (error) {
    console.error(`[manage_customer_credit:${requestId}]`, error);
    const message = error instanceof Error ? error.message : 'customer_credit_failed';
    return Response.json({ error: message, request_id: requestId }, { status: message === 'invalid_money_value' ? 422 : 500 });
  }
});
