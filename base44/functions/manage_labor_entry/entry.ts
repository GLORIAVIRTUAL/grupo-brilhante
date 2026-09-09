import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { productionMoneyRound } from '../../shared/productionMath.js';

const ROLES = new Set(['super_admin', 'admin', 'manager', 'production', 'operator']);
const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

async function rateFor(base44: any, unitId: string, operatorId: string) {
  const profiles = await base44.asServiceRole.entities.ProductionCostProfile.filter({ unit_id: unitId, active: true });
  const profile = profiles.sort((a: any, b: any) => Date.parse(b.valid_from || 0) - Date.parse(a.valid_from || 0))[0];
  return Number(profile?.operator_rates?.[operatorId] ?? profile?.labor_hourly_cost_default ?? 0);
}

function elapsedMinutes(startedAt?: string, endAt = Date.now()) {
  if (!startedAt) return 0;
  return Math.max(0, (endAt - Date.parse(startedAt)) / 60000);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_labor_entry' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ROLES.has(user.role || '') && !(user.permissions || []).includes('production.operate')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const input = await req.json();
    const action = String(input.action || '');
    const now = new Date().toISOString();

    if (action === 'start') {
      const batchId = String(input.production_batch_id || '');
      const batch = batchId ? await base44.asServiceRole.entities.ProductionBatch.get(batchId) : null;
      if (!batch) return Response.json({ error: 'production_batch_not_found', request_id: requestId }, { status: 404 });
      if (!canAccessUnit(user, batch.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      if (!['processing', 'paused'].includes(batch.status)) return Response.json({ error: 'batch_not_active', request_id: requestId }, { status: 409 });
      const operatorId = String(input.operator_user_id || user.id);
      if (operatorId !== user.id && !MANAGER_ROLES.has(user.role || '')) return Response.json({ error: 'manager_required_for_other_operator', request_id: requestId }, { status: 403 });
      const current = await base44.asServiceRole.entities.LaborEntry.filter({ production_batch_id: batch.id, operator_user_id: operatorId });
      if (current.some((entry: any) => ['running', 'paused'].includes(entry.status))) return Response.json({ error: 'operator_entry_already_active', request_id: requestId }, { status: 409 });
      const hourlyCost = input.hourly_cost != null && MANAGER_ROLES.has(user.role || '') ? Number(input.hourly_cost) : await rateFor(base44, batch.unit_id, operatorId);
      const entry = await base44.asServiceRole.entities.LaborEntry.create({ unit_id: batch.unit_id, production_batch_id: batch.id, garment_item_id: input.garment_item_id, operator_user_id: operatorId, activity: input.activity || batch.stage, status: 'running', started_at: now, duration_minutes: 0, accumulated_minutes: 0, pause_count: 0, hourly_cost: hourlyCost, labor_cost: 0, is_rework: Boolean(input.is_rework), request_id: requestId, notes: input.notes });
      await base44.asServiceRole.entities.ProductionEvent.create({ unit_id: batch.unit_id, production_batch_id: batch.id, garment_item_ids: batch.garment_item_ids || [], event_type: 'operator_changed', previous_status: batch.status, new_status: batch.status, machine_id: batch.machine_id, operator_user_id: operatorId, reason: 'labor_entry_started', occurred_at: now, request_id: requestId, snapshot: { labor_entry_id: entry.id, hourly_cost: hourlyCost } });
      return Response.json({ labor_entry: entry, request_id: requestId });
    }

    const entryId = String(input.labor_entry_id || '');
    const entry = entryId ? await base44.asServiceRole.entities.LaborEntry.get(entryId) : null;
    if (!entry) return Response.json({ error: 'labor_entry_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, entry.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    if (entry.operator_user_id !== user.id && !MANAGER_ROLES.has(user.role || '')) return Response.json({ error: 'operator_or_manager_required', request_id: requestId }, { status: 403 });
    const batch = await base44.asServiceRole.entities.ProductionBatch.get(entry.production_batch_id);

    if (action === 'pause') {
      if (entry.status !== 'running' || !String(input.reason || '').trim()) return Response.json({ error: 'running_entry_and_reason_required', request_id: requestId }, { status: 422 });
      const accumulated = Number(entry.accumulated_minutes || 0) + elapsedMinutes(entry.started_at);
      const updated = await base44.asServiceRole.entities.LaborEntry.update(entry.id, { status: 'paused', paused_at: now, accumulated_minutes: accumulated, duration_minutes: accumulated, pause_count: Number(entry.pause_count || 0) + 1, pause_reason: String(input.reason) });
      return Response.json({ labor_entry: updated, request_id: requestId });
    }

    if (action === 'resume') {
      if (entry.status !== 'paused') return Response.json({ error: 'labor_entry_not_paused', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.LaborEntry.update(entry.id, { status: 'running', started_at: now, paused_at: null, pause_reason: null });
      return Response.json({ labor_entry: updated, request_id: requestId });
    }

    if (action === 'complete') {
      if (!['running', 'paused'].includes(entry.status)) return Response.json({ error: 'labor_entry_not_active', request_id: requestId }, { status: 409 });
      const duration = Number(entry.accumulated_minutes || 0) + (entry.status === 'running' ? elapsedMinutes(entry.started_at) : 0);
      const laborCost = productionMoneyRound((duration / 60) * Number(entry.hourly_cost || 0));
      const updated = await base44.asServiceRole.entities.LaborEntry.update(entry.id, { status: 'completed', completed_at: now, duration_minutes: duration, accumulated_minutes: duration, labor_cost: laborCost, notes: input.notes || entry.notes });
      if (batch) {
        const entries = await base44.asServiceRole.entities.LaborEntry.filter({ production_batch_id: batch.id });
        const actualLaborCost = productionMoneyRound(entries.reduce((sum: number, row: any) => sum + Number(row.id === updated.id ? updated.labor_cost : row.labor_cost || 0), 0));
        await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { actual_labor_cost: actualLaborCost });
      }
      await base44.asServiceRole.entities.AuditLog.create({ action: 'complete', entity_type: 'labor_entry', entity_id: entry.id, item_label: `${entry.activity} · ${entry.operator_user_id}`, amount: laborCost, reason: 'labor_entry_completed', user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: entry.unit_id, request_id: requestId, after_data: { duration_minutes: duration, labor_cost: laborCost }, success: true });
      return Response.json({ labor_entry: updated, request_id: requestId });
    }

    if (action === 'cancel') {
      if (!MANAGER_ROLES.has(user.role || '') || !String(input.reason || '').trim()) return Response.json({ error: 'manager_and_reason_required', request_id: requestId }, { status: 403 });
      if (entry.status === 'completed') return Response.json({ error: 'completed_entry_not_cancellable', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.LaborEntry.update(entry.id, { status: 'cancelled', completed_at: now, notes: String(input.reason) });
      await base44.asServiceRole.entities.AuditLog.create({ action: 'cancel', entity_type: 'labor_entry', entity_id: entry.id, item_label: `${entry.activity} · ${entry.operator_user_id}`, reason: String(input.reason), user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: entry.unit_id, request_id: requestId, before_data: entry, after_data: updated, success: true });
      return Response.json({ labor_entry: updated, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[manage_labor_entry:${requestId}]`, error);
    return Response.json({ error: (error as Error)?.message || 'labor_entry_operation_failed', request_id: requestId }, { status: Number((error as any)?.status || 500) });
  }
});
