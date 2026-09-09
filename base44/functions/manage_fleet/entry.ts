import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const MANAGE_ROLES = new Set(['super_admin', 'admin', 'manager', 'logistics_manager']);
const VIEW_ROLES = new Set([...MANAGE_ROLES, 'driver', 'attendant', 'auditor']);
function canAccessUnit(user: any, unitId?: string) { if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true; return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId); }
function normalizePlate(value: any) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
async function audit(base44: any, user: any, requestId: string, action: string, vehicle: any, reason: string, before?: any) { return base44.asServiceRole.entities.AuditLog.create({ action, entity_type: 'fleet_vehicle', entity_id: vehicle.id, item_label: `${vehicle.code} · ${vehicle.plate}`, reason, user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role, unit_id: vehicle.unit_id, request_id: requestId, before_data: before, after_data: vehicle, domain: 'logistics', severity: action === 'status_change' ? 'notice' : 'info', result: 'success', occurred_at: new Date().toISOString(), success: true }); }

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_fleet' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!VIEW_ROLES.has(user.role) && !(user.permissions || []).includes('logistics.view')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const body = await req.json(); const action = String(body.action || 'list');
    if (action === 'list') { const rows = await base44.asServiceRole.entities.FleetVehicle.list('code', 2000); return Response.json({ vehicles: rows.filter((row: any) => canAccessUnit(user, row.unit_id)), request_id: requestId }); }
    if (!MANAGE_ROLES.has(user.role) && !(user.permissions || []).includes('fleet.manage')) return Response.json({ error: 'management_forbidden', request_id: requestId }, { status: 403 });
    if (action === 'save') {
      const reason = String(body.change_reason || '').trim(); const unitId = body.unit_id || user.primary_unit_id; const plate = normalizePlate(body.plate);
      if (!canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      if (!String(body.code || '').trim() || plate.length < 7 || reason.length < 8) return Response.json({ error: 'code_plate_and_reason_required', request_id: requestId }, { status: 422 });
      const all = await base44.asServiceRole.entities.FleetVehicle.list('code', 2000); const duplicate = all.find((row: any) => row.id !== body.vehicle_id && normalizePlate(row.plate) === plate && row.active !== false); if (duplicate) return Response.json({ error: 'vehicle_plate_exists', vehicle_id: duplicate.id, request_id: requestId }, { status: 409 });
      const before = body.vehicle_id ? await base44.asServiceRole.entities.FleetVehicle.get(body.vehicle_id) : null; if (before && !canAccessUnit(user, before.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const payload = { unit_id: unitId, code: String(body.code).trim().toUpperCase(), plate, description: body.description, vehicle_type: body.vehicle_type || 'car', status: before?.status || body.status || 'available', capacity_kg: Math.max(0, Number(body.capacity_kg || 0)), capacity_volume_m3: Math.max(0, Number(body.capacity_volume_m3 || 0)), capacity_stops: Math.max(0, Number(body.capacity_stops || 0)), odometer_km: Math.max(0, Number(body.odometer_km || 0)), fuel_type: body.fuel_type, cost_per_km: Math.max(0, Number(body.cost_per_km || 0)), insurance_valid_until: body.insurance_valid_until, registration_valid_until: body.registration_valid_until, next_maintenance_at_km: body.next_maintenance_at_km ? Number(body.next_maintenance_at_km) : undefined, next_maintenance_at: body.next_maintenance_at, active: body.active !== false, created_by_user_id: before?.created_by_user_id || user.id, updated_by_user_id: user.id, change_reason: reason, metadata: body.metadata || before?.metadata || {} };
      const vehicle = before ? await base44.asServiceRole.entities.FleetVehicle.update(before.id, payload) : await base44.asServiceRole.entities.FleetVehicle.create(payload); await audit(base44, user, requestId, before ? 'update' : 'create', vehicle, reason, before); return Response.json({ vehicle, request_id: requestId });
    }
    if (action === 'set_status') {
      const vehicle = await base44.asServiceRole.entities.FleetVehicle.get(body.vehicle_id); if (!vehicle || !canAccessUnit(user, vehicle.unit_id)) return Response.json({ error: 'vehicle_not_found', request_id: requestId }, { status: 404 });
      const status = String(body.status || ''); const reason = String(body.reason || '').trim(); if (!['available', 'assigned', 'in_route', 'maintenance', 'inactive'].includes(status) || reason.length < 8) return Response.json({ error: 'valid_status_and_reason_required', request_id: requestId }, { status: 422 });
      if (vehicle.status === 'in_route' && status === 'maintenance') return Response.json({ error: 'vehicle_in_active_route', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.FleetVehicle.update(vehicle.id, { status, current_driver_user_id: status === 'available' ? undefined : body.driver_user_id || vehicle.current_driver_user_id, change_reason: reason, updated_by_user_id: user.id }); await audit(base44, user, requestId, 'status_change', updated, reason, vehicle); return Response.json({ vehicle: updated, request_id: requestId });
    }
    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 422 });
  } catch (error: any) { return Response.json({ error: error?.message || 'fleet_operation_failed', request_id: requestId }, { status: 500 }); }
});
