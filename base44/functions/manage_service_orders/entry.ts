import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { authorizeUserOrInternal, enforceAuthenticatedUser, securityErrorResponse } from '../../shared/functionSecurity.js';
import { assertTransition, nextServiceOrderNumber, SERVICE_ORDER_TRANSITIONS } from '../../shared/businessCore.js';
import { recordDomainEvent } from '../../shared/domainEvents.js';

const SERVICE_TYPES = new Set(['laundry_piece', 'laundry_weight', 'hospital_pickup', 'hospital_processing', 'linen_delivery', 'linen_collection', 'corporate_cleaning', 'inspection', 'maintenance', 'outsourcing', 'other']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent', 'critical']);

function clean(value: unknown, max = 180) { return String(value || '').trim().slice(0, max); }
function reason(value: unknown) { const text = clean(value, 800); if (text.length < 8) throw new Error('reason_required'); return text; }
function unique(values: unknown) { return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))]; }

async function principalFor(base44: any, req: Request, user: any, permission: string, legalEntityId: string, unitId?: string, requireMfa = false) {
  return enforceAuthenticatedUser(base44, req, user, { permission, legalEntityId, unitId: unitId || null, requireMfa, source: 'manage_service_orders' });
}

async function audit(db: any, principal: any, input: any) {
  await db.AuditLog.create({
    action: input.action,
    entity_type: 'service_order',
    entity_id: input.order.id,
    item_label: input.order.service_order_number,
    reason: input.reason,
    user_id: principal.user.id,
    user_email: principal.user.email,
    user_name: principal.user.full_name || principal.user.display_name || principal.user.email,
    user_role: principal.role,
    legal_entity_id: input.order.legal_entity_id,
    unit_id: input.order.unit_id,
    request_id: input.request_id,
    before_data: input.before_data,
    after_data: input.after_data,
    metadata: input.metadata || {},
    success: true,
    domain: 'operations',
  });
}

async function validateAssets(db: any, ids: string[], legalEntityId: string) {
  const uniqueIds = unique(ids);
  const assets = await Promise.all(uniqueIds.map((id: string) => db.DocumentAsset.get(id).catch(() => null)));
  if (assets.some((asset) => !asset || asset.legal_entity_id !== legalEntityId || (asset.status || 'active') !== 'active')) throw new Error('document_scope_mismatch');
  return uniqueIds;
}

