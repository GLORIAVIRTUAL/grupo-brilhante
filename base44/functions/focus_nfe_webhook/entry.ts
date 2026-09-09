import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { focusStatusToDocumentStatus, sanitizeFocusNfeResponse } from '../../shared/fiscalProviderContract.js';

function clean(value: unknown, max = 500) { return String(value || '').trim().slice(0, max); }
function digits(value: unknown) { return String(value || '').replace(/\D/g, ''); }
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function timingSafeEqual(left: string, right: string) { const a = new TextEncoder().encode(String(left || '')); const b = new TextEncoder().encode(String(right || '')); const length = Math.max(a.length, b.length); let diff = a.length ^ b.length; for (let index = 0; index < length; index += 1) diff |= (a[index % Math.max(1, a.length)] || 0) ^ (b[index % Math.max(1, b.length)] || 0); return diff === 0; }
async function updateOrders(db: any, document: any, status: string) { for (const orderId of document.order_ids || []) { const order = await db.Order.get(orderId).catch(() => null); if (order && (!order.legal_entity_id || order.legal_entity_id === document.legal_entity_id)) await db.Order.update(order.id, { fiscal_status: status }).catch(() => null); } }
async function addEvent(db: any, document: any, webhook: any, eventType: string, status: string, message: string, safe: any) { const eventKey = `${eventType}:${document.id}:${webhook.event_key}`; const prior = await db.FiscalEvent.filter({ event_key: eventKey }, '-created_date', 2).catch(() => []); if (prior.length) return prior[0]; return db.FiscalEvent.create({ legal_entity_id: document.legal_entity_id, unit_id: document.unit_id, fiscal_document_id: document.id, event_key: eventKey, event_type: eventType, status, provider: 'focusnfe', environment: document.environment, external_protocol: document.provider_reference, code: safe.errorCode, message: clean(message, 800), payload_hash: webhook.payload_hash, occurred_at: new Date().toISOString(), actor_user_id: 'integration', actor_name: 'Focus NFe Webhook', request_id: webhook.id, metadata: { provider_status: safe.status, webhook_event_id: webhook.id } }); }

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const expectedToken = Deno.env.get('FOCUSNFE_WEBHOOK_TOKEN') || '';
    const headerName = clean(Deno.env.get('FOCUSNFE_WEBHOOK_HEADER') || 'x-focusnfe-webhook-token', 80).toLowerCase();
    const environment = clean(Deno.env.get('FOCUSNFE_WEBHOOK_ENVIRONMENT'), 40).toLowerCase();
    if (!expectedToken || !['homologation', 'production'].includes(environment)) return Response.json({ error: 'focusnfe_webhook_not_configured', request_id: requestId }, { status: 503 });
    const suppliedToken = req.headers.get(headerName) || '';
    if (!timingSafeEqual(suppliedToken, expectedToken)) return Response.json({ error: 'invalid_webhook_token', request_id: requestId }, { status: 401 });
    const raw = await req.text(); if (!raw || raw.length > 1024 * 1024) return Response.json({ error: 'invalid_webhook_body', request_id: requestId }, { status: 413 });
    let payload: any; try { payload = JSON.parse(raw); } catch { return Response.json({ error: 'invalid_webhook_json', request_id: requestId }, { status: 400 }); }
    const payloadHash = await sha256(raw); const safe = sanitizeFocusNfeResponse(payload); const reference = clean(safe.reference || payload?.ref || payload?.referencia, 100); const providerTaxId = digits(payload?.cnpj_prestador || payload?.prestador?.cnpj || payload?.cnpj);
    if (!reference || !/^[a-zA-Z0-9]+$/.test(reference)) return Response.json({ error: 'invalid_focusnfe_reference', request_id: requestId }, { status: 422 });
    const eventKey = clean(req.headers.get('x-focusnfe-event-id') || `${reference}:${safe.status || 'unknown'}:${safe.nfseNumber || ''}:${payloadHash}`, 220);
    const base44 = createClientFromRequest(req); const db = base44.asServiceRole.entities;
    const prior = await db.FiscalWebhookEvent.filter({ provider: 'focusnfe', environment, event_key: eventKey }, '-created_date', 2).catch(() => []);
    if (prior.length) { if (prior[0].payload_hash !== payloadHash) return Response.json({ error: 'webhook_event_conflict', request_id: requestId }, { status: 409 }); return Response.json({ accepted: true, idempotent: true, request_id: requestId }); }
    const webhook = await db.FiscalWebhookEvent.create({ provider: 'focusnfe', environment, event_key: eventKey, event_type: 'nfse', provider_reference: reference, provider_status: safe.status, payload_hash: payloadHash, safe_payload: safe, received_at: new Date().toISOString(), status: 'validated', idempotency_key: `focusnfe-webhook:${eventKey}`, metadata: { provider_tax_id_suffix: providerTaxId.slice(-4) } });
    const documents = await db.FiscalDocument.filter({ provider: 'focusnfe', environment, provider_reference: reference }, '-created_date', 5).catch(() => []);
    const document = documents.find((item: any) => item.external_protocol === reference || item.provider_reference === reference) || null;
    if (!document) { await db.FiscalWebhookEvent.update(webhook.id, { status: 'repair_required', safe_error_code: 'FISCAL_DOCUMENT_NOT_FOUND', processed_at: new Date().toISOString() }); return Response.json({ accepted: true, repair_required: true, request_id: requestId }, { status: 202 }); }
    const profile = await db.FiscalProfile.get(document.fiscal_profile_id).catch(() => null);
    if (!profile || profile.legal_entity_id !== document.legal_entity_id || (providerTaxId && digits(profile.tax_id) !== providerTaxId)) { await db.FiscalWebhookEvent.update(webhook.id, { legal_entity_id: document.legal_entity_id, unit_id: document.unit_id, fiscal_document_id: document.id, status: 'repair_required', safe_error_code: 'FISCAL_PROFILE_SCOPE_MISMATCH', processed_at: new Date().toISOString() }); return Response.json({ accepted: true, repair_required: true, request_id: requestId }, { status: 202 }); }
    const mapped = focusStatusToDocumentStatus(safe.status); const now = new Date().toISOString(); const patch: any = { status: mapped, provider_status: safe.status, nfse_number: safe.nfseNumber || document.nfse_number, verification_code: safe.verificationCode || document.verification_code, document_type: mapped === 'authorized' || safe.nfseNumber ? 'nfse' : document.document_type, last_error_code: safe.errorCode, last_error_message: safe.errorMessage, last_provider_response_at: now, safe_provider_snapshot: safe, metadata: { ...(document.metadata || {}), artifact_urls_pending_secure_download: Boolean(safe.xmlPath || safe.pdfUrl) } };
    if (mapped === 'authorized') patch.authorized_at = document.authorized_at || now;
    if (mapped === 'cancelled') patch.cancelled_at = document.cancelled_at || now;
    const updated = await db.FiscalDocument.update(document.id, patch);
    await db.FiscalWebhookEvent.update(webhook.id, { legal_entity_id: document.legal_entity_id, unit_id: document.unit_id, fiscal_document_id: document.id, status: 'processed', processed_at: now });
    const jobs = await db.IntegrationJob.filter({ provider: 'focusnfe', entity_type: 'fiscal_document', entity_id: document.id }, '-created_date', 20).catch(() => []);
    for (const job of jobs.filter((item: any) => ['pending', 'processing', 'retry_scheduled'].includes(item.status))) await db.IntegrationJob.update(job.id, { status: 'completed', completed_at: now, provider_reference: reference, response_snapshot: safe, checkpoints: [...new Set([...(job.checkpoints || []), 'webhook_received', `document_${mapped}`])] }).catch(() => null);
    const eventType = mapped === 'authorized' ? 'authorized' : mapped === 'cancelled' ? 'cancelled' : mapped === 'rejected' ? 'rejected' : 'submitted';
    await addEvent(db, updated, webhook, eventType, mapped === 'rejected' ? 'failed' : mapped === 'processing' ? 'pending' : 'success', `Webhook Focus NFe: ${safe.status || mapped}.`, safe);
    if (['authorized', 'cancelled'].includes(mapped)) await updateOrders(db, updated, mapped);
    return Response.json({ accepted: true, fiscal_document_id: document.id, status: mapped, request_id: requestId });
  } catch {
    return Response.json({ error: 'focusnfe_webhook_failed', request_id: requestId }, { status: 500 });
  }
});
