import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { allocateLots, calculateInventoryVariance, moneyRound, normalizeQuantity, quantityRound } from '../../shared/stockMath.js';

const COUNT_ROLES = new Set(['super_admin', 'admin', 'manager', 'inventory', 'finance']);
const APPROVE_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

function canCount(user: any) {
  return COUNT_ROLES.has(user?.role || '') || (user?.permissions || []).includes('inventory.manage');
}

function canApprove(user: any) {
  return APPROVE_ROLES.has(user?.role || '') || (user?.permissions || []).includes('inventory.approve');
}

async function processEvent(base44: any, eventKey: string, unitId: string, eventType: string) {
  const existing = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
  const completed = existing.find((row: any) => row.status === 'completed');
  if (completed) return { duplicate: completed };
  const event = existing[0] || await base44.asServiceRole.entities.ProcessedEvent.create({ event_key: eventKey, event_type: eventType, source: 'user_command', status: 'processing', attempts: 1, started_at: new Date().toISOString(), unit_id: unitId });
  return { event };
}

async function audit(base44: any, user: any, count: any, action: string, reason: string, requestId: string, beforeData?: any, afterData?: any) {
  return base44.asServiceRole.entities.AuditLog.create({ action, entity_type: 'inventory_count', entity_id: count.id, item_label: count.code, reason, user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: count.unit_id, request_id: requestId, before_data: beforeData, after_data: afterData, success: true });
}

