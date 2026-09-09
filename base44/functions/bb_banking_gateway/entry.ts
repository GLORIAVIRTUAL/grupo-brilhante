import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { requireInternalRequest, securityErrorResponse } from '../../shared/functionSecurity.js';
import { assertExternalBankingAllowed, bankingRuntimeConfig, buildBoletoPayload, buildPixPayload, oauthBasicHeader, sanitizedBankResponse } from '../../shared/bankingProviderContract.js';

function clean(value: unknown, max = 500) { return String(value || '').trim().slice(0, max); }
function config() { return bankingRuntimeConfig((name) => Deno.env.get(name) || ''); }
function endpointPath(name: string) { const value = clean(Deno.env.get(name), 300); if (!value || !value.startsWith('/')) throw new Error('banking_endpoint_not_configured'); return value; }
function urlWithDeveloperKey(base: string, path: string, key: string) { const url = new URL(path, `${base}/`); url.searchParams.set('gw-dev-app-key', key); return url.toString(); }
async function fetchJson(url: string, init: RequestInit, timeout = 15000) { const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout) }); const text = await response.text(); let data: any = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = {}; } if (!response.ok) { const error: any = new Error(`banking_provider_http_${response.status}`); error.status = response.status; error.safeResponse = { status: response.status, provider_code: clean(data?.codigo || data?.code || '', 80) || null }; throw error; } return data; }

