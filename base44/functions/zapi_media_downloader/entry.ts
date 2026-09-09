import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { requireInternalRequest, securityErrorResponse, SecurityError } from '../../shared/functionSecurity.js';

const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/'];
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'application/octet-stream']);
const TRUSTED_HOST_SUFFIXES = ['.z-api.io', '.amazonaws.com', '.whatsapp.net', '.fbcdn.net', '.googleusercontent.com'];

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host === '::' || host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host) || host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.')) return true;
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && [0, 2, 168].includes(b)) return true;
    if (a === 198 && [18, 19, 51].includes(b)) return true;
    if (a === 203 && b === 0) return true;
  }
  return host === '100.100.100.200' || host === 'metadata.google.internal';
}

async function assertPublicResolution(hostname) {
  if (isPrivateHost(hostname)) throw new SecurityError('Origem de mídia não permitida.', 400, 'MEDIA_ORIGIN_BLOCKED');
  const addresses = [];
  for (const type of ['A', 'AAAA']) {
    try {
      addresses.push(...await Deno.resolveDns(hostname, type));
    } catch {
      // Alguns provedores publicam apenas um dos tipos de registro.
    }
  }
  if (addresses.length === 0) throw new SecurityError('Host de mídia não pôde ser resolvido.', 502, 'MEDIA_DNS_FAILED');
  if (addresses.some(isPrivateHost)) throw new SecurityError('DNS da mídia aponta para rede privada ou reservada.', 400, 'MEDIA_DNS_BLOCKED');
}

function allowedHosts() {
  const configured = String(Deno.env.get('MEDIA_DOWNLOAD_HOST_ALLOWLIST') || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured;
}

function validateMediaUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SecurityError('URL de mídia inválida.', 400, 'INVALID_MEDIA_URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || isPrivateHost(url.hostname)) {
    throw new SecurityError('Origem de mídia não permitida.', 400, 'MEDIA_ORIGIN_BLOCKED');
  }
  const host = url.hostname.toLowerCase();
  const explicitlyAllowed = allowedHosts().some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  const trustedProvider = TRUSTED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) || host === 'z-api.io';
  if (!explicitlyAllowed && !trustedProvider) {
    throw new SecurityError('Host de mídia não autorizado.', 400, 'MEDIA_HOST_NOT_ALLOWED');
  }
  return url;
}

async function readBodyWithLimit(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_MEDIA_BYTES) throw new SecurityError('Mídia excede 15 MB.', 413, 'MEDIA_TOO_LARGE');
  if (!response.body) throw new SecurityError('Resposta de mídia vazia.', 422, 'EMPTY_MEDIA');

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_MEDIA_BYTES) {
      await reader.cancel();
      throw new SecurityError('Mídia excede 15 MB.', 413, 'MEDIA_TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function extensionFor(mimeType, mediaType) {
  const mime = mimeType.toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('mp4')) return 'mp4';
  if (mediaType === 'IMAGE') return 'jpg';
  if (mediaType === 'AUDIO') return 'ogg';
  return 'bin';
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    requireInternalRequest(req, body);
    const { message_id, media_url, media_type } = body;

    if (!message_id || !media_url) throw new SecurityError('Mensagem e URL de mídia são obrigatórias.', 400, 'MISSING_MEDIA_FIELDS');
    const url = validateMediaUrl(media_url);
    await assertPublicResolution(url.hostname);
    const message = await base44.asServiceRole.entities.Message.get(message_id);
    if (!message) throw new SecurityError('Mensagem não encontrada.', 404, 'MESSAGE_NOT_FOUND');

    const headers = {};
    if (url.hostname.endsWith('.z-api.io') || url.hostname === 'z-api.io') {
      const clientToken = Deno.env.get('ZAPI_SECURITY_TOKEN') || Deno.env.get('ZAPI_MOINHOS_SECURITY_TOKEN');
      if (clientToken) headers['client-token'] = clientToken;
    }

    const response = await fetch(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new SecurityError(`Falha ao obter mídia (${response.status}).`, 502, 'MEDIA_FETCH_FAILED');

    const mimeType = String(response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) && !ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new SecurityError('Tipo de mídia não permitido.', 415, 'MEDIA_TYPE_BLOCKED');
    }

    const bytes = await readBodyWithLimit(response);
    const safeMessageId = String(message_id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const file = new File([bytes], `media_${safeMessageId}.${extensionFor(mimeType, media_type)}`, { type: mimeType });
    const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
    await base44.asServiceRole.entities.Message.update(message_id, { media_file_id: file_url });

    return Response.json({ status: 'success', file_url, bytes: bytes.byteLength, mime_type: mimeType });
  } catch (error) {
    console.error('Error in zapi_media_downloader:', error?.code || error?.message || error);
    return securityErrorResponse(error);
  }
});
