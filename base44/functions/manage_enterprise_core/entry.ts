import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';
import { normalizeEnterpriseCode, sanitizeEnterprisePatch, validateTaxId } from '../../shared/enterpriseCore.js';

const ADMIN_ACTIONS = new Set([
  'create_group',
  'create_legal_entity',
  'update_legal_entity',
  'link_unit',
  'save_company_grant',
  'revoke_company_grant',
]);
const CHILD_CONFIG = {
  save_cost_center: {
    entity: 'CostCenter',
    permission: 'cost_centers.manage',
    type: 'cost_center',
    fields: ['unit_id', 'parent_id', 'code', 'name', 'description', 'cost_center_type', 'status', 'valid_from', 'valid_until', 'manager_user_id', 'metadata'],
  },
  save_bank_account: {
    entity: 'BankAccount',
    permission: 'bank_accounts.manage',
    type: 'bank_account',
    fields: ['unit_id', 'code', 'name', 'bank_code', 'bank_name', 'branch_masked', 'account_masked', 'account_type', 'pix_key_type', 'pix_key_masked', 'currency', 'status', 'integration_provider', 'integration_status', 'metadata'],
  },
  save_warehouse: {
    entity: 'Warehouse',
    permission: 'companies.manage',
    type: 'warehouse',
    fields: ['unit_id', 'code', 'name', 'warehouse_type', 'status', 'allows_negative_stock', 'address', 'manager_user_id', 'metadata'],
  },
};

function hasPermission(principal: any, permission: string) {
  return principal?.permissions?.includes('*') || principal?.permissions?.includes(permission);
}

function requiredText(value: any, field: string, min = 1, max = 200) {
  const normalized = String(value || '').trim();
  if (normalized.length < min || normalized.length > max) throw new Error(`invalid_${field}`);
  return normalized;
}

function optionalText(value: any, max = 300) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim();
  if (normalized.length > max) throw new Error('text_too_long');
  return normalized || undefined;
}

function requireReason(value: any) {
  return requiredText(value, 'reason', 8, 500);
}

async function audit(base44: any, principal: any, requestId: string, payload: any) {
  await base44.asServiceRole.entities.AuditLog.create({
    action: payload.action || 'update',
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    item_label: payload.item_label,
    reason: payload.reason,
    user_email: principal.user?.email,
    user_name: principal.user?.full_name || principal.user?.display_name,
    user_role: principal.role,
    legal_entity_id: payload.legal_entity_id,
    unit_id: payload.unit_id || principal.user?.primary_unit_id,
    request_id: requestId,
    before_data: payload.before_data,
    after_data: payload.after_data,
    metadata: payload.metadata,
    domain: 'security',
    severity: 'notice',
    result: 'success',
    origin: 'api',
    retention_class: 'security',
    occurred_at: new Date().toISOString(),
    success: true,
  });
}

async function ensureUnique(base44: any, entityName: string, criteria: any, currentId?: string) {
  const rows = await base44.asServiceRole.entities[entityName].filter(criteria, '-created_date', 20);
  if (rows.some((row: any) => row.id !== currentId)) throw new Error('duplicate_record');
}

