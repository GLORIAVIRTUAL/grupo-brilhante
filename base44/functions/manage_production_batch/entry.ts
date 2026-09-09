import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { calculateBatchCost, calculateCapacity, calculatePlannedConsumption, productionMoneyRound, STAGE_TO_GARMENT_STATUS, STAGE_TO_MACHINE_TYPE } from '../../shared/productionMath.js';

const ROLES = new Set(['super_admin', 'admin', 'manager', 'production', 'operator']);
const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager']);
const ACTIVE_STATUSES = new Set(['scheduled', 'waiting_materials', 'queued', 'processing', 'paused']);
const STAGES = new Set(['washing', 'drying', 'dry_cleaning', 'ironing', 'finishing', 'quality_control', 'packaging']);
const NEXT_STATUS = { washing: 'queued', drying: 'queued', dry_cleaning: 'queued', ironing: 'quality_control', finishing: 'quality_control', quality_control: 'ready', packaging: 'ready' };
const EVENT_TYPE_BY_ACTION = { schedule: 'planned', queue: 'queued', start: 'started', pause: 'paused', resume: 'resumed', complete: 'completed', cancel: 'cancelled' };

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

function assertRole(user: any) {
  if (!ROLES.has(user?.role || '') && !(user?.permissions || []).includes('production.manage')) throw Object.assign(new Error('forbidden'), { status: 403 });
}

async function loadMachine(base44: any, machineId?: string) {
  if (!machineId) return null;
  const records = await base44.asServiceRole.entities.MachineState.filter({ machine_id: machineId });
  return records[0] || null;
}

async function loadGarments(base44: any, ids: string[]) {
  const garments = [];
  for (const id of [...new Set(ids)]) {
    const garment = await base44.asServiceRole.entities.GarmentItem.get(id);
    if (garment) garments.push(garment);
  }
  return garments;
}

async function loadRecipe(base44: any, input: any, garments: any[], unitId: string) {
  if (input.recipe_id) return base44.asServiceRole.entities.ConsumptionRecipe.get(input.recipe_id);
  const recipes = await base44.asServiceRole.entities.ConsumptionRecipe.filter({ unit_id: unitId, active: true });
  const serviceIds = new Set(garments.flatMap((garment) => (garment.services || []).map((service: any) => String(service.service_id || ''))));
  const productIds = new Set(garments.map((garment) => String(garment.product_id || '')));
  return recipes.find((recipe: any) => recipe.stage === input.stage && (!recipe.service_id || serviceIds.has(String(recipe.service_id))) && (!recipe.product_id || productIds.has(String(recipe.product_id))) && (!recipe.machine_type || recipe.machine_type === STAGE_TO_MACHINE_TYPE[input.stage])) || null;
}

async function findMissingMaterials(base44: any, batch: any) {
  if (!Array.isArray(batch.planned_consumption) || batch.planned_consumption.length === 0) return [];
  const stockItems = await base44.asServiceRole.entities.StockItem.filter({ unit_id: batch.unit_id, active: true });
  const stockMap = Object.fromEntries(stockItems.map((item: any) => [item.id, item]));
  return batch.planned_consumption.filter((line: any) => Number(stockMap[line.stock_item_id]?.current_quantity || 0) - Number(stockMap[line.stock_item_id]?.reserved_quantity || 0) < Number(line.quantity || 0));
}

async function assertGarmentsAvailable(base44: any, garments: any[], unitId: string, stage: string, ignoreBatchId?: string) {
  if (garments.length === 0) throw Object.assign(new Error('garments_required'), { status: 422 });
  for (const garment of garments) {
    if (garment.unit_id !== unitId) throw Object.assign(new Error(`garment_wrong_unit:${garment.id}`), { status: 409 });
    if (['delivered', 'cancelled', 'out_for_delivery'].includes(garment.status)) throw Object.assign(new Error(`garment_not_producible:${garment.id}`), { status: 409 });
    if (garment.current_production_batch_id && garment.current_production_batch_id !== ignoreBatchId) throw Object.assign(new Error(`garment_already_in_batch:${garment.id}`), { status: 409 });
  }
  const activeBatches = await base44.asServiceRole.entities.ProductionBatch.filter({ unit_id: unitId });
  const selected = new Set(garments.map((garment) => garment.id));
  const collision = activeBatches.find((batch: any) => batch.id !== ignoreBatchId && ACTIVE_STATUSES.has(batch.status) && batch.stage === stage && (batch.garment_item_ids || []).some((id: string) => selected.has(id)));
  if (collision) throw Object.assign(new Error(`garment_stage_collision:${collision.id}`), { status: 409 });
}

