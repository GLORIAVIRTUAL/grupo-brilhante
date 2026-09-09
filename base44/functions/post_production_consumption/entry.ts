import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { allocateLots, moneyRound, quantityRound } from '../../shared/stockMath.js';
import { calculatePlannedConsumption, variancePercent } from '../../shared/productionMath.js';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'production', 'inventory']);
const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

async function upsertAlert(base44: any, input: any) {
  const existing = await base44.asServiceRole.entities.OperationalAlert.filter({ alert_key: input.alert_key });
  const current = existing.find((row: any) => ['open', 'acknowledged'].includes(row.status));
  const now = new Date().toISOString();
  if (current) return base44.asServiceRole.entities.OperationalAlert.update(current.id, { ...input, last_detected_at: now, status: 'open' });
  return base44.asServiceRole.entities.OperationalAlert.create({ ...input, first_detected_at: now, last_detected_at: now, status: 'open' });
}

async function loadContext(base44: any, batchId: string) {
  const batch = await base44.asServiceRole.entities.ProductionBatch.get(batchId);
  if (!batch) throw Object.assign(new Error('production_batch_not_found'), { status: 404 });
  const garments = [];
  for (const id of batch.garment_item_ids || []) {
    const garment = await base44.asServiceRole.entities.GarmentItem.get(id);
    if (garment) garments.push(garment);
  }
  const recipe = batch.recipe_id ? await base44.asServiceRole.entities.ConsumptionRecipe.get(batch.recipe_id) : null;
  const stockItems = await base44.asServiceRole.entities.StockItem.filter({ unit_id: batch.unit_id, active: true });
  const planned = recipe ? calculatePlannedConsumption(recipe, batch, garments, stockItems) : [];
  return { batch, garments, recipe, stockItems, planned };
}

function normalizeActual(planned: any[], provided: any[]) {
  const override = new Map((provided || []).map((line: any) => [String(line.stock_item_id), line]));
  const result = planned.map((line: any) => {
    const custom: any = override.get(String(line.stock_item_id));
    const quantity = custom?.quantity == null ? Number(line.quantity || 0) : Number(custom.quantity || 0);
    return { ...line, quantity: quantityRound(quantity), source_stock_item_id: String(custom?.stock_item_id || line.stock_item_id), notes: custom?.notes };
  });
  for (const custom of provided || []) {
    if (!planned.some((line: any) => String(line.stock_item_id) === String(custom.stock_item_id))) {
      result.push({ stock_item_id: String(custom.stock_item_id), source_stock_item_id: String(custom.stock_item_id), quantity: quantityRound(custom.quantity), unit: custom.unit, notes: custom.notes, unplanned: true });
    }
  }
  return result.filter((line: any) => line.quantity > 0);
}