async function companyCode(db: any, legalEntityId: string) {
  const company = await db.LegalEntity.get(legalEntityId).catch(() => null);
  if (!company) throw new Error('legal_entity_not_found');
  return clean(company.code || company.trade_name || 'ERP', 12);
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const body = await req.json();
    const action = clean(body.action, 60);
    const auth = await authorizeUserOrInternal(base44, req, body, { allowInternal: false, source: 'manage_service_orders' });

    if (action === 'list') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      await principalFor(base44, req, auth.user, 'service_orders.view', legalEntityId, body.unit_id);
      let orders = await db.ServiceOrder.filter({ legal_entity_id: legalEntityId }, '-created_date', 1000).catch(() => []);
      if (body.unit_id) orders = orders.filter((row: any) => row.unit_id === body.unit_id);
      if (body.status) orders = orders.filter((row: any) => row.status === body.status);
      if (body.contract_id) orders = orders.filter((row: any) => row.contract_id === body.contract_id);
      return Response.json({ service_orders: orders, request_id: requestId });
    }

    if (action === 'create') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const unitId = clean(body.unit_id, 100) || null;
      const principal = await principalFor(base44, req, auth.user, 'service_orders.execute', legalEntityId, unitId || undefined);
      const idempotencyKey = clean(body.idempotency_key, 160);
      if (idempotencyKey.length < 12) return Response.json({ error: 'idempotency_key_required', request_id: requestId }, { status: 422 });
      const prior = await db.ServiceOrder.filter({ legal_entity_id: legalEntityId, idempotency_key: idempotencyKey }, '-created_date', 2).catch(() => []);
      if (prior.length) return Response.json({ service_order: prior[0], idempotent: true, request_id: requestId });
      const party = await db.BusinessParty.get(body.business_party_id).catch(() => null);
      if (!party || ['blocked', 'inactive'].includes(party.status)) return Response.json({ error: 'party_unavailable', request_id: requestId }, { status: 409 });
      const serviceType = clean(body.service_type, 60);
      if (!SERVICE_TYPES.has(serviceType)) return Response.json({ error: 'invalid_service_type', request_id: requestId }, { status: 422 });
      let contract = null;
      if (body.contract_id) {
        contract = await db.BusinessContract.get(body.contract_id).catch(() => null);
        if (!contract || contract.legal_entity_id !== legalEntityId || contract.business_party_id !== party.id || contract.status !== 'active') return Response.json({ error: 'active_contract_scope_required', request_id: requestId }, { status: 409 });
      }
      const assetIds = await validateAssets(db, unique(body.document_asset_ids), legalEntityId);
      const code = await companyCode(db, legalEntityId);
      const orderNumber = clean(body.service_order_number, 90) || nextServiceOrderNumber(Date.now() % 9999999, code);
      const changeReason = reason(body.reason);
      const order = await db.ServiceOrder.create({
        legal_entity_id: legalEntityId, unit_id: unitId, cost_center_id: clean(body.cost_center_id || contract?.cost_center_id, 100) || null,
        warehouse_id: clean(body.warehouse_id || contract?.warehouse_id, 100) || null, business_party_id: party.id,
        contract_id: contract?.id || null, opportunity_id: clean(body.opportunity_id, 100) || null,
        service_order_number: orderNumber, service_type: serviceType, title: clean(body.title, 240), description: clean(body.description, 4000) || null,
        priority: PRIORITIES.has(body.priority) ? body.priority : 'normal', service_address_id: clean(body.service_address_id || contract?.service_address_id, 100) || null,
        scheduled_start_at: body.scheduled_start_at || null, scheduled_end_at: body.scheduled_end_at || null,
        team_user_ids: unique(body.team_user_ids), owner_user_id: clean(body.owner_user_id, 100) || principal.user.id,
        diagnosis: clean(body.diagnosis, 3000) || null, execution_notes: null, materials: [], checklist: Array.isArray(body.checklist) ? body.checklist : [],
        document_asset_ids: assetIds, customer_acceptance_status: body.customer_acceptance_required === true ? 'pending' : 'not_required',
        status: body.scheduled_start_at ? 'scheduled' : 'draft', idempotency_key: idempotencyKey,
        created_by_user_id: principal.user.id, updated_by_user_id: principal.user.id, metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      await audit(db, principal, { action: 'create', order, reason: changeReason, request_id: requestId, after_data: order });
      await recordDomainEvent(db, { eventType: 'service_order.created', aggregateType: 'ServiceOrder', aggregateId: order.id, legalEntityId, unitId, actorId: principal.user.id, eventKey: `service_order.created:${order.id}`, payload: { service_order_number: orderNumber, service_type: serviceType, contract_id: contract?.id || null, status: order.status } });
      return Response.json({ service_order: order, request_id: requestId }, { status: 201 });
    }

    const order = await db.ServiceOrder.get(clean(body.service_order_id, 100)).catch(() => null);
    if (!order) return Response.json({ error: 'service_order_not_found', request_id: requestId }, { status: 404 });
    const legalEntityId = order.legal_entity_id;
    const unitId = order.unit_id || undefined;

    if (action === 'detail') {
      await principalFor(base44, req, auth.user, 'service_orders.view', legalEntityId, unitId);
      const [party, contract] = await Promise.all([
        db.BusinessParty.get(order.business_party_id).catch(() => null),
        order.contract_id ? db.BusinessContract.get(order.contract_id).catch(() => null) : null,
      ]);
      return Response.json({ service_order: order, party, contract, request_id: requestId });
    }

    if (action === 'update_execution') {
      const principal = await principalFor(base44, req, auth.user, 'service_orders.execute', legalEntityId, unitId);
      if (!['scheduled', 'in_progress', 'waiting_customer', 'quality_review'].includes(order.status)) return Response.json({ error: 'service_order_not_executable', request_id: requestId }, { status: 409 });
      const changeReason = reason(body.reason);
      const assetIds = body.document_asset_ids ? await validateAssets(db, body.document_asset_ids, legalEntityId) : (order.document_asset_ids || []);
      const patch: any = {
        updated_by_user_id: principal.user.id,
        execution_notes: body.execution_notes === undefined ? order.execution_notes : clean(body.execution_notes, 5000),
        diagnosis: body.diagnosis === undefined ? order.diagnosis : clean(body.diagnosis, 3000),
        materials: Array.isArray(body.materials) ? body.materials.slice(0, 500) : (order.materials || []),
        checklist: Array.isArray(body.checklist) ? body.checklist.slice(0, 500) : (order.checklist || []),
        document_asset_ids: assetIds,
      };
      const updated = await db.ServiceOrder.update(order.id, patch);
      await audit(db, principal, { action: 'update', order, reason: changeReason, request_id: requestId, before_data: { execution_notes: order.execution_notes, materials: order.materials, checklist: order.checklist, document_asset_ids: order.document_asset_ids }, after_data: patch });
      return Response.json({ service_order: updated, request_id: requestId });
    }

    const transitions: Record<string, string> = {
      schedule: 'scheduled', start: 'in_progress', wait_customer: 'waiting_customer', resume: 'in_progress',
      submit_quality: 'quality_review', approve_completion: 'completed', cancel: 'cancelled',
    };
    if (transitions[action]) {
      const nextStatus = transitions[action];
      const approval = ['approve_completion', 'cancel'].includes(action);
      const permission = approval ? 'service_orders.approve' : 'service_orders.execute';
      const principal = await principalFor(base44, req, auth.user, permission, legalEntityId, unitId, approval);
      const transition = assertTransition(order.status, nextStatus, SERVICE_ORDER_TRANSITIONS, 'invalid_service_order_transition');
      if (transition.idempotent) return Response.json({ service_order: order, idempotent: true, request_id: requestId });
      const changeReason = reason(body.reason);
      if (action === 'approve_completion' && !(order.document_asset_ids || []).length && order.service_type !== 'other') return Response.json({ error: 'service_evidence_required', request_id: requestId }, { status: 409 });
      const now = new Date().toISOString();
      const patch: any = { status: nextStatus, updated_by_user_id: principal.user.id };
      if (action === 'schedule') { patch.scheduled_start_at = body.scheduled_start_at || order.scheduled_start_at; patch.scheduled_end_at = body.scheduled_end_at || order.scheduled_end_at; if (!patch.scheduled_start_at) return Response.json({ error: 'schedule_required', request_id: requestId }, { status: 422 }); }
      if (action === 'start') patch.started_at = order.started_at || now;
      if (action === 'approve_completion') { patch.completed_at = now; patch.quality_score = Math.max(0, Math.min(100, Number(body.quality_score || 100))); patch.quality_notes = clean(body.quality_notes, 2000) || null; }
      if (action === 'cancel') { patch.cancelled_at = now; patch.cancellation_reason = changeReason; }
      const updated = await db.ServiceOrder.update(order.id, patch);
      await audit(db, principal, { action: action === 'approve_completion' ? 'approve' : 'status_change', order, reason: changeReason, request_id: requestId, before_data: { status: order.status }, after_data: patch, metadata: { operation: action } });
      await recordDomainEvent(db, { eventType: `service_order.${nextStatus}`, aggregateType: 'ServiceOrder', aggregateId: order.id, legalEntityId, unitId, actorId: principal.user.id, payload: { previous_status: order.status, status: nextStatus, operation: action } });
      return Response.json({ service_order: updated, request_id: requestId });
    }

    if (action === 'record_customer_acceptance') {
      const principal = await principalFor(base44, req, auth.user, 'service_orders.execute', legalEntityId, unitId);
      if (order.status !== 'waiting_customer') return Response.json({ error: 'customer_acceptance_not_expected', request_id: requestId }, { status: 409 });
      const acceptance = body.accepted === true ? 'accepted' : 'rejected';
      const changeReason = reason(body.reason);
      const updated = await db.ServiceOrder.update(order.id, { customer_acceptance_status: acceptance, customer_accepted_at: new Date().toISOString(), updated_by_user_id: principal.user.id });
      await audit(db, principal, { action: 'status_change', order, reason: changeReason, request_id: requestId, before_data: { customer_acceptance_status: order.customer_acceptance_status }, after_data: { customer_acceptance_status: acceptance } });
      return Response.json({ service_order: updated, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const validation = new Set(['reason_required', 'document_scope_mismatch', 'legal_entity_not_found', 'invalid_service_order_transition', 'domain_event_key_conflict']);
    return Response.json({ error: validation.has(error?.message) ? error.message : 'service_order_operation_failed', request_id: requestId }, { status: validation.has(error?.message) ? 422 : 500 });
  }
});
