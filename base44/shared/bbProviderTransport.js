import { BB_DEFAULT_ENDPOINTS, buildBoletoPayload, buildPixPayload, oauthBasicHeader } from './bankingProviderContract.js';

// Transporte HTTP compartilhado com o Banco do Brasil.
// Usado pelo gateway de jobs e pela emissão direta de cobrança do balcão.

export function cleanValue(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

export function endpointPath(name, getEnv) {
  const value = cleanValue(getEnv(name), 300) || BB_DEFAULT_ENDPOINTS[name] || '';
  if (!value || !value.startsWith('/')) throw new Error('banking_endpoint_not_configured');
  return value;
}

export function urlWithDeveloperKey(base, path, key) {
  const url = new URL(path, `${base}/`);
  url.searchParams.set('gw-dev-app-key', key);
  return url.toString();
}

export async function fetchJson(url, init, timeout = 15000) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(`banking_provider_http_${response.status}`);
    error.status = response.status;
    error.safeResponse = { status: response.status, provider_code: cleanValue(data?.codigo || data?.code || '', 80) || null };
    throw error;
  }
  return data;
}

export async function accessToken(runtime) {
  const data = await fetchJson(runtime.oauthUrl, {
    method: 'POST',
    headers: { Authorization: oauthBasicHeader(runtime), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'grant_type=client_credentials&scope=cobrancas.boletos-info+cob.write+cob.read+pix.read+pix.write',
  }, 12000);
  const token = cleanValue(data.access_token, 5000);
  if (!token) throw new Error('banking_oauth_token_missing');
  return token;
}

function chargePayerInput(charge) {
  return {
    ...charge,
    payer: { name: charge.payer_name, tax_id: charge.payer_tax_id, email: charge.payer_email, address: charge.payer_address },
    description: charge.metadata?.description,
    with_pix: charge.metadata?.with_pix,
    modality_code: charge.metadata?.modality_code,
    receipt_limit_days: charge.metadata?.receipt_limit_days,
    expiration_seconds: charge.metadata?.expiration_seconds,
    valid_after_due_days: charge.metadata?.valid_after_due_days,
  };
}

export function providerRequestFor(operation, charge, runtime, getEnv) {
  if (operation === 'create_charge') {
    const input = chargePayerInput(charge);
    const payload = charge.charge_type === 'boleto' ? buildBoletoPayload(input, runtime) : buildPixPayload(input, runtime);
    const path = charge.charge_type === 'boleto' ? endpointPath('BB_CHARGE_CREATE_PATH', getEnv) : endpointPath('BB_PIX_CREATE_PATH', getEnv);
    return {
      method: charge.charge_type === 'pix_immediate' ? 'PUT' : 'POST',
      url: urlWithDeveloperKey(runtime.apiBaseUrl, path.replace('{txid}', charge.txid || charge.internal_reference), runtime.developerApplicationKey),
      payload,
    };
  }
  if (operation === 'cancel_charge') {
    const path = charge.charge_type === 'boleto' ? endpointPath('BB_CHARGE_CANCEL_PATH', getEnv) : endpointPath('BB_PIX_CANCEL_PATH', getEnv);
    return {
      method: charge.charge_type === 'boleto' ? 'POST' : 'PATCH',
      url: urlWithDeveloperKey(runtime.apiBaseUrl, path.replace('{id}', charge.provider_charge_id || charge.our_number || '').replace('{txid}', charge.txid || ''), runtime.developerApplicationKey),
      payload: charge.charge_type === 'boleto' ? {} : { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' },
    };
  }
  if (operation === 'refund_charge') {
    const path = endpointPath('BB_PIX_REFUND_PATH', getEnv);
    return {
      method: 'PUT',
      url: urlWithDeveloperKey(runtime.apiBaseUrl, path.replace('{txid}', charge.txid || '').replace('{refund_id}', `DEV${String(charge.id).replace(/[^a-zA-Z0-9]/g, '').slice(-20)}`), runtime.developerApplicationKey),
      payload: { valor: Number(charge.settled_amount || charge.amount).toFixed(2) },
    };
  }
  throw new Error('unsupported_banking_operation');
}

export async function callProvider(operation, charge, runtime, getEnv, idempotencyKey) {
  const token = await accessToken(runtime);
  const request = providerRequestFor(operation, charge, runtime, getEnv);
  return fetchJson(request.url, {
    method: request.method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'X-Idempotency-Key': idempotencyKey },
    body: ['GET', 'DELETE'].includes(request.method) ? undefined : JSON.stringify(request.payload),
  });
}