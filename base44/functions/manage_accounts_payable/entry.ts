import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const APPROVER_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);
const PAYER_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);

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
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_accounts_payable' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });

    const body = await req.json();
    const action = body.action;
    const payableId = body.accounts_payable_id;
    if (!payableId || !['approve', 'reject', 'pay', 'cancel'].includes(action)) {
      return Response.json({ error: 'invalid_payable_action', request_id: requestId }, { status: 400 });
    }

    const payable = await base44.asServiceRole.entities.AccountsPayable.get(payableId);
    if (!payable) return Response.json({ error: 'accounts_payable_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, payable.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });

    const now = new Date().toISOString();

    if (action === 'approve' || action === 'reject') {
      if (!APPROVER_ROLES.has(user.role) && !(user.permissions || []).includes('finance.approve')) {
        return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
      }
      if (!String(body.reason || '').trim() && action === 'reject') {
        return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
      }
      if (payable.created_by && payable.created_by === user.email && !['super_admin', 'admin', 'manager'].includes(user.role)) {
        return Response.json({ error: 'segregation_of_duties_required', request_id: requestId }, { status: 403 });
      }

      const updated = await base44.asServiceRole.entities.AccountsPayable.update(payable.id, {
        approval_status: action === 'approve' ? 'approved' : 'rejected',
        status: action === 'approve' ? 'approved' : 'cancelled',
        approved_by_user_id: user.id,
        approved_at: now,
        notes: [payable.notes, body.reason].filter(Boolean).join('\n'),
      });

      await base44.asServiceRole.entities.AuditLog.create({
        action: action === 'approve' ? 'approve' : 'reject', entity_type: 'accounts_payable', entity_id: payable.id,
        item_label: payable.description, amount: Number(payable.open_amount || payable.original_amount || 0), reason: body.reason || `accounts_payable_${action}`,
        user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role,
        unit_id: payable.unit_id, request_id: requestId, before_data: { approval_status: payable.approval_status }, after_data: { approval_status: updated.approval_status }, success: true,
      });
      return Response.json({ accounts_payable: updated, request_id: requestId });
    }

    if (action === 'cancel') {
      if (!APPROVER_ROLES.has(user.role) || !String(body.reason || '').trim()) {
        return Response.json({ error: 'manager_and_reason_required', request_id: requestId }, { status: 403 });
      }
      if (payable.status === 'paid') return Response.json({ error: 'paid_payable_cannot_be_cancelled', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.AccountsPayable.update(payable.id, {
        status: 'cancelled',
        notes: [payable.notes, body.reason].filter(Boolean).join('\n'),
      });
      return Response.json({ accounts_payable: updated, request_id: requestId });
    }

    if (!PAYER_ROLES.has(user.role) && !(user.permissions || []).includes('finance.pay')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }
    if (payable.approval_status !== 'approved') {
      return Response.json({ error: 'payable_not_approved', request_id: requestId }, { status: 409 });
    }
    if (payable.status === 'paid') return Response.json({ accounts_payable: payable, duplicate: true, request_id: requestId });

    const amount = Math.min(Number(body.amount || payable.open_amount || 0), Number(payable.open_amount || 0));
    if (!Number.isFinite(amount) || amount <= 0) return Response.json({ error: 'invalid_payment_amount', request_id: requestId }, { status: 422 });

    const eventKey = `pay_accounts_payable:${payable.id}:${body.external_reference || body.idempotency_key || amount}`;
    const events = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
    if (events.some((event: any) => event.status === 'completed')) {
      return Response.json({ accounts_payable: payable, duplicate: true, request_id: requestId });
    }
    const event = events[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: eventKey,
      event_type: 'pay_accounts_payable',
      source: 'user_command',
      status: 'processing',
      payload_hash: `${payable.id}:${amount}:${body.external_reference || ''}`,
      attempts: 1,
      started_at: now,
      unit_id: payable.unit_id,
    });

    const openAmount = Math.max(0, Number(payable.open_amount || 0) - amount);
    const paidAmount = Number(payable.paid_amount || 0) + amount;
    const updated = await base44.asServiceRole.entities.AccountsPayable.update(payable.id, {
      paid_amount: paidAmount,
      open_amount: openAmount,
      status: openAmount <= 0.01 ? 'paid' : 'partially_paid',
      paid_at: openAmount <= 0.01 ? now : payable.paid_at,
      payment_method: body.payment_method || payable.payment_method || 'bank_transfer',
      bank_transaction_id: body.bank_transaction_id,
      notes: [payable.notes, body.notes].filter(Boolean).join('\n'),
    });

    const financeEntry = await base44.asServiceRole.entities.FinanceEntry.create({
      type: 'expense',
      category: payable.category || 'Outras despesas',
      description: payable.description,
      amount,
      payment_method: body.payment_method || payable.payment_method || 'bank_transfer',
      entry_date: now.slice(0, 10),
      unit_id: payable.unit_id,
      status: 'paid',
      notes: `Baixa da conta ${payable.id}. Referência: ${body.external_reference || 'não informada'}`,
    });

    if (body.cash_session_id && body.payment_method === 'cash') {
      await base44.asServiceRole.entities.CashMovement.create({
        cash_session_id: body.cash_session_id,
        unit_id: payable.unit_id,
        movement_type: 'withdrawal',
        amount,
        payment_method: 'cash',
        supplier_id: payable.supplier_id,
        category: payable.category,
        reason: `Pagamento: ${payable.description}`,
        operator_user_id: user.id,
        approved_by_user_id: user.id,
        occurred_at: now,
        request_id: requestId,
      });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'payment', entity_type: 'accounts_payable', entity_id: payable.id, item_label: payable.description, amount,
      reason: 'accounts_payable_settled', user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role,
      unit_id: payable.unit_id, request_id: requestId, before_data: { open_amount: payable.open_amount, status: payable.status },
      after_data: { open_amount: openAmount, status: updated.status, finance_entry_id: financeEntry.id }, success: true,
    });
    await base44.asServiceRole.entities.ProcessedEvent.update(event.id, {
      status: 'completed', entity_type: 'accounts_payable', entity_id: payable.id,
      result: { finance_entry_id: financeEntry.id, paid_amount: amount }, completed_at: now,
    });

    return Response.json({ accounts_payable: updated, finance_entry: financeEntry, request_id: requestId });
  } catch (error) {
    console.error(`[manage_accounts_payable:${requestId}]`, error);
    return Response.json({ error: 'accounts_payable_operation_failed', request_id: requestId }, { status: 500 });
  }
});
