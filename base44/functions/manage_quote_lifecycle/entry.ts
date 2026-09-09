import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { loadLaundryPricingCatalog, priceGarmentItems } from '../../shared/laundryPricing.js';
import { toCents, fromCents } from '../../shared/paymentMath.js';
import { evaluateCommercialAdjustment, selectCommercialApprovalPolicy } from '../../shared/commercialApproval.js';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

const ROLES = new Set(['super_admin', 'admin', 'manager', 'cashier', 'attendant']);
const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

function lowerStatus(status: string) {
  return String(status || 'DRAFT').toLowerCase();
}

function buildSnapshot(quote: any) {
  return {
    quote_number: quote.quote_number,
    version_number: quote.version_number,
    status: quote.status,
    origin: quote.origin,
    items: quote.items || [],
    subtotal: Number(quote.subtotal || 0),
    discount: Number(quote.discount || 0),
    addition: Number(quote.addition || 0),
    total: Number(quote.total || 0),
    price_adjustments: quote.price_adjustments || [],
    catalog_version: quote.catalog_version,
    valid_until: quote.valid_until,
    customer_message: quote.customer_message,
  };
}

async function createVersion(base44: any, quote: any, user: any, changeType: string, reason: string, requestId: string) {
  const version = await base44.asServiceRole.entities.QuoteVersion.create({
    quote_id: quote.id,
    root_quote_id: quote.root_quote_id || quote.id,
    previous_version_id: quote.current_version_id,
    unit_id: quote.unit_id,
    customer_id: quote.customer_id,
    version_number: Number(quote.version_number || 1),
    status: lowerStatus(quote.status),
    snapshot: buildSnapshot(quote),
    subtotal: Number(quote.subtotal || 0),
    discount_amount: Number(quote.discount || 0),
    addition_amount: Number(quote.addition || 0),
    total_amount: Number(quote.total || 0),
    valid_until: quote.valid_until,
    change_type: changeType,
    change_reason: reason,
    price_override: Number(quote.discount || 0) > 0 || Number(quote.addition || 0) > 0,
    price_override_amount: Number(quote.addition || 0) - Number(quote.discount || 0),
    created_by_user_id: user.id,
    created_by_name: user.full_name || user.display_name || user.email,
    created_at_business: new Date().toISOString(),
    request_id: requestId,
  });
  await base44.asServiceRole.entities.Quote.update(quote.id, { current_version_id: version.id, root_quote_id: quote.root_quote_id || quote.id });
  return version;
}

