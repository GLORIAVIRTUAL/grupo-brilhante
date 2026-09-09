import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { requireInternalRequest, securityErrorResponse } from '../../shared/functionSecurity.js';
import { assertExternalFiscalAllowed, buildFocusNfePayload, fiscalRuntimeConfig, focusStatusToDocumentStatus, sanitizeFocusNfeResponse } from '../../shared/fiscalProviderContract.js';

function clean(value: unknown, max = 500) { return String(value || '').trim().slice(0, max); }
async function fetchJson(url: string, init: RequestInit) { const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) }); const text = await response.text(); let data: any = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = {}; } return { status: response.status, data }; }
function authHeader(token: string) { return `Basic ${btoa(`${token}:`)}`; }
async function addEvent(db: any, document: any, job: any, type: string, status: string, message: string, metadata: any = {}) { const eventKey = `${type}:${document.id}:${job.id}:${clean(metadata.provider_status, 80)}`; const prior = await db.FiscalEvent.filter({ event_key: eventKey }, '-created_date', 2).catch(() => []); if (prior.length) return prior[0]; return db.FiscalEvent.create({ legal_entity_id: document.legal_entity_id, unit_id: document.unit_id, fiscal_document_id: document.id, event_key: eventKey, event_type: type, status, provider: 'focusnfe', environment: document.environment, external_protocol: document.provider_reference, code: metadata.code, message: clean(message, 800), payload_hash: document.provider_payload_hash, occurred_at: new Date().toISOString(), actor_user_id: 'integration', actor_name: 'Focus NFe Gateway', request_id: job.correlation_id || job.id, metadata }); }
async function updateOrders(db: any, document: any, fiscalStatus: string) { for (const orderId of document.order_ids || []) { const order = await db.Order.get(orderId).catch(() => null); if (order && (!order.legal_entity_id || order.legal_entity_id === document.legal_entity_id)) await db.Order.update(order.id, { fiscal_status: fiscalStatus }).catch(() => null); } }

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID(); let db: any = null; let job: any = null; let document: any = null; let attempt = 0;
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    requireInternalRequest(req);
    const base44 = createClientFromRequest(req); db = base44.asServiceRole.entities;
    const body = await req.json(); job = await db.IntegrationJob.get(body.job_id).catch(() => null);
    if (!job || job.provider !== 'focusnfe' || job.entity_type !== 'fiscal_document') return Response.json({ error: 'fiscal_job_not_found', request_id: requestId }, { status: 404 });
    if (job.status === 'completed') return Response.json({ job, idempotent: true, request_id: requestId });
    if (!['pending', 'retry_scheduled'].includes(job.status)) return Response.json({ error: 'fiscal_job_not_processable', request_id: requestId }, { status: 409 });
    document = await db.FiscalDocument.get(job.entity_id).catch(() => null); const profile = document ? await db.FiscalProfile.get(document.fiscal_profile_id).catch(() => null) : null;
    if (!document || !profile || document.legal_entity_id !== job.legal_entity_id || profile.legal_entity_id !== job.legal_entity_id) return Response.json({ error: 'fiscal_job_scope_mismatch', request_id: requestId }, { status: 409 });
    if (!['issue_nfse', 'consult_nfse', 'cancel_nfse'].includes(job.operation)) return Response.json({ error: 'unsupported_fiscal_operation', request_id: requestId }, { status: 400 });
    const runtime = fiscalRuntimeConfig((name) => Deno.env.get(name) || '', profile); assertExternalFiscalAllowed(runtime);
    attempt = Number(job.attempt_count || 0) + 1;
    await db.IntegrationJob.update(job.id, { status: 'processing', attempt_count: attempt, started_at: new Date().toISOString(), last_error_code: null, last_error_message: null });
    const reference = clean(document.provider_reference || document.external_protocol, 100); if (!reference || !/^[a-zA-Z0-9]+$/.test(reference)) throw new Error('invalid_focusnfe_reference');
    const headers: Record<string, string> = { Authorization: authHeader(runtime.token), Accept: 'application/json', 'Content-Type': 'application/json' };
    let method = 'GET'; let path = `/v2/nfse/${encodeURIComponent(reference)}`; let requestBody: any = undefined;
    if (job.operation === 'issue_nfse') { method = 'POST'; path = `/v2/nfse?ref=${encodeURIComponent(reference)}`; requestBody = buildFocusNfePayload({ document, profile }); }
    if (job.operation === 'cancel_nfse') { method = 'DELETE'; requestBody = { justificativa: clean(job.metadata?.reason || document.cancellation_reason, 255) }; if (requestBody.justificativa.length < 15) throw new Error('cancellation_reason_required'); }
    const providerResponse = await fetchJson(`${runtime.baseUrl}${path}`, { method, headers, body: requestBody === undefined ? undefined : JSON.stringify(requestBody) });
    const safe = sanitizeFocusNfeResponse(providerResponse.data); const mapped = focusStatusToDocumentStatus(safe.status);
    const acceptableHttp = job.operation === 'issue_nfse' ? [200, 201, 202] : [200]; const accepted = acceptableHttp.includes(providerResponse.status) && !safe.errorCode;
    if (!accepted) { const error: any = new Error('focusnfe_request_rejected'); error.providerStatus = providerResponse.status; error.safe = safe; throw error; }
    const now = new Date().toISOString();
    const patch: any = { status: mapped, document_type: mapped === 'authorized' || safe.nfseNumber ? 'nfse' : document.document_type, provider_status: safe.status, provider_reference: safe.reference || reference, external_protocol: safe.reference || reference, nfse_number: safe.nfseNumber || document.nfse_number, verification_code: safe.verificationCode || document.verification_code, attempt_count: attempt, last_error_code: null, last_error_message: null, last_provider_response_at: now, safe_provider_snapshot: safe, metadata: { ...(document.metadata || {}), focusnfe_ref: safe.reference || reference, artifact_urls_pending_secure_download: Boolean(safe.xmlPath || safe.pdfUrl) } };
    if (mapped === 'authorized') patch.authorized_at = document.authorized_at || now;
    if (mapped === 'cancelled') { patch.cancelled_at = document.cancelled_at || now; patch.cancellation_reason = clean(job.metadata?.reason || document.cancellation_reason, 255); }
    const updated = await db.FiscalDocument.update(document.id, patch);
    await db.IntegrationJob.update(job.id, { status: 'completed', completed_at: now, provider_reference: safe.reference || reference, response_snapshot: safe, checkpoints: [...new Set([...(job.checkpoints || []), 'provider_called', 'provider_response_sanitized', `document_${mapped}`])] });
    const eventType = mapped === 'authorized' ? 'authorized' : mapped === 'cancelled' ? 'cancelled' : mapped === 'rejected' ? 'rejected' : 'submitted';
    await addEvent(db, updated, job, eventType, mapped === 'rejected' ? 'failed' : mapped === 'processing' ? 'pending' : 'success', `Focus NFe: ${safe.status || mapped}.`, { provider_status: safe.status, code: safe.errorCode, job_id: job.id });
    if (['authorized', 'cancelled'].includes(mapped)) await updateOrders(db, updated, mapped);
    return Response.json({ job_id: job.id, fiscal_document: updated, request_id: requestId });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const code = clean(error?.message || 'focusnfe_gateway_failed', 120); const safe = error?.safe || {};
    if (db && job?.id) {
      const currentAttempt = attempt || Number(job.attempt_count || 0) + 1; const repair = currentAttempt >= Number(job.max_attempts || 5); const nextAttempt = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.max(0, currentAttempt - 1))).toISOString();
      await db.IntegrationJob.update(job.id, { status: repair ? 'repair_required' : 'retry_scheduled', attempt_count: currentAttempt, next_attempt_at: repair ? null : nextAttempt, last_error_code: code, last_error_message: 'Falha segura na comunicação fiscal.', response_snapshot: safe }).catch(() => null);
      if (document?.id) { const updated = await db.FiscalDocument.update(document.id, { status: repair ? 'error' : document.status, attempt_count: currentAttempt, last_error_code: code, last_error_message: safe.errorMessage || 'Falha segura na integração fiscal.', safe_provider_snapshot: safe }).catch(() => document); await addEvent(db, updated, job, 'error', 'failed', safe.errorMessage || 'Falha segura na integração fiscal.', { code, job_id: job.id }).catch(() => null); }
      if (repair && document?.id) await db.RepairTask.create({ legal_entity_id: job.legal_entity_id, unit_id: job.unit_id, domain: 'fiscal', entity_type: 'fiscal_document', entity_id: document.id, integration_job_id: job.id, title: 'Reparar integração Focus NFe', description: 'A operação fiscal excedeu o limite de tentativas e exige análise administrativa.', severity: 'critical', status: 'open', required_permission: 'repairs.manage', checkpoints: job.checkpoints || [], context_snapshot: { safe_error_code: code, operation: job.operation, provider_reference: document.provider_reference }, metadata: { provider: 'focusnfe' } }).catch(() => null);
    }
    const unavailable = ['fiscal_external_requests_disabled', 'fiscal_environment_disabled', 'fiscal_production_disabled', 'focusnfe_token_not_configured'].includes(code);
    return Response.json({ error: code, request_id: requestId }, { status: unavailable ? 503 : 502 });
  }
});
