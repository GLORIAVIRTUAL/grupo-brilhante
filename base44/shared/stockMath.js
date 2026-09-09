const quantityRound = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 1_000_000) / 1_000_000;
const moneyRound = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;

export function normalizeQuantity(value) {
  const quantity = quantityRound(value);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('invalid_quantity');
  return quantity;
}

export function availableQuantity(item) {
  return quantityRound(Math.max(0, Number(item?.current_quantity || 0) - Number(item?.reserved_quantity || 0)));
}

export function weightedAverageCost({ currentQuantity, currentAverageCost, incomingQuantity, incomingUnitCost }) {
  const current = normalizeQuantity(currentQuantity);
  const incoming = normalizeQuantity(incomingQuantity);
  const total = quantityRound(current + incoming);
  if (total <= 0) return moneyRound(incomingUnitCost || currentAverageCost || 0);
  return moneyRound(((current * Number(currentAverageCost || 0)) + (incoming * Number(incomingUnitCost || 0))) / total);
}

function lotTimestamp(lot) {
  const expiry = lot?.expiry_date ? Date.parse(lot.expiry_date) : Number.POSITIVE_INFINITY;
  const received = lot?.received_at ? Date.parse(lot.received_at) : Number.POSITIVE_INFINITY;
  return [Number.isFinite(expiry) ? expiry : Number.POSITIVE_INFINITY, Number.isFinite(received) ? received : Number.POSITIVE_INFINITY, String(lot?.id || '')];
}

export function sortLotsForConsumption(lots = []) {
  const now = Date.now();
  return [...lots]
    .filter((lot) => lot && lot.status === 'available' && Number(lot.current_quantity || 0) > Number(lot.reserved_quantity || 0) && (!lot.expiry_date || Date.parse(lot.expiry_date) >= now))
    .sort((a, b) => {
      const ka = lotTimestamp(a);
      const kb = lotTimestamp(b);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
    });
}

export function allocateLots(lots, requestedQuantity) {
  let remaining = normalizeQuantity(requestedQuantity);
  const allocations = [];
  for (const lot of sortLotsForConsumption(lots)) {
    if (remaining <= 0) break;
    const available = quantityRound(Math.max(0, Number(lot.current_quantity || 0) - Number(lot.reserved_quantity || 0)));
    const quantity = quantityRound(Math.min(available, remaining));
    if (quantity <= 0) continue;
    allocations.push({
      stock_lot_id: lot.id,
      lot_number: lot.lot_number,
      quantity,
      unit_cost: moneyRound(lot.unit_cost || 0),
      total_cost: moneyRound(quantity * Number(lot.unit_cost || 0)),
      balance_before: quantityRound(lot.current_quantity || 0),
      balance_after: quantityRound(Number(lot.current_quantity || 0) - quantity),
    });
    remaining = quantityRound(remaining - quantity);
  }
  return { allocations, allocated_quantity: quantityRound(requestedQuantity - remaining), remaining_quantity: remaining };
}

export function calculateInventoryVariance(items = []) {
  return items.reduce((summary, item) => {
    const system = quantityRound(item.system_quantity || 0);
    const counted = quantityRound(item.counted_quantity || 0);
    const difference = quantityRound(counted - system);
    const differenceValue = moneyRound(difference * Number(item.average_cost_snapshot || 0));
    summary.items.push({ ...item, system_quantity: system, counted_quantity: counted, difference, difference_value: differenceValue });
    if (difference !== 0) summary.variance_item_count += 1;
    summary.total_variance_value = moneyRound(summary.total_variance_value + differenceValue);
    return summary;
  }, { items: [], variance_item_count: 0, total_variance_value: 0 });
}

export { quantityRound, moneyRound };
