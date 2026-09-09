import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { authorizeUserOrInternal, enforceAuthenticatedUser, securityErrorResponse } from '../../shared/functionSecurity.js';
import { assertTransition, roundMoney } from '../../shared/businessCore.js';
import { bankingRuntimeConfig, BANK_CHARGE_TRANSITIONS, normalizePayer } from '../../shared/bankingProviderContract.js';
import { normalizeDate, sha256Json } from '../../shared/financeCore.js';
import { recordDomainEvent } from '../../shared/domainEvents.js';

function clean(value: unknown, max = 240) { return String(value || '').trim().slice(0, max); }
function reason(value: unknown) { const text = clean(value, 800); if (text.length < 8) throw new Error('reason_required'); return text; }
function runtimeConfig() { return bankingRuntimeConfig((name) => Deno.env.get(name) || ''); }

async function principalFor(base44: any, req: Request, user: any, permission: string, legalEntityId: string, unitId?: string, requireMfa = false) {
  return enforceAuthenticatedUser(base44, req, user, { permission, legalEntityId, unitId: unitId || null, requireMfa, source: 'manage_bank_charges' });
}

async function audit(db: any, principal: any, input: any) {
  await db.AuditLog.create({ action: input.action, entity_type: 'bank_charge', entity_id: input.charge.id, item_label: input.charge.internal_reference, reason: input.reason, user_id: principal.user.id, user_email: principal.user.email, user_name: principal.user.full_name || principal.user.display_name || principal.user.email, user_role: principal.role, legal_entity_id: input.charge.legal_entity_id, unit_id: input.charge.unit_id, request_id: input.request_id, before_data: input.before_data, after_data: input.after_data, metadata: input.metadata || {}, domain: 'finance', success: true });
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const body = await req.json();
    const action = clean(body.action, 60);
    const auth = await authorizeUserOrInternal(base44, req, body, { allowInternal: false, source: 'manage_bank_charges' });

    if (action === 'overview') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      await principalFor(base44, req, auth.user, 'banking.view', legalEntityId);
      const [charges, jobs] = await Promise.all([
        db.BankCharge.filter({ legal_entity_id: legalEntityId }, '-created_date', 1000).catch(() => []),
        db.IntegrationJob.filter({ legal_entity_id: legalEntityId, provider: 'banco_do_brasil' }, '-created_date', 1000).catch(() => []),
      ]);
      const config = runtimeConfig();
      return Response.json({ charges, jobs, provider: { environment: config.environment, external_requests_enabled: config.externalRequestsEnabled, production_enabled: config.productionEnabled }, request_id: requestId });
    }

    if (action === 'create_draft') {
      const legalEntityId = clean(body.legal_entity_id, 100); const unitId = clean(body.unit_id, 100);
      const principal = await principalFor(base44, req, auth.user, 'banking.manage', legalEntityId, unitId);
      const unit = await db.Unit.get(unitId).catch(() => null); const account = await db.BankAccount.get(body.bank_account_id).catch(() => null);
      if (!unit || unit.legal_entity_id !== legalEntityId || !account || account.legal_entity_id !== legalEntityId || account.status !== 'active') return Response.json({ error: 'bank_scope_mismatch', request_id: requestId }, { status: 409 });
      const party = await db.BusinessParty.get(body.business_party_id).catch(() => null);
      if (!party || ['blocked', 'inactive'].includes(party.status)) return Response.json({ error: 'payer_unavailable', request_id: requestId }, { status: 409 });
      const chargeType = clean(body.charge_type, 40);
      if (!['boleto', 'pix_immediate', 'pix_due_date'].includes(chargeType)) return Response.json({ error: 'invalid_charge_type', request_id: requestId }, { status: 422 });
      const amount = roundMoney(body.amount); const issueDate = normalizeDate(body.issue_date) || new Date().toISOString().slice(0, 10); const dueDate = normalizeDate(body.due_date);
      if (amount <= 0 || (chargeType !== 'pix_immediate' && !dueDate)) return Response.json({ error: 'invalid_bank_charge', request_id: requestId }, { status: 422 });
      const payer = normalizePayer({ name: body.payer_name || party.legal_name, tax_id: body.payer_tax_id || party.tax_id, email: body.payer_email, address: body.payer_address });
      const idempotencyKey = clean(body.idempotency_key, 160);
      if (idempotencyKey.length < 12) return Response.json({ error: 'idempotency_key_required', request_id: requestId }, { status: 422 });
      const prior = await db.BankCharge.filter({ legal_entity_id: legalEntityId, idempotency_key: idempotencyKey }, '-created_date', 2).catch(() => []);
      if (prior.length) return Response.json({ charge: prior[0], idempotent: true, request_id: requestId });
      let receivable = null;
      if (body.accounts_receivable_id) {
        receivable = await db.AccountsReceivable.get(body.accounts_receivable_id).catch(() => null);
        if (!receivable || receivable.legal_entity_id !== legalEntityId || ['paid', 'cancelled', 'written_off'].includes(receivable.status) || amount > Number(receivable.open_amount || 0) + 0.01) return Response.json({ error: 'receivable_scope_mismatch', request_id: requestId }, { status: 409 });
      }
      const config = runtimeConfig(); const changeReason = reason(body.reason);
      const reference = clean(body.internal_reference, 40) || `GB-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const charge = await db.BankCharge.create({ legal_entity_id: legalEntityId, unit_id: unitId, bank_account_id: account.id, business_party_id: party.id, contract_id: clean(body.contract_id, 100) || null, billing_statement_id: clean(body.billing_statement_id, 100) || null, accounts_receivable_id: receivable?.id || null, charge_type: chargeType, provider: 'banco_do_brasil', provider_environment: config.environment, internal_reference: reference, payer_name: payer.name, payer_tax_id: payer.taxId, payer_email: payer.email, payer_address: payer.address, amount, currency: 'BRL', issue_date: issueDate, due_date: dueDate, expires_at: body.expires_at || null, status: 'draft', settled_amount: 0, idempotency_key: idempotencyKey, created_by_user_id: principal.user.id, metadata: { description: clean(body.description, 300), with_pix: body.with_pix === true, modality_code: Number(body.modality_code || 1), receipt_limit_days: Number(body.receipt_limit_days || 0), expiration_seconds: Number(body.expiration_seconds || 3600), valid_after_due_days: Number(body.valid_after_due_days || 0) } });
      await audit(db, principal, { action: 'create', charge, reason: changeReason, request_id: requestId, after_data: { ...charge, payer_tax_id: `${payer.taxId.slice(0, 3)}***${payer.taxId.slice(-2)}` } });
      return Response.json({ charge, request_id: requestId }, { status: 201 });
    }

    const charge = await db.BankCharge.get(body.charge_id).catch(() => null);
    if (!charge) return Response.json({ error: 'bank_charge_not_found', request_id: requestId }, { status: 404 });

    if (action === 'detail') {
      await principalFor(base44, req, auth.user, 'banking.view', charge.legal_entity_id, charge.unit_id);
      const jobs = await db.IntegrationJob.filter({ entity_type: 'bank_charge', entity_id: charge.id }, '-created_date', 100).catch(() => []);
      return Response.json({ charge, jobs, request_id: requestId });
    }

    if (action === 'queue_transmission' || action === 'queue_cancellation' || action === 'queue_refund') {
      const principal = await principalFor(base44, req, auth.user, 'banking.manage', charge.legal_entity_id, charge.unit_id, true);
      const changeReason = reason(body.reason);
      const operation = action === 'queue_transmission' ? 'create_charge' : action === 'queue_cancellation' ? 'cancel_charge' : 'refund_charge';
      const nextStatus = action === 'queue_transmission' ? 'queued' : action === 'queue_cancellation' ? 'cancel_pending' : 'refund_pending';
      assertTransition(charge.status, nextStatus, BANK_CHARGE_TRANSITIONS, 'invalid_bank_charge_transition');
      const eventKey = `${operation}:${charge.id}:${body.operation_key || charge.idempotency_key}`;
      const priorJobs = await db.IntegrationJob.filter({ idempotency_key: eventKey }, '-created_date', 2).catch(() => []);
      if (priorJobs.length) return Response.json({ charge, job: priorJobs[0], idempotent: true, request_id: requestId });
      const safeRequest = { charge_id: charge.id, charge_type: charge.charge_type, internal_reference: charge.internal_reference, amount: charge.amount, due_date: charge.due_date, payer_tax_id_masked: `${String(charge.payer_tax_id).slice(0, 3)}***${String(charge.payer_tax_id).slice(-2)}` };
      const payloadHash = await sha256Json(safeRequest);
      const job = await db.IntegrationJob.create({ legal_entity_id: charge.legal_entity_id, unit_id: charge.unit_id, provider: 'banco_do_brasil', operation, entity_type: 'bank_charge', entity_id: charge.id, idempotency_key: eventKey, payload_hash: payloadHash, status: 'pending', attempt_count: 0, max_attempts: 5, request_snapshot: safeRequest, checkpoints: ['authorized_by_user'], created_by_user_id: principal.user.id, metadata: { reason: changeReason } });
      const updated = await db.BankCharge.update(charge.id, { status: nextStatus, integration_job_id: job.id, safe_error_code: null });
      await audit(db, principal, { action: 'status_change', charge, reason: changeReason, request_id: requestId, before_data: { status: charge.status }, after_data: { status: nextStatus, integration_job_id: job.id }, metadata: { operation } });
      await recordDomainEvent(db, { eventType: `bank_charge.${nextStatus}`, aggregateType: 'BankCharge', aggregateId: charge.id, legalEntityId: charge.legal_entity_id, unitId: charge.unit_id, actorId: principal.user.id, eventKey: `bank_charge.${nextStatus}:${charge.id}:${job.id}`, payload: { job_id: job.id, operation, amount: charge.amount } });
      return Response.json({ charge: updated, job, request_id: requestId });
    }

    if (action === 'cancel_draft') {
      const principal = await principalFor(base44, req, auth.user, 'banking.manage', charge.legal_entity_id, charge.unit_id, true);
      if (!['draft', 'queued', 'failed'].includes(charge.status)) return Response.json({ error: 'bank_charge_requires_provider_cancellation', request_id: requestId }, { status: 409 });
      const changeReason = reason(body.reason);
      const updated = await db.BankCharge.update(charge.id, { status: 'cancelled', safe_error_code: null, metadata: { ...(charge.metadata || {}), cancellation_reason: changeReason, cancelled_at: new Date().toISOString() } });
      if (charge.integration_job_id) await db.IntegrationJob.update(charge.integration_job_id, { status: 'cancelled', completed_at: new Date().toISOString() }).catch(() => null);
      await audit(db, principal, { action: 'status_change', charge, reason: changeReason, request_id: requestId, before_data: { status: charge.status }, after_data: { status: 'cancelled' } });
      return Response.json({ charge: updated, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const validation = new Set(['reason_required', 'invalid_payer_tax_id', 'payer_name_required', 'invalid_bank_charge_transition', 'invalid_bank_charge', 'domain_event_key_conflict']);
    return Response.json({ error: validation.has(error?.message) ? error.message : 'bank_charge_operation_failed', request_id: requestId }, { status: validation.has(error?.message) ? 422 : 500 });
  }
});