async function validateAdjustment(base44: any, user: any, unitId: string, subtotalCents: number, discountCents: number, additionCents: number, reason: string) {
  const policies = await base44.asServiceRole.entities.CommercialApprovalPolicy.filter({ role: user.role, active: true }, '-version', 100);
  const policy = selectCommercialApprovalPolicy(policies, unitId);
  evaluateCommercialAdjustment({
    role: user.role,
    permissions: user.permissions || [],
    mfaStatus: user.mfa_status,
    subtotalCents,
    discountCents,
    additionCents,
    reason,
    policy,
  });
  return policy;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const principal = await authorizeUserOrInternal(base44, req, body, {
      allowInternal: false,
      source: 'manage_quote_lifecycle',
    });
    const user = principal.user;
    if (!ROLES.has(user.role || 'attendant') && !(user.permissions || []).includes('quotes.manage')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }
    const action = String(body.action || '');
    const now = new Date().toISOString();

    if (action === 'duplicate') {
      const source = await base44.asServiceRole.entities.Quote.get(body.quote_id);
      if (!source || !canAccessUnit(user, source.unit_id)) return Response.json({ error: 'quote_not_found', request_id: requestId }, { status: 404 });
      const duplicate = await base44.asServiceRole.entities.Quote.create({
        customer_id: body.customer_id || source.customer_id,
        unit_id: source.unit_id,
        status: 'DRAFT',
        origin: source.origin,
        items: source.items || [],
        quote_number: `ORC-${Date.now().toString(36).toUpperCase()}`,
        version_number: 1,
        subtotal: source.subtotal,
        discount: 0,
        addition: 0,
        total: source.subtotal,
        price_adjustments: [],
        catalog_version: source.catalog_version,
        valid_until: body.valid_until || new Date(Date.now() + 7 * 86400000).toISOString(),
        customer_message: source.customer_message,
        status_reason: `Duplicado de ${source.quote_number || source.id}`,
        metadata: { ...(source.metadata || {}), duplicated_from_quote_id: source.id },
      });
      const updated = await base44.asServiceRole.entities.Quote.update(duplicate.id, { root_quote_id: duplicate.id });
      const version = await createVersion(base44, updated, user, 'duplicated', String(body.reason || `Duplicado de ${source.quote_number || source.id}`), requestId);
      return Response.json({ quote: { ...updated, current_version_id: version.id }, quote_version: version, request_id: requestId });
    }

    const quote = await base44.asServiceRole.entities.Quote.get(body.quote_id);
    if (!quote || !canAccessUnit(user, quote.unit_id)) return Response.json({ error: 'quote_not_found', request_id: requestId }, { status: 404 });

    if (action === 'revise') {
      if (!['DRAFT', 'HUMAN_REVIEW', 'SENT', 'REJECTED', 'EXPIRED'].includes(quote.status)) return Response.json({ error: 'quote_not_editable', request_id: requestId }, { status: 409 });
      const items = Array.isArray(body.items) ? body.items : quote.items || [];
      const catalog = await loadLaundryPricingCatalog(base44, { unitId: quote.unit_id, customerId: quote.customer_id });
      const priced = priceGarmentItems({ items, catalog, unitId: quote.unit_id, priority: body.priority || quote.metadata?.priority || 'normal' });
      const subtotalCents = toCents(priced.subtotal);
      const discountCents = toCents(body.discount ?? quote.discount ?? 0);
      const additionCents = toCents(body.addition ?? quote.addition ?? 0);
      const reason = String(body.reason || '').trim();
      const approvalPolicy = await validateAdjustment(base44, user, quote.unit_id, subtotalCents, discountCents, additionCents, reason);
      const totalCents = Math.max(0, subtotalCents - discountCents + additionCents);
      const nextVersion = Number(quote.version_number || 1) + 1;
      const priceAdjustments = [];
      if (discountCents > 0) priceAdjustments.push({ type: 'discount', scope: 'quote', amount: fromCents(discountCents), reason, approved_by_user_id: user.id, applied_at: now, approval_policy_id: approvalPolicy?.id, approval_policy_version: approvalPolicy?.version });
      if (additionCents > 0) priceAdjustments.push({ type: 'addition', scope: 'quote', amount: fromCents(additionCents), reason, approved_by_user_id: user.id, applied_at: now, approval_policy_id: approvalPolicy?.id, approval_policy_version: approvalPolicy?.version });
      const updated = await base44.asServiceRole.entities.Quote.update(quote.id, {
        status: 'DRAFT',
        items: priced.items,
        quote_number: quote.quote_number || `ORC-${Date.now().toString(36).toUpperCase()}`,
        root_quote_id: quote.root_quote_id || quote.id,
        version_number: nextVersion,
        subtotal: fromCents(subtotalCents),
        discount: fromCents(discountCents),
        addition: fromCents(additionCents),
        total: fromCents(totalCents),
        price_adjustments: priceAdjustments,
        catalog_version: priced.priced_at,
        valid_until: body.valid_until || quote.valid_until || new Date(Date.now() + 7 * 86400000).toISOString(),
        customer_message: body.customer_message ?? quote.customer_message,
        human_adjustments: reason,
        status_reason: reason || 'quote_revised',
        reopened_at: ['REJECTED', 'EXPIRED'].includes(quote.status) ? now : quote.reopened_at,
        reopened_by_user_id: ['REJECTED', 'EXPIRED'].includes(quote.status) ? user.id : quote.reopened_by_user_id,
      });
      const version = await createVersion(base44, updated, user, 'edited', reason || 'Revisão do orçamento', requestId);
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'update', entity_type: 'quote', entity_id: quote.id, item_label: updated.quote_number,
        amount: updated.total, reason: reason || 'quote_revised', user_email: user.email,
        user_name: user.full_name || user.display_name, user_role: user.role, unit_id: quote.unit_id,
        request_id: requestId, before_data: buildSnapshot(quote), after_data: buildSnapshot(updated), success: true,
      });
      return Response.json({ quote: { ...updated, current_version_id: version.id }, quote_version: version, request_id: requestId });
    }

    if (action === 'send') {
      if (!['DRAFT', 'HUMAN_REVIEW'].includes(quote.status)) return Response.json({ error: 'quote_not_sendable', request_id: requestId }, { status: 409 });
      if (!quote.items?.length || Number(quote.total || 0) <= 0) return Response.json({ error: 'quote_has_no_priced_items', request_id: requestId }, { status: 422 });
      const validUntil = body.valid_until || quote.valid_until || new Date(Date.now() + 7 * 86400000).toISOString();
      const updated = await base44.asServiceRole.entities.Quote.update(quote.id, { status: 'SENT', sent_at: now, issued_at: quote.issued_at || now, valid_until: validUntil, status_reason: 'quote_sent' });
      const version = await createVersion(base44, updated, user, 'sent', 'Orçamento enviado ao cliente', requestId);
      return Response.json({ quote: { ...updated, current_version_id: version.id }, quote_version: version, request_id: requestId });
    }

    if (action === 'accept') {
      if (!['SENT', 'APPROVED'].includes(quote.status)) return Response.json({ error: 'quote_not_acceptable', request_id: requestId }, { status: 409 });
      if (quote.valid_until && new Date(quote.valid_until) < new Date()) return Response.json({ error: 'quote_expired', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.Quote.update(quote.id, { status: 'ACCEPTED', accepted_at: now, status_reason: body.reason || 'customer_accepted' });
      const version = await createVersion(base44, updated, user, 'accepted', String(body.reason || 'Aceite registrado'), requestId);
      return Response.json({ quote: { ...updated, current_version_id: version.id }, quote_version: version, request_id: requestId });
    }

    if (action === 'reject') {
      const reason = String(body.reason || '').trim();
      if (reason.length < 3) return Response.json({ error: 'rejection_reason_required', request_id: requestId }, { status: 422 });
      if (!['SENT', 'APPROVED'].includes(quote.status)) return Response.json({ error: 'quote_not_rejectable', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.Quote.update(quote.id, { status: 'REJECTED', rejected_at: now, rejection_reason: reason, status_reason: reason });
      const version = await createVersion(base44, updated, user, 'rejected', reason, requestId);
      return Response.json({ quote: { ...updated, current_version_id: version.id }, quote_version: version, request_id: requestId });
    }

    if (action === 'cancel') {
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'cancellation_reason_required', request_id: requestId }, { status: 422 });
      const orders = await base44.asServiceRole.entities.Order.filter({ source_quote_id: quote.id });
      if (orders.some((order: any) => order.status !== 'cancelled')) return Response.json({ error: 'quote_with_active_order_cannot_be_cancelled', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.Quote.update(quote.id, { status: 'CANCELLED', cancelled_at: now, cancelled_by_user_id: user.id, cancellation_reason: reason, status_reason: reason });
      const version = await createVersion(base44, updated, user, 'cancelled', reason, requestId);
      return Response.json({ quote: { ...updated, current_version_id: version.id }, quote_version: version, request_id: requestId });
    }

    if (action === 'reopen') {
      const reason = String(body.reason || '').trim();
      if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('quotes.reopen')) return Response.json({ error: 'manager_approval_required', request_id: requestId }, { status: 403 });
      if (reason.length < 8) return Response.json({ error: 'reopen_reason_required', request_id: requestId }, { status: 422 });
      if (!['REJECTED', 'EXPIRED', 'CANCELLED'].includes(quote.status)) return Response.json({ error: 'quote_not_reopenable', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.Quote.update(quote.id, { status: 'DRAFT', version_number: Number(quote.version_number || 1) + 1, reopened_at: now, reopened_by_user_id: user.id, status_reason: reason, cancelled_at: undefined, cancelled_by_user_id: undefined, cancellation_reason: undefined, valid_until: body.valid_until || new Date(Date.now() + 7 * 86400000).toISOString() });
      const version = await createVersion(base44, updated, user, 'reopened', reason, requestId);
      return Response.json({ quote: { ...updated, current_version_id: version.id }, quote_version: version, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    console.error(`[manage_quote_lifecycle:${requestId}]`, error);
    const message = error instanceof Error ? error.message : 'quote_lifecycle_failed';
    const validation = new Set(['invalid_adjustment', 'adjustment_reason_required', 'invalid_money_value', 'product_not_found', 'service_not_found', 'service_not_compatible']);
    return Response.json({ error: message, request_id: requestId }, { status: validation.has(message) ? 422 : 500 });
  }
});
