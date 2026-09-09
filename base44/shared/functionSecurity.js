import { effectivePermissions, normalizeLegacyRole, ROLE_DEFINITIONS } from './accessGovernance.js';

export class SecurityError extends Error {
  constructor(message, status = 403, code = 'ACCESS_DENIED') {
    super(message);
    this.name = 'SecurityError';
    this.status = status;
    this.code = code;
  }
}

function constantTimeEqual(left, right) {
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
    unitId = null,
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
    policies = await base44.asServiceRole.entities.AccessPolicy.filter({ role, status: 'active' }, '-version', 100);
  } catch {
    policies = [];
  }
  const permissions = effectivePermissions(user, policies);
  const allowedRoles = new Set(roles.map(normalizeLegacyRole));
  if (allowedRoles.size && !allowedRoles.has(role) && !permissions.includes('*')) {
    await recordDenied(base44, user, { source, reason: 'role_denied', role, roles });
    throw new SecurityError('Seu papel não permite esta operação.', 403, 'ROLE_DENIED');
  }
  if (permission && !permissions.includes('*') && !permissions.includes(permission)) {
    await recordDenied(base44, user, { source, reason: 'permission_denied', permission, role });
    throw new SecurityError('Permissão insuficiente.', 403, 'PERMISSION_DENIED');
  }

  const unitIds = userUnitIds(user);
  if (unitId && role !== 'super_admin' && !permissions.includes('*') && !unitIds.includes(unitId)) {
    await recordDenied(base44, user, { source, reason: 'unit_scope_denied', unit_id: unitId });
    throw new SecurityError('Unidade fora do seu escopo.', 403, 'UNIT_SCOPE_DENIED');
  }

  const applicablePolicies = policies.filter((policy) => !policy.unit_id || unitIds.includes(policy.unit_id));
  // MFA só é exigido quando marcado explicitamente no usuário ou numa política de acesso.
  // Não é mais derivado automaticamente do papel, pois o app não possui fluxo de cadastro de MFA.
  const mustUseMfa = user.require_mfa === true || applicablePolicies.some((policy) => policy.require_mfa === true);
  if (mustUseMfa && user.mfa_status !== 'verified') {
    await recordDenied(base44, user, { source, reason: 'mfa_required' });
    throw new SecurityError('Esta operação exige MFA verificado.', 403, 'MFA_REQUIRED');
  }

  return { kind: 'user', user, role, permissions, unitIds, policies: applicablePolicies };
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
      return { kind: 'internal', user: null, role: 'internal', permissions: ['*'], unitIds: [] };
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