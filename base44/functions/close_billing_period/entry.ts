import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { toCents, fromCents } from '../../shared/paymentMath.js';

const ROLES = new Set(['super_admin', 'admin', 'manager', 'finance', 'cashier']);
const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

function endOfDay(value: string) {
  const date = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_period');
  return date;
}

function startOfDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_period');
  return date;
}

function calculateDueDate(periodEnd: string, paymentTermDays: number) {
  const date = endOfDay(periodEnd);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Number(paymentTermDays || 0)));
  return date.toISOString();
}

async function eligibleOrders(base44: any, agreement: any, periodStart: string, periodEnd: string) {
  const start = startOfDay(periodStart);
  const end = endOfDay(periodEnd);
  const orders = await base44.asServiceRole.entities.Order.filter({ billing_agreement_id: agreement.id, billing_type: 'invoiced' });
  return orders.filter((order: any) => {
    const created = new Date(order.created_date || order.approved_at || 0);
    const openCents = Math.max(0, toCents(order.total_amount || 0) - toCents(order.paid_amount || 0));
    return !order.billing_statement_id && order.status !== 'cancelled' && created >= start && created <= end && openCents > 0;
  });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'close_billing_period' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ROLES.has(user.role) && !(user.permissions || []).includes('billing.close')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }
    const body = await req.json();
    const action = String(body.action || 'preview');

    if (action === 'preview' || action === 'close') {
      if (!body.billing_agreement_id || !body.period_start || !body.period_end) {
        return Response.json({ error: 'agreement_and_period_required', request_id: requestId }, { status: 422 });
      }
      const agreement = await base44.asServiceRole.entities.BillingAgreement.get(body.billing_agreement_id);
      if (!agreement || !canAccessUnit(user, agreement.unit_id)) return Response.json({ error: 'billing_agreement_not_found', request_id: requestId }, { status: 404 });
      if (agreement.status !== 'active') return Response.json({ error: 'billing_agreement_not_active', request_id: requestId }, { status: 409 });
      if (startOfDay(body.period_start) > endOfDay(body.period_end)) return Response.json({ error: 'invalid_period', request_id: requestId }, { status: 422 });
      const orders = await eligibleOrders(base44, agreement, body.period_start, body.period_end);
      const subtotalCents = orders.reduce((sum: number, order: any) => sum + Math.max(0, toCents(order.total_amount || 0) - toCents(order.paid_amount || 0)), 0);
      const preview = {
        billing_agreement_id: agreement.id,
        period_start: body.period_start,
        period_end: body.period_end,
        order_count: orders.length,
        order_ids: orders.map((order: any) => order.id),
        subtotal: fromCents(subtotalCents),
        total: fromCents(subtotalCents),
        due_date: body.due_date || calculateDueDate(body.period_end, agreement.payment_term_days),
      };
      if (action === 'preview') return Response.json({ preview, request_id: requestId });
      if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('billing.issue')) {
        return Response.json({ error: 'manager_approval_required', request_id: requestId }, { status: 403 });
      }
      if (orders.length === 0) return Response.json({ error: 'no_eligible_orders', request_id: requestId }, { status: 422 });
      const existing = await base44.asServiceRole.entities.BillingStatement.filter({
        billing_agreement_id: agreement.id, period_start: body.period_start, period_end: body.period_end,
      });
      const activeExisting = existing.find((item: any) => item.status !== 'cancelled');
      if (activeExisting) return Response.json({ billing_statement: activeExisting, duplicate: true, request_id: requestId });

      const eventKey = `billing_close:${agreement.id}:${body.period_start}:${body.period_end}`;
      const events = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
      const event = events[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
        event_key: eventKey, event_type: 'billing_period_close', source: 'user_command', status: 'processing',
        payload_hash: `${agreement.id}:${body.period_start}:${body.period_end}:${preview.total}`,
        attempts: 1, started_at: new Date().toISOString(), unit_id: agreement.unit_id,
      });
      const now = new Date().toISOString();
      const statementNumber = `FAT-${body.period_end.replaceAll('-', '')}-${Date.now().toString(36).toUpperCase()}`;
      const statement = await base44.asServiceRole.entities.BillingStatement.create({
        statement_number: statementNumber,
        unit_id: agreement.unit_id,
        billing_agreement_id: agreement.id,
        customer_id: agreement.bill_to_customer_id,
        status: 'review',
        period_start: body.period_start,
        period_end: body.period_end,
        issue_date: now.slice(0, 10),
        due_date: preview.due_date.slice(0, 10),
        order_ids: preview.order_ids,
        accounts_receivable_ids: [],
        payment_receipt_ids: [],
        subtotal: preview.subtotal,
        discount_amount: 0,
        addition_amount: 0,
        interest_amount: 0,
        total_amount: preview.total,
        paid_amount: 0,
        open_amount: preview.total,
        cost_centers: [...new Set(orders.map((order: any) => order.cost_center).filter(Boolean))],
        purchase_order_numbers: [...new Set(orders.map((order: any) => order.purchase_order_number).filter(Boolean))],
        issued_by_user_id: user.id,
        notes: body.notes || '',
      });
      const receivableNumber = `CR-${statementNumber}`;
      const receivable = await base44.asServiceRole.entities.AccountsReceivable.create({
        unit_id: agreement.unit_id,
        customer_id: agreement.bill_to_customer_id,
        billing_statement_id: statement.id,
        billing_agreement_id: agreement.id,
        receivable_number: receivableNumber,
        installment_number: 1,
        installment_count: 1,
        competence: body.period_end.slice(0, 7),
        description: `Faturamento ${agreement.name} — ${body.period_start} a ${body.period_end}`,
        issue_date: now,
        due_date: preview.due_date,
        original_amount: preview.total,
        discount_amount: 0,
        interest_amount: 0,
        paid_amount: 0,
        open_amount: preview.total,
        status: 'open',
        billing_type: 'invoiced',
        payment_receipt_ids: [],
        payment_allocation_ids: [],
        collection_status: 'not_started',
        notes: body.notes || '',
      });
      for (const order of orders) {
        await base44.asServiceRole.entities.Order.update(order.id, {
          billing_statement_id: statement.id,
          accounts_receivable_ids: [...new Set([...(order.accounts_receivable_ids || []), receivable.id])],
        });
      }
      const updatedStatement = await base44.asServiceRole.entities.BillingStatement.update(statement.id, {
        accounts_receivable_ids: [receivable.id],
      });
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'create', entity_type: 'billing_statement', entity_id: statement.id, item_label: statementNumber,
        amount: preview.total, reason: 'billing_period_closed_for_review', user_email: user.email,
        user_name: user.full_name || user.display_name, user_role: user.role, unit_id: agreement.unit_id,
        request_id: requestId, after_data: { order_count: orders.length, receivable_id: receivable.id }, success: true,
      });
      await base44.asServiceRole.entities.ProcessedEvent.update(event.id, {
        status: 'completed', entity_type: 'billing_statement', entity_id: statement.id,
        result: { statement_id: statement.id, receivable_id: receivable.id }, completed_at: now,
      });
      return Response.json({ billing_statement: updatedStatement, accounts_receivable: receivable, request_id: requestId });
    }

    const statement = await base44.asServiceRole.entities.BillingStatement.get(body.billing_statement_id);
    if (!statement || !canAccessUnit(user, statement.unit_id)) return Response.json({ error: 'billing_statement_not_found', request_id: requestId }, { status: 404 });
    if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('billing.issue')) {
      return Response.json({ error: 'manager_approval_required', request_id: requestId }, { status: 403 });
    }
    const now = new Date().toISOString();

    if (action === 'issue') {
      if (statement.status === 'issued') return Response.json({ billing_statement: statement, duplicate: true, request_id: requestId });
      if (statement.status !== 'review') return Response.json({ error: 'statement_not_in_review', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.BillingStatement.update(statement.id, {
        status: 'issued', issued_at: now, issued_by_user_id: user.id,
      });
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'status_change', entity_type: 'billing_statement', entity_id: statement.id, item_label: statement.statement_number,
        amount: statement.total_amount, reason: 'billing_statement_issued', user_email: user.email,
        user_name: user.full_name || user.display_name, user_role: user.role, unit_id: statement.unit_id,
        request_id: requestId, before_data: { status: statement.status }, after_data: { status: 'issued' }, success: true,
      });
      return Response.json({ billing_statement: updated, request_id: requestId });
    }

    if (action === 'cancel') {
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'cancellation_reason_required', request_id: requestId }, { status: 422 });
      if (Number(statement.paid_amount || 0) > 0.009) return Response.json({ error: 'paid_statement_cannot_be_cancelled', request_id: requestId }, { status: 409 });
      for (const receivableId of statement.accounts_receivable_ids || []) {
        const receivable = await base44.asServiceRole.entities.AccountsReceivable.get(receivableId);
        if (receivable && Number(receivable.paid_amount || 0) <= 0.009) {
          await base44.asServiceRole.entities.AccountsReceivable.update(receivable.id, {
            status: 'cancelled', cancelled_at: now, cancelled_by_user_id: user.id, cancellation_reason: reason,
          });
        }
      }
      for (const orderId of statement.order_ids || []) {
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if (order) await base44.asServiceRole.entities.Order.update(order.id, { billing_statement_id: undefined });
      }
      const updated = await base44.asServiceRole.entities.BillingStatement.update(statement.id, {
        status: 'cancelled', cancelled_at: now, cancelled_by_user_id: user.id, cancellation_reason: reason,
      });
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'status_change', entity_type: 'billing_statement', entity_id: statement.id, item_label: statement.statement_number,
        amount: statement.total_amount, reason, user_email: user.email, user_name: user.full_name || user.display_name,
        user_role: user.role, unit_id: statement.unit_id, request_id: requestId,
        before_data: { status: statement.status }, after_data: { status: 'cancelled' }, success: true,
      });
      return Response.json({ billing_statement: updated, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[close_billing_period:${requestId}]`, error);
    const message = error instanceof Error ? error.message : 'billing_period_failed';
    return Response.json({ error: message, request_id: requestId }, { status: ['invalid_period', 'invalid_money_value'].includes(message) ? 422 : 500 });
  }
});
