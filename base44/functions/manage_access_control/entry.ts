import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { ROLE_DEFINITIONS, PERMISSION_CATALOG, VALID_ROLES, VALID_PERMISSIONS, normalizeLegacyRole, effectivePermissions } from '../../shared/accessGovernance.js';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

const ADMIN_ROLES = new Set(['super_admin', 'admin']);
const POLICY_ROLES = new Set(['super_admin']);

function canManageUsers(actor: any) {
  return ADMIN_ROLES.has(actor?.role) || (actor?.permissions || []).includes('users.manage');
}

function canManageTarget(actor: any, target: any) {
  if (actor.role === 'super_admin') return true;
  if (target?.role === 'super_admin') return false;
  if (actor.role === 'admin') return true;
  if (!(actor.permissions || []).includes('users.manage_limited')) return false;
  const actorUnits = new Set([actor.primary_unit_id, ...(actor.allowed_unit_ids || [])].filter(Boolean));
  return [target?.primary_unit_id, ...(target?.allowed_unit_ids || [])].filter(Boolean).every((unitId) => actorUnits.has(unitId));
}

function normalizePermissions(values: any) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(String).filter((value) => VALID_PERMISSIONS.has(value)))];
}

async function validateUnits(base44: any, ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const units = await base44.asServiceRole.entities.Unit.list('name', 1000);
  const available = new Set(units.map((unit: any) => unit.id));
  if (uniqueIds.some((id) => !available.has(id))) throw new Error('invalid_unit_scope');
  return uniqueIds;
}

