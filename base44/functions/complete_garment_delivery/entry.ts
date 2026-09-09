import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'attendant', 'cashier', 'driver']);
const RELEASE_ROLES = new Set(['super_admin', 'admin', 'manager']);
const DELIVERABLE_STATUSES = new Set(['ready', 'out_for_delivery']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

function money(value: any) {
  return Math.round(Math.max(0, Number(value || 0)) * 100) / 100;
}

function receiptNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  const time = now.toISOString().slice(11, 19).replaceAll(':', '');
  return `ENT-${date}-${time}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

async function refreshOccupancy(base44: any, locationId: string) {
  if (!locationId) return;
  const garments = await base44.asServiceRole.entities.GarmentItem.filter({ location_id: locationId }, '-created_date', 5000);
  const current = garments.filter((garment: any) => !['delivered', 'cancelled'].includes(garment.status)).length;
  await base44.asServiceRole.entities.Location.update(locationId, { current_occupancy: current });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  let processedEvent: any = null;
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'complete_garment_delivery' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'attendant') && !(user.permissions || []).includes('deliveries.complete')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const body = await req.json();
    const garmentIds = [...new Set(Array.isArray(body.garment_item_ids) ? body.garment_item_ids.filter(Boolean) : [])];
    const idempotencyKey = String(body.idempotency_key || '').trim();
    const recipientName = String(body.recipient_name || '').trim();
    const deliveryType = body.delivery_type || 'counter_pickup';
    if (garmentIds.length === 0 || garmentIds.length > 200) return Response.json({ error: 'garment_item_ids_required', request_id: requestId }, { status: 400 });
    if (!idempotencyKey || recipientName.length < 2) return Response.json({ error: 'recipient_and_idempotency_required', request_id: requestId }, { status: 422 });

    const eventKey = `complete_garment_delivery:${idempotencyKey}`;
    const previous = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
    const completed = previous.find((event: any) => event.status === 'completed');
    if (completed?.entity_id) {
      const receipt = await base44.asServiceRole.entities.DeliveryReceipt.get(completed.entity_id);
      return Response.json({ receipt, duplicate: true, request_id: requestId });
    }

    const garments = [];
    for (const garmentId of garmentIds) {
      const garment = await base44.asServiceRole.entities.GarmentItem.get(garmentId);
      if (!garment) return Response.json({ error: 'garment_not_found', garment_item_id: garmentId, request_id: requestId }, { status: 404 });
      if (!canAccessUnit(user, garment.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      if (!DELIVERABLE_STATUSES.has(garment.status)) return Response.json({ error: 'garment_not_ready', garment_item_id: garmentId, status: garment.status, request_id: requestId }, { status: 409 });
      garments.push(garment);
    }

    const unitIds = [...new Set(garments.map((garment) => garment.unit_id).filter(Boolean))];
    const customerIds = [...new Set(garments.map((garment) => garment.customer_id).filter(Boolean))];
    if (unitIds.length !== 1 || customerIds.length !== 1) return Response.json({ error: 'single_customer_and_unit_required', request_id: requestId }, { status: 422 });
    const unitId = unitIds[0];
    const customerId = customerIds[0];

    const orderIds = [...new Set(garments.map((garment) => garment.order_id).filter(Boolean))];
    const orders = [];
    for (const orderId of orderIds) {
      const order = await base44.asServiceRole.entities.Order.get(orderId);
      if (!order || order.customer_id !== customerId || order.unit_id !== unitId) return Response.json({ error: 'order_scope_mismatch', request_id: requestId }, { status: 409 });
      orders.push(order);
    }

    const totalOutstanding = money(orders.reduce((sum, order) => sum + Math.max(0, Number(order.total_amount || 0) - Number(order.paid_amount || 0)), 0));
    const releaseWithOutstanding = totalOutstanding > 0;
    if (releaseWithOutstanding) {
      if (body.allow_outstanding !== true) return Response.json({ error: 'outstanding_balance', outstanding_amount: totalOutstanding, request_id: requestId }, { status: 409 });
      if (!RELEASE_ROLES.has(user.role) && !(user.permissions || []).includes('deliveries.release_unpaid')) {
        return Response.json({ error: 'outstanding_release_forbidden', request_id: requestId }, { status: 403 });
      }
      if (String(body.release_reason || '').trim().length < 10) return Response.json({ error: 'release_reason_required', request_id: requestId }, { status: 422 });
    }

    const allOrderGarments = [];
    for (const orderId of orderIds) {
      const related = await base44.asServiceRole.entities.GarmentItem.filter({ order_id: orderId }, 'garment_code', 1000);
      allOrderGarments.push(...related);
    }
    const remainingBefore = allOrderGarments.filter((garment: any) => !['delivered', 'cancelled'].includes(garment.status));
    const deliveryScope = remainingBefore.every((garment: any) => garmentIds.includes(garment.id)) ? 'total' : 'partial';
    const deliveredValue = money(garments.reduce((sum, garment) => sum + Number(garment.total_amount || garment.subtotal || 0), 0));

    processedEvent = previous[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: eventKey,
      event_type: 'complete_garment_delivery',
      source: 'user_command',
      status: 'processing',
      payload_hash: `${garmentIds.sort().join(',')}|${recipientName}|${deliveryType}`,
      attempts: 1,
      started_at: new Date().toISOString(),
      unit_id: unitId,
    });

    const deliveredAt = new Date().toISOString();
    const affectedLocations = new Set<string>();
    const updatedGarments = [];
    for (const garment of garments) {
      if (garment.location_id) affectedLocations.add(garment.location_id);
      const updated = await base44.asServiceRole.entities.GarmentItem.update(garment.id, {
        status: 'delivered', delivered_at: deliveredAt, location_id: null, location_label: null,
        metadata: { ...(garment.metadata || {}), delivery_request_id: requestId },
      });
      updatedGarments.push(updated);
      await base44.asServiceRole.entities.GarmentEvent.create({
        garment_item_id: garment.id,
        order_id: garment.order_id,
        unit_id: garment.unit_id,
        event_type: 'delivered',
        from_status: garment.status,
        to_status: 'delivered',
        from_location_id: garment.location_id,
        to_location_id: null,
        operator_user_id: user.id,
        operator_name: user.full_name || user.display_name,
        reason: deliveryType,
        notes: `Recebido por ${recipientName}`,
        asset_ids: Array.isArray(body.proof_asset_ids) ? body.proof_asset_ids : [],
        occurred_at: deliveredAt,
        request_id: requestId,
      });
    }

    const updatedOrders = [];
    for (const order of orders) {
      const currentGarments = await base44.asServiceRole.entities.GarmentItem.filter({ order_id: order.id }, 'garment_code', 1000);
      const active = currentGarments.filter((garment: any) => garment.status !== 'cancelled');
      const deliveredCount = active.filter((garment: any) => garment.status === 'delivered').length;
      const readyCount = active.filter((garment: any) => ['ready', 'out_for_delivery', 'delivered'].includes(garment.status)).length;
      const isComplete = active.length > 0 && deliveredCount === active.length;
      const updated = await base44.asServiceRole.entities.Order.update(order.id, {
        status: isComplete ? 'delivered' : deliveredCount > 0 ? 'partially_delivered' : order.status,
        delivery_status: isComplete ? 'delivered' : deliveredCount > 0 ? 'partially_delivered' : order.delivery_status,
        ready_piece_count: readyCount,
        delivered_piece_count: deliveredCount,
        closed_at: isComplete ? deliveredAt : undefined,
      });
      updatedOrders.push(updated);
    }

    for (const locationId of affectedLocations) await refreshOccupancy(base44, locationId);

    const receipt = await base44.asServiceRole.entities.DeliveryReceipt.create({
      receipt_number: receiptNumber(),
      unit_id: unitId,
      customer_id: customerId,
      order_ids: orderIds,
      garment_item_ids: garmentIds,
      delivery_type: deliveryType,
      delivery_scope: deliveryScope,
      piece_count: garments.length,
      delivered_value: deliveredValue,
      outstanding_value_at_delivery: totalOutstanding,
      released_with_outstanding_balance: releaseWithOutstanding,
      release_reason: releaseWithOutstanding ? String(body.release_reason).trim() : undefined,
      recipient_name: recipientName,
      recipient_document_last4: String(body.recipient_document_last4 || '').replace(/\D/g, '').slice(-4) || undefined,
      recipient_relationship: body.recipient_relationship || undefined,
      signature_asset_id: body.signature_asset_id || undefined,
      proof_asset_ids: Array.isArray(body.proof_asset_ids) ? body.proof_asset_ids : [],
      operator_user_id: user.id,
      delivered_at: deliveredAt,
      idempotency_key: idempotencyKey,
      status: 'completed',
      notes: body.notes || '',
      metadata: { request_id: requestId },
    });

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'deliver', entity_type: 'delivery_receipt', entity_id: receipt.id, item_label: receipt.receipt_number,
      reason: deliveryType, user_email: user.email, user_name: user.full_name || user.display_name,
      user_role: user.role, unit_id: unitId, request_id: requestId,
      before_data: { garment_ids: garmentIds, order_ids: orderIds },
      after_data: { receipt_number: receipt.receipt_number, delivery_scope: deliveryScope, delivered_value: deliveredValue, outstanding_value: totalOutstanding }, success: true,
    });

    await base44.asServiceRole.entities.ProcessedEvent.update(processedEvent.id, {
      status: 'completed', entity_type: 'delivery_receipt', entity_id: receipt.id,
      result: { receipt_id: receipt.id, receipt_number: receipt.receipt_number }, completed_at: deliveredAt,
    });
    return Response.json({ receipt, garments: updatedGarments, orders: updatedOrders, request_id: requestId });
  } catch (error) {
    console.error(`[complete_garment_delivery:${requestId}]`, error);
    if (processedEvent?.id) {
      try {
        const base44 = createClientFromRequest(req);
        await base44.asServiceRole.entities.ProcessedEvent.update(processedEvent.id, { status: 'failed', error_message: 'delivery_failed', completed_at: new Date().toISOString() });
      } catch (_) {}
    }
    return Response.json({ error: 'delivery_failed', request_id: requestId }, { status: 500 });
  }
});
