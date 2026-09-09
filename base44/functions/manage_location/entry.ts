import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager']);
const LOCATION_TYPES = new Set(['reception', 'production', 'machine', 'rack', 'shelf', 'locker', 'dispatch', 'third_party', 'other']);

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
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_location' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('locations.manage')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const body = await req.json();
    const action = body.action || 'create';
    if (!['create', 'update', 'archive'].includes(action)) return Response.json({ error: 'invalid_action', request_id: requestId }, { status: 400 });

    if (action === 'create') {
      const unitId = body.unit_id || user.primary_unit_id;
      const code = String(body.code || '').trim().toUpperCase();
      const name = String(body.name || '').trim();
      const locationType = String(body.location_type || 'other');
      if (!unitId || !code || !name || !LOCATION_TYPES.has(locationType)) return Response.json({ error: 'invalid_location', request_id: requestId }, { status: 422 });
      if (!canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const duplicates = await base44.asServiceRole.entities.Location.filter({ unit_id: unitId, code });
      if (duplicates.some((location: any) => location.active !== false)) return Response.json({ error: 'location_code_exists', request_id: requestId }, { status: 409 });

      const location = await base44.asServiceRole.entities.Location.create({
        unit_id: unitId,
        code,
        name,
        location_type: locationType,
        parent_location_id: body.parent_location_id || undefined,
        capacity: Math.max(0, Number(body.capacity || 0)),
        current_occupancy: 0,
        scan_required: body.scan_required !== false,
        active: true,
        metadata: { created_request_id: requestId },
      });
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'create', entity_type: 'location', entity_id: location.id, item_label: `${code} · ${name}`,
        reason: 'location_created', user_email: user.email, user_name: user.full_name || user.display_name,
        user_role: user.role, unit_id: unitId, request_id: requestId, after_data: location, success: true,
      });
      return Response.json({ location, request_id: requestId });
    }

    const location = await base44.asServiceRole.entities.Location.get(body.location_id);
    if (!location) return Response.json({ error: 'location_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, location.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });

    if (action === 'archive') {
      if (Number(location.current_occupancy || 0) > 0) return Response.json({ error: 'location_not_empty', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.Location.update(location.id, { active: false });
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'archive', entity_type: 'location', entity_id: location.id, item_label: `${location.code} · ${location.name}`,
        reason: String(body.reason || 'location_archived'), user_email: user.email, user_name: user.full_name || user.display_name,
        user_role: user.role, unit_id: location.unit_id, request_id: requestId, before_data: location, after_data: updated, success: true,
      });
      return Response.json({ location: updated, request_id: requestId });
    }

    const patch: any = {};
    if (body.name !== undefined) patch.name = String(body.name || '').trim();
    if (body.capacity !== undefined) patch.capacity = Math.max(0, Number(body.capacity || 0));
    if (body.scan_required !== undefined) patch.scan_required = body.scan_required === true;
    if (body.location_type !== undefined && LOCATION_TYPES.has(body.location_type)) patch.location_type = body.location_type;
    if (patch.capacity > 0 && patch.capacity < Number(location.current_occupancy || 0)) return Response.json({ error: 'capacity_below_occupancy', request_id: requestId }, { status: 409 });
    const updated = await base44.asServiceRole.entities.Location.update(location.id, patch);
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'update', entity_type: 'location', entity_id: location.id, item_label: `${location.code} · ${location.name}`,
      reason: String(body.reason || 'location_updated'), user_email: user.email, user_name: user.full_name || user.display_name,
      user_role: user.role, unit_id: location.unit_id, request_id: requestId, before_data: location, after_data: updated, success: true,
    });
    return Response.json({ location: updated, request_id: requestId });
  } catch (error) {
    console.error(`[manage_location:${requestId}]`, error);
    return Response.json({ error: 'location_management_failed', request_id: requestId }, { status: 500 });
  }
});