async function loadScopedOverview(base44: any, principal: any) {
  const canViewAll = principal.role === 'super_admin' || principal.permissions.includes('companies.view_all');
  const legalIds = new Set(principal.legalEntityIds || []);
  const allLegalEntities = await base44.asServiceRole.entities.LegalEntity.list('code', 1000);
  const legalEntities = canViewAll ? allLegalEntities : allLegalEntities.filter((row: any) => legalIds.has(row.id));
  const visibleIds = new Set(legalEntities.map((row: any) => row.id));
  const [groups, units, costCenters, bankAccounts, warehouses, grants] = await Promise.all([
    base44.asServiceRole.entities.BusinessGroup.list('name', 1000),
    base44.asServiceRole.entities.Unit.list('name', 1000),
    base44.asServiceRole.entities.CostCenter.list('code', 1000),
    base44.asServiceRole.entities.BankAccount.list('code', 1000),
    base44.asServiceRole.entities.Warehouse.list('code', 1000),
    base44.asServiceRole.entities.CompanyAccessGrant.filter({ status: 'active' }, '-valid_from', 1000).catch(() => []),
  ]);
  const groupIds = new Set(legalEntities.map((row: any) => row.group_id));
  const canBootstrap = hasPermission(principal, 'companies.manage') && legalEntities.length === 0;
  return {
    groups: canViewAll || canBootstrap ? groups : groups.filter((row: any) => groupIds.has(row.id)),
    legal_entities: legalEntities,
    units: units.filter((row: any) => visibleIds.has(row.legal_entity_id)),
    unlinked_units: hasPermission(principal, 'companies.manage') ? units.filter((row: any) => !row.legal_entity_id) : [],
    cost_centers: costCenters.filter((row: any) => visibleIds.has(row.legal_entity_id)),
    bank_accounts: bankAccounts.filter((row: any) => visibleIds.has(row.legal_entity_id)),
    warehouses: warehouses.filter((row: any) => visibleIds.has(row.legal_entity_id)),
    company_grants: hasPermission(principal, 'users.manage')
      ? grants.filter((row: any) => canViewAll || visibleIds.has(row.legal_entity_id))
      : grants.filter((row: any) => row.user_id === principal.user.id),
    scope: { legal_entity_ids: [...visibleIds], unit_ids: principal.unitIds || [], can_view_all: canViewAll },
  };
}

