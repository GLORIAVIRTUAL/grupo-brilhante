import assert from 'node:assert/strict';
import { allocateLots, availableQuantity, calculateInventoryVariance, weightedAverageCost } from '../base44/shared/stockMath.js';
import { calculateBatchCost, calculateCapacity, calculatePlannedConsumption, recipeBasisQuantity, variancePercent } from '../base44/shared/productionMath.js';

const stockItems = [{ id: 'soap', name: 'Detergente', average_cost: 4, base_unit: 'ml', current_quantity: 100, reserved_quantity: 10 }];
const recipe = { basis: 'per_kg', items: [{ stock_item_id: 'soap', quantity: 2, unit: 'ml' }] };
const batch = { total_weight_kg: 3, piece_count: 2 };

assert.equal(recipeBasisQuantity(recipe, batch, []), 3);
assert.deepEqual(calculatePlannedConsumption(recipe, batch, [], stockItems)[0], {
  stock_item_id: 'soap',
  stock_item_name: 'Detergente',
  quantity: 6,
  unit: 'ml',
  unit_cost: 4,
  total_cost: 24,
  allow_substitution: false,
  substitute_stock_item_ids: [],
});
assert.equal(availableQuantity(stockItems[0]), 90);
assert.equal(weightedAverageCost({ currentQuantity: 10, currentAverageCost: 2, incomingQuantity: 10, incomingUnitCost: 4 }), 3);
assert.equal(calculateCapacity({ totalWeightKg: 8, pieceCount: 4, machineCapacityKg: 10, machineCapacityItems: 10 }), 80);
assert.deepEqual(calculateBatchCost({ materialCost: 10, laborCost: 20, machineHourlyCost: 12, actualMinutes: 30, energyCost: 3, waterCost: 1, overheadPercent: 10 }), {
  material_cost: 10,
  labor_cost: 20,
  machine_cost: 6,
  energy_cost: 3,
  water_cost: 1,
  other_cost: 0,
  overhead_cost: 4,
  total_cost: 44,
});
assert.equal(variancePercent(12, 10), 20);

const allocation = allocateLots([
  { id: 'later', lot_number: 'B', status: 'available', current_quantity: 10, reserved_quantity: 0, unit_cost: 3, received_at: '2026-01-01T00:00:00.000Z', expiry_date: '2027-01-01T00:00:00.000Z' },
  { id: 'soon', lot_number: 'A', status: 'available', current_quantity: 5, reserved_quantity: 0, unit_cost: 2, received_at: '2026-02-01T00:00:00.000Z', expiry_date: '2026-12-01T00:00:00.000Z' },
], 8);
assert.deepEqual(allocation.allocations.map(({ stock_lot_id, quantity }) => ({ stock_lot_id, quantity })), [
  { stock_lot_id: 'soon', quantity: 5 },
  { stock_lot_id: 'later', quantity: 3 },
]);
assert.equal(allocation.remaining_quantity, 0);

const variance = calculateInventoryVariance([{ stock_item_id: 'soap', system_quantity: 10, counted_quantity: 8, average_cost_snapshot: 4 }]);
assert.equal(variance.variance_item_count, 1);
assert.equal(variance.total_variance_value, -8);

console.log('Wave 3 math tests: OK');