async function resolveStockItem(base44: any, unitId: string, line: any, plannedLine: any) {
  const primary = await base44.asServiceRole.entities.StockItem.get(line.source_stock_item_id || line.stock_item_id);
  if (primary && primary.unit_id === unitId && Number(primary.current_quantity || 0) - Number(primary.reserved_quantity || 0) >= Number(line.quantity || 0)) return { item: primary, substitutedFrom: null };
  if (plannedLine?.allow_substitution) {
    for (const substituteId of plannedLine.substitute_stock_item_ids || []) {
      const substitute = await base44.asServiceRole.entities.StockItem.get(substituteId);
      if (substitute && substitute.unit_id === unitId && Number(substitute.current_quantity || 0) - Number(substitute.reserved_quantity || 0) >= Number(line.quantity || 0)) return { item: substitute, substitutedFrom: primary?.id || line.stock_item_id };
    }
  }
  throw Object.assign(new Error(`insufficient_stock:${primary?.id || line.stock_item_id}`), { status: 409 });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'post_production_consumption' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || '') && !(user.permissions || []).includes('production.consume')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const input = await req.json();
    const action = String(input.action || 'preview');
    const batchId = String(input.production_batch_id || '');
    if (!batchId) return Response.json({ error: 'production_batch_id_required', request_id: requestId }, { status: 422 });
    const { batch, garments, recipe, stockItems, planned } = await loadContext(base44, batchId);
    if (!canAccessUnit(user, batch.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });

    if (action === 'preview') {
      const stockMap = Object.fromEntries(stockItems.map((item: any) => [item.id, item]));
      return Response.json({ production_batch: batch, recipe, planned_consumption: planned.map((line: any) => ({ ...line, available_quantity: Number(stockMap[line.stock_item_id]?.current_quantity || 0) - Number(stockMap[line.stock_item_id]?.reserved_quantity || 0), sufficient: Number(stockMap[line.stock_item_id]?.current_quantity || 0) - Number(stockMap[line.stock_item_id]?.reserved_quantity || 0) >= Number(line.quantity || 0) })), request_id: requestId });
    }

    if (action === 'post') {
      if (!recipe) return Response.json({ error: 'active_recipe_required', request_id: requestId }, { status: 409 });
      if (!['processing', 'paused', 'completed'].includes(batch.status)) return Response.json({ error: 'batch_not_started', request_id: requestId }, { status: 409 });
      const eventKey = `production_consumption:${batch.id}:${String(input.idempotency_key || batch.id)}`;
      const previousEvents = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
      const completed = previousEvents.find((event: any) => event.status === 'completed');
      if (completed) return Response.json({ duplicate: true, result: completed.result, request_id: requestId });
      const event = previousEvents[0] || await base44.asServiceRole.entities.ProcessedEvent.create({ event_key: eventKey, event_type: 'production_consumption', source: 'internal', status: 'processing', attempts: 1, started_at: new Date().toISOString(), unit_id: batch.unit_id });
      const actual = normalizeActual(planned, input.actual_consumption || []);
      const movements: any[] = [];
      const actualSnapshot: any[] = [];
      let totalMaterialCost = 0;
      const now = new Date().toISOString();
      for (const line of actual) {
        const plannedLine = planned.find((candidate: any) => String(candidate.stock_item_id) === String(line.stock_item_id));
        const { item, substitutedFrom } = await resolveStockItem(base44, batch.unit_id, line, plannedLine);
        const before = Number(item.current_quantity || 0);
        const after = quantityRound(before - Number(line.quantity || 0));
        let allocations: any[] = [];
        if (item.batch_control) {
          const lots = await base44.asServiceRole.entities.StockLot.filter({ unit_id: batch.unit_id, stock_item_id: item.id });
          const allocation = allocateLots(lots, line.quantity);
          if (allocation.remaining_quantity > 0) throw Object.assign(new Error(`insufficient_lot_stock:${item.id}`), { status: 409 });
          allocations = allocation.allocations;
          for (const part of allocations) {
            await base44.asServiceRole.entities.StockLot.update(part.stock_lot_id, { current_quantity: part.balance_after, total_cost: moneyRound(part.balance_after * part.unit_cost), status: part.balance_after <= 0 ? 'exhausted' : 'available', last_movement_at: now });
          }
        }
        const lineCost = allocations.length > 0 ? moneyRound(allocations.reduce((sum, part) => sum + Number(part.total_cost || 0), 0)) : moneyRound(Number(line.quantity || 0) * Number(item.average_cost || 0));
        const movement = await base44.asServiceRole.entities.StockMovement.create({ unit_id: batch.unit_id, stock_item_id: item.id, movement_type: 'consumption', quantity: Number(line.quantity || 0), unit_cost: Number(line.quantity || 0) > 0 ? moneyRound(lineCost / Number(line.quantity || 0)) : 0, total_cost: lineCost, balance_before: before, balance_after: after, production_batch_id: batch.id, consumption_recipe_id: recipe.id, machine_id: batch.machine_id, operator_user_id: user.id, reason: 'production_batch_consumption', occurred_at: now, request_id: requestId, status: 'posted', metadata: { lot_allocations: allocations, substituted_from_stock_item_id: substitutedFrom, notes: line.notes, unplanned: line.unplanned } });
        movements.push(movement);
        totalMaterialCost = moneyRound(totalMaterialCost + lineCost);
        await base44.asServiceRole.entities.StockItem.update(item.id, { current_quantity: after, available_quantity: quantityRound(after - Number(item.reserved_quantity || 0)), last_movement_at: now });
        const plannedQty = Number(plannedLine?.quantity || 0);
        const variance = variancePercent(line.quantity, plannedQty);
        actualSnapshot.push({ stock_item_id: item.id, stock_item_name: item.name, planned_stock_item_id: plannedLine?.stock_item_id, quantity: line.quantity, planned_quantity: plannedQty, unit: line.unit || item.base_unit, total_cost: lineCost, variance_percent: variance, substituted_from_stock_item_id: substitutedFrom, movement_id: movement.id });
        const tolerance = Number(recipe.waste_tolerance_percent ?? 5);
        if (Math.abs(variance) > tolerance) await upsertAlert(base44, { unit_id: batch.unit_id, alert_key: `consumption:${batch.id}:${plannedLine?.stock_item_id || item.id}`, category: 'consumption_variance', severity: Math.abs(variance) >= Math.max(20, tolerance * 2) ? 'critical' : 'warning', title: `Consumo fora da ficha: ${item.name}`, description: `Previsto ${plannedQty}; realizado ${line.quantity}; desvio ${variance.toFixed(1)}%.`, entity_type: 'production_batch', entity_id: batch.id, metric_value: variance, threshold_value: tolerance, metadata: { stock_item_id: item.id, recipe_id: recipe.id } });
        if (after <= Number(item.minimum_quantity || 0)) await upsertAlert(base44, { unit_id: batch.unit_id, alert_key: `stock:${item.id}:${after <= 0 ? 'stockout' : 'low'}`, category: after <= 0 ? 'stockout' : 'low_stock', severity: after <= 0 ? 'critical' : 'warning', title: after <= 0 ? `${item.name} sem estoque` : `${item.name} abaixo do mínimo`, description: `Saldo ${after} ${item.base_unit}; mínimo ${item.minimum_quantity || 0}.`, entity_type: 'stock_item', entity_id: item.id, metric_value: after, threshold_value: Number(item.minimum_quantity || 0) });
      }
      const updatedBatch = await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { planned_consumption: planned, actual_consumption: actualSnapshot, estimated_material_cost: moneyRound(planned.reduce((sum: number, line: any) => sum + Number(line.total_cost || 0), 0)), actual_material_cost: totalMaterialCost });
      await base44.asServiceRole.entities.ProductionEvent.create({ unit_id: batch.unit_id, production_batch_id: batch.id, garment_item_ids: batch.garment_item_ids || [], event_type: 'consumption_posted', previous_status: batch.status, new_status: batch.status, machine_id: batch.machine_id, operator_user_id: user.id, reason: 'automatic_recipe_consumption', occurred_at: now, request_id: requestId, snapshot: { recipe_id: recipe.id, recipe_version: recipe.version, movements: movements.map((movement) => movement.id), total_material_cost: totalMaterialCost } });
      const result = { production_batch_id: batch.id, movement_ids: movements.map((movement) => movement.id), actual_consumption: actualSnapshot, total_material_cost: totalMaterialCost };
      await base44.asServiceRole.entities.ProcessedEvent.update(event.id, { status: 'completed', entity_type: 'production_batch', entity_id: batch.id, result, completed_at: now });
      await base44.asServiceRole.entities.AuditLog.create({ action: 'consume', entity_type: 'production_batch', entity_id: batch.id, item_label: batch.code, amount: totalMaterialCost, reason: 'production_consumption_posted', user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: batch.unit_id, request_id: requestId, after_data: result, success: true });
      return Response.json({ production_batch: updatedBatch, ...result, request_id: requestId });
    }

    if (action === 'reverse') {
      if (!MANAGER_ROLES.has(user.role || '') && !(user.permissions || []).includes('inventory.reverse_consumption')) return Response.json({ error: 'manager_permission_required', request_id: requestId }, { status: 403 });
      if (!String(input.reason || '').trim()) return Response.json({ error: 'reversal_reason_required', request_id: requestId }, { status: 422 });
      const eventKey = `production_consumption_reverse:${batch.id}:${String(input.idempotency_key || requestId)}`;
      const previousEvents = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
      const completed = previousEvents.find((event: any) => event.status === 'completed');
      if (completed) return Response.json({ duplicate: true, result: completed.result, request_id: requestId });
      const event = previousEvents[0] || await base44.asServiceRole.entities.ProcessedEvent.create({ event_key: eventKey, event_type: 'production_consumption_reverse', source: 'user_command', status: 'processing', attempts: 1, started_at: new Date().toISOString(), unit_id: batch.unit_id });
      const posted = await base44.asServiceRole.entities.StockMovement.filter({ production_batch_id: batch.id, movement_type: 'consumption', status: 'posted' });
      if (posted.length === 0) return Response.json({ error: 'posted_consumption_not_found', request_id: requestId }, { status: 404 });
      const reversalIds = [];
      const now = new Date().toISOString();
      for (const movement of posted) {
        const item = await base44.asServiceRole.entities.StockItem.get(movement.stock_item_id);
        if (!item) continue;
        const before = Number(item.current_quantity || 0);
        const after = quantityRound(before + Number(movement.quantity || 0));
        for (const part of movement.metadata?.lot_allocations || []) {
          const lot = await base44.asServiceRole.entities.StockLot.get(part.stock_lot_id);
          if (lot) await base44.asServiceRole.entities.StockLot.update(lot.id, { current_quantity: quantityRound(Number(lot.current_quantity || 0) + Number(part.quantity || 0)), total_cost: moneyRound((Number(lot.current_quantity || 0) + Number(part.quantity || 0)) * Number(lot.unit_cost || 0)), status: 'available', last_movement_at: now });
        }
        const reversal = await base44.asServiceRole.entities.StockMovement.create({ unit_id: batch.unit_id, stock_item_id: item.id, movement_type: 'consumption_reversal', quantity: Number(movement.quantity || 0), unit_cost: Number(movement.unit_cost || 0), total_cost: Number(movement.total_cost || 0), balance_before: before, balance_after: after, production_batch_id: batch.id, consumption_recipe_id: movement.consumption_recipe_id, machine_id: batch.machine_id, reversal_of_movement_id: movement.id, operator_user_id: user.id, reason: String(input.reason), occurred_at: now, request_id: requestId, status: 'posted' });
        reversalIds.push(reversal.id);
        await base44.asServiceRole.entities.StockMovement.update(movement.id, { status: 'reversed' });
        await base44.asServiceRole.entities.StockItem.update(item.id, { current_quantity: after, available_quantity: quantityRound(after - Number(item.reserved_quantity || 0)), last_movement_at: now });
      }
      await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { actual_consumption: [], actual_material_cost: 0 });
      const result = { production_batch_id: batch.id, reversal_movement_ids: reversalIds };
      await base44.asServiceRole.entities.ProcessedEvent.update(event.id, { status: 'completed', entity_type: 'production_batch', entity_id: batch.id, result, completed_at: now });
      await base44.asServiceRole.entities.AuditLog.create({ action: 'reverse', entity_type: 'production_batch', entity_id: batch.id, item_label: batch.code, reason: String(input.reason), user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: batch.unit_id, request_id: requestId, after_data: result, success: true });
      return Response.json({ ...result, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[post_production_consumption:${requestId}]`, error);
    return Response.json({ error: (error as Error)?.message || 'production_consumption_failed', request_id: requestId }, { status: Number((error as any)?.status || 500) });
  }
});