async function updateGarmentsForStage(base44: any, batch: any, status: 'start' | 'complete' | 'cancel') {
  const garments = await loadGarments(base44, batch.garment_item_ids || []);
  const servicesCatalog = await base44.asServiceRole.entities.LaundryService.list('name', 2000);
  const catalogMap = Object.fromEntries(servicesCatalog.map((service: any) => [service.id, service]));
  const now = new Date().toISOString();
  for (const garment of garments) {
    const batchIds = [...new Set([...(garment.production_batch_ids || []), batch.id])];
    const services = (garment.services || []).map((service: any) => {
      const definition = catalogMap[service.service_id];
      const steps = definition?.production_steps || [];
      const usesStage = steps.length === 0 || steps.includes(batch.stage);
      if (!usesStage) return service;
      if (status === 'start') return { ...service, status: 'processing', machine_id: batch.machine_id, production_batch_id: batch.id, consumption_recipe_id: batch.recipe_id, started_at: service.started_at || now };
      if (status === 'complete') {
        const isLast = steps.length === 0 || steps.indexOf(batch.stage) === steps.length - 1;
        return { ...service, status: isLast ? 'completed' : 'queued', machine_id: batch.machine_id, production_batch_id: batch.id, consumption_recipe_id: batch.recipe_id, completed_at: isLast ? now : service.completed_at, actual_material_cost: batch.piece_count > 0 ? Number(batch.actual_material_cost || 0) / batch.piece_count : 0 };
      }
      return { ...service, status: service.status === 'processing' ? 'queued' : service.status };
    });
    if (status === 'start') await base44.asServiceRole.entities.GarmentItem.update(garment.id, { status: STAGE_TO_GARMENT_STATUS[batch.stage] || garment.status, current_production_batch_id: batch.id, current_production_stage: batch.stage, production_batch_ids: batchIds, services });
    if (status === 'complete') await base44.asServiceRole.entities.GarmentItem.update(garment.id, { status: NEXT_STATUS[batch.stage] || garment.status, current_production_batch_id: null, current_production_stage: null, production_batch_ids: batchIds, material_cost: productionMoneyRound(Number(garment.material_cost || 0) + (batch.piece_count > 0 ? Number(batch.actual_material_cost || 0) / batch.piece_count : 0)), labor_cost: productionMoneyRound(Number(garment.labor_cost || 0) + (batch.piece_count > 0 ? Number(batch.actual_labor_cost || 0) / batch.piece_count : 0)), machine_cost: productionMoneyRound(Number(garment.machine_cost || 0) + (batch.piece_count > 0 ? Number(batch.metadata?.machine_cost || 0) / batch.piece_count : 0)), total_production_cost: productionMoneyRound(Number(garment.total_production_cost || 0) + (batch.piece_count > 0 ? Number(batch.total_actual_cost || 0) / batch.piece_count : 0)), services });
    if (status === 'cancel') await base44.asServiceRole.entities.GarmentItem.update(garment.id, { status: garment.status === STAGE_TO_GARMENT_STATUS[batch.stage] ? 'queued' : garment.status, current_production_batch_id: garment.current_production_batch_id === batch.id ? null : garment.current_production_batch_id, current_production_stage: garment.current_production_batch_id === batch.id ? null : garment.current_production_stage, production_batch_ids: batchIds, services });
  }
}

async function eventState(base44: any, batch: any, action: string, key: string) {
  const eventKey = `production_batch:${batch.id}:${action}:${key}`;
  const existing = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
  const completed = existing.find((row: any) => row.status === 'completed');
  if (completed) return { duplicate: completed };
  const event = existing[0] || await base44.asServiceRole.entities.ProcessedEvent.create({ event_key: eventKey, event_type: `production_batch_${action}`, source: 'user_command', status: 'processing', attempts: 1, started_at: new Date().toISOString(), unit_id: batch.unit_id });
  return { event };
}

