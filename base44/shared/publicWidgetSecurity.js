import { constantTimeEqual, SecurityError } from './functionSecurity.js';

const encoder = new TextEncoder();

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value || '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomWidgetToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function configuredOrigins() {
  return String(Deno.env.get('PUBLIC_WIDGET_ORIGIN_ALLOWLIST') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try { return new URL(value).origin; } catch { return null; }
    })
    .filter(Boolean);
}

export function requireWidgetOrigin(req) {
  const allowlist = configuredOrigins();
  if (allowlist.length === 0) throw new SecurityError('Widget público indisponível: origem não configurada.', 503, 'WIDGET_ORIGIN_NOT_CONFIGURED');
  const presented = req.headers.get('origin') || req.headers.get('referer') || '';
  let origin = '';
  try { origin = new URL(presented).origin; } catch { origin = ''; }
  if (!origin || !allowlist.includes(origin)) throw new SecurityError('Origem do widget não autorizada.', 403, 'WIDGET_ORIGIN_DENIED');
  return origin;
}

function requestIp(req) {
  return String(req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || '')
    .split(',')[0]
    .trim();
}

export async function widgetRequestFingerprint(req) {
  const pepper = Deno.env.get('PUBLIC_WIDGET_HASH_PEPPER') || '';
  if (!pepper) throw new SecurityError('Widget público indisponível: proteção de privacidade não configurada.', 503, 'WIDGET_HASH_PEPPER_NOT_CONFIGURED');
  const ipHash = await sha256Hex(`${pepper}:ip:${requestIp(req) || 'unknown'}`);
  const userAgentHash = await sha256Hex(`${pepper}:ua:${req.headers.get('user-agent') || 'unknown'}`);
  return { ipHash, userAgentHash };
}

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export async function enforceWidgetStartRateLimit(base44, fingerprint) {
  const limit = positiveInteger(Deno.env.get('PUBLIC_WIDGET_STARTS_PER_HOUR'), 5, 1, 50);
  const cutoff = Date.now() - 60 * 60 * 1000;
  const sessions = await base44.asServiceRole.entities.PublicConversationSession
    .filter({ ip_hash: fingerprint.ipHash }, '-created_date', limit + 5)
    .catch(() => []);
  const recent = sessions.filter((session) => new Date(session.created_date || 0).getTime() >= cutoff);
  if (recent.length >= limit) throw new SecurityError('Limite temporário do atendimento atingido. Tente novamente mais tarde.', 429, 'WIDGET_RATE_LIMITED');
}

export async function createWidgetSession(base44, req, context) {
  const origin = requireWidgetOrigin(req);
  const fingerprint = await widgetRequestFingerprint(req);
  await enforceWidgetStartRateLimit(base44, fingerprint);
  const token = randomWidgetToken();
  const tokenHash = await sha256Hex(token);
  const ttlMinutes = positiveInteger(Deno.env.get('PUBLIC_WIDGET_SESSION_TTL_MINUTES'), 120, 10, 1440);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const session = await base44.asServiceRole.entities.PublicConversationSession.create({
    session_key: crypto.randomUUID(),
    token_hash: tokenHash,
    conversation_id: context.conversationId,
    customer_id: context.customerId,
    legal_entity_id: context.legalEntityId || undefined,
    unit_id: context.unitId,
    origin,
    ip_hash: fingerprint.ipHash,
    user_agent_hash: fingerprint.userAgentHash,
    status: 'active',
    expires_at: expiresAt,
    last_used_at: new Date().toISOString(),
    message_count: 1,
    failed_attempts: 0,
    metadata: { source: 'landing_widget', version: 1 },
  });
  return { session, token };
}

function presentedWidgetToken(req, body) {
  return req.headers.get('x-widget-token') || body?.session_token || '';
}

export async function authorizeWidgetSession(base44, req, body = {}, options = {}) {
  const origin = requireWidgetOrigin(req);
  const sessionKey = String(body.session_key || '').trim();
  const token = String(presentedWidgetToken(req, body) || '').trim();
  if (!sessionKey || !token) throw new SecurityError('Sessão do atendimento obrigatória.', 401, 'WIDGET_SESSION_REQUIRED');
  const sessions = await base44.asServiceRole.entities.PublicConversationSession.filter({ session_key: sessionKey }, '-created_date', 2).catch(() => []);
  const session = sessions[0];
  if (!session || session.status !== 'active') throw new SecurityError('Sessão do atendimento inválida.', 401, 'WIDGET_SESSION_INVALID');
  if (session.origin !== origin) throw new SecurityError('Origem da sessão divergente.', 403, 'WIDGET_SESSION_ORIGIN_MISMATCH');
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.PublicConversationSession.update(session.id, { status: 'expired' }).catch(() => null);
    throw new SecurityError('Sessão do atendimento expirada.', 401, 'WIDGET_SESSION_EXPIRED');
  }
  const tokenHash = await sha256Hex(token);
  if (!constantTimeEqual(tokenHash, session.token_hash)) {
    await base44.asServiceRole.entities.PublicConversationSession.update(session.id, { failed_attempts: Number(session.failed_attempts || 0) + 1 }).catch(() => null);
    throw new SecurityError('Sessão do atendimento inválida.', 401, 'WIDGET_SESSION_INVALID');
  }
  if (body.conversation_id && body.conversation_id !== session.conversation_id) throw new SecurityError('Conversa fora da sessão.', 403, 'WIDGET_CONVERSATION_DENIED');
  const maxMessages = positiveInteger(Deno.env.get('PUBLIC_WIDGET_MAX_MESSAGES'), 100, 10, 500);
  const nextCount = Number(session.message_count || 0) + (options.incrementMessage ? 1 : 0);
  if (nextCount > maxMessages) throw new SecurityError('Limite de mensagens da sessão atingido.', 429, 'WIDGET_MESSAGE_LIMIT');
  const now = Date.now();
  if (options.incrementMessage && session.last_used_at && now - new Date(session.last_used_at).getTime() < 750) throw new SecurityError('Aguarde antes de enviar outra mensagem.', 429, 'WIDGET_SEND_THROTTLED');
  await base44.asServiceRole.entities.PublicConversationSession.update(session.id, {
    last_used_at: new Date(now).toISOString(),
    message_count: nextCount,
  });
  return session;
}
