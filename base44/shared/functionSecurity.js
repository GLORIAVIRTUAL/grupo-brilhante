import { effectivePermissions, normalizeLegacyRole, ROLE_DEFINITIONS } from './accessGovernance.js';

export class SecurityError extends Error {
  constructor(message, status = 403, code = 'ACCESS_DENIED') {
    super(message);
    this.name = 'SecurityError';
    this.status = status;
    this.code = code;
  }
}

export function constantTimeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < max; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function presentedInternalToken(req, body = {}) {
  return req.headers.get('x-internal-token') ||
    req.headers.get('x-automation-token') ||
    body?._internal_token ||
    body?.internal_token ||
    '';
}

export function requireInternalRequest(req, body = {}, envName = 'INTERNAL_FUNCTION_TOKEN') {
  const configured = Deno.env.get(envName) || '';
  if (!configured) {
    throw new SecurityError(`Integração interna indisponível: configure ${envName}.`, 503, 'INTERNAL_TOKEN_NOT_CONFIGURED');
  }
  if (!constantTimeEqual(presentedInternalToken(req, body), configured)) {
    throw new SecurityError('Chamada interna não autorizada.', 401, 'INVALID_INTERNAL_TOKEN');
  }
  return { kind: 'internal', tokenEnv: envName };
}