async function finishEvent(base44: any, state: any, batch: any, result: any) {
  if (state?.event) await base44.asServiceRole.entities.ProcessedEvent.update(state.event.id, { status: 'completed', entity_type: 'production_batch', entity_id: batch.id, result, completed_at: new Date().toISOString() });
}

async function audit(base44: any, user: any, batch: any, action: string, reason: string, requestId: string, beforeData?: any, afterData?: any) {
  return base44.asServiceRole.entities.AuditLog.create({ action, entity_type: 'production_batch', entity_id: batch.id, item_label: batch.code, amount: Number(batch.total_actual_cost || batch.estimated_material_cost || 0), reason, user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: batch.unit_id, request_id: requestId, before_data: beforeData, after_data: afterData, success: true });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_production_batch' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    assertRole(user);
    const input = await req.json();
    const action = String(input.action || '');
    const now = new Date().toISOString();

    if (action === 'create') {
      const unitId = String(input.unit_id || '');
      const stage = String(input.stage || '');
      if (!unitId || !canAccessUnit(user, unitId) || !STAGES.has(stage)) return Response.json({ error: 'batch_fields_invalid', request_id: requestId }, { status: 422 });
      const garments = await loadGarments(base44, input.garment_item_ids || []);
      await assertGarmentsAvailable(base44, garments, unitId, stage);
      const machine = await loadMachine(base44, input.machine_id);
      if (machine) {
        if (machine.unit_id && machine.unit_id !== unitId) return Response.json({ error: 'machine_wrong_unit', request_id: requestId }, { status: 409 });
        if (machine.active === false || ['maintenance', 'out_of_service', 'running', 'reserved', 'paused'].includes(machine.operational_status)) return Response.json({ error: 'machine_unavailable', request_id: requestId }, { status: 409 });
        if (machine.machine_type && machine.machine_type !== STAGE_TO_MACHINE_TYPE[stage]) return Response.json({ error: 'machine_type_incompatible', request_id: requestId }, { status: 409 });
      }
      const totalWeightKg = Number(input.total_weight_kg || garments.reduce((sum, garment) => sum + Number(garment.actual_weight_kg || garment.estimated_weight_kg || 0), 0));
      const pieceCount = garments.length;
      const capacityPercent = calculateCapacity({ totalWeightKg, pieceCount, machineCapacityKg: machine?.capacity_kg, machineCapacityItems: machine?.capacity_items });
      const maxPercent = Number(machine?.maximum_load_percent || 100);
      const overCapacity = machine && capacityPercent > maxPercent;
      const canOverride = MANAGER_ROLES.has(user.role || '') || (user.permissions || []).includes('production.override_capacity');
      if (overCapacity && !(input.capacity_override && canOverride && String(input.capacity_override_reason || '').trim())) return Response.json({ error: 'machine_capacity_exceeded', capacity_percent: capacityPercent, maximum_percent: maxPercent, request_id: requestId }, { status: 409 });
      const recipe = await loadRecipe(base44, { ...input, stage }, garments, unitId);
      const stockItems = await base44.asServiceRole.entities.StockItem.filter({ unit_id: unitId, active: true });
      const batchSeed = { piece_count: pieceCount, total_weight_kg: totalWeightKg };
      const planned = recipe ? calculatePlannedConsumption(recipe, batchSeed, garments, stockItems) : [];
      const stockMap = Object.fromEntries(stockItems.map((item: any) => [item.id, item]));
      const missing = planned.filter((line: any) => Number(stockMap[line.stock_item_id]?.current_quantity || 0) - Number(stockMap[line.stock_item_id]?.reserved_quantity || 0) < Number(line.quantity || 0));
      const code = `LOT-${now.slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const status = missing.length > 0 ? 'waiting_materials' : input.scheduled_at ? 'scheduled' : 'draft';
      const batch = await base44.asServiceRole.entities.ProductionBatch.create({ unit_id: unitId, code, stage, status, machine_id: machine?.machine_id || input.machine_id, machine_type: machine?.machine_type || STAGE_TO_MACHINE_TYPE[stage], machine_capacity_kg_snapshot: machine?.capacity_kg, machine_capacity_items_snapshot: machine?.capacity_items, location_id: input.location_id, garment_item_ids: garments.map((garment) => garment.id), order_ids: [...new Set(garments.map((garment) => garment.order_id).filter(Boolean))], service_ids: [...new Set(garments.flatMap((garment) => (garment.services || []).map((service: any) => service.service_id).filter(Boolean)))], piece_count: pieceCount, total_weight_kg: totalWeightKg, capacity_percent: capacityPercent, capacity_override: Boolean(overCapacity && input.capacity_override), capacity_override_reason: overCapacity ? String(input.capacity_override_reason || '') : undefined, recipe_id: recipe?.id, recipe_version_snapshot: recipe?.version, planned_consumption: planned, actual_consumption: [], priority: input.priority || 'normal', scheduled_at: input.scheduled_at, estimated_minutes: Number(input.estimated_minutes || 0), estimated_material_cost: productionMoneyRound(planned.reduce((sum: number, line: any) => sum + Number(line.total_cost || 0), 0)), notes: input.notes, request_id: requestId, metadata: { missing_materials: missing, created_by_user_id: user.id } });
      if (machine && ['scheduled', 'draft'].includes(status)) await base44.asServiceRole.entities.MachineState.update(machine.id, { operational_status: 'reserved', production_batch_id: batch.id, stage, operator_user_id: input.operator_user_id || null });
      await base44.asServiceRole.entities.ProductionEvent.create({ unit_id: unitId, production_batch_id: batch.id, garment_item_ids: batch.garment_item_ids, event_type: overCapacity ? 'capacity_overridden' : 'created', previous_status: null, new_status: status, machine_id: batch.machine_id, operator_user_id: user.id, reason: overCapacity ? String(input.capacity_override_reason) : 'production_batch_created', occurred_at: now, request_id: requestId, snapshot: { capacity_percent: capacityPercent, planned_consumption: planned, missing_materials: missing } });
      await audit(base44, user, batch, 'create', 'production_batch_created', requestId, undefined, { stage, status, piece_count: pieceCount, capacity_percent: capacityPercent, missing_materials: missing.length });
      return Response.json({ production_batch: batch, missing_materials: missing, request_id: requestId });
    }

    const batchId = String(input.production_batch_id || '');
    const batch = batchId ? await base44.asServiceRole.entities.ProductionBatch.get(batchId) : null;
    if (!batch) return Response.json({ error: 'production_batch_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, batch.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    const state = await eventState(base44, batch, action, String(input.idempotency_key || requestId));
    if (state.duplicate) return Response.json({ duplicate: true, result: state.duplicate.result, request_id: requestId });
    let updated = batch;
    let eventType = EVENT_TYPE_BY_ACTION[action] || action;
    let reason = String(input.reason || `production_batch_${action}`);

    if (action === 'schedule' || action === 'queue') {
      if (!['draft', 'scheduled', 'waiting_materials', 'queued'].includes(batch.status)) return Response.json({ error: 'batch_not_plannable', request_id: requestId }, { status: 409 });
      const garments = await loadGarments(base44, batch.garment_item_ids || []);
      await assertGarmentsAvailable(base44, garments, batch.unit_id, batch.stage, batch.id);
      const missing = await findMissingMaterials(base44, batch);
      if (missing.length > 0) {
        await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { status: 'waiting_materials', metadata: { ...(batch.metadata || {}), missing_materials: missing } });
        return Response.json({ error: 'production_materials_insufficient', missing_materials: missing, request_id: requestId }, { status: 409 });
      }
      const nextStatus = action === 'queue' ? 'queued' : 'scheduled';
      updated = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { status: nextStatus, scheduled_at: input.scheduled_at || batch.scheduled_at || now, queued_at: action === 'queue' ? now : batch.queued_at, operator_user_id: input.operator_user_id || batch.operator_user_id, operator_name: input.operator_name || batch.operator_name });
      if (action === 'queue') {
        for (const garment of garments) await base44.asServiceRole.entities.GarmentItem.update(garment.id, { status: 'queued', current_production_batch_id: batch.id, current_production_stage: batch.stage, production_batch_ids: [...new Set([...(garment.production_batch_ids || []), batch.id])] });
      }
    } else if (action === 'start') {
      if (!['draft', 'scheduled', 'queued'].includes(batch.status)) return Response.json({ error: 'batch_not_startable', request_id: requestId }, { status: 409 });
      const missing = await findMissingMaterials(base44, batch);
      if (missing.length > 0) {
        await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { status: 'waiting_materials', metadata: { ...(batch.metadata || {}), missing_materials: missing } });
        return Response.json({ error: 'production_materials_insufficient', missing_materials: missing, request_id: requestId }, { status: 409 });
      }
      const machine = await loadMachine(base44, input.machine_id || batch.machine_id);
      if (machine) {
        if (machine.unit_id && machine.unit_id !== batch.unit_id) return Response.json({ error: 'machine_wrong_unit', request_id: requestId }, { status: 409 });
        if (machine.production_batch_id && machine.production_batch_id !== batch.id && ['reserved', 'running', 'paused'].includes(machine.operational_status)) return Response.json({ error: 'machine_unavailable', request_id: requestId }, { status: 409 });
      }
      const operatorUserId = String(input.operator_user_id || user.id);
      updated = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { status: 'processing', machine_id: machine?.machine_id || batch.machine_id, operator_user_id: operatorUserId, operator_name: input.operator_name || user.full_name, started_at: batch.started_at || now, paused_at: null, pause_reason: null });
      if (machine) {
        const minutes = Number(batch.estimated_minutes || input.estimated_minutes || machine.minutes || 0);
        await base44.asServiceRole.entities.MachineState.update(machine.id, { unit_id: batch.unit_id, operational_status: 'running', production_batch_id: batch.id, operator_user_id: operatorUserId, stage: batch.stage, customer_name: batch.piece_count > 1 ? `${batch.piece_count} peças · ${batch.code}` : batch.code, sale_id: batch.order_ids?.length === 1 ? batch.order_ids[0] : null, machine_type: STAGE_TO_MACHINE_TYPE[batch.stage], minutes, ends_at: minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0, finished: false, last_started_at: now });
      }
      await updateGarmentsForStage(base44, updated, 'start');
    } else if (action === 'pause') {
      if (batch.status !== 'processing' || !String(input.reason || '').trim()) return Response.json({ error: 'running_batch_and_reason_required', request_id: requestId }, { status: 422 });
      updated = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { status: 'paused', paused_at: now, pause_reason: String(input.reason) });
      const machine = await loadMachine(base44, batch.machine_id);
      if (machine?.production_batch_id === batch.id) await base44.asServiceRole.entities.MachineState.update(machine.id, { operational_status: 'paused', finished: false });
    } else if (action === 'resume') {
      if (batch.status !== 'paused') return Response.json({ error: 'batch_not_paused', request_id: requestId }, { status: 409 });
      const pausedMinutes = batch.paused_at ? Math.max(0, (Date.now() - Date.parse(batch.paused_at)) / 60000) : 0;
      updated = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { status: 'processing', total_pause_minutes: Number(batch.total_pause_minutes || 0) + pausedMinutes, paused_at: null, pause_reason: null });
      const machine = await loadMachine(base44, batch.machine_id);
      if (machine?.production_batch_id === batch.id) await base44.asServiceRole.entities.MachineState.update(machine.id, { operational_status: 'running' });
    } else if (action === 'complete') {
      if (!['processing', 'paused'].includes(batch.status)) return Response.json({ error: 'batch_not_completable', request_id: requestId }, { status: 409 });
      if (batch.recipe_id) {
        const movements = await base44.asServiceRole.entities.StockMovement.filter({ production_batch_id: batch.id, movement_type: 'consumption', status: 'posted' });
        if (movements.length === 0) return Response.json({ error: 'production_consumption_required', request_id: requestId }, { status: 409 });
      }
      const laborEntries = await base44.asServiceRole.entities.LaborEntry.filter({ production_batch_id: batch.id });
      const machine = await loadMachine(base44, batch.machine_id);
      const profiles = await base44.asServiceRole.entities.ProductionCostProfile.filter({ unit_id: batch.unit_id, active: true });
      const profile = profiles.sort((a: any, b: any) => Date.parse(b.valid_from || 0) - Date.parse(a.valid_from || 0))[0];
      const actualMinutes = batch.started_at ? Math.max(0, Math.round((Date.now() - Date.parse(batch.started_at)) / 60000 - Number(batch.total_pause_minutes || 0))) : Number(input.actual_minutes || batch.estimated_minutes || 0);
      const laborCost = productionMoneyRound(laborEntries.reduce((sum: number, entry: any) => sum + Number(entry.labor_cost || 0), 0));
      const costs = calculateBatchCost({ materialCost: batch.actual_material_cost, laborCost, machineHourlyCost: machine?.hourly_cost, actualMinutes, energyCost: input.energy_cost ?? machine?.cycle_energy_cost, waterCost: input.water_cost ?? machine?.cycle_water_cost, otherCost: input.other_cost, overheadPercent: profile?.overhead_percent });
      updated = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { status: 'completed', completed_at: now, actual_minutes: actualMinutes, actual_labor_cost: laborCost, energy_cost: costs.energy_cost, water_cost: costs.water_cost, other_cost: costs.other_cost, total_actual_cost: costs.total_cost, cost_variance: productionMoneyRound(costs.total_cost - Number(batch.estimated_material_cost || 0) - Number(batch.estimated_labor_cost || 0)), completion_note: input.completion_note, metadata: { ...(batch.metadata || {}), machine_cost: costs.machine_cost, overhead_cost: costs.overhead_cost } });
      await updateGarmentsForStage(base44, updated, 'complete');
      if (machine?.production_batch_id === batch.id) await base44.asServiceRole.entities.MachineState.update(machine.id, { operational_status: 'idle', production_batch_id: null, operator_user_id: null, stage: null, customer_name: null, sale_id: null, minutes: 0, ends_at: 0, finished: false, last_completed_at: now });
    } else if (action === 'cancel') {
      if (['completed', 'cancelled'].includes(batch.status) || !String(input.reason || '').trim()) return Response.json({ error: 'cancellable_batch_and_reason_required', request_id: requestId }, { status: 422 });
      const posted = await base44.asServiceRole.entities.StockMovement.filter({ production_batch_id: batch.id, movement_type: 'consumption', status: 'posted' });
      if (posted.length > 0) return Response.json({ error: 'reverse_consumption_before_cancelling', request_id: requestId }, { status: 409 });
      updated = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { status: 'cancelled', cancellation_reason: String(input.reason), completed_at: now });
      await updateGarmentsForStage(base44, batch, 'cancel');
      const machine = await loadMachine(base44, batch.machine_id);
      if (machine?.production_batch_id === batch.id) await base44.asServiceRole.entities.MachineState.update(machine.id, { operational_status: 'idle', production_batch_id: null, operator_user_id: null, stage: null, customer_name: null, sale_id: null, minutes: 0, ends_at: 0, finished: false });
    } else {
      return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
    }

    await base44.asServiceRole.entities.ProductionEvent.create({ unit_id: batch.unit_id, production_batch_id: batch.id, garment_item_ids: batch.garment_item_ids || [], event_type: eventType, previous_status: batch.status, new_status: updated.status, machine_id: updated.machine_id, operator_user_id: input.operator_user_id || user.id, reason, occurred_at: now, request_id: requestId, snapshot: { actual_minutes: updated.actual_minutes, total_actual_cost: updated.total_actual_cost } });
    const result = { production_batch_id: batch.id, status: updated.status, machine_id: updated.machine_id };
    await finishEvent(base44, state, updated, result);
    await audit(base44, user, updated, action, reason, requestId, { status: batch.status }, { status: updated.status, machine_id: updated.machine_id });
    return Response.json({ production_batch: updated, ...result, request_id: requestId });
  } catch (error) {
    console.error(`[manage_production_batch:${requestId}]`, error);
    return Response.json({ error: (error as Error)?.message || 'production_batch_operation_failed', request_id: requestId }, { status: Number((error as any)?.status || 500) });
  }
});