async function accessToken(runtime: any) {
  const data = await fetchJson(runtime.oauthUrl, { method: 'POST', headers: { Authorization: oauthBasicHeader(runtime), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: 'grant_type=client_credentials&scope=cobrancas.boletos-info+cob.write+cob.read+pix.read+pix.write' }, 12000);
  const token = clean(data.access_token, 5000);
  if (!token) throw new Error('banking_oauth_token_missing');
  return token;
}

function requestFor(job: any, charge: any, runtime: any) {
  if (job.operation === 'create_charge') {
    const payload = charge.charge_type === 'boleto'
      ? buildBoletoPayload({ ...charge, payer: { name: charge.payer_name, tax_id: charge.payer_tax_id, email: charge.payer_email, address: charge.payer_address }, description: charge.metadata?.description, with_pix: charge.metadata?.with_pix, modality_code: charge.metadata?.modality_code, receipt_limit_days: charge.metadata?.receipt_limit_days }, runtime)
      : buildPixPayload({ ...charge, payer: { name: charge.payer_name, tax_id: charge.payer_tax_id, email: charge.payer_email, address: charge.payer_address }, description: charge.metadata?.description, expiration_seconds: charge.metadata?.expiration_seconds, valid_after_due_days: charge.metadata?.valid_after_due_days }, runtime);
    const path = charge.charge_type === 'boleto' ? endpointPath('BB_CHARGE_CREATE_PATH') : endpointPath('BB_PIX_CREATE_PATH');
    return { method: charge.charge_type === 'pix_immediate' ? 'PUT' : 'POST', url: urlWithDeveloperKey(runtime.apiBaseUrl, path.replace('{txid}', charge.txid || charge.internal_reference), runtime.developerApplicationKey), payload };
  }
  if (job.operation === 'cancel_charge') {
    const path = charge.charge_type === 'boleto' ? endpointPath('BB_CHARGE_CANCEL_PATH') : endpointPath('BB_PIX_CANCEL_PATH');
    return { method: charge.charge_type === 'boleto' ? 'POST' : 'PATCH', url: urlWithDeveloperKey(runtime.apiBaseUrl, path.replace('{id}', charge.provider_charge_id || charge.our_number || '').replace('{txid}', charge.txid || ''), runtime.developerApplicationKey), payload: charge.charge_type === 'boleto' ? {} : { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' } };
  }
  if (job.operation === 'refund_charge') {
    const path = endpointPath('BB_PIX_REFUND_PATH');
    return { method: 'PUT', url: urlWithDeveloperKey(runtime.apiBaseUrl, path.replace('{txid}', charge.txid || '').replace('{refund_id}', `DEV${charge.id.replace(/[^a-zA-Z0-9]/g, '').slice(-20)}`), runtime.developerApplicationKey), payload: { valor: Number(charge.settled_amount || charge.amount).toFixed(2) } };
  }
  throw new Error('unsupported_banking_operation');
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  let job: any = null;
  let db: any = null;
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    requireInternalRequest(req);
    const base44 = createClientFromRequest(req); db = base44.asServiceRole.entities;
    const body = await req.json();
    job = await db.IntegrationJob.get(body.job_id).catch(() => null);
    if (!job || job.provider !== 'banco_do_brasil' || job.entity_type !== 'bank_charge') return Response.json({ error: 'banking_job_not_found', request_id: requestId }, { status: 404 });
    if (job.status === 'completed') return Response.json({ job, idempotent: true, request_id: requestId });
    if (!['pending', 'retry_scheduled'].includes(job.status)) return Response.json({ error: 'banking_job_not_processable', request_id: requestId }, { status: 409 });
    const charge = await db.BankCharge.get(job.entity_id).catch(() => null);
    if (!charge || charge.legal_entity_id !== job.legal_entity_id) return Response.json({ error: 'bank_charge_scope_mismatch', request_id: requestId }, { status: 409 });
    const runtime = config(); assertExternalBankingAllowed(runtime);
    const attempt = Number(job.attempt_count || 0) + 1;
    await db.IntegrationJob.update(job.id, { status: 'processing', attempt_count: attempt, started_at: new Date().toISOString(), last_error_code: null, last_error_message: null });
    await db.BankCharge.update(charge.id, { status: job.operation === 'create_charge' ? 'transmitting' : charge.status, last_provider_request_at: new Date().toISOString(), provider_environment: runtime.environment });
    const token = await accessToken(runtime);
    const providerRequest = requestFor(job, charge, runtime);
    const response = await fetchJson(providerRequest.url, { method: providerRequest.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'X-Idempotency-Key': job.idempotency_key }, body: ['GET', 'DELETE'].includes(providerRequest.method) ? undefined : JSON.stringify(providerRequest.payload) });
    const safe = sanitizedBankResponse(response);
    const nextChargeStatus = job.operation === 'create_charge' ? 'active' : job.operation === 'cancel_charge' ? 'cancelled' : 'refunded';
    const chargePatch: any = { status: nextChargeStatus, provider_charge_id: safe.providerChargeId || charge.provider_charge_id, txid: safe.txid || charge.txid, our_number: safe.ourNumber || charge.our_number, digitable_line: safe.digitableLine || charge.digitable_line, barcode: safe.barcode || charge.barcode, qr_code_text: safe.qrCodeText || charge.qr_code_text, qr_code_location: safe.qrCodeLocation || charge.qr_code_location, last_provider_status: safe.providerStatus, last_provider_response_at: new Date().toISOString(), safe_error_code: null };
    const updatedCharge = await db.BankCharge.update(charge.id, chargePatch);
    const completed = await db.IntegrationJob.update(job.id, { status: 'completed', completed_at: new Date().toISOString(), provider_reference: safe.providerChargeId || safe.txid || null, response_snapshot: safe, checkpoints: [...new Set([...(job.checkpoints || []), 'oauth_authorized', 'provider_accepted', 'charge_updated'])] });
    return Response.json({ job: completed, charge: updatedCharge, request_id: requestId });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const code = clean(error?.message || 'banking_gateway_failed', 120);
    if (db && job?.id) {
      const attempts = Number(job.attempt_count || 0) + 1;
      const repair = attempts >= Number(job.max_attempts || 5);
      const nextAttempt = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.max(0, attempts - 1))).toISOString();
      await db.IntegrationJob.update(job.id, { status: repair ? 'repair_required' : 'retry_scheduled', attempt_count: attempts, next_attempt_at: repair ? null : nextAttempt, last_error_code: code, last_error_message: 'Falha segura na comunicação com o provedor bancário.' }).catch(() => null);
      if (job.entity_id) await db.BankCharge.update(job.entity_id, { status: repair ? 'repair_required' : 'queued', safe_error_code: code }).catch(() => null);
      if (repair) await db.RepairTask.create({ legal_entity_id: job.legal_entity_id, unit_id: job.unit_id, domain: 'banking', entity_type: 'bank_charge', entity_id: job.entity_id, integration_job_id: job.id, title: 'Reparar integração Banco do Brasil', description: 'A operação bancária excedeu o limite de tentativas e exige análise administrativa.', severity: 'high', status: 'open', required_permission: 'repairs.manage', checkpoints: job.checkpoints || [], context_snapshot: { safe_error_code: code, operation: job.operation }, metadata: { provider: 'banco_do_brasil' } }).catch(() => null);
    }
    const unavailable = ['banking_external_requests_disabled', 'banking_production_disabled', 'banking_credentials_incomplete', 'banking_endpoint_not_configured'].includes(code);
    return Response.json({ error: code, request_id: requestId }, { status: unavailable ? 503 : 502 });
  }
});
