import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { allocateLots, availableQuantity, moneyRound, normalizeQuantity, quantityRound, weightedAverageCost } from '../../shared/stockMath.js';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'inventory', 'finance']);
const OUT_ACTIONS = new Set(['adjust_out', 'loss', 'return_to_supplier']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

function assertPermission(user: any) {
  if (!ALLOWED_ROLES.has(user?.role || '') && !(user?.permissions || []).includes('inventory.manage')) {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
}

async function upsertAlert(base44: any, input: any) {
  const existing = await base44.asServiceRole.entities.OperationalAlert.filter({ alert_key: input.alert_key });
  const open = existing.find((alert: any) => ['open', 'acknowledged'].includes(alert.status));
  const now = new Date().toISOString();
  if (open) return base44.asServiceRole.entities.OperationalAlert.update(open.id, { ...input, last_detected_at: now, status: 'open' });
  return base44.asServiceRole.entities.OperationalAlert.create({ ...input, first_detected_at: now, last_detected_at: now, status: 'open' });
}

async function refreshStockAlert(base44: any, item: any) {
  const current = Number(item.current_quantity || 0);
  const minimum = Number(item.minimum_quantity || 0);
  if (current <= minimum) {
    await upsertAlert(base44, {
      unit_id: item.unit_id,
      alert_key: `stock:${item.id}:${current <= 0 ? 'stockout' : 'low'}`,
      category: current <= 0 ? 'stockout' : 'low_stock',
      severity: current <= 0 ? 'critical' : 'warning',
      title: current <= 0 ? `${item.name} sem estoque` : `${item.name} abaixo do mínimo`,
      description: `Saldo ${current} ${item.base_unit}; mínimo ${minimum}.`,
      entity_type: 'stock_item',
      entity_id: item.id,
      metric_value: current,
      threshold_value: minimum,
    });
  } else {
    const alerts = await base44.asServiceRole.entities.OperationalAlert.filter({ entity_type: 'stock_item', entity_id: item.id });
    for (const alert of alerts.filter((row: any) => ['low_stock', 'stockout'].includes(row.category) && row.status !== 'resolved')) {
      await base44.asServiceRole.entities.OperationalAlert.update(alert.id, { status: 'resolved', resolved_at: new Date().toISOString(), resolution_note: 'Saldo normalizado automaticamente.' });
    }
  }
}

async function createOrUpdateLot(base44: any, item: any, input: any, quantity: number, unitCost: number, now: string) {
  const lotNumber = String(input.lot_number || `MANUAL-${now.slice(0, 10)}-${item.id.slice(0, 6)}`);
  const lots = await base44.asServiceRole.entities.StockLot.filter({ unit_id: item.unit_id, stock_item_id: item.id, lot_number: lotNumber });
  const lot = lots.find((row: any) => row.status !== 'cancelled');
  if (lot) {
    const before = Number(lot.current_quantity || 0);
    const after = quantityRound(before + quantity);
    return base44.asServiceRole.entities.StockLot.update(lot.id, {
      current_quantity: after,
      initial_quantity: quantityRound(Number(lot.initial_quantity || 0) + quantity),
      unit_cost: weightedAverageCost({ currentQuantity: before, currentAverageCost: lot.unit_cost, incomingQuantity: quantity, incomingUnitCost: unitCost }),
      total_cost: moneyRound(after * weightedAverageCost({ currentQuantity: before, currentAverageCost: lot.unit_cost, incomingQuantity: quantity, incomingUnitCost: unitCost })),
      expiry_date: input.expiry_date || lot.expiry_date,
      storage_location: input.storage_location || lot.storage_location,
      last_movement_at: now,
      status: 'available',
    });
  }
  return base44.asServiceRole.entities.StockLot.create({
    unit_id: item.unit_id,
    stock_item_id: item.id,
    lot_number: lotNumber,
    supplier_id: input.supplier_id,
    received_at: now,
    expiry_date: input.expiry_date,
    initial_quantity: quantity,
    current_quantity: quantity,
    reserved_quantity: 0,
    unit_cost: unitCost,
    total_cost: moneyRound(quantity * unitCost),
    storage_location: input.storage_location || item.storage_location,
    status: 'available',
    quality_status: 'not_required',
  });
}

async function consumeLots(base44: any, item: any, quantity: number, requestedLotId?: string) {
  let lots = await base44.asServiceRole.entities.StockLot.filter({ unit_id: item.unit_id, stock_item_id: item.id });
  if (requestedLotId) lots = lots.filter((lot: any) => lot.id === requestedLotId);
  const allocation = allocateLots(lots, quantity);
  if (allocation.remaining_quantity > 0) throw Object.assign(new Error('insufficient_lot_stock'), { status: 409 });
  for (const part of allocation.allocations) {
    await base44.asServiceRole.entities.StockLot.update(part.stock_lot_id, {
      current_quantity: part.balance_after,
      total_cost: moneyRound(part.balance_after * part.unit_cost),
      status: part.balance_after <= 0 ? 'exhausted' : 'available',
      last_movement_at: new Date().toISOString(),
    });
  }
  return allocation.allocations;
}

async function findOrCreateDestinationItem(base44: any, source: any, destinationUnitId: string) {
  const matches = await base44.asServiceRole.entities.StockItem.filter({ unit_id: destinationUnitId, sku: source.sku });
  if (matches[0]) return matches[0];
  return base44.asServiceRole.entities.StockItem.create({
    unit_id: destinationUnitId,
    sku: source.sku,
    name: source.name,
    description: source.description,
    category: source.category,
    base_unit: source.base_unit,
    purchase_unit: source.purchase_unit,
    purchase_to_base_factor: source.purchase_to_base_factor || 1,
    current_quantity: 0,
    reserved_quantity: 0,
    available_quantity: 0,
    minimum_quantity: source.minimum_quantity || 0,
    maximum_quantity: source.maximum_quantity,
    reorder_quantity: source.reorder_quantity || 0,
    reorder_lead_days: source.reorder_lead_days || 0,
    safety_stock_quantity: source.safety_stock_quantity || 0,
    average_cost: source.average_cost || 0,
    last_cost: source.last_cost || 0,
    preferred_supplier_id: source.preferred_supplier_id,
    barcode: source.barcode,
    storage_location: source.storage_location,
    batch_control: source.batch_control || false,
    expiry_control: source.expiry_control || false,
    active: true,
    metadata: { replicated_from_stock_item_id: source.id },
  });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_stock_operation' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    assertPermission(user);

    const input = await req.json();
    const action = String(input.action || '');
    const idempotencyKey = String(input.idempotency_key || requestId);
    const eventKey = `stock_operation:${action}:${idempotencyKey}`;
    const prior = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
    const completed = prior.find((event: any) => event.status === 'completed');
    if (completed) return Response.json({ duplicate: true, result: completed.result, request_id: requestId });

    if (action === 'create_item') {
      const unitId = String(input.unit_id || '');
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      if (!input.sku || !input.name || !input.base_unit) return Response.json({ error: 'item_fields_required', request_id: requestId }, { status: 422 });
      const duplicate = await base44.asServiceRole.entities.StockItem.filter({ unit_id: unitId, sku: String(input.sku).trim() });
      if (duplicate[0]) return Response.json({ error: 'sku_already_exists', stock_item_id: duplicate[0].id, request_id: requestId }, { status: 409 });
      const item = await base44.asServiceRole.entities.StockItem.create({
        unit_id: unitId,
        sku: String(input.sku).trim(),
        name: String(input.name).trim(),
        description: input.description,
        category: input.category,
        base_unit: input.base_unit,
        purchase_unit: input.purchase_unit || input.base_unit,
        purchase_to_base_factor: Number(input.purchase_to_base_factor || 1),
        current_quantity: 0,
        reserved_quantity: 0,
        available_quantity: 0,
        minimum_quantity: Number(input.minimum_quantity || 0),
        maximum_quantity: input.maximum_quantity == null ? undefined : Number(input.maximum_quantity),
        reorder_quantity: Number(input.reorder_quantity || 0),
        reorder_lead_days: Number(input.reorder_lead_days || 0),
        safety_stock_quantity: Number(input.safety_stock_quantity || 0),
        average_cost: 0,
        last_cost: 0,
        preferred_supplier_id: input.preferred_supplier_id,
        barcode: input.barcode,
        storage_location: input.storage_location,
        batch_control: Boolean(input.batch_control),
        expiry_control: Boolean(input.expiry_control),
        active: true,
      });
      await base44.asServiceRole.entities.ProcessedEvent.create({ event_key: eventKey, event_type: 'stock_item_created', source: 'user_command', status: 'completed', entity_type: 'stock_item', entity_id: item.id, result: { stock_item_id: item.id }, started_at: new Date().toISOString(), completed_at: new Date().toISOString(), unit_id: unitId });
      await base44.asServiceRole.entities.AuditLog.create({ action: 'create', entity_type: 'stock_item', entity_id: item.id, item_label: item.name, reason: 'inventory_catalog_created', user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: unitId, request_id: requestId, after_data: item, success: true });
      return Response.json({ stock_item: item, request_id: requestId });
    }

    const stockItemId = String(input.stock_item_id || '');
    const item = stockItemId ? await base44.asServiceRole.entities.StockItem.get(stockItemId) : null;
    if (!item) return Response.json({ error: 'stock_item_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, item.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    const sourceCounts = await base44.asServiceRole.entities.InventoryCount.filter({ unit_id: item.unit_id });
    if (sourceCounts.some((count: any) => count.status === 'counting' && count.freeze_movements === true)) {
      return Response.json({ error: 'inventory_count_freezes_movements', request_id: requestId }, { status: 423 });
    }
    const quantity = normalizeQuantity(input.quantity);
    if (quantity <= 0) return Response.json({ error: 'positive_quantity_required', request_id: requestId }, { status: 422 });
    const now = new Date().toISOString();
    const processingEvent = prior[0] || await base44.asServiceRole.entities.ProcessedEvent.create({ event_key: eventKey, event_type: `stock_${action}`, source: 'user_command', status: 'processing', attempts: 1, started_at: now, unit_id: item.unit_id });
    const movements: any[] = [];
    const before = Number(item.current_quantity || 0);

    if (action === 'adjust_in') {
      const unitCost = moneyRound(input.unit_cost ?? item.last_cost ?? item.average_cost ?? 0);
      const after = quantityRound(before + quantity);
      const averageCost = weightedAverageCost({ currentQuantity: before, currentAverageCost: item.average_cost, incomingQuantity: quantity, incomingUnitCost: unitCost });
      const lot = item.batch_control || input.lot_number ? await createOrUpdateLot(base44, item, input, quantity, unitCost, now) : null;
      const movement = await base44.asServiceRole.entities.StockMovement.create({ unit_id: item.unit_id, stock_item_id: item.id, stock_lot_id: lot?.id, movement_type: 'adjustment_in', quantity, unit_cost: unitCost, total_cost: moneyRound(quantity * unitCost), balance_before: before, balance_after: after, batch_number: lot?.lot_number, expiry_date: lot?.expiry_date, operator_user_id: user.id, reason: String(input.reason || 'manual_adjustment_in'), occurred_at: now, request_id: requestId, status: 'posted' });
      movements.push(movement);
      const updated = await base44.asServiceRole.entities.StockItem.update(item.id, { current_quantity: after, available_quantity: quantityRound(after - Number(item.reserved_quantity || 0)), average_cost: averageCost, last_cost: unitCost, last_movement_at: now });
      await refreshStockAlert(base44, updated);
    } else if (OUT_ACTIONS.has(action)) {
      let lossBatch = null;
      if (action === 'loss' && input.production_batch_id) {
        lossBatch = await base44.asServiceRole.entities.ProductionBatch.get(input.production_batch_id);
        if (!lossBatch || lossBatch.unit_id !== item.unit_id) return Response.json({ error: 'invalid_production_batch', request_id: requestId }, { status: 422 });
      }
      const canOverride = ['super_admin', 'admin', 'manager'].includes(user.role) || (user.permissions || []).includes('inventory.override_negative');
      const after = quantityRound(before - quantity);
      if (after < 0 && !(input.allow_negative_override && canOverride && String(input.reason || '').trim().length >= 5)) {
        return Response.json({ error: 'insufficient_stock', available_quantity: availableQuantity(item), request_id: requestId }, { status: 409 });
      }
      const allocations = item.batch_control ? await consumeLots(base44, item, quantity, input.stock_lot_id) : [];
      const movementType = action === 'adjust_out' ? 'adjustment_out' : action;
      const movement = await base44.asServiceRole.entities.StockMovement.create({ unit_id: item.unit_id, stock_item_id: item.id, stock_lot_id: input.stock_lot_id, movement_type: movementType, quantity, unit_cost: Number(item.average_cost || 0), total_cost: moneyRound(quantity * Number(item.average_cost || 0)), balance_before: before, balance_after: after, production_batch_id: input.production_batch_id, machine_id: input.machine_id, operator_user_id: user.id, reason: String(input.reason || action), occurred_at: now, request_id: requestId, status: 'posted', metadata: { lot_allocations: allocations, negative_override: after < 0 } });
      movements.push(movement);
      const updated = await base44.asServiceRole.entities.StockItem.update(item.id, { current_quantity: after, available_quantity: quantityRound(after - Number(item.reserved_quantity || 0)), last_movement_at: now });
      await refreshStockAlert(base44, updated);
      if (action === 'loss') {
        await upsertAlert(base44, { unit_id: item.unit_id, alert_key: `loss:${movement.id}`, category: 'loss', severity: quantity * Number(item.average_cost || 0) >= 100 ? 'critical' : 'warning', title: `Perda registrada: ${item.name}`, description: `${quantity} ${item.base_unit} · ${input.reason || 'Sem detalhe'}`, entity_type: 'stock_movement', entity_id: movement.id, metric_value: moneyRound(quantity * Number(item.average_cost || 0)), threshold_value: 100, metadata: { production_batch_id: input.production_batch_id, machine_id: input.machine_id } });
        if (lossBatch) {
          const lossCost = moneyRound(quantity * Number(item.average_cost || 0));
          await base44.asServiceRole.entities.ProductionBatch.update(lossBatch.id, { actual_material_cost: moneyRound(Number(lossBatch.actual_material_cost || 0) + lossCost), actual_consumption: [...(lossBatch.actual_consumption || []), { stock_item_id: item.id, stock_item_name: item.name, quantity, unit: item.base_unit, total_cost: lossCost, movement_id: movement.id, loss: true, reason: input.reason }] });
        }
      }
    } else if (action === 'transfer') {
      const destinationUnitId = String(input.destination_unit_id || '');
      if (!destinationUnitId || destinationUnitId === item.unit_id || !canAccessUnit(user, destinationUnitId)) return Response.json({ error: 'invalid_destination_unit', request_id: requestId }, { status: 422 });
      const destinationCounts = await base44.asServiceRole.entities.InventoryCount.filter({ unit_id: destinationUnitId });
      if (destinationCounts.some((count: any) => count.status === 'counting' && count.freeze_movements === true)) return Response.json({ error: 'destination_inventory_count_freezes_movements', request_id: requestId }, { status: 423 });
      if (before - quantity < 0) return Response.json({ error: 'insufficient_stock', available_quantity: availableQuantity(item), request_id: requestId }, { status: 409 });
      const destination = await findOrCreateDestinationItem(base44, item, destinationUnitId);
      const transferId = crypto.randomUUID();
      const allocations = item.batch_control ? await consumeLots(base44, item, quantity, input.stock_lot_id) : [];
      const sourceAfter = quantityRound(before - quantity);
      const destinationBefore = Number(destination.current_quantity || 0);
      const destinationAfter = quantityRound(destinationBefore + quantity);
      const outMovement = await base44.asServiceRole.entities.StockMovement.create({ unit_id: item.unit_id, stock_item_id: item.id, movement_type: 'transfer_out', quantity, unit_cost: Number(item.average_cost || 0), total_cost: moneyRound(quantity * Number(item.average_cost || 0)), balance_before: before, balance_after: sourceAfter, source_unit_id: item.unit_id, destination_unit_id: destinationUnitId, transfer_id: transferId, operator_user_id: user.id, reason: String(input.reason || 'unit_transfer'), occurred_at: now, request_id: requestId, status: 'posted', metadata: { lot_allocations: allocations } });
      const inMovement = await base44.asServiceRole.entities.StockMovement.create({ unit_id: destinationUnitId, stock_item_id: destination.id, movement_type: 'transfer_in', quantity, unit_cost: Number(item.average_cost || 0), total_cost: moneyRound(quantity * Number(item.average_cost || 0)), balance_before: destinationBefore, balance_after: destinationAfter, source_unit_id: item.unit_id, destination_unit_id: destinationUnitId, transfer_id: transferId, operator_user_id: user.id, reason: String(input.reason || 'unit_transfer'), occurred_at: now, request_id: requestId, status: 'posted' });
      movements.push(outMovement, inMovement);
      await base44.asServiceRole.entities.StockItem.update(item.id, { current_quantity: sourceAfter, available_quantity: quantityRound(sourceAfter - Number(item.reserved_quantity || 0)), last_movement_at: now });
      await base44.asServiceRole.entities.StockItem.update(destination.id, { current_quantity: destinationAfter, available_quantity: quantityRound(destinationAfter - Number(destination.reserved_quantity || 0)), average_cost: weightedAverageCost({ currentQuantity: destinationBefore, currentAverageCost: destination.average_cost, incomingQuantity: quantity, incomingUnitCost: item.average_cost }), last_cost: Number(item.average_cost || 0), last_movement_at: now });
      for (const allocation of allocations) {
        await createOrUpdateLot(base44, destination, { lot_number: allocation.lot_number, storage_location: destination.storage_location }, allocation.quantity, allocation.unit_cost, now);
      }
      await refreshStockAlert(base44, { ...item, current_quantity: sourceAfter });
      await refreshStockAlert(base44, { ...destination, current_quantity: destinationAfter });
    } else {
      return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
    }

    const result = { action, stock_item_id: item.id, movement_ids: movements.map((movement) => movement.id) };
    await base44.asServiceRole.entities.ProcessedEvent.update(processingEvent.id, { status: 'completed', entity_type: 'stock_item', entity_id: item.id, result, completed_at: new Date().toISOString() });
    await base44.asServiceRole.entities.AuditLog.create({ action: action === 'transfer' ? 'update' : 'adjust', entity_type: 'stock_item', entity_id: item.id, item_label: item.name, amount: moneyRound(quantity * Number(item.average_cost || 0)), reason: String(input.reason || action), user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: item.unit_id, request_id: requestId, before_data: { current_quantity: before }, after_data: result, success: true });
    return Response.json({ ...result, movements, request_id: requestId });
  } catch (error) {
    console.error(`[manage_stock_operation:${requestId}]`, error);
    const status = Number((error as any)?.status || 500);
    return Response.json({ error: (error as Error)?.message || 'stock_operation_failed', request_id: requestId }, { status });
  }
});
