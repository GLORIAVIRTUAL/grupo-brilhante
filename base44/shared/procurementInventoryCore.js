export function quantity(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) throw new Error('invalid_quantity');
  return Math.round(number * 1000000) / 1000000;
}

export function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) throw new Error('invalid_amount');
  return Math.round(number * 100) / 100;
}

export function computePurchaseTotals(items = [], extras = {}) {
  const subtotal = money(items.reduce((sum, item) => sum + quantity(item.ordered_quantity ?? item.requested_quantity) * money(item.unit_price ?? item.estimated_unit_price), 0));
  const discount = money(Math.max(0, extras.discount || 0));
  const freight = money(Math.max(0, extras.freight || 0));
  const taxes = money(Math.max(0, extras.taxes || 0));
  return { subtotal, discount, freight, taxes, total: money(Math.max(0, subtotal - discount + freight + taxes)) };
}

export function purchaseRequisitionTransition(current, action) {
  const map = {
    submit: { draft: 'submitted' }, approve: { submitted: 'approved' }, reject: { submitted: 'rejected' },
    order: { approved: 'ordered', partially_ordered: 'ordered' }, cancel: { draft: 'cancelled', submitted: 'cancelled', approved: 'cancelled' },
  };
  const next = map[action]?.[current]; if (!next) throw new Error('invalid_requisition_transition'); return next;
}

export function purchaseOrderTransition(current, action) {
  const map = {
    submit: { draft: 'submitted' }, approve: { submitted: 'approved' }, send: { approved: 'sent' }, receive_partial: { sent: 'partially_received', partially_received: 'partially_received' }, receive_complete: { sent: 'received', partially_received: 'received' }, close: { received: 'closed' }, cancel: { draft: 'cancelled', submitted: 'cancelled', approved: 'cancelled' },
  };
  const next = map[action]?.[current]; if (!next) throw new Error('invalid_purchase_order_transition'); return next;
}

export function receiptLineStatus({ received, accepted, rejected }) {
  const receivedQuantity = quantity(received); const acceptedQuantity = quantity(accepted); const rejectedQuantity = quantity(rejected);
  if (acceptedQuantity + rejectedQuantity > receivedQuantity) throw new Error('receipt_quantities_exceed_received');
  if (acceptedQuantity === 0 && rejectedQuantity === receivedQuantity) return 'rejected';
  if (acceptedQuantity === receivedQuantity) return 'accepted';
  return 'partially_accepted';
}

export function receiptStatus(lines = []) {
  if (!lines.length) throw new Error('receipt_items_required');
  const statuses = lines.map((line) => receiptLineStatus(line));
  if (statuses.every((status) => status === 'accepted')) return 'accepted';
  if (statuses.every((status) => status === 'rejected')) return 'rejected';
  return 'partially_accepted';
}

export function assertWarehouseScope({ warehouse, legalEntityId, unitId, activeRequired = true }) {
  if (!warehouse || warehouse.legal_entity_id !== legalEntityId || (warehouse.unit_id && unitId && warehouse.unit_id !== unitId)) throw new Error('warehouse_scope_mismatch');
  if (activeRequired && warehouse.status !== 'active') throw new Error('warehouse_not_active');
  return true;
}

export function assertSameCompanyTransfer(sourceWarehouse, destinationWarehouse) {
  if (!sourceWarehouse || !destinationWarehouse || sourceWarehouse.id === destinationWarehouse.id) throw new Error('invalid_transfer_warehouses');
  if (sourceWarehouse.legal_entity_id !== destinationWarehouse.legal_entity_id) throw new Error('intercompany_stock_transfer_requires_separate_process');
  if (sourceWarehouse.status !== 'active' || destinationWarehouse.status !== 'active') throw new Error('warehouse_not_active');
  return true;
}