async function audit(base44: any, actor: any, requestId: string, payload: any) {
  return base44.asServiceRole.entities.AuditLog.create({
    action: 'permission_change',
    entity_type: 'user',
    entity_id: payload.entity_id,
    item_label: payload.item_label,
    reason: payload.reason,
    user_email: actor.email,
    user_name: actor.full_name || actor.display_name,
    user_role: actor.role,
    unit_id: payload.unit_id || actor.primary_unit_id,
    request_id: requestId,
    before_data: payload.before_data,
    after_data: payload.after_data,
    metadata: payload.metadata,
    success: true,
  });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const principal = await authorizeUserOrInternal(base44, req, body, {
      allowInternal: false,
      source: 'manage_access_control',
    });
    const actor = principal.user;
    if (!canManageUsers(actor)) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });

    const action = String(body.action || 'catalog');
    const now = new Date().toISOString();

    if (action === 'catalog') {
      const policies = await base44.asServiceRole.entities.AccessPolicy.filter({ status: 'active' }, '-version', 1000).catch(() => []);
      return Response.json({
        roles: Object.entries(ROLE_DEFINITIONS).map(([code, definition]: any) => ({ code, ...definition })),
        permissions: PERMISSION_CATALOG,
        active_policies: policies,
        request_id: requestId,
      });
    }

    if (action === 'update_user') {
      const target = await base44.asServiceRole.entities.User.get(body.user_id);
      if (!target || !canManageTarget(actor, target)) return Response.json({ error: 'user_not_found_or_forbidden', request_id: requestId }, { status: 404 });
      if (target.id === actor.id && body.role && body.role !== target.role) return Response.json({ error: 'self_role_change_forbidden', request_id: requestId }, { status: 409 });

      const role = normalizeLegacyRole(body.role || target.role);
      if (!VALID_ROLES.has(role)) return Response.json({ error: 'invalid_role', request_id: requestId }, { status: 422 });
      if (role === 'super_admin' && actor.role !== 'super_admin') return Response.json({ error: 'super_admin_required', request_id: requestId }, { status: 403 });
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'access_change_reason_required', request_id: requestId }, { status: 422 });

      const primaryUnitId = body.primary_unit_id ?? target.primary_unit_id;
      const unitIds = await validateUnits(base44, [primaryUnitId, ...(body.allowed_unit_ids ?? target.allowed_unit_ids ?? [])]);
      const allowedUnitIds = unitIds.filter((id) => id !== primaryUnitId);
      const permissions = normalizePermissions(body.permissions ?? target.permissions ?? []);
      const roleRequiresMfa = ROLE_DEFINITIONS[role]?.mfaRequired === true;
      const requireMfa = roleRequiresMfa || body.require_mfa === true;

      const patch = {
        role,
        primary_unit_id: primaryUnitId,
        allowed_unit_ids: allowedUnitIds,
        permissions,
        require_mfa: requireMfa,
        mfa_status: requireMfa
          ? (['enrolled', 'verified'].includes(target.mfa_status) ? target.mfa_status : 'required')
          : 'not_required',
        display_name: body.display_name ?? target.display_name,
        employment_identifier: body.employment_identifier ?? target.employment_identifier,
        job_title: body.job_title ?? target.job_title,
        access_revision: Number(target.access_revision || 0) + 1,
        access_reviewed_at: now,
        access_reviewed_by_user_id: actor.id,
        access_change_reason: reason,
      };
      const updated = await base44.asServiceRole.entities.User.update(target.id, patch);
      await audit(base44, actor, requestId, {
        entity_id: target.id,
        item_label: target.email || target.display_name || target.id,
        unit_id: primaryUnitId,
        reason,
        before_data: { role: target.role, primary_unit_id: target.primary_unit_id, allowed_unit_ids: target.allowed_unit_ids, permissions: target.permissions, require_mfa: target.require_mfa, status: target.status },
        after_data: patch,
        metadata: { operation: 'update_user_access' },
      });
      return Response.json({ user: updated, effective_permissions: effectivePermissions(updated), request_id: requestId });
    }

    if (action === 'set_status') {
      const target = await base44.asServiceRole.entities.User.get(body.user_id);
      if (!target || !canManageTarget(actor, target)) return Response.json({ error: 'user_not_found_or_forbidden', request_id: requestId }, { status: 404 });
      if (target.id === actor.id) return Response.json({ error: 'self_status_change_forbidden', request_id: requestId }, { status: 409 });
      const status = String(body.status || '');
      if (!['active', 'suspended', 'disabled'].includes(status)) return Response.json({ error: 'invalid_status', request_id: requestId }, { status: 422 });
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'status_reason_required', request_id: requestId }, { status: 422 });
      if (['suspended', 'disabled'].includes(status)) {
        const admins = await base44.asServiceRole.entities.User.filter({ status: 'active' }, '-created_date', 1000);
        const activeAdmins = admins.filter((user: any) => ['super_admin', 'admin'].includes(normalizeLegacyRole(user.role)));
        if (activeAdmins.length <= 1 && activeAdmins.some((user: any) => user.id === target.id)) return Response.json({ error: 'last_active_admin_cannot_be_disabled', request_id: requestId }, { status: 409 });
      }
      const patch: any = {
        status,
        access_revision: Number(target.access_revision || 0) + 1,
        access_reviewed_at: now,
        access_reviewed_by_user_id: actor.id,
        access_change_reason: reason,
      };
      if (status === 'active') {
        patch.suspended_at = undefined;
        patch.suspended_by_user_id = undefined;
        patch.suspension_reason = undefined;
      } else {
        patch.suspended_at = now;
        patch.suspended_by_user_id = actor.id;
        patch.suspension_reason = reason;
        patch.session_revoked_after = now;
      }
      const updated = await base44.asServiceRole.entities.User.update(target.id, patch);
      await base44.asServiceRole.entities.UserSessionEvent.create({
        user_id: target.id,
        unit_id: target.primary_unit_id,
        event_type: status === 'active' ? 'login_observed' : 'account_suspended',
        provider: 'application',
        verified: true,
        occurred_at: now,
        recorded_by_user_id: actor.id,
        reason,
      });
      await audit(base44, actor, requestId, {
        entity_id: target.id,
        item_label: target.email || target.id,
        unit_id: target.primary_unit_id,
        reason,
        before_data: { status: target.status },
        after_data: { status },
        metadata: { operation: 'set_user_status' },
      });
      return Response.json({ user: updated, request_id: requestId });
    }

    if (action === 'record_mfa_status') {
      const target = await base44.asServiceRole.entities.User.get(body.user_id);
      if (!target || !canManageTarget(actor, target)) return Response.json({ error: 'user_not_found_or_forbidden', request_id: requestId }, { status: 404 });
      const status = String(body.mfa_status || '');
      if (!['required', 'enrolled', 'verified', 'recovery_required'].includes(status)) return Response.json({ error: 'invalid_mfa_status', request_id: requestId }, { status: 422 });
      const provider = String(body.mfa_provider || 'not_configured');
      if (!['base44', 'external_idp', 'not_configured'].includes(provider)) return Response.json({ error: 'invalid_mfa_provider', request_id: requestId }, { status: 422 });
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'mfa_reason_required', request_id: requestId }, { status: 422 });
      const patch: any = {
        require_mfa: true,
        mfa_status: status,
        mfa_provider: provider,
        access_revision: Number(target.access_revision || 0) + 1,
        access_reviewed_at: now,
        access_reviewed_by_user_id: actor.id,
        access_change_reason: reason,
      };
      if (['enrolled', 'verified'].includes(status)) patch.mfa_enrolled_at = target.mfa_enrolled_at || now;
      if (status === 'verified') patch.mfa_verified_at = now;
      const updated = await base44.asServiceRole.entities.User.update(target.id, patch);
      await base44.asServiceRole.entities.UserSessionEvent.create({
        user_id: target.id,
        unit_id: target.primary_unit_id,
        event_type: status === 'verified' ? 'step_up_verified' : 'mfa_enrollment_confirmed',
        provider: provider === 'not_configured' ? 'application' : provider,
        verified: status === 'verified',
        occurred_at: now,
        recorded_by_user_id: actor.id,
        reason,
        metadata: { provider_attestation_only: true },
      });
      await audit(base44, actor, requestId, {
        entity_id: target.id,
        item_label: target.email || target.id,
        unit_id: target.primary_unit_id,
        reason,
        before_data: { mfa_status: target.mfa_status, mfa_provider: target.mfa_provider },
        after_data: patch,
        metadata: { operation: 'record_mfa_status', provider_attestation_only: true },
      });
      return Response.json({ user: updated, request_id: requestId });
    }

    if (action === 'save_policy') {
      if (!POLICY_ROLES.has(actor.role) && !(actor.permissions || []).includes('users.manage')) return Response.json({ error: 'super_admin_required', request_id: requestId }, { status: 403 });
      const role = normalizeLegacyRole(body.role);
      const reason = String(body.change_reason || '').trim();
      if (!VALID_ROLES.has(role) || reason.length < 8) return Response.json({ error: 'valid_role_and_reason_required', request_id: requestId }, { status: 422 });
      const permissions = normalizePermissions(body.permissions || []);
      const deniedPermissions = normalizePermissions(body.denied_permissions || []);
      const criticalPermissions = normalizePermissions(body.critical_permissions || []).filter((permission) => PERMISSION_CATALOG.find((entry) => entry.code === permission)?.critical);
      const existing = body.policy_id ? await base44.asServiceRole.entities.AccessPolicy.get(body.policy_id) : null;
      const next = {
        name: String(body.name || `${ROLE_DEFINITIONS[role].label} v${Number(existing?.version || 0) + 1}`).trim(),
        code: String(body.code || `ROLE-${role}`).trim().toUpperCase(),
        unit_id: body.unit_id || undefined,
        role,
        permissions,
        denied_permissions: deniedPermissions,
        critical_permissions: criticalPermissions,
        require_mfa: body.require_mfa === true || ROLE_DEFINITIONS[role].mfaRequired === true,
        step_up_max_age_minutes: Math.max(1, Math.min(120, Number(body.step_up_max_age_minutes || 15))),
        session_max_age_minutes: Math.max(15, Math.min(10080, Number(body.session_max_age_minutes || 720))),
        allowed_weekdays: Array.isArray(body.allowed_weekdays) ? body.allowed_weekdays.filter((day: any) => Number.isInteger(day) && day >= 0 && day <= 6) : [0, 1, 2, 3, 4, 5, 6],
        allowed_start_time: body.allowed_start_time,
        allowed_end_time: body.allowed_end_time,
        segregation_rules: Array.isArray(body.segregation_rules) ? body.segregation_rules : [],
        version: Number(existing?.version || 0) + 1,
        status: body.status === 'active' ? 'active' : 'draft',
        valid_from: body.valid_from || now,
        valid_until: body.valid_until,
        created_by_user_id: actor.id,
        approved_by_user_id: body.status === 'active' ? actor.id : undefined,
        approved_at: body.status === 'active' ? now : undefined,
        change_reason: reason,
      };
      if (next.unit_id) await validateUnits(base44, [next.unit_id]);
      if (next.status === 'active') {
        const active = await base44.asServiceRole.entities.AccessPolicy.filter({ role, status: 'active' }, '-version', 1000);
        for (const policy of active.filter((policy: any) => (policy.unit_id || '') === (next.unit_id || ''))) {
          await base44.asServiceRole.entities.AccessPolicy.update(policy.id, { status: 'retired', valid_until: now });
        }
      }
      const policy = await base44.asServiceRole.entities.AccessPolicy.create(next);
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'permission_change', entity_type: 'user', entity_id: policy.id, item_label: policy.name,
        reason, user_email: actor.email, user_name: actor.full_name || actor.display_name, user_role: actor.role,
        unit_id: next.unit_id, request_id: requestId, after_data: policy, metadata: { operation: 'save_access_policy', role }, success: true,
      });
      return Response.json({ access_policy: policy, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 422 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const validation = new Set(['invalid_unit_scope']);
    const status = validation.has(error?.message) ? 422 : 500;
    return Response.json({ error: error?.message || 'access_control_failed', request_id: requestId }, { status });
  }
});