async function adjustControlledLots(base44: any, item: any, difference: number, countCode: string, now: string) {
  if (!item.batch_control || difference === 0) return [];
  if (difference > 0) {
    const lot = await base44.asServiceRole.entities.StockLot.create({ unit_id: item.unit_id, stock_item_id: item.id, lot_number: `INV-${countCode}-${item.id.slice(0, 6)}`, received_at: now, initial_quantity: difference, current_quantity: difference, reserved_quantity: 0, unit_cost: Number(item.average_cost || 0), total_cost: moneyRound(difference * Number(item.average_cost || 0)), storage_location: item.storage_location, status: 'available', quality_status: 'not_required', last_movement_at: now, metadata: { source: 'inventory_count' } });
    return [{ stock_lot_id: lot.id, lot_number: lot.lot_number, quantity: difference }];
  }
  const lots = await base44.asServiceRole.entities.StockLot.filter({ unit_id: item.unit_id, stock_item_id: item.id });
  const allocation = allocateLots(lots, Math.abs(difference));
  if (allocation.remaining_quantity > 0) throw Object.assign(new Error(`insufficient_lot_stock:${item.id}`), { status: 409 });
  for (const part of allocation.allocations) {
    await base44.asServiceRole.entities.StockLot.update(part.stock_lot_id, { current_quantity: part.balance_after, total_cost: moneyRound(part.balance_after * part.unit_cost), status: part.balance_after <= 0 ? 'exhausted' : 'available', last_movement_at: now });
  }
  return allocation.allocations;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_inventory_count' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!canCount(user)) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const input = await req.json();
    const action = String(input.action || '');
    const now = new Date().toISOString();

    if (action === 'create') {
      const unitId = String(input.unit_id || '');
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const openCounts = await base44.asServiceRole.entities.InventoryCount.filter({ unit_id: unitId });
      if (openCounts.some((row: any) => ['counting', 'review'].includes(row.status))) return Response.json({ error: 'inventory_count_already_open', request_id: requestId }, { status: 409 });
      let stockItems = await base44.asServiceRole.entities.StockItem.filter({ unit_id: unitId, active: true });
      if (input.scope === 'category' && input.category) stockItems = stockItems.filter((item: any) => item.category === input.category);
      if (input.scope === 'selected_items') {
        const selected = new Set(Array.isArray(input.stock_item_ids) ? input.stock_item_ids : []);
        stockItems = stockItems.filter((item: any) => selected.has(item.id));
      }
      if (stockItems.length === 0) return Response.json({ error: 'inventory_items_required', request_id: requestId }, { status: 422 });
      const code = `INV-${now.slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const items = stockItems.map((item: any) => ({ stock_item_id: item.id, system_quantity: Number(item.current_quantity || 0), counted_quantity: null, difference: null, average_cost_snapshot: Number(item.average_cost || 0), difference_value: null, reason: '', review_status: 'pending' }));
      const count = await base44.asServiceRole.entities.InventoryCount.create({ unit_id: unitId, code, status: 'counting', scope: input.scope || 'all', category: input.category, selected_stock_item_ids: input.stock_item_ids || [], blind_count: input.blind_count !== false, freeze_movements: Boolean(input.freeze_movements), started_at: now, started_by_user_id: user.id, items, item_count: items.length, counted_item_count: 0, variance_item_count: 0, total_variance_value: 0, notes: input.notes, request_id: requestId });
      await audit(base44, user, count, 'create', 'inventory_count_started', requestId, undefined, { item_count: items.length, blind_count: count.blind_count, freeze_movements: count.freeze_movements });
      return Response.json({ inventory_count: count, request_id: requestId });
    }

    const countId = String(input.inventory_count_id || '');
    const count = countId ? await base44.asServiceRole.entities.InventoryCount.get(countId) : null;
    if (!count) return Response.json({ error: 'inventory_count_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, count.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });

    if (action === 'record') {
      if (count.status !== 'counting') return Response.json({ error: 'inventory_not_counting', request_id: requestId }, { status: 409 });
      const stockItemId = String(input.stock_item_id || '');
      const countedQuantity = normalizeQuantity(input.counted_quantity);
      const itemIndex = (count.items || []).findIndex((item: any) => item.stock_item_id === stockItemId);
      if (itemIndex < 0) return Response.json({ error: 'stock_item_not_in_count', request_id: requestId }, { status: 404 });
      const items = [...count.items];
      const previous = items[itemIndex];
      const difference = quantityRound(countedQuantity - Number(previous.system_quantity || 0));
      items[itemIndex] = { ...previous, counted_quantity: countedQuantity, difference, difference_value: moneyRound(difference * Number(previous.average_cost_snapshot || 0)), reason: String(input.reason || previous.reason || ''), review_status: 'pending', counted_by_user_id: user.id, counted_at: now };
      const countedItemCount = items.filter((item: any) => item.counted_quantity != null).length;
      const variance = calculateInventoryVariance(items.filter((item: any) => item.counted_quantity != null));
      const updated = await base44.asServiceRole.entities.InventoryCount.update(count.id, { items, counted_item_count: countedItemCount, variance_item_count: variance.variance_item_count, total_variance_value: variance.total_variance_value });
      return Response.json({ inventory_count: updated, request_id: requestId });
    }

    if (action === 'review_item') {
      if (count.status !== 'review') return Response.json({ error: 'inventory_not_in_review', request_id: requestId }, { status: 409 });
      const stockItemId = String(input.stock_item_id || '');
      const itemIndex = (count.items || []).findIndex((item: any) => item.stock_item_id === stockItemId);
      if (itemIndex < 0) return Response.json({ error: 'stock_item_not_in_count', request_id: requestId }, { status: 404 });
      const items = [...count.items];
      items[itemIndex] = { ...items[itemIndex], reason: String(input.reason || items[itemIndex].reason || ''), review_status: input.review_status || 'accepted' };
      const updated = await base44.asServiceRole.entities.InventoryCount.update(count.id, { items });
      return Response.json({ inventory_count: updated, request_id: requestId });
    }

    if (action === 'submit') {
      if (count.status !== 'counting') return Response.json({ error: 'inventory_not_counting', request_id: requestId }, { status: 409 });
      const missing = (count.items || []).filter((item: any) => item.counted_quantity == null);
      if (missing.length > 0) return Response.json({ error: 'inventory_items_not_counted', missing_count: missing.length, request_id: requestId }, { status: 409 });
      const variance = calculateInventoryVariance(count.items || []);
      const updated = await base44.asServiceRole.entities.InventoryCount.update(count.id, { status: 'review', items: variance.items, counted_item_count: variance.items.length, variance_item_count: variance.variance_item_count, total_variance_value: variance.total_variance_value, completed_at: now });
      await audit(base44, user, count, 'update', 'inventory_count_submitted', requestId, { status: count.status }, { status: 'review', variance_item_count: variance.variance_item_count, total_variance_value: variance.total_variance_value });
      return Response.json({ inventory_count: updated, request_id: requestId });
    }

    if (action === 'approve') {
      if (!canApprove(user)) return Response.json({ error: 'approval_permission_required', request_id: requestId }, { status: 403 });
      if (count.status !== 'review') return Response.json({ error: 'inventory_not_in_review', request_id: requestId }, { status: 409 });
      const eventKey = `inventory_approve:${count.id}:${String(input.idempotency_key || count.request_id || count.id)}`;
      const state = await processEvent(base44, eventKey, count.unit_id, 'inventory_count_approve');
      if (state.duplicate) return Response.json({ duplicate: true, result: state.duplicate.result, request_id: requestId });
      const updatedItems = [];
      const movementIds = [];
      for (const line of count.items || []) {
        if (line.counted_quantity == null) throw Object.assign(new Error('inventory_items_not_counted'), { status: 409 });
        const item = await base44.asServiceRole.entities.StockItem.get(line.stock_item_id);
        if (!item || item.unit_id !== count.unit_id) throw Object.assign(new Error(`invalid_stock_item:${line.stock_item_id}`), { status: 409 });
        if (Number(item.current_quantity || 0) !== Number(line.system_quantity || 0) && count.freeze_movements !== true) throw Object.assign(new Error(`stock_changed_after_count:${item.id}`), { status: 409 });
        const difference = quantityRound(Number(line.counted_quantity || 0) - Number(item.current_quantity || 0));
        let movement = null;
        let lotAllocations: any[] = [];
        if (difference !== 0) {
          if (!String(line.reason || '').trim()) throw Object.assign(new Error(`variance_reason_required:${item.id}`), { status: 422 });
          lotAllocations = await adjustControlledLots(base44, item, difference, count.code, now);
          movement = await base44.asServiceRole.entities.StockMovement.create({ unit_id: count.unit_id, stock_item_id: item.id, movement_type: 'inventory_difference', quantity: Math.abs(difference), unit_cost: Number(item.average_cost || 0), total_cost: moneyRound(Math.abs(difference) * Number(item.average_cost || 0)), balance_before: Number(item.current_quantity || 0), balance_after: Number(line.counted_quantity || 0), operator_user_id: user.id, reason: line.reason, occurred_at: now, request_id: requestId, status: 'posted', metadata: { inventory_count_id: count.id, signed_difference: difference, lot_allocations: lotAllocations } });
          movementIds.push(movement.id);
          await base44.asServiceRole.entities.StockItem.update(item.id, { current_quantity: Number(line.counted_quantity || 0), available_quantity: quantityRound(Number(line.counted_quantity || 0) - Number(item.reserved_quantity || 0)), last_inventory_at: now, last_movement_at: now });
          const alert = await base44.asServiceRole.entities.OperationalAlert.create({ unit_id: count.unit_id, alert_key: `inventory:${count.id}:${item.id}`, category: 'inventory_variance', severity: Math.abs(Number(line.difference_value || 0)) >= 100 ? 'critical' : 'warning', title: `Divergência de inventário: ${item.name}`, description: `${difference > 0 ? '+' : ''}${difference} ${item.base_unit} · ${line.reason}`, entity_type: 'inventory_count', entity_id: count.id, status: 'open', first_detected_at: now, last_detected_at: now, metric_value: Number(line.difference_value || 0), threshold_value: 100, metadata: { stock_item_id: item.id, movement_id: movement.id } });
          void alert;
        } else {
          await base44.asServiceRole.entities.StockItem.update(item.id, { last_inventory_at: now });
        }
        updatedItems.push({ ...line, difference, difference_value: moneyRound(difference * Number(line.average_cost_snapshot || 0)), review_status: 'accepted', movement_id: movement?.id });
      }
      const updated = await base44.asServiceRole.entities.InventoryCount.update(count.id, { status: 'approved', items: updatedItems, approved_at: now, approved_by_user_id: user.id });
      const result = { inventory_count_id: count.id, movement_ids: movementIds, variance_item_count: count.variance_item_count, total_variance_value: count.total_variance_value };
      await base44.asServiceRole.entities.ProcessedEvent.update(state.event.id, { status: 'completed', entity_type: 'inventory_count', entity_id: count.id, result, completed_at: now });
      await audit(base44, user, count, 'approve', 'inventory_count_approved', requestId, { status: count.status }, { status: 'approved', movement_ids: movementIds });
      return Response.json({ inventory_count: updated, ...result, request_id: requestId });
    }

    if (action === 'cancel') {
      if (!String(input.reason || '').trim()) return Response.json({ error: 'cancellation_reason_required', request_id: requestId }, { status: 422 });
      if (['approved', 'cancelled'].includes(count.status)) return Response.json({ error: 'inventory_not_cancellable', request_id: requestId }, { status: 409 });
      const updated = await base44.asServiceRole.entities.InventoryCount.update(count.id, { status: 'cancelled', cancellation_reason: String(input.reason), completed_at: now });
      await audit(base44, user, count, 'cancel', String(input.reason), requestId, { status: count.status }, { status: 'cancelled' });
      return Response.json({ inventory_count: updated, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[manage_inventory_count:${requestId}]`, error);
    const status = Number((error as any)?.status || 500);
    return Response.json({ error: (error as Error)?.message || 'inventory_count_failed', request_id: requestId }, { status });
  }
});
