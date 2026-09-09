import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager']);
const OPERATIONAL_ROLES = new Set(['super_admin', 'admin', 'manager', 'production', 'operator']);
const TYPES = new Set(['wash', 'dry', 'iron', 'dry_clean']);
const STATUSES = new Set(['idle', 'reserved', 'running', 'paused', 'finished', 'maintenance', 'out_of_service']);

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
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_machine' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    const input = await req.json();
    const action = String(input.action || '');
    const now = new Date().toISOString();

    if (action === 'create') {
      if (!MANAGER_ROLES.has(user.role || '') && !(user.permissions || []).includes('production.machines')) return Response.json({ error: 'manager_permission_required', request_id: requestId }, { status: 403 });
      const unitId = String(input.unit_id || '');
      const machineId = String(input.machine_id || '').trim().toUpperCase();
      if (!unitId || !machineId || !canAccessUnit(user, unitId) || !TYPES.has(input.machine_type)) return Response.json({ error: 'machine_fields_invalid', request_id: requestId }, { status: 422 });
      const duplicate = await base44.asServiceRole.entities.MachineState.filter({ machine_id: machineId });
      if (duplicate[0]) return Response.json({ error: 'machine_id_already_exists', machine: duplicate[0], request_id: requestId }, { status: 409 });
      const machine = await base44.asServiceRole.entities.MachineState.create({ unit_id: unitId, name: String(input.name || machineId), machine_id: machineId, machine_type: input.machine_type, active: true, operational_status: 'idle', capacity_kg: input.capacity_kg == null ? undefined : Number(input.capacity_kg), capacity_items: input.capacity_items == null ? undefined : Number(input.capacity_items), minimum_load_percent: Number(input.minimum_load_percent || 0), maximum_load_percent: Number(input.maximum_load_percent || 100), hourly_cost: Number(input.hourly_cost || 0), cycle_energy_cost: Number(input.cycle_energy_cost || 0), cycle_water_cost: Number(input.cycle_water_cost || 0), minutes: 0, ends_at: 0, finished: false, metadata: { created_by_user_id: user.id } });
      await base44.asServiceRole.entities.AuditLog.create({ action: 'create', entity_type: 'machine_state', entity_id: machine.id, item_label: machine.name, reason: 'machine_created', user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: unitId, request_id: requestId, after_data: machine, success: true });
      return Response.json({ machine, request_id: requestId });
    }

    const machineId = String(input.machine_id || '');
    const records = machineId ? await base44.asServiceRole.entities.MachineState.filter({ machine_id: machineId }) : [];
    const machine = records[0];
    if (!machine) return Response.json({ error: 'machine_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, machine.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });

    if (action === 'update') {
      if (!MANAGER_ROLES.has(user.role || '') && !(user.permissions || []).includes('production.machines')) return Response.json({ error: 'manager_permission_required', request_id: requestId }, { status: 403 });
      if (machine.production_batch_id && machine.operational_status === 'running') return Response.json({ error: 'running_machine_not_editable', request_id: requestId }, { status: 409 });
      const patch: any = {};
      for (const field of ['name', 'capacity_kg', 'capacity_items', 'minimum_load_percent', 'maximum_load_percent', 'hourly_cost', 'cycle_energy_cost', 'cycle_water_cost', 'next_maintenance_at', 'maintenance_notes', 'active']) {
        if (input[field] !== undefined) patch[field] = ['name', 'next_maintenance_at', 'maintenance_notes'].includes(field) ? input[field] : field === 'active' ? Boolean(input[field]) : Number(input[field]);
      }
      if (input.machine_type !== undefined) {
        if (!TYPES.has(input.machine_type)) return Response.json({ error: 'invalid_machine_type', request_id: requestId }, { status: 422 });
        patch.machine_type = input.machine_type;
      }
      const updated = await base44.asServiceRole.entities.MachineState.update(machine.id, patch);
      await base44.asServiceRole.entities.AuditLog.create({ action: 'update', entity_type: 'machine_state', entity_id: machine.id, item_label: machine.name || machine.machine_id, reason: String(input.reason || 'machine_configuration_updated'), user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: machine.unit_id, request_id: requestId, before_data: machine, after_data: updated, success: true });
      return Response.json({ machine: updated, request_id: requestId });
    }

    if (action === 'set_status') {
      if (!OPERATIONAL_ROLES.has(user.role || '') && !(user.permissions || []).includes('production.operate')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
      const status = String(input.status || '');
      if (!STATUSES.has(status)) return Response.json({ error: 'invalid_machine_status', request_id: requestId }, { status: 422 });
      if (machine.production_batch_id && ['maintenance', 'out_of_service'].includes(status)) return Response.json({ error: 'machine_has_active_batch', request_id: requestId }, { status: 409 });
      if (['maintenance', 'out_of_service'].includes(status) && !String(input.reason || '').trim()) return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
      const patch: any = { operational_status: status };
      if (status === 'maintenance') patch.last_maintenance_at = now;
      if (status === 'idle') { patch.production_batch_id = null; patch.operator_user_id = null; patch.finished = false; patch.ends_at = 0; patch.minutes = 0; }
      const updated = await base44.asServiceRole.entities.MachineState.update(machine.id, patch);
      await base44.asServiceRole.entities.AuditLog.create({ action: 'status_change', entity_type: 'machine_state', entity_id: machine.id, item_label: machine.name || machine.machine_id, reason: String(input.reason || `machine_${status}`), user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: machine.unit_id, request_id: requestId, before_data: { operational_status: machine.operational_status }, after_data: { operational_status: status }, success: true });
      return Response.json({ machine: updated, request_id: requestId });
    }

    if (action === 'seed_legacy') {
      if (!MANAGER_ROLES.has(user.role || '')) return Response.json({ error: 'manager_permission_required', request_id: requestId }, { status: 403 });
      const unitId = String(input.unit_id || '');
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const defaults = [
        ['WSH-9001', 'Lavar 1', 'wash'], ['WSH-9002', 'Lavar 2', 'wash'], ['WSH-9003', 'Lavar 3', 'wash'],
        ['DRY-7000', 'Secar 1', 'dry'], ['DRC-5000', 'Lavagem a seco 1', 'dry_clean'], ['PRS-X1', 'Passar 1', 'iron'], ['PRS-X2', 'Passar 2', 'iron'],
      ];
      const created = [];
      for (const [id, name, type] of defaults) {
        const existing = await base44.asServiceRole.entities.MachineState.filter({ machine_id: id });
        if (existing[0]) {
          if (!existing[0].unit_id) await base44.asServiceRole.entities.MachineState.update(existing[0].id, { unit_id: unitId, name, active: true, operational_status: existing[0].finished ? 'finished' : existing[0].ends_at > Date.now() ? 'running' : 'idle' });
          continue;
        }
        created.push(await base44.asServiceRole.entities.MachineState.create({ unit_id: unitId, name, machine_id: id, machine_type: type, active: true, operational_status: 'idle', minutes: 0, ends_at: 0, finished: false, maximum_load_percent: 100 }));
      }
      return Response.json({ created_count: created.length, machines: created, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[manage_machine:${requestId}]`, error);
    return Response.json({ error: (error as Error)?.message || 'machine_operation_failed', request_id: requestId }, { status: Number((error as any)?.status || 500) });
  }
});