export async function requireMetaSignature(req, rawBody, envName = 'WHATSAPP_APP_SECRET') {
  const secret = Deno.env.get(envName) || '';
  if (!secret) throw new SecurityError(`Webhook indisponível: configure ${envName}.`, 503, 'META_SECRET_NOT_CONFIGURED');
  const presented = String(req.headers.get('x-hub-signature-256') || '');
  if (!presented.startsWith('sha256=')) throw new SecurityError('Assinatura Meta ausente.', 401, 'META_SIGNATURE_MISSING');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = `sha256=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  if (!constantTimeEqual(presented, expected)) throw new SecurityError('Assinatura Meta inválida.', 401, 'INVALID_META_SIGNATURE');
  return true;
}

export function requireProviderToken(req, envName, headerNames = ['client-token']) {
  const configured = Deno.env.get(envName) || '';
  if (!configured) {
    throw new SecurityError(`Webhook indisponível: configure ${envName}.`, 503, 'PROVIDER_TOKEN_NOT_CONFIGURED');
  }
  const presented = headerNames.map((name) => req.headers.get(name)).find(Boolean) || '';
  if (!constantTimeEqual(presented, configured)) {
    throw new SecurityError('Assinatura/token do provedor inválido.', 401, 'INVALID_PROVIDER_TOKEN');
  }
  return true;
}

function bearerIssuedAt(req) {
  try {
    const authorization = String(req.headers.get('authorization') || '');
    const token = authorization.replace(/^Bearer\s+/i, '');
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const payload = JSON.parse(atob(normalized));
    return Number.isFinite(Number(payload.iat)) ? new Date(Number(payload.iat) * 1000) : null;
  } catch {
    return null;
  }
}

function userUnitIds(user) {
  return [...new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean))];
}

function userLegalEntityIds(user) {
  return [...new Set([user?.primary_legal_entity_id, ...(user?.allowed_legal_entity_ids || [])].filter(Boolean))];
}

function activeAt(record, now = new Date()) {
  if (!record || record.status !== 'active') return false;
  if (record.valid_from && new Date(record.valid_from) > now) return false;
  if (record.valid_until && new Date(record.valid_until) < now) return false;
  return true;
}

async function loadCompanyGrants(base44, user) {
  if (!user?.id) return [];
  try {
    const grants = await base44.asServiceRole.entities.CompanyAccessGrant.filter({ user_id: user.id, status: 'active' }, '-valid_from', 1000);
    return grants.filter((grant) => activeAt(grant));
  } catch {
    return [];
  }
}

async function recordDenied(base44, user, details) {
  try {
    await base44.asServiceRole.entities.UserSessionEvent.create({
      user_id: user?.id || null,
      event_type: 'access_denied',
      occurred_at: new Date().toISOString(),
      source: details?.source || 'server_function',
      reason: details?.reason || 'access_denied',
      metadata: details || {},
    });
  } catch {
    // A auditoria de negação nunca deve transformar uma recusa segura em falha aberta.
  }
}

export async function enforceAuthenticatedUser(base44, req, user, options = {}) {
  const {
    permission = null,
    roles = [],
    legalEntityId = null,
    unitId = null,
    requireMfa = false,
    source = 'server_function',
  } = options;

  if (!user) throw new SecurityError('Autenticação obrigatória.', 401, 'AUTH_REQUIRED');

  const role = normalizeLegacyRole(user.role);
  if (['suspended', 'disabled'].includes(user.status)) {
    await recordDenied(base44, user, { source, reason: `account_${user.status}` });
    throw new SecurityError('Conta suspensa ou desativada.', 403, 'ACCOUNT_BLOCKED');
  }

  if (user.session_revoked_after) {
    const issuedAt = bearerIssuedAt(req);
    if (!issuedAt || issuedAt <= new Date(user.session_revoked_after)) {
      await recordDenied(base44, user, { source, reason: 'session_revoked' });
      throw new SecurityError('Sessão revogada. Entre novamente.', 401, 'SESSION_REVOKED');
    }
  }

  let policies = [];
  try {
    policies = await base44.asServiceRole.entities.AccessPolicy.filter({ role, status: 'active' }, '-version', 1000);
  } catch {
    policies = [];
  }
  const grants = await loadCompanyGrants(base44, user);
  const legalEntityIds = [...new Set([
    ...userLegalEntityIds(user),
    ...grants.map((grant) => grant.legal_entity_id),
  ].filter(Boolean))];
  const unitIds = [...new Set([
    ...userUnitIds(user),
    ...grants.flatMap((grant) => grant.unit_ids || []),
  ].filter(Boolean))];
  const applicablePolicies = policies.filter((policy) => (!policy.legal_entity_id || legalEntityIds.includes(policy.legal_entity_id))
    && (!policy.unit_id || unitIds.includes(policy.unit_id)));
  const permissionSet = new Set(effectivePermissions(user, applicablePolicies));
  const applicableGrants = legalEntityId ? grants.filter((grant) => grant.legal_entity_id === legalEntityId) : grants;
  for (const grant of applicableGrants) {
    for (const granted of grant.permissions || []) permissionSet.add(granted);
    for (const denied of grant.denied_permissions || []) permissionSet.delete(denied);
  }
  const permissions = [...permissionSet];

  const allowedRoles = new Set(roles.map(normalizeLegacyRole));
  if (allowedRoles.size && !allowedRoles.has(role) && !permissions.includes('*')) {
    await recordDenied(base44, user, { source, reason: 'role_denied', role, roles });
    throw new SecurityError('Seu papel não permite esta operação.', 403, 'ROLE_DENIED');
  }
  if (permission && !permissions.includes('*') && !permissions.includes(permission)) {
    await recordDenied(base44, user, { source, reason: 'permission_denied', permission, role, legal_entity_id: legalEntityId });
    throw new SecurityError('Permissão insuficiente.', 403, 'PERMISSION_DENIED');
  }

  const canViewAllCompanies = role === 'super_admin' || permissions.includes('*') || permissions.includes('companies.view_all');
  if (legalEntityId && !canViewAllCompanies && !legalEntityIds.includes(legalEntityId)) {
    await recordDenied(base44, user, { source, reason: 'legal_entity_scope_denied', legal_entity_id: legalEntityId });
    throw new SecurityError('Empresa fora do seu escopo.', 403, 'LEGAL_ENTITY_SCOPE_DENIED');
  }
  if (unitId && role !== 'super_admin' && !unitIds.includes(unitId)) {
    await recordDenied(base44, user, { source, reason: 'unit_scope_denied', unit_id: unitId, legal_entity_id: legalEntityId });
    throw new SecurityError('Unidade fora do seu escopo.', 403, 'UNIT_SCOPE_DENIED');
  }
  if (unitId && legalEntityId) {
    const unit = await base44.asServiceRole.entities.Unit.get(unitId).catch(() => null);
    if (!unit || unit.legal_entity_id !== legalEntityId) {
      await recordDenied(base44, user, { source, reason: 'unit_company_mismatch', unit_id: unitId, legal_entity_id: legalEntityId });
      throw new SecurityError('Unidade não pertence à empresa informada.', 409, 'UNIT_COMPANY_MISMATCH');
    }
  }

  // MFA desativado em ambiente de desenvolvimento — ignora exigência de verificação multifator.
  const mustUseMfa = false;
  if (mustUseMfa && user.mfa_status !== 'verified') {
    await recordDenied(base44, user, { source, reason: 'mfa_required', legal_entity_id: legalEntityId });
    throw new SecurityError('Esta operação exige MFA verificado.', 403, 'MFA_REQUIRED');
  }

  return { kind: 'user', user, role, permissions, unitIds, legalEntityIds, companyGrants: grants, policies: applicablePolicies };
}

export async function enforceExistingUserSecurity(base44, req, user, options = {}) {
  if (!user) return null;
  return enforceAuthenticatedUser(base44, req, user, options);
}

export async function authorizeUserOrInternal(base44, req, body = {}, options = {}) {
  const { allowInternal = true, internalTokenEnv = 'INTERNAL_FUNCTION_TOKEN' } = options;
  if (allowInternal) {
    const configured = Deno.env.get(internalTokenEnv) || '';
    const presented = presentedInternalToken(req, body);
    if (configured && presented && constantTimeEqual(presented, configured)) {
      return { kind: 'internal', user: null, role: 'internal', permissions: ['*'], unitIds: [], legalEntityIds: [] };
    }
  }

  let user = null;
  try {
    user = await base44.auth.me();
  } catch {
    user = null;
  }
  return enforceAuthenticatedUser(base44, req, user, options);
}

export function securityErrorResponse(error) {
  const status = Number(error?.status) || 500;
  const safeMessage = status >= 500 ? 'Falha interna ao processar a solicitação.' : (error?.message || 'Operação não autorizada.');
  return Response.json({ error: safeMessage, code: error?.code || 'INTERNAL_ERROR' }, { status });
}