import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'attendant', 'production']);
const TERMINAL_STATUSES = new Set(['delivered', 'cancelled']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

async function refreshOccupancy(base44: any, locationId: string) {
  if (!locationId) return;
  const garments = await base44.asServiceRole.entities.GarmentItem.filter({ location_id: locationId }, '-created_date', 5000);
  const current = garments.filter((garment: any) => !TERMINAL_STATUSES.has(garment.status)).length;
  await base44.asServiceRole.entities.Location.update(locationId, { current_occupancy: current });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  let processedEvent: any = null;
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'move_garments' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'attendant') && !(user.permissions || []).includes('garments.move')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const body = await req.json();
    const garmentIds = [...new Set(Array.isArray(body.garment_item_ids) ? body.garment_item_ids.filter(Boolean) : [])];
    const locationId = body.location_id || null;
    const reason = String(body.reason || 'physical_storage').trim();
    const idempotencyKey = String(body.idempotency_key || '').trim();
    if (garmentIds.length === 0 || garmentIds.length > 200) return Response.json({ error: 'garment_item_ids_required', request_id: requestId }, { status: 400 });
    if (!idempotencyKey) return Response.json({ error: 'idempotency_key_required', request_id: requestId }, { status: 400 });

    const eventKey = `move_garments:${idempotencyKey}`;
    const previous = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
    const completed = previous.find((event: any) => event.status === 'completed');
    if (completed) return Response.json({ ...(completed.result || {}), duplicate: true, request_id: requestId });

    const garments = [];
    for (const garmentId of garmentIds) {
      const garment = await base44.asServiceRole.entities.GarmentItem.get(garmentId);
      if (!garment) return Response.json({ error: 'garment_not_found', garment_item_id: garmentId, request_id: requestId }, { status: 404 });
      if (!canAccessUnit(user, garment.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      if (TERMINAL_STATUSES.has(garment.status)) return Response.json({ error: 'terminal_garment_cannot_move', garment_item_id: garmentId, request_id: requestId }, { status: 409 });
      garments.push(garment);
    }

    const unitIds = [...new Set(garments.map((garment) => garment.unit_id).filter(Boolean))];
    if (unitIds.length !== 1) return Response.json({ error: 'single_unit_required', request_id: requestId }, { status: 422 });
    const unitId = unitIds[0];

    let location: any = null;
    if (locationId) {
      location = await base44.asServiceRole.entities.Location.get(locationId);
      if (!location || location.active === false) return Response.json({ error: 'location_not_found', request_id: requestId }, { status: 404 });
      if (location.unit_id !== unitId || !canAccessUnit(user, location.unit_id)) return Response.json({ error: 'forbidden_location', request_id: requestId }, { status: 403 });
      const incoming = garments.filter((garment) => garment.location_id !== locationId).length;
      if (Number(location.capacity || 0) > 0 && Number(location.current_occupancy || 0) + incoming > Number(location.capacity)) {
        return Response.json({ error: 'location_capacity_exceeded', available: Math.max(0, Number(location.capacity) - Number(location.current_occupancy || 0)), request_id: requestId }, { status: 409 });
      }
    }

    processedEvent = previous[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: eventKey,
      event_type: 'move_garments',
      source: 'user_command',
      status: 'processing',
      payload_hash: `${garmentIds.sort().join(',')}|${locationId || 'none'}`,
      attempts: 1,
      started_at: new Date().toISOString(),
      unit_id: unitId,
    });

    const occurredAt = new Date().toISOString();
    const affectedLocations = new Set<string>();
    const updated = [];
    for (const garment of garments) {
      if (garment.location_id) affectedLocations.add(garment.location_id);
      if (locationId) affectedLocations.add(locationId);
      const patch = {
        location_id: locationId,
        location_label: location ? `${location.code} · ${location.name}` : null,
        metadata: { ...(garment.metadata || {}), last_request_id: requestId },
      };
      const current = await base44.asServiceRole.entities.GarmentItem.update(garment.id, patch);
      updated.push(current);
      await base44.asServiceRole.entities.GarmentEvent.create({
        garment_item_id: garment.id,
        order_id: garment.order_id,
        unit_id: garment.unit_id,
        event_type: 'location_changed',
        from_status: garment.status,
        to_status: garment.status,
        from_location_id: garment.location_id,
        to_location_id: locationId,
        operator_user_id: user.id,
        operator_name: user.full_name || user.display_name,
        reason,
        notes: body.notes || '',
        occurred_at: occurredAt,
        request_id: requestId,
      });
    }

    for (const affectedLocationId of affectedLocations) await refreshOccupancy(base44, affectedLocationId);

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'move',
      entity_type: 'garment_item',
      entity_id: garmentIds.join(','),
      item_label: `${garmentIds.length} peça(s)`,
      reason,
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      unit_id: unitId,
      request_id: requestId,
      before_data: garments.map((garment) => ({ id: garment.id, location_id: garment.location_id })),
      after_data: { location_id: locationId, location_label: location ? `${location.code} · ${location.name}` : null },
      success: true,
    });

    const result = { moved: updated.length, garment_ids: garmentIds, location_id: locationId };
    await base44.asServiceRole.entities.ProcessedEvent.update(processedEvent.id, { status: 'completed', result, completed_at: occurredAt });
    return Response.json({ ...result, request_id: requestId });
  } catch (error) {
    console.error(`[move_garments:${requestId}]`, error);
    if (processedEvent?.id) {
      try {
        const base44 = createClientFromRequest(req);
        await base44.asServiceRole.entities.ProcessedEvent.update(processedEvent.id, { status: 'failed', error_message: 'move_garments_failed', completed_at: new Date().toISOString() });
      } catch (_) {}
    }
    return Response.json({ error: 'move_garments_failed', request_id: requestId }, { status: 500 });
  }
});
