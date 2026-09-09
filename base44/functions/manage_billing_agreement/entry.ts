import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { toCents, fromCents } from '../../shared/paymentMath.js';

const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

async function calculateExposure(base44: any, agreement: any) {
  const receivables = await base44.asServiceRole.entities.AccountsReceivable.filter({ billing_agreement_id: agreement.id });
  const orders = await base44.asServiceRole.entities.Order.filter({ billing_agreement_id: agreement.id, billing_type: 'invoiced' });
  const billedCents = receivables
    .filter((item: any) => !['paid', 'cancelled', 'written_off'].includes(item.status))
    .reduce((sum: number, item: any) => sum + toCents(item.open_amount || 0), 0);
  const unbilledCents = orders
    .filter((item: any) => !item.billing_statement_id && item.status !== 'cancelled')
    .reduce((sum: number, item: any) => sum + Math.max(0, toCents(item.total_amount || 0) - toCents(item.paid_amount || 0)), 0);
  return { billed: fromCents(billedCents), unbilled: fromCents(unbilledCents), total: fromCents(billedCents + unbilledCents) };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_billing_agreement' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('billing.manage')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }
    const body = await req.json();
    const action = String(body.action || '');
    const now = new Date().toISOString();

    if (action === 'create') {
      const unitId = body.unit_id || user.primary_unit_id;
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      if (!String(body.name || '').trim() || !String(body.code || '').trim() || !body.bill_to_customer_id) {
        return Response.json({ error: 'code_name_and_bill_to_customer_required', request_id: requestId }, { status: 422 });
      }
      const billToCustomer = await base44.asServiceRole.entities.Customer.get(body.bill_to_customer_id);
      if (!billToCustomer || !canAccessUnit(user, billToCustomer.unit_id)) return Response.json({ error: 'bill_to_customer_not_found', request_id: requestId }, { status: 404 });
      const existing = await base44.asServiceRole.entities.BillingAgreement.filter({ unit_id: unitId, code: String(body.code).trim().toUpperCase() });
      if (existing.length > 0) return Response.json({ error: 'agreement_code_already_exists', request_id: requestId }, { status: 409 });
      const agreement = await base44.asServiceRole.entities.BillingAgreement.create({
        unit_id: unitId,
        code: String(body.code).trim().toUpperCase(),
        name: String(body.name).trim(),
        status: 'draft',
        agreement_type: body.agreement_type || 'corporate',
        legal_name: body.legal_name || billToCustomer.legal_name || billToCustomer.full_name,
        tax_id: body.tax_id || billToCustomer.tax_id,
        billing_email: body.billing_email || billToCustomer.billing_email || billToCustomer.email,
        billing_contact: body.billing_contact,
        bill_to_customer_id: billToCustomer.id,
        customer_ids: [...new Set([billToCustomer.id, ...(body.customer_ids || [])])],
        price_rule_ids: body.price_rule_ids || [],
        credit_limit: Math.max(0, Number(body.credit_limit || 0)),
        payment_term_days: Math.max(0, Number(body.payment_term_days || 0)),
        billing_cycle: body.billing_cycle || 'monthly',
        closing_day: Number(body.closing_day || 1),
        due_day: Number(body.due_day || 10),
        requires_cost_center: body.requires_cost_center === true,
        requires_purchase_order: body.requires_purchase_order === true,
        requires_service_recipient: body.requires_service_recipient === true,
        allow_over_limit: body.allow_over_limit === true,
        over_limit_requires_approval: body.over_limit_requires_approval !== false,
        valid_from: body.valid_from,
        valid_until: body.valid_until,
        created_by_user_id: user.id,
        notes: body.notes || '',
      });
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'create', entity_type: 'billing_agreement', entity_id: agreement.id, item_label: agreement.name,
        reason: 'billing_agreement_created', user_email: user.email, user_name: user.full_name || user.display_name,
        user_role: user.role, unit_id: unitId, request_id: requestId, after_data: agreement, success: true,
      });
      return Response.json({ billing_agreement: agreement, request_id: requestId });
    }

    const agreement = await base44.asServiceRole.entities.BillingAgreement.get(body.billing_agreement_id);
    if (!agreement || !canAccessUnit(user, agreement.unit_id)) return Response.json({ error: 'billing_agreement_not_found', request_id: requestId }, { status: 404 });

    if (action === 'activate' || action === 'suspend') {
      if (action === 'activate' && (!agreement.bill_to_customer_id || Number(agreement.credit_limit || 0) < 0)) {
        return Response.json({ error: 'agreement_not_ready', request_id: requestId }, { status: 422 });
      }
      const status = action === 'activate' ? 'active' : 'suspended';
      const updated = await base44.asServiceRole.entities.BillingAgreement.update(agreement.id, {
        status,
        approved_by_user_id: action === 'activate' ? user.id : agreement.approved_by_user_id,
        approved_at: action === 'activate' ? now : agreement.approved_at,
        notes: body.notes ?? agreement.notes,
      });
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'status_change', entity_type: 'billing_agreement', entity_id: agreement.id, item_label: agreement.name,
        reason: body.reason || `billing_agreement_${status}`, user_email: user.email,
        user_name: user.full_name || user.display_name, user_role: user.role, unit_id: agreement.unit_id,
        request_id: requestId, before_data: { status: agreement.status }, after_data: { status }, success: true,
      });
      return Response.json({ billing_agreement: updated, request_id: requestId });
    }

    if (action === 'assign_customer') {
      const customer = await base44.asServiceRole.entities.Customer.get(body.customer_id);
      if (!customer || !canAccessUnit(user, customer.unit_id)) return Response.json({ error: 'customer_not_found', request_id: requestId }, { status: 404 });
      if (agreement.status !== 'active') return Response.json({ error: 'agreement_not_active', request_id: requestId }, { status: 409 });
      const customerIds = [...new Set([...(agreement.customer_ids || []), customer.id])];
      const updatedAgreement = await base44.asServiceRole.entities.BillingAgreement.update(agreement.id, { customer_ids: customerIds });
      const updatedCustomer = await base44.asServiceRole.entities.Customer.update(customer.id, {
        billing_agreement_id: agreement.id,
        billing_status: 'approved',
        billing_cycle: agreement.billing_cycle,
        payment_term_days: agreement.payment_term_days,
        credit_limit: Number(agreement.credit_limit || 0),
        credit_available: Math.max(0, Number(agreement.credit_limit || 0) - Number(customer.credit_used || 0)),
        customer_type: customer.customer_type === 'company' ? 'company' : 'agreement_member',
        purchase_order_required: agreement.requires_purchase_order === true,
      });
      return Response.json({ billing_agreement: updatedAgreement, customer: updatedCustomer, request_id: requestId });
    }

    if (action === 'assign_order') {
      if (agreement.status !== 'active') return Response.json({ error: 'agreement_not_active', request_id: requestId }, { status: 409 });
      const order = await base44.asServiceRole.entities.Order.get(body.order_id);
      if (!order || order.unit_id !== agreement.unit_id) return Response.json({ error: 'order_not_found', request_id: requestId }, { status: 404 });
      if (!(agreement.customer_ids || []).includes(order.customer_id)) return Response.json({ error: 'customer_not_in_agreement', request_id: requestId }, { status: 422 });
      if (agreement.requires_cost_center && !String(body.cost_center || '').trim()) return Response.json({ error: 'cost_center_required', request_id: requestId }, { status: 422 });
      if (agreement.requires_purchase_order && !String(body.purchase_order_number || '').trim()) return Response.json({ error: 'purchase_order_required', request_id: requestId }, { status: 422 });
      const exposure = await calculateExposure(base44, agreement);
      const orderOpen = Math.max(0, Number(order.total_amount || 0) - Number(order.paid_amount || 0));
      const projected = exposure.total + orderOpen;
      const limit = Number(agreement.credit_limit || 0);
      const overLimit = limit > 0 && projected - limit > 0.009;
      const explicitlyApproved = body.over_limit_approved === true && MANAGER_ROLES.has(user.role);
      if (overLimit && !agreement.allow_over_limit && !explicitlyApproved) {
        return Response.json({ error: 'credit_limit_exceeded', exposure, projected, credit_limit: limit, request_id: requestId }, { status: 409 });
      }
      const updatedOrder = await base44.asServiceRole.entities.Order.update(order.id, {
        billing_type: 'invoiced',
        billing_agreement_id: agreement.id,
        cost_center: body.cost_center,
        purchase_order_number: body.purchase_order_number,
        open_amount: orderOpen,
        payment_status: order.paid_amount > 0 ? 'partial' : 'unpaid',
      });
      const customer = await base44.asServiceRole.entities.Customer.get(order.customer_id);
      await base44.asServiceRole.entities.Customer.update(customer.id, {
        credit_used: projected,
        credit_available: Math.max(0, limit - projected),
      });
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'update', entity_type: 'order', entity_id: order.id, item_label: order.ticket_number || order.id,
        amount: orderOpen, reason: overLimit ? 'invoiced_order_over_limit_approved' : 'invoiced_order_assigned',
        user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role,
        unit_id: agreement.unit_id, request_id: requestId,
        after_data: { billing_agreement_id: agreement.id, projected_exposure: projected, credit_limit: limit }, success: true,
      });
      return Response.json({ order: updatedOrder, exposure: { ...exposure, projected }, request_id: requestId });
    }

    if (action === 'exposure') {
      return Response.json({ exposure: await calculateExposure(base44, agreement), request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[manage_billing_agreement:${requestId}]`, error);
    const message = error instanceof Error ? error.message : 'billing_agreement_failed';
    return Response.json({ error: message, request_id: requestId }, { status: message === 'invalid_money_value' ? 422 : 500 });
  }
});
