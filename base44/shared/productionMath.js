const qty = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 1_000_000) / 1_000_000;
const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;

export const STAGE_TO_GARMENT_STATUS = {
  washing: 'washing',
  drying: 'drying',
  dry_cleaning: 'washing',
  ironing: 'ironing',
  finishing: 'quality_control',
  quality_control: 'quality_control',
  packaging: 'ready',
};

export const STAGE_TO_MACHINE_TYPE = {
  washing: 'wash',
  drying: 'dry',
  dry_cleaning: 'dry_clean',
  ironing: 'iron',
  finishing: 'finishing',
  quality_control: 'quality',
  packaging: 'packaging',
};

export function recipeBasisQuantity(recipe, batch, garments = []) {
  switch (recipe?.basis) {
    case 'per_kg': return qty(batch?.total_weight_kg || garments.reduce((sum, garment) => sum + Number(garment.actual_weight_kg || garment.estimated_weight_kg || 0), 0));
    case 'per_cycle': return 1;
    case 'per_square_meter': return qty(garments.reduce((sum, garment) => {
      const width = Number(garment.attributes?.width_cm || 0);
      const height = Number(garment.attributes?.height_cm || 0);
      return sum + ((width * height) / 10000);
    }, 0));
    case 'per_piece':
    default: return qty(batch?.piece_count || garments.length || 0);
  }
}

export function calculatePlannedConsumption(recipe, batch, garments = [], stockItems = []) {
  if (!recipe) return [];
  const factor = recipeBasisQuantity(recipe, batch, garments);
  const stockMap = Object.fromEntries((stockItems || []).map((item) => [item.id, item]));
  return (recipe.items || []).map((line) => {
    const quantity = qty(Number(line.quantity || 0) * factor);
    const stock = stockMap[line.stock_item_id];
    const unitCost = money(stock?.average_cost || 0);
    return {
      stock_item_id: line.stock_item_id,
      stock_item_name: stock?.name || line.stock_item_id,
      quantity,
      unit: line.unit || stock?.base_unit,
      unit_cost: unitCost,
      total_cost: money(quantity * unitCost),
      allow_substitution: Boolean(line.allow_substitution),
      substitute_stock_item_ids: line.substitute_stock_item_ids || [],
    };
  });
}

export function calculateCapacity({ totalWeightKg = 0, pieceCount = 0, machineCapacityKg = 0, machineCapacityItems = 0 }) {
  const weightPercent = machineCapacityKg > 0 ? (Number(totalWeightKg || 0) / machineCapacityKg) * 100 : 0;
  const itemPercent = machineCapacityItems > 0 ? (Number(pieceCount || 0) / machineCapacityItems) * 100 : 0;
  return qty(Math.max(weightPercent, itemPercent, 0));
}

export function calculateBatchCost({ materialCost = 0, laborCost = 0, machineHourlyCost = 0, actualMinutes = 0, energyCost = 0, waterCost = 0, otherCost = 0, overheadPercent = 0 }) {
  const machineCost = money(Number(machineHourlyCost || 0) * (Number(actualMinutes || 0) / 60));
  const direct = money(Number(materialCost || 0) + Number(laborCost || 0) + machineCost + Number(energyCost || 0) + Number(waterCost || 0) + Number(otherCost || 0));
  const overhead = money(direct * (Number(overheadPercent || 0) / 100));
  return { material_cost: money(materialCost), labor_cost: money(laborCost), machine_cost: machineCost, energy_cost: money(energyCost), water_cost: money(waterCost), other_cost: money(otherCost), overhead_cost: overhead, total_cost: money(direct + overhead) };
}

export function variancePercent(actual, planned) {
  const baseline = Math.abs(Number(planned || 0));
  if (baseline === 0) return Number(actual || 0) === 0 ? 0 : 100;
  return qty(((Number(actual || 0) - Number(planned || 0)) / baseline) * 100);
}

export { qty as productionQuantityRound, money as productionMoneyRound };
