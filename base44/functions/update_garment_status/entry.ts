import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'attendant', 'production', 'cashier', 'driver']);

const TRANSITIONS: Record<string, string[]> = {
  draft: ['awaiting_approval', 'received', 'cancelled'],
  awaiting_approval: ['received', 'cancelled'],
  received: ['tagged', 'queued', 'with_third_party', 'cancelled'],
  tagged: ['queued', 'with_third_party', 'cancelled'],
  queued: ['washing', 'drying', 'ironing', 'with_third_party', 'cancelled'],
  washing: ['drying', 'ironing', 'quality_control', 'rework'],
  drying: ['ironing', 'quality_control', 'rework'],
  ironing: ['quality_control', 'rework'],
  quality_control: ['ready', 'rework', 'with_third_party'],
  ready: ['out_for_delivery', 'delivered', 'rework'],
  with_third_party: ['quality_control', 'ready', 'rework'],
  rework: ['queued', 'washing', 'drying', 'ironing', 'quality_control'],
  out_for_delivery: ['delivered', 'ready'],
  delivered: [],
  cancelled: [],
};

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

function deriveOrderState(garments: any[]) {
  const active = garments.filter((item) => item.status !== 'cancelled');
  const delivered = active.filter((item) => item.status === 'delivered').length;
  const ready = active.filter((item) => ['ready', 'out_for_delivery', 'delivered'].includes(item.status)).length;

  if (active.length === 0) return { status: 'cancelled', ready, delivered };
  if (delivered === active.length) return { status: 'delivered', ready, delivered };
  if (delivered > 0) return { status: 'partially_delivered', ready, delivered };
  if (ready === active.length) return { status: 'ready', ready, delivered };
  if (ready > 0) return { status: 'partially_ready', ready, delivered };
  return { status: 'processing', ready, delivered };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'update_garment_status' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'attendant') && !(user.permissions || []).includes('production.manage')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const {
      garment_item_id: garmentItemId,
      status: requestedStatus,
      location_id: locationId,
      location_label: locationLabel,
      reason,
      notes,
      asset_ids: assetIds = [],
    } = await req.json();

    if (!garmentItemId || !requestedStatus) {
      return Response.json({ error: 'garment_and_status_required', request_id: requestId }, { status: 400 });
    }

    const garment = await base44.asServiceRole.entities.GarmentItem.get(garmentItemId);
    if (!garment) return Response.json({ error: 'garment_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, garment.unit_id)) {
      return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    }

    const allowed = TRANSITIONS[garment.status] || [];
    if (requestedStatus !== garment.status && !allowed.includes(requestedStatus)) {
      return Response.json({
        error: 'invalid_status_transition',
        from: garment.status,
        to: requestedStatus,
        allowed,
        request_id: requestId,
      }, { status: 409 });
    }

    if (['cancelled', 'rework'].includes(requestedStatus) && !String(reason || '').trim()) {
      return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
    }

    const now = new Date().toISOString();
    const patch: any = {
      status: requestedStatus,
      metadata: { ...(garment.metadata || {}), last_request_id: requestId },
    };
    if (locationId !== undefined) patch.location_id = locationId || null;
    if (locationLabel !== undefined) patch.location_label = locationLabel || null;
    if (requestedStatus === 'ready') patch.ready_at = now;
    if (requestedStatus === 'delivered') patch.delivered_at = now;

    const updated = await base44.asServiceRole.entities.GarmentItem.update(garment.id, patch);
    const locationChanged = locationId !== undefined && locationId !== garment.location_id;

    await base44.asServiceRole.entities.GarmentEvent.create({
      garment_item_id: garment.id,
      order_id: garment.order_id,
      unit_id: garment.unit_id,
      event_type: locationChanged ? 'location_changed' : 'status_changed',
      from_status: garment.status,
      to_status: requestedStatus,
      from_location_id: garment.location_id,
      to_location_id: locationId,
      operator_user_id: user.id,
      operator_name: user.full_name || user.display_name,
      reason: reason || 'operational_update',
      notes: notes || '',
      asset_ids: Array.isArray(assetIds) ? assetIds : [],
      occurred_at: now,
      request_id: requestId,
    });

    let order = null;
    if (garment.order_id) {
      const garments = await base44.asServiceRole.entities.GarmentItem.filter({ order_id: garment.order_id });
      const state = deriveOrderState(garments.map((item: any) => item.id === garment.id ? updated : item));
      order = await base44.asServiceRole.entities.Order.update(garment.order_id, {
        status: state.status,
        ready_piece_count: state.ready,
        delivered_piece_count: state.delivered,
        closed_at: state.status === 'delivered' ? now : undefined,
      });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'status_change',
      entity_type: 'garment_item',
      entity_id: garment.id,
      item_label: garment.garment_code,
      reason: reason || 'operational_update',
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      unit_id: garment.unit_id,
      request_id: requestId,
      before_data: { status: garment.status, location_id: garment.location_id },
      after_data: { status: requestedStatus, location_id: locationId },
      success: true,
    });

    return Response.json({ garment: updated, order, request_id: requestId });
  } catch (error) {
    console.error(`[update_garment_status:${requestId}]`, error);
    return Response.json({ error: 'garment_update_failed', request_id: requestId }, { status: 500 });
  }
});