async function saveChild(base44: any, principal: any, body: any, config: any, requestId: string) {
  if (!hasPermission(principal, config.permission)) throw Object.assign(new Error('permission_denied'), { status: 403 });
  const legalEntityId = requiredText(body.legal_entity_id, 'legal_entity_id', 1, 100);
  const canViewAll = principal.role === 'super_admin' || principal.permissions.includes('companies.view_all');
  if (!canViewAll && !principal.legalEntityIds.includes(legalEntityId)) throw Object.assign(new Error('legal_entity_scope_denied'), { status: 403 });
  const legalEntity = await base44.asServiceRole.entities.LegalEntity.get(legalEntityId).catch(() => null);
  if (!legalEntity) throw Object.assign(new Error('legal_entity_not_found'), { status: 404 });
  if (config.entity === 'BankAccount' && ['branch', 'account', 'pix_key', 'api_key', 'secret'].some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new Error('sensitive_bank_data_forbidden');
  }
  const id = optionalText(body.id, 100);
  const existing = id ? await base44.asServiceRole.entities[config.entity].get(id).catch(() => null) : null;
  if (id && (!existing || existing.legal_entity_id !== legalEntityId)) throw Object.assign(new Error('record_not_found'), { status: 404 });
  const reason = requireReason(body.reason);
  const patch: any = sanitizeEnterprisePatch(body, config.fields);
  patch.legal_entity_id = legalEntityId;
  patch.code = normalizeEnterpriseCode(body.code || existing?.code || body.name);
  if (!patch.code) throw new Error('invalid_code');
  if (body.unit_id) {
    const unit = await base44.asServiceRole.entities.Unit.get(body.unit_id).catch(() => null);
    if (!unit || unit.legal_entity_id !== legalEntityId) throw new Error('unit_company_mismatch');
  }
  if (config.entity === 'BankAccount') {
    if (body.integration_status === 'production') throw new Error('production_activation_requires_separate_approval');
    patch.integration_status = body.integration_status || existing?.integration_status || 'disabled';
  }
  await ensureUnique(base44, config.entity, { legal_entity_id: legalEntityId, code: patch.code }, id);
  patch.updated_by_user_id = principal.user.id;
  let record;
  if (existing) {
    record = await base44.asServiceRole.entities[config.entity].update(existing.id, patch);
  } else {
    record = await base44.asServiceRole.entities[config.entity].create({ ...patch, created_by_user_id: principal.user.id });
  }
  await audit(base44, principal, requestId, {
    action: existing ? 'update' : 'create',
    entity_type: config.type,
    entity_id: record.id,
    item_label: record.name || record.code,
    reason,
    legal_entity_id: legalEntityId,
    unit_id: record.unit_id,
    before_data: existing || undefined,
    after_data: record,
    metadata: { operation: body.action },
  });
  return record;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'overview');
    const config = CHILD_CONFIG[action];
    const requiredPermission = config?.permission || (ADMIN_ACTIONS.has(action) ? 'companies.manage' : 'companies.view');
    const legalEntityId = body.legal_entity_id || (action === 'update_legal_entity' ? body.id : null);
    const principal = await authorizeUserOrInternal(base44, req, body, {
      allowInternal: false,
      permission: requiredPermission,
      legalEntityId,
      requireMfa: ADMIN_ACTIONS.has(action) || Boolean(config),
      source: 'manage_enterprise_core',
    });
    const now = new Date().toISOString();

    if (action === 'overview') {
      return Response.json({ ...(await loadScopedOverview(base44, principal)), request_id: requestId });
    }

    if (action === 'create_group') {
      const reason = requireReason(body.reason);
      const code = normalizeEnterpriseCode(body.code || body.name);
      const name = requiredText(body.name, 'name', 2, 160);
      if (!code) throw new Error('invalid_code');
      await ensureUnique(base44, 'BusinessGroup', { code });
      const group = await base44.asServiceRole.entities.BusinessGroup.create({
        name,
        trade_name: optionalText(body.trade_name, 160) || name,
        code,
        status: body.status === 'active' ? 'active' : 'draft',
        default_currency: 'BRL',
        timezone: optionalText(body.timezone, 100) || 'America/Sao_Paulo',
        branding: body.branding || {},
        created_by_user_id: principal.user.id,
        updated_by_user_id: principal.user.id,
      });
      await audit(base44, principal, requestId, { action: 'create', entity_type: 'business_group', entity_id: group.id, item_label: group.name, reason, after_data: group, metadata: { operation: action } });
      return Response.json({ business_group: group, request_id: requestId }, { status: 201 });
    }

    if (action === 'create_legal_entity') {
      const reason = requireReason(body.reason);
      const group = await base44.asServiceRole.entities.BusinessGroup.get(requiredText(body.group_id, 'group_id', 1, 100)).catch(() => null);
      if (!group) throw Object.assign(new Error('business_group_not_found'), { status: 404 });
      const taxId = validateTaxId(body.tax_id, 'company');
      if (!taxId.valid) throw new Error('invalid_cnpj');
      const code = normalizeEnterpriseCode(body.code || body.trade_name || body.legal_name);
      if (!code) throw new Error('invalid_code');
      await ensureUnique(base44, 'LegalEntity', { tax_id: taxId.normalized });
      await ensureUnique(base44, 'LegalEntity', { group_id: group.id, code });
      const legalEntity = await base44.asServiceRole.entities.LegalEntity.create({
        group_id: group.id,
        code,
        legal_name: requiredText(body.legal_name, 'legal_name', 2, 200),
        trade_name: requiredText(body.trade_name || body.legal_name, 'trade_name', 2, 160),
        tax_id: taxId.normalized,
        state_registration: optionalText(body.state_registration, 40),
        municipal_registration: optionalText(body.municipal_registration, 40),
        tax_regime: body.tax_regime,
        status: 'draft',
        implementation_status: 'not_started',
        address: body.address || {},
        billing_email: optionalText(body.billing_email, 200),
        finance_email: optionalText(body.finance_email, 200),
        phone: optionalText(body.phone, 40),
        website_url: optionalText(body.website_url, 300),
        created_by_user_id: principal.user.id,
        updated_by_user_id: principal.user.id,
      });
      if (!principal.user.primary_legal_entity_id) {
        await base44.asServiceRole.entities.User.update(principal.user.id, {
          primary_legal_entity_id: legalEntity.id,
          access_revision: Number(principal.user.access_revision || 0) + 1,
          access_change_reason: reason,
          access_reviewed_at: now,
          access_reviewed_by_user_id: principal.user.id,
        });
      }
      await audit(base44, principal, requestId, { action: 'create', entity_type: 'legal_entity', entity_id: legalEntity.id, item_label: legalEntity.trade_name, reason, legal_entity_id: legalEntity.id, after_data: legalEntity, metadata: { operation: action, bootstrap_scope_assigned: !principal.user.primary_legal_entity_id } });
      return Response.json({ legal_entity: legalEntity, request_id: requestId }, { status: 201 });
    }

    if (action === 'update_legal_entity') {
      const reason = requireReason(body.reason);
      const existing = await base44.asServiceRole.entities.LegalEntity.get(requiredText(body.id, 'id', 1, 100)).catch(() => null);
      if (!existing) throw Object.assign(new Error('legal_entity_not_found'), { status: 404 });
      const patch: any = sanitizeEnterprisePatch(body, ['legal_name', 'trade_name', 'state_registration', 'municipal_registration', 'tax_regime', 'status', 'implementation_status', 'address', 'billing_email', 'finance_email', 'phone', 'website_url', 'default_cost_center_id', 'default_bank_account_id', 'default_warehouse_id', 'fiscal_profile_id', 'metadata']);
      if (body.tax_id) {
        const taxId = validateTaxId(body.tax_id, 'company');
        if (!taxId.valid) throw new Error('invalid_cnpj');
        await ensureUnique(base44, 'LegalEntity', { tax_id: taxId.normalized }, existing.id);
        patch.tax_id = taxId.normalized;
      }
      if (body.code) {
        patch.code = normalizeEnterpriseCode(body.code);
        await ensureUnique(base44, 'LegalEntity', { group_id: existing.group_id, code: patch.code }, existing.id);
      }
      if (body.implementation_status === 'live' || body.status === 'active') throw new Error('go_live_requires_separate_approval');
      patch.updated_by_user_id = principal.user.id;
      const updated = await base44.asServiceRole.entities.LegalEntity.update(existing.id, patch);
      await audit(base44, principal, requestId, { action: 'update', entity_type: 'legal_entity', entity_id: updated.id, item_label: updated.trade_name, reason, legal_entity_id: updated.id, before_data: existing, after_data: updated, metadata: { operation: action } });
      return Response.json({ legal_entity: updated, request_id: requestId });
    }

    if (config) {
      const record = await saveChild(base44, principal, body, config, requestId);
      return Response.json({ record, request_id: requestId }, { status: body.id ? 200 : 201 });
    }

    if (action === 'link_unit') {
      const reason = requireReason(body.reason);
      const legalId = requiredText(body.legal_entity_id, 'legal_entity_id', 1, 100);
      const unit = await base44.asServiceRole.entities.Unit.get(requiredText(body.unit_id, 'unit_id', 1, 100)).catch(() => null);
      if (!unit) throw Object.assign(new Error('unit_not_found'), { status: 404 });
      const code = normalizeEnterpriseCode(body.code || unit.code || unit.name);
      await ensureUnique(base44, 'Unit', { legal_entity_id: legalId, code }, unit.id);
      const patch = {
        legal_entity_id: legalId,
        code,
        unit_type: body.unit_type || unit.unit_type || 'branch',
        cost_center_id: body.cost_center_id || unit.cost_center_id,
        default_warehouse_id: body.default_warehouse_id || unit.default_warehouse_id,
        structured_address: body.structured_address || unit.structured_address,
        updated_by_user_id: principal.user.id,
      };
      const updated = await base44.asServiceRole.entities.Unit.update(unit.id, patch);
      await audit(base44, principal, requestId, { action: 'update', entity_type: 'unit', entity_id: updated.id, item_label: updated.name, reason, legal_entity_id: legalId, unit_id: updated.id, before_data: unit, after_data: updated, metadata: { operation: action } });
      return Response.json({ unit: updated, request_id: requestId });
    }

    if (action === 'save_company_grant') {
      if (!hasPermission(principal, 'users.manage')) throw Object.assign(new Error('permission_denied'), { status: 403 });
      const reason = requireReason(body.reason);
      const target = await base44.asServiceRole.entities.User.get(requiredText(body.user_id, 'user_id', 1, 100)).catch(() => null);
      if (!target) throw Object.assign(new Error('user_not_found'), { status: 404 });
      const legalId = requiredText(body.legal_entity_id, 'legal_entity_id', 1, 100);
      const unitIds = [...new Set((Array.isArray(body.unit_ids) ? body.unit_ids : []).map(String).filter(Boolean))];
      for (const unitId of unitIds) {
        const unit = await base44.asServiceRole.entities.Unit.get(unitId).catch(() => null);
        if (!unit || unit.legal_entity_id !== legalId) throw new Error('unit_company_mismatch');
      }
      const requestedPermissions = [...new Set((Array.isArray(body.permissions) ? body.permissions : []).map(String))];
      if (principal.role !== 'super_admin' && requestedPermissions.some((permission) => ['companies.view_all', 'companies.manage', 'users.manage'].includes(permission))) throw Object.assign(new Error('privilege_escalation_forbidden'), { status: 403 });
      const current = await base44.asServiceRole.entities.CompanyAccessGrant.filter({ user_id: target.id, legal_entity_id: legalId, status: 'active' }, '-valid_from', 20);
      for (const grant of current) await base44.asServiceRole.entities.CompanyAccessGrant.update(grant.id, { status: 'revoked', revoked_by_user_id: principal.user.id, revoked_at: now, reason: `Substituído: ${reason}` });
      const grant = await base44.asServiceRole.entities.CompanyAccessGrant.create({
        user_id: target.id,
        legal_entity_id: legalId,
        unit_ids: unitIds,
        permissions: requestedPermissions,
        denied_permissions: [...new Set((Array.isArray(body.denied_permissions) ? body.denied_permissions : []).map(String))],
        status: 'active',
        valid_from: body.valid_from || now,
        valid_until: body.valid_until,
        reason,
        approved_by_user_id: principal.user.id,
        approved_at: now,
      });
      await base44.asServiceRole.entities.User.update(target.id, { access_revision: Number(target.access_revision || 0) + 1, access_reviewed_at: now, access_reviewed_by_user_id: principal.user.id, access_change_reason: reason });
      await audit(base44, principal, requestId, { action: 'permission_change', entity_type: 'company_access_grant', entity_id: grant.id, item_label: target.email || target.id, reason, legal_entity_id: legalId, after_data: grant, metadata: { operation: action, target_user_id: target.id } });
      return Response.json({ company_access_grant: grant, request_id: requestId }, { status: 201 });
    }

    if (action === 'revoke_company_grant') {
      if (!hasPermission(principal, 'users.manage')) throw Object.assign(new Error('permission_denied'), { status: 403 });
      const reason = requireReason(body.reason);
      const grant = await base44.asServiceRole.entities.CompanyAccessGrant.get(requiredText(body.grant_id, 'grant_id', 1, 100)).catch(() => null);
      if (!grant || grant.status !== 'active') throw Object.assign(new Error('grant_not_found'), { status: 404 });
      const updated = await base44.asServiceRole.entities.CompanyAccessGrant.update(grant.id, { status: 'revoked', revoked_by_user_id: principal.user.id, revoked_at: now, reason });
      const target = await base44.asServiceRole.entities.User.get(grant.user_id).catch(() => null);
      if (target) await base44.asServiceRole.entities.User.update(target.id, { access_revision: Number(target.access_revision || 0) + 1, access_reviewed_at: now, access_reviewed_by_user_id: principal.user.id, access_change_reason: reason });
      await audit(base44, principal, requestId, { action: 'permission_change', entity_type: 'company_access_grant', entity_id: updated.id, item_label: target?.email || grant.user_id, reason, legal_entity_id: grant.legal_entity_id, before_data: grant, after_data: updated, metadata: { operation: action } });
      return Response.json({ company_access_grant: updated, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 422 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const status = Number(error?.status) || (String(error?.message || '').includes('not_found') ? 404 : 422);
    const safe = status >= 500 ? 'enterprise_core_failed' : (error?.message || 'enterprise_core_failed');
    return Response.json({ error: safe, request_id: requestId }, { status });
  }
});
