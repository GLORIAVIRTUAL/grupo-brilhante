import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { productionMoneyRound } from '../../shared/productionMath.js';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'inventory', 'finance']);
const BASES = new Set(['per_piece', 'per_kg', 'per_cycle', 'per_square_meter']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

async function deactivatePeers(base44: any, recipe: any) {
  const peers = await base44.asServiceRole.entities.ConsumptionRecipe.filter({ unit_id: recipe.unit_id, active: true });
  for (const peer of peers.filter((row: any) => row.id !== recipe.id && String(row.service_id || '') === String(recipe.service_id || '') && String(row.product_id || '') === String(recipe.product_id || '') && String(row.stage || '') === String(recipe.stage || '') && String(row.machine_type || '') === String(recipe.machine_type || ''))) {
    await base44.asServiceRole.entities.ConsumptionRecipe.update(peer.id, { active: false, valid_until: new Date().toISOString() });
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_consumption_recipe' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || '') && !(user.permissions || []).includes('inventory.recipes')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const input = await req.json();
    const action = String(input.action || '');
    const now = new Date().toISOString();

    if (action === 'create_version') {
      const unitId = String(input.unit_id || '');
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      if (!String(input.name || '').trim() || !BASES.has(input.basis) || !Array.isArray(input.items) || input.items.length === 0) return Response.json({ error: 'recipe_fields_required', request_id: requestId }, { status: 422 });
      const normalizedItems = [];
      let estimatedMaterialCost = 0;
      for (const line of input.items) {
        const stockItem = await base44.asServiceRole.entities.StockItem.get(String(line.stock_item_id || ''));
        if (!stockItem || stockItem.unit_id !== unitId || stockItem.active === false) return Response.json({ error: 'invalid_stock_item', stock_item_id: line.stock_item_id, request_id: requestId }, { status: 422 });
        const quantity = Number(line.quantity || 0);
        if (!Number.isFinite(quantity) || quantity <= 0) return Response.json({ error: 'positive_recipe_quantity_required', stock_item_id: stockItem.id, request_id: requestId }, { status: 422 });
        estimatedMaterialCost += quantity * Number(stockItem.average_cost || 0);
        normalizedItems.push({ stock_item_id: stockItem.id, quantity, unit: line.unit || stockItem.base_unit, minimum_quantity: line.minimum_quantity == null ? undefined : Number(line.minimum_quantity), maximum_quantity: line.maximum_quantity == null ? undefined : Number(line.maximum_quantity), allow_substitution: Boolean(line.allow_substitution), substitute_stock_item_ids: line.substitute_stock_item_ids || [], notes: line.notes });
      }
      const previous = await base44.asServiceRole.entities.ConsumptionRecipe.filter({ unit_id: unitId });
      const sameFamily = previous.filter((row: any) => String(row.service_id || '') === String(input.service_id || '') && String(row.product_id || '') === String(input.product_id || '') && String(row.stage || '') === String(input.stage || '') && String(row.machine_type || '') === String(input.machine_type || ''));
      const nextVersion = String(input.version || Math.max(0, ...sameFamily.map((row: any) => Number.parseInt(row.version || '0', 10) || 0)) + 1);
      const recipe = await base44.asServiceRole.entities.ConsumptionRecipe.create({ unit_id: unitId, name: String(input.name).trim(), service_id: input.service_id, product_id: input.product_id, machine_type: input.machine_type, stage: input.stage, machine_ids: input.machine_ids || [], basis: input.basis, expected_output_quantity: Number(input.expected_output_quantity || 1), waste_tolerance_percent: Number(input.waste_tolerance_percent ?? 5), items: normalizedItems, version: nextVersion, estimated_material_cost: productionMoneyRound(estimatedMaterialCost), approved_by_user_id: user.id, approved_at: now, active: input.active !== false, valid_from: input.valid_from || now, valid_until: input.valid_until });
      if (recipe.active) await deactivatePeers(base44, recipe);
      await base44.asServiceRole.entities.AuditLog.create({ action: 'create', entity_type: 'consumption_recipe', entity_id: recipe.id, item_label: recipe.name, amount: recipe.estimated_material_cost, reason: 'consumption_recipe_version_created', user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: unitId, request_id: requestId, after_data: { version: recipe.version, basis: recipe.basis, items: recipe.items.length }, success: true });
      return Response.json({ recipe, request_id: requestId });
    }

    const recipeId = String(input.recipe_id || '');
    const recipe = recipeId ? await base44.asServiceRole.entities.ConsumptionRecipe.get(recipeId) : null;
    if (!recipe) return Response.json({ error: 'recipe_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, recipe.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });

    if (action === 'activate') {
      const updated = await base44.asServiceRole.entities.ConsumptionRecipe.update(recipe.id, { active: true, valid_from: input.valid_from || now, valid_until: input.valid_until });
      await deactivatePeers(base44, updated);
      await base44.asServiceRole.entities.AuditLog.create({ action: 'activate', entity_type: 'consumption_recipe', entity_id: recipe.id, item_label: recipe.name, reason: String(input.reason || 'recipe_activated'), user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: recipe.unit_id, request_id: requestId, before_data: { active: recipe.active }, after_data: { active: true }, success: true });
      return Response.json({ recipe: updated, request_id: requestId });
    }

    if (action === 'deactivate') {
      if (!String(input.reason || '').trim()) return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
      const updated = await base44.asServiceRole.entities.ConsumptionRecipe.update(recipe.id, { active: false, valid_until: now });
      await base44.asServiceRole.entities.AuditLog.create({ action: 'deactivate', entity_type: 'consumption_recipe', entity_id: recipe.id, item_label: recipe.name, reason: String(input.reason), user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: recipe.unit_id, request_id: requestId, before_data: { active: recipe.active }, after_data: { active: false }, success: true });
      return Response.json({ recipe: updated, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[manage_consumption_recipe:${requestId}]`, error);
    return Response.json({ error: (error as Error)?.message || 'recipe_operation_failed', request_id: requestId }, { status: Number((error as any)?.status || 500) });
  }
});
