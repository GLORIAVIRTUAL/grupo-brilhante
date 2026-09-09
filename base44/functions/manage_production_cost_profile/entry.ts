import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);

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
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_production_cost_profile' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!MANAGER_ROLES.has(user.role || '') && !(user.permissions || []).includes('production.costs')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const input = await req.json();
    const action = String(input.action || '');
    const now = new Date().toISOString();

    if (action === 'create_version') {
      const unitId = String(input.unit_id || '');
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const profile = await base44.asServiceRole.entities.ProductionCostProfile.create({ unit_id: unitId, name: String(input.name || `Custos vigentes em ${new Date().toLocaleDateString('pt-BR')}`), labor_hourly_cost_default: Number(input.labor_hourly_cost_default || 0), energy_kwh_cost: Number(input.energy_kwh_cost || 0), water_m3_cost: Number(input.water_m3_cost || 0), overhead_percent: Number(input.overhead_percent || 0), packaging_cost_per_piece: Number(input.packaging_cost_per_piece || 0), quality_cost_per_piece: Number(input.quality_cost_per_piece || 0), operator_rates: input.operator_rates || {}, active: input.active !== false, valid_from: input.valid_from || now, valid_until: input.valid_until, created_by_user_id: user.id, approved_by_user_id: user.id, approved_at: now });
      if (profile.active) {
        const active = await base44.asServiceRole.entities.ProductionCostProfile.filter({ unit_id: unitId, active: true });
        for (const previous of active.filter((row: any) => row.id !== profile.id)) await base44.asServiceRole.entities.ProductionCostProfile.update(previous.id, { active: false, valid_until: now });
      }
      await base44.asServiceRole.entities.AuditLog.create({ action: 'create', entity_type: 'production_cost_profile', entity_id: profile.id, item_label: profile.name, reason: 'production_cost_profile_version_created', user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: unitId, request_id: requestId, after_data: profile, success: true });
      return Response.json({ profile, request_id: requestId });
    }

    const profile = input.profile_id ? await base44.asServiceRole.entities.ProductionCostProfile.get(input.profile_id) : null;
    if (!profile) return Response.json({ error: 'cost_profile_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, profile.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    if (action === 'deactivate') {
      if (!String(input.reason || '').trim()) return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
      const updated = await base44.asServiceRole.entities.ProductionCostProfile.update(profile.id, { active: false, valid_until: now });
      await base44.asServiceRole.entities.AuditLog.create({ action: 'deactivate', entity_type: 'production_cost_profile', entity_id: profile.id, item_label: profile.name, reason: String(input.reason), user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: profile.unit_id, request_id: requestId, before_data: { active: profile.active }, after_data: { active: false }, success: true });
      return Response.json({ profile: updated, request_id: requestId });
    }
    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[manage_production_cost_profile:${requestId}]`, error);
    return Response.json({ error: (error as Error)?.message || 'production_cost_profile_failed', request_id: requestId }, { status: Number((error as any)?.status || 500) });
  }
});
