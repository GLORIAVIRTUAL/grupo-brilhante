import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { priceGarmentItems } from '../../shared/laundryPricing.js';

const MANAGE_ROLES = new Set(['super_admin', 'admin', 'manager']);
const ACTIVATE_ROLES = new Set(['super_admin', 'admin']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}
function money(value: any) { const n = Number(value || 0); return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100; }
function keyOf(rule: any) { return [rule.unit_id || '*', rule.product_id || '*', rule.service_id || '*', rule.customer_group || '*', rule.priority || '*'].join('|'); }
function overlaps(a: any, b: any) {
  const aStart = a.valid_from ? new Date(a.valid_from).getTime() : Number.NEGATIVE_INFINITY;
  const aEnd = a.valid_until ? new Date(a.valid_until).getTime() : Number.POSITIVE_INFINITY;
  const bStart = b.valid_from ? new Date(b.valid_from).getTime() : Number.NEGATIVE_INFINITY;
  const bEnd = b.valid_until ? new Date(b.valid_until).getTime() : Number.POSITIVE_INFINITY;
  return aStart <= bEnd && bStart <= aEnd;
}
function snapshot(rule: any) {
  return { name: rule.name, unit_id: rule.unit_id, product_id: rule.product_id, service_id: rule.service_id, customer_group: rule.customer_group, priority: rule.priority, base_price: rule.base_price, additional_percent: rule.additional_percent, additional_amount: rule.additional_amount, minimum_price: rule.minimum_price, valid_from: rule.valid_from, valid_until: rule.valid_until, version: rule.version, status: rule.status, active: rule.active, specificity_key: rule.specificity_key };
}
async function version(base44: any, rule: any, user: any, status: string, reason: string, requestId: string, simulation?: any) {
  return base44.asServiceRole.entities.PriceRuleVersion.create({ price_rule_id: rule.id, root_rule_id: rule.parent_rule_id || rule.id, version: Number(rule.version || 1), status, snapshot: snapshot(rule), simulation_result: simulation, change_reason: reason, created_by_user_id: user.id, approved_by_user_id: ['approved', 'active'].includes(status) ? user.id : undefined, created_at_business: new Date().toISOString(), approved_at: ['approved', 'active'].includes(status) ? new Date().toISOString() : undefined, request_id: requestId });
}
async function audit(base44: any, user: any, requestId: string, action: string, rule: any, reason: string, before?: any) {
  return base44.asServiceRole.entities.AuditLog.create({ action, entity_type: 'price_rule', entity_id: rule.id, item_label: rule.name, reason, user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role, unit_id: rule.unit_id, request_id: requestId, before_data: before, after_data: snapshot(rule), domain: 'commercial', severity: action === 'approve' ? 'notice' : 'info', result: 'success', origin: 'web', retention_class: 'standard', occurred_at: new Date().toISOString(), success: true });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_pricing_rules' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!MANAGE_ROLES.has(user.role) && !(user.permissions || []).includes('prices.manage')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const body = await req.json();
    const action = String(body.action || 'list');
    const now = new Date().toISOString();

    if (action === 'list') {
      const [rules, policies] = await Promise.all([base44.asServiceRole.entities.PriceRule.list('-created_date', 5000), base44.asServiceRole.entities.CommercialApprovalPolicy.list('-created_date', 1000)]);
      return Response.json({ rules: rules.filter((rule: any) => canAccessUnit(user, rule.unit_id)), approval_policies: policies.filter((policy: any) => canAccessUnit(user, policy.unit_id)), request_id: requestId });
    }

    if (action === 'create_draft') {
      const unitId = body.unit_id || user.primary_unit_id;
      if (unitId && !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const reason = String(body.change_reason || '').trim();
      if (reason.length < 8 || !String(body.name || '').trim()) return Response.json({ error: 'name_and_reason_required', request_id: requestId }, { status: 422 });
      if (!body.product_id && !body.service_id) return Response.json({ error: 'product_or_service_required', request_id: requestId }, { status: 422 });
      const parent = body.parent_rule_id ? await base44.asServiceRole.entities.PriceRule.get(body.parent_rule_id) : null;
      const data: any = { name: String(body.name).trim(), unit_id: unitId || undefined, product_id: body.product_id || undefined, service_id: body.service_id || undefined, customer_group: body.customer_group || undefined, priority: body.priority || undefined, base_price: money(body.base_price), additional_percent: money(body.additional_percent), additional_amount: money(body.additional_amount), minimum_price: money(body.minimum_price), valid_from: body.valid_from || now, valid_until: body.valid_until || undefined, version: String(Number(parent?.version || 0) + 1), active: false, status: 'draft', parent_rule_id: parent?.parent_rule_id || parent?.id || undefined, supersedes_rule_id: body.supersedes_rule_id || parent?.id || undefined, specificity_key: keyOf({ unit_id: unitId, product_id: body.product_id, service_id: body.service_id, customer_group: body.customer_group, priority: body.priority }), currency: 'BRL', created_by_user_id: user.id, change_reason: reason };
      if (data.base_price < 0 || data.additional_percent < 0 || data.additional_amount < 0 || data.minimum_price < 0) return Response.json({ error: 'negative_price_forbidden', request_id: requestId }, { status: 422 });
      const rule = await base44.asServiceRole.entities.PriceRule.create(data);
      const ruleVersion = await version(base44, rule, user, 'draft', reason, requestId);
      await audit(base44, user, requestId, 'create', rule, reason);
      return Response.json({ price_rule: rule, price_rule_version: ruleVersion, request_id: requestId });
    }

    const rule = await base44.asServiceRole.entities.PriceRule.get(body.price_rule_id);
    if (!rule || !canAccessUnit(user, rule.unit_id)) return Response.json({ error: 'price_rule_not_found', request_id: requestId }, { status: 404 });

    if (action === 'simulate') {
      const [products, services, activeRules, customer] = await Promise.all([base44.asServiceRole.entities.Product.list('name', 2000), base44.asServiceRole.entities.LaundryService.list('name', 2000), base44.asServiceRole.entities.PriceRule.filter({ active: true }, '-valid_from', 5000), body.customer_id ? base44.asServiceRole.entities.Customer.get(body.customer_id).catch(() => null) : Promise.resolve(null)]);
      const productId = body.product_id || rule.product_id;
      const serviceId = body.service_id || rule.service_id;
      if (!productId || !serviceId) return Response.json({ error: 'simulation_product_and_service_required', request_id: requestId }, { status: 422 });
      const synthetic = { ...rule, active: true, valid_from: body.simulation_at || now, valid_until: rule.valid_until };
      const catalog = { products: products.filter((item: any) => item.active !== false), services: services.filter((item: any) => item.active !== false), rules: [...activeRules.filter((item: any) => item.id !== rule.id && item.specificity_key !== rule.specificity_key), synthetic], customerGroup: customer?.customer_group || customer?.billing_agreement_id || body.customer_group || null };
      const result = priceGarmentItems({ items: [{ product_id: productId, qty: Math.max(1, Number(body.quantity || 1)), services: [{ service_id: serviceId, quantity: Math.max(1, Number(body.service_quantity || 1)) }] }], catalog, unitId: rule.unit_id, priority: body.priority || rule.priority || 'normal' });
      const updated = await base44.asServiceRole.entities.PriceRule.update(rule.id, { simulation_snapshot: { ...result, simulated_at: now, simulated_by_user_id: user.id } });
      const ruleVersion = await version(base44, updated, user, 'simulated', String(body.reason || rule.change_reason || 'Simulação de regra'), requestId, result);
      return Response.json({ price_rule: updated, simulation: result, price_rule_version: ruleVersion, request_id: requestId });
    }

    if (action === 'activate') {
      if (!ACTIVATE_ROLES.has(user.role) && !(user.permissions || []).includes('prices.activate')) return Response.json({ error: 'activation_forbidden', request_id: requestId }, { status: 403 });
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'activation_reason_required', request_id: requestId }, { status: 422 });
      if (!rule.simulation_snapshot) return Response.json({ error: 'simulation_required_before_activation', request_id: requestId }, { status: 409 });
      const active = await base44.asServiceRole.entities.PriceRule.filter({ active: true }, '-valid_from', 5000);
      const conflicts = active.filter((candidate: any) => candidate.id !== rule.id && (candidate.specificity_key || keyOf(candidate)) === (rule.specificity_key || keyOf(rule)) && overlaps(candidate, rule));
      if (conflicts.length > 0 && body.retire_conflicts !== true) return Response.json({ error: 'overlapping_price_rule', conflicts: conflicts.map((item: any) => ({ id: item.id, name: item.name, valid_from: item.valid_from, valid_until: item.valid_until })), request_id: requestId }, { status: 409 });
      for (const conflict of conflicts) await base44.asServiceRole.entities.PriceRule.update(conflict.id, { active: false, status: 'retired', retired_at: now, valid_until: rule.valid_from || now });
      const before = snapshot(rule);
      const updated = await base44.asServiceRole.entities.PriceRule.update(rule.id, { active: true, status: new Date(rule.valid_from || now) > new Date() ? 'scheduled' : 'active', approved_by_user_id: user.id, approved_at: now, change_reason: reason });
      const ruleVersion = await version(base44, updated, user, 'active', reason, requestId, updated.simulation_snapshot);
      await audit(base44, user, requestId, 'approve', updated, reason, before);
      return Response.json({ price_rule: updated, retired_conflict_ids: conflicts.map((item: any) => item.id), price_rule_version: ruleVersion, request_id: requestId });
    }

    if (action === 'retire') {
      if (!ACTIVATE_ROLES.has(user.role) && !(user.permissions || []).includes('prices.activate')) return Response.json({ error: 'retirement_forbidden', request_id: requestId }, { status: 403 });
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'retirement_reason_required', request_id: requestId }, { status: 422 });
      const before = snapshot(rule);
      const updated = await base44.asServiceRole.entities.PriceRule.update(rule.id, { active: false, status: 'retired', retired_at: now, valid_until: body.valid_until || now, change_reason: reason });
      await version(base44, updated, user, 'retired', reason, requestId);
      await audit(base44, user, requestId, 'update', updated, reason, before);
      return Response.json({ price_rule: updated, request_id: requestId });
    }

    if (action === 'save_approval_policy') {
      if (!ACTIVATE_ROLES.has(user.role) && !(user.permissions || []).includes('prices.activate')) return Response.json({ error: 'policy_forbidden', request_id: requestId }, { status: 403 });
      const reason = String(body.change_reason || '').trim();
      if (reason.length < 8 || !String(body.role || '').trim()) return Response.json({ error: 'role_and_reason_required', request_id: requestId }, { status: 422 });
      const unitId = body.unit_id || user.primary_unit_id;
      if (unitId && !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const prior = await base44.asServiceRole.entities.CommercialApprovalPolicy.filter({ unit_id: unitId, role: body.role, active: true }, '-version', 100);
      for (const item of prior) await base44.asServiceRole.entities.CommercialApprovalPolicy.update(item.id, { active: false, valid_until: now });
      const policy = await base44.asServiceRole.entities.CommercialApprovalPolicy.create({ name: String(body.name || `Alçada ${body.role}`).trim(), unit_id: unitId, role: body.role, max_discount_percent: Math.max(0, money(body.max_discount_percent)), max_discount_amount: Math.max(0, money(body.max_discount_amount)), max_addition_percent: Math.max(0, money(body.max_addition_percent || 100)), max_courtesy_amount: Math.max(0, money(body.max_courtesy_amount)), requires_reason_above_percent: Math.max(0, money(body.requires_reason_above_percent)), requires_different_approver_above_percent: Math.max(0, money(body.requires_different_approver_above_percent || 10)), require_mfa_above_percent: Math.max(0, money(body.require_mfa_above_percent || 20)), active: true, version: Number(prior[0]?.version || 0) + 1, valid_from: now, created_by_user_id: user.id, approved_by_user_id: user.id, approved_at: now, change_reason: reason });
      await base44.asServiceRole.entities.AuditLog.create({ action: 'approve', entity_type: 'price_rule', entity_id: policy.id, item_label: policy.name, reason, user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role, unit_id: unitId, request_id: requestId, after_data: policy, domain: 'commercial', severity: 'notice', result: 'success', occurred_at: now, success: true });
      return Response.json({ approval_policy: policy, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 422 });
  } catch (error: any) {
    const validation = new Set(['product_not_found', 'service_not_found', 'service_not_compatible']);
    return Response.json({ error: error?.message || 'pricing_rule_failed', details: error?.details, request_id: requestId }, { status: validation.has(error?.message) ? 422 : 500 });
  }
});
