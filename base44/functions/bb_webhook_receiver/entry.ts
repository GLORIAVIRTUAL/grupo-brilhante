import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { securityErrorResponse } from '../../shared/functionSecurity.js';
import { extractSettlementEvent } from '../../shared/bankingProviderContract.js';
import { roundMoney } from '../../shared/businessCore.js';
import { recordDomainEvent } from '../../shared/domainEvents.js';

function clean(value: unknown, max = 500) { return String(value || '').trim().slice(0, max); }
async function sha256Hex(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function timingSafeEqual(left: string, right: string) { const a = new TextEncoder().encode(String(left || '')); const b = new TextEncoder().encode(String(right || '')); const length = Math.max(a.length, b.length); let diff = a.length ^ b.length; for (let index = 0; index < length; index += 1) diff |= (a[index % Math.max(a.length, 1)] || 0) ^ (b[index % Math.max(b.length, 1)] || 0); return diff === 0; }
function environment() { const value = clean(Deno.env.get('BB_ENVIRONMENT'), 40).toLowerCase(); return ['sandbox', 'homologation', 'production'].includes(value) ? value : 'disabled'; }
async function hmacHex(secret: string, body: string) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)); return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, '0')).join(''); }
function safePayload(payload: any, event: any) { return { event_type: event.eventType, txid: event.txid, provider_charge_id: event.providerChargeId, amount: event.amount, settled_at: event.settledAt, end_to_end_id: event.endToEndId, provider_status: clean(payload?.status || payload?.estado || '', 80) || null }; }

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const runtimeEnvironment = environment();
    if (runtimeEnvironment === 'disabled') return Response.json({ error: 'banking_webhook_disabled', request_id: requestId }, { status: 503 });
    const expectedToken = Deno.env.get('BB_WEBHOOK_TOKEN') || '';
    if (!expectedToken) return Response.json({ error: 'banking_webhook_not_configured', request_id: requestId }, { status: 503 });
    const token = req.headers.get('x-bb-webhook-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!(await timingSafeEqual(token, expectedToken))) return Response.json({ error: 'invalid_webhook_token', request_id: requestId }, { status: 401 });
    const rawBody = await req.text();
    if (!rawBody || rawBody.length > 1024 * 1024) return Response.json({ error: 'invalid_webhook_body', request_id: requestId }, { status: 413 });
    const hmacSecret = Deno.env.get('BB_WEBHOOK_HMAC_SECRET') || '';
    if (hmacSecret) {
      const supplied = (req.headers.get('x-bb-signature') || '').replace(/^sha256=/i, '').toLowerCase();
      const expected = await hmacHex(hmacSecret, rawBody);
      if (!supplied || !(await timingSafeEqual(supplied, expected))) return Response.json({ error: 'invalid_webhook_signature', request_id: requestId }, { status: 401 });
    }
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch { return Response.json({ error: 'invalid_webhook_json', request_id: requestId }, { status: 400 }); }
    const payloadHash = await sha256Hex(rawBody);
    const event = extractSettlementEvent(payload);
    const eventKey = clean(req.headers.get('x-bb-event-id') || payload?.id || payload?.eventoId || event.endToEndId || payloadHash, 180);
    const base44 = createClientFromRequest(req); const db = base44.asServiceRole.entities;
    const prior = await db.BankWebhookEvent.filter({ provider: 'banco_do_brasil', event_key: eventKey }, '-created_date', 2).catch(() => []);
    if (prior.length) {
      if (prior[0].payload_hash !== payloadHash) return Response.json({ error: 'webhook_event_conflict', request_id: requestId }, { status: 409 });
      return Response.json({ accepted: true, idempotent: true, request_id: requestId });
    }
    const webhookEvent = await db.BankWebhookEvent.create({ provider: 'banco_do_brasil', provider_environment: runtimeEnvironment, event_key: eventKey, event_type: event.eventType, payload_hash: payloadHash, received_at: new Date().toISOString(), status: 'validated', provider_charge_id: event.providerChargeId, txid: event.txid, safe_payload: safePayload(payload, event), idempotency_key: `bb-webhook:${eventKey}`, metadata: {} });
    const byTxid = event.txid ? await db.BankCharge.filter({ txid: event.txid }, '-created_date', 5).catch(() => []) : [];
    const byProvider = !byTxid.length && event.providerChargeId ? await db.BankCharge.filter({ provider_charge_id: event.providerChargeId }, '-created_date', 5).catch(() => []) : [];
    const charge = [...byTxid, ...byProvider].find((item: any) => item.provider_environment === runtimeEnvironment) || null;
    if (!charge) {
      await db.BankWebhookEvent.update(webhookEvent.id, { status: 'repair_required', safe_error_code: 'BANK_CHARGE_NOT_FOUND', processed_at: new Date().toISOString() });
      await db.RepairTask.create({ legal_entity_id: 'unresolved', domain: 'banking', entity_type: 'bank_webhook_event', entity_id: webhookEvent.id, title: 'Vincular evento bancário', description: 'O webhook foi autenticado, mas não foi possível localizar a cobrança correspondente.', severity: 'high', status: 'open', required_permission: 'repairs.manage', checkpoints: ['webhook_authenticated', 'payload_hashed'], context_snapshot: { event_key: eventKey, txid: event.txid, provider_charge_id: event.providerChargeId }, metadata: { provider: 'banco_do_brasil' } }).catch(() => null);
      return Response.json({ accepted: true, repair_required: true, request_id: requestId }, { status: 202 });
    }
    if (event.eventType !== 'settlement' || !event.amount || event.amount <= 0) {
      await db.BankWebhookEvent.update(webhookEvent.id, { status: 'ignored', legal_entity_id: charge.legal_entity_id, bank_account_id: charge.bank_account_id, bank_charge_id: charge.id, processed_at: new Date().toISOString() });
      return Response.json({ accepted: true, ignored: true, request_id: requestId });
    }
    const transactionExternalId = event.endToEndId || eventKey;
    const priorTransactions = await db.BankTransaction.filter({ bank_account_id: charge.bank_account_id, external_id: transactionExternalId }, '-created_date', 2).catch(() => []);
    let transaction = priorTransactions[0] || null;
    if (!transaction) transaction = await db.BankTransaction.create({ legal_entity_id: charge.legal_entity_id, unit_id: charge.unit_id, bank_account_id: charge.bank_account_id, external_id: transactionExternalId, transaction_date: new Date(event.settledAt).toISOString(), posted_at: new Date(event.settledAt).toISOString(), transaction_type: 'credit', amount: roundMoney(event.amount), currency: 'BRL', description: `Liquidação bancária ${charge.internal_reference}`, status: 'unmatched', source_system: 'provider', import_hash: payloadHash, idempotency_key: `bb-settlement:${transactionExternalId}`, raw_data: {}, metadata: { bank_charge_id: charge.id, bank_webhook_event_id: webhookEvent.id, txid: event.txid } });
    const settledAmount = roundMoney(Number(charge.settled_amount || 0) + (priorTransactions.length ? 0 : Number(event.amount || 0)));
    const nextStatus = settledAmount + 0.01 >= Number(charge.amount || 0) ? 'paid' : 'partially_paid';
    const updatedCharge = await db.BankCharge.update(charge.id, { status: nextStatus, settled_amount: settledAmount, settled_at: event.settledAt, bank_transaction_id: transaction.id, last_provider_status: nextStatus, last_provider_response_at: new Date().toISOString() });
    await db.BankWebhookEvent.update(webhookEvent.id, { status: 'processed', legal_entity_id: charge.legal_entity_id, bank_account_id: charge.bank_account_id, bank_charge_id: charge.id, processed_at: new Date().toISOString() });
    await recordDomainEvent(db, { eventType: `bank_charge.${nextStatus}`, eventKey: `bank_charge.${nextStatus}:${charge.id}:${eventKey}`, aggregateType: 'BankCharge', aggregateId: charge.id, legalEntityId: charge.legal_entity_id, unitId: charge.unit_id, actorType: 'integration', actorId: 'banco_do_brasil', payload: { charge_id: charge.id, bank_transaction_id: transaction.id, amount: event.amount, settled_amount: settledAmount, status: nextStatus } }).catch(() => null);
    return Response.json({ accepted: true, charge_status: updatedCharge.status, request_id: requestId });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    return Response.json({ error: 'banking_webhook_failed', request_id: requestId }, { status: 500 });
  }
});
