import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { authorizeUserOrInternal, enforceAuthenticatedUser, securityErrorResponse } from '../../shared/functionSecurity.js';
import { buildFiscalDraft, buildFocusReference, getFiscalReadiness, validateFiscalProfile } from '../../shared/fiscalProviderContract.js';

function clean(value: unknown, max = 500) { return String(value || '').trim().slice(0, max); }
function reason(value: unknown, min = 8) { const text = clean(value, 800); if (text.length < min) throw new Error('reason_required'); return text; }
async function sha256(value: unknown) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function principalFor(base44: any, req: Request, user: any, permission: string, legalEntityId: string, requireMfa = false) { return enforceAuthenticatedUser(base44, req, user, { permission, legalEntityId, requireMfa, source: 'manage_fiscal_document' }); }
async function scopedUnit(db: any, unitId: string, legalEntityId: string) { const unit = await db.Unit.get(unitId).catch(() => null); if (!unit || unit.legal_entity_id !== legalEntityId) throw new Error('unit_company_mismatch'); return unit; }
async function addEvent(db: any, document: any, principal: any, requestId: string, eventType: string, status: string, message: string, metadata: any = {}) {
  const eventKey = `${eventType}:${document.id}:${metadata.job_id || metadata.provider_reference || requestId}`;
  const prior = await db.FiscalEvent.filter({ event_key: eventKey }, '-created_date', 2).catch(() => []);
  if (prior.length) return prior[0];
  return db.FiscalEvent.create({ legal_entity_id: document.legal_entity_id, unit_id: document.unit_id, fiscal_document_id: document.id, event_key: eventKey, event_type: eventType, status, provider: document.provider, environment: document.environment, external_protocol: document.provider_reference || document.external_protocol, code: metadata.code, message: clean(message, 800), payload_hash: document.provider_payload_hash, occurred_at: new Date().toISOString(), actor_user_id: principal?.user?.id || 'system', actor_name: principal?.user?.full_name || principal?.user?.email || 'Sistema', request_id: requestId, metadata });
}
async function audit(db: any, principal: any, input: any) { await db.AuditLog.create({ action: input.action, entity_type: input.entity_type, entity_id: input.entity_id, item_label: input.item_label, reason: input.reason, user_id: principal.user.id, user_email: principal.user.email, user_name: principal.user.full_name || principal.user.email, user_role: principal.role, legal_entity_id: input.legal_entity_id, unit_id: input.unit_id, request_id: input.request_id, before_data: input.before_data, after_data: input.after_data, metadata: input.metadata || {}, domain: 'fiscal', success: true }); }
async function createJob(db: any, document: any, operation: string, operationKey: string, principal: any, metadata: any = {}) {
  const idempotencyKey = `focusnfe:${operation}:${document.id}:${operationKey}`;
  const prior = await db.IntegrationJob.filter({ idempotency_key: idempotencyKey }, '-created_date', 2).catch(() => []);
  if (prior.length) return { job: prior[0], idempotent: true };
  const job = await db.IntegrationJob.create({ provider: 'focusnfe', operation, entity_type: 'fiscal_document', entity_id: document.id, legal_entity_id: document.legal_entity_id, unit_id: document.unit_id, status: 'pending', attempt_count: 0, max_attempts: 5, idempotency_key: idempotencyKey, correlation_id: document.request_id || document.id, payload_snapshot: { fiscal_document_id: document.id, fiscal_profile_id: document.fiscal_profile_id, provider_reference: document.provider_reference }, checkpoints: ['document_validated', 'human_command_authorized'], created_by_user_id: principal.user.id, metadata });
  return { job, idempotent: false };
}

export default async function(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req); const db = base44.asServiceRole.entities;
    const body = await req.json(); const action = clean(body.action, 60);
    const auth = await authorizeUserOrInternal(base44, req, body, { allowInternal: false, source: 'manage_fiscal_document' });

    if (action === 'overview') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      await principalFor(base44, req, auth.user, 'fiscal.view', legalEntityId);
      const [profiles, documents, events, jobs, orders, statements] = await Promise.all([
        db.FiscalProfile.filter({ legal_entity_id: legalEntityId }, '-updated_date', 100).catch(() => []),
        db.FiscalDocument.filter({ legal_entity_id: legalEntityId }, '-created_date', 2000).catch(() => []),
        db.FiscalEvent.filter({ legal_entity_id: legalEntityId }, '-occurred_at', 3000).catch(() => []),
        db.IntegrationJob.filter({ legal_entity_id: legalEntityId, provider: 'focusnfe' }, '-created_date', 1000).catch(() => []),
        db.Order.filter({ legal_entity_id: legalEntityId }, '-created_date', 2000).catch(() => []),
        db.BillingStatement.filter({ legal_entity_id: legalEntityId }, '-created_date', 1000).catch(() => []),
      ]);
      return Response.json({ profiles, documents, events, jobs, orders, statements, request_id: requestId });
    }

    if (action === 'save_profile') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const principal = await principalFor(base44, req, auth.user, 'fiscal.manage', legalEntityId, true);
      const legalEntity = await db.LegalEntity.get(legalEntityId).catch(() => null);
      if (!legalEntity) return Response.json({ error: 'legal_entity_not_found', request_id: requestId }, { status: 404 });
      const unitIds = [...new Set((body.unit_ids || [body.unit_id]).filter(Boolean).map((value: any) => clean(value, 100)))];
      if (!unitIds.length) return Response.json({ error: 'fiscal_unit_required', request_id: requestId }, { status: 422 });
      for (const unitId of unitIds) await scopedUnit(db, unitId, legalEntityId);
      const current = body.fiscal_profile_id ? await db.FiscalProfile.get(body.fiscal_profile_id).catch(() => null) : (await db.FiscalProfile.filter({ legal_entity_id: legalEntityId }, '-updated_date', 2).catch(() => []))[0];
      if (current && current.legal_entity_id && current.legal_entity_id !== legalEntityId) return Response.json({ error: 'fiscal_profile_scope_mismatch', request_id: requestId }, { status: 409 });
      const provider = clean(body.provider || current?.provider || 'focusnfe', 40);
      const environment = clean(body.environment || current?.environment || 'disabled', 40);
      if (!['focusnfe', 'none', 'national_nfse'].includes(provider) || !['disabled', 'homologation', 'production'].includes(environment)) return Response.json({ error: 'invalid_fiscal_provider_configuration', request_id: requestId }, { status: 422 });
      const changeReason = reason(body.reason);
      const data = {
        legal_entity_id: legalEntityId, unit_id: unitIds[0], unit_ids: unitIds, status: 'draft', provider, environment,
        municipality_code: clean(body.municipality_code || current?.municipality_code || legalEntity.address?.municipality_code, 20), municipality_name: clean(body.municipality_name || current?.municipality_name || legalEntity.address?.city, 100), state: clean(body.state || current?.state || legalEntity.address?.state, 2).toUpperCase(),
        legal_name: clean(body.legal_name || current?.legal_name || legalEntity.legal_name, 180), trade_name: clean(body.trade_name || current?.trade_name || legalEntity.trade_name, 180), tax_id: clean(body.tax_id || current?.tax_id || legalEntity.tax_id, 20), municipal_registration: clean(body.municipal_registration || current?.municipal_registration || legalEntity.municipal_registration, 60),
        tax_regime: clean(body.tax_regime || current?.tax_regime || legalEntity.tax_regime, 80), special_tax_regime: clean(body.special_tax_regime || current?.special_tax_regime, 40), service_code: clean(body.service_code || current?.service_code, 80), service_description: clean(body.service_description || current?.service_description, 500), municipal_tax_code: clean(body.municipal_tax_code || current?.municipal_tax_code, 80), iss_rate: Number(body.iss_rate ?? current?.iss_rate ?? 0), iss_withheld: body.iss_withheld ?? current?.iss_withheld ?? false,
        operation_nature: clean(body.operation_nature || current?.operation_nature || '1', 1), simple_national_opt_in: body.simple_national_opt_in ?? current?.simple_national_opt_in ?? false, cultural_incentive: body.cultural_incentive ?? current?.cultural_incentive ?? false, cnae_code: clean(body.cnae_code || current?.cnae_code, 20), nbs_code: clean(body.nbs_code || current?.nbs_code, 30), operation_indicator_code: clean(body.operation_indicator_code || current?.operation_indicator_code, 30), ibs_cbs_tax_classification: clean(body.ibs_cbs_tax_classification || current?.ibs_cbs_tax_classification, 60),
        rps_series: clean(body.rps_series || current?.rps_series || '1', 20), next_rps_number: Math.max(1, Number(body.next_rps_number ?? current?.next_rps_number ?? 1)), provider_company_reference: clean(body.provider_company_reference || current?.provider_company_reference, 100), credential_reference: clean(body.credential_reference || current?.credential_reference, 120), certificate_reference: clean(body.certificate_reference || current?.certificate_reference, 120), external_requests_enabled: current?.external_requests_enabled === true, production_enabled: current?.production_enabled === true, webhook_configured: current?.webhook_configured === true, last_validation_status: 'not_tested', created_by_user_id: current?.created_by_user_id || principal.user.id, updated_by_user_id: principal.user.id, notes: clean(body.notes || current?.notes, 1000), metadata: { ...(current?.metadata || {}), target_standard: provider === 'focusnfe' ? 'focusnfe' : 'national_nfse' },
      };
      const profile = current ? await db.FiscalProfile.update(current.id, data) : await db.FiscalProfile.create(data);
      await audit(db, principal, { action: current ? 'update' : 'create', entity_type: 'fiscal_profile', entity_id: profile.id, item_label: profile.trade_name || profile.legal_name, reason: changeReason, legal_entity_id: legalEntityId, unit_id: profile.unit_id, request_id: requestId, before_data: current, after_data: { ...profile, credential_reference: profile.credential_reference ? '[REFERENCE]' : null, certificate_reference: profile.certificate_reference ? '[REFERENCE]' : null } });
      return Response.json({ fiscal_profile: profile, readiness: validateFiscalProfile(profile), transmission_enabled: profile.external_requests_enabled === true, request_id: requestId });
    }

    if (action === 'set_activation') {
      const profile = await db.FiscalProfile.get(body.fiscal_profile_id).catch(() => null);
      if (!profile?.legal_entity_id) return Response.json({ error: 'fiscal_profile_not_found', request_id: requestId }, { status: 404 });
      const principal = await principalFor(base44, req, auth.user, 'fiscal.transmit', profile.legal_entity_id, true);
      if (!['super_admin', 'admin'].includes(principal.role)) return Response.json({ error: 'admin_approval_required', request_id: requestId }, { status: 403 });
      const changeReason = reason(body.reason, 15); const enableExternal = body.external_requests_enabled === true; const enableProduction = body.production_enabled === true;
      const readiness = validateFiscalProfile(profile);
      if ((enableExternal || enableProduction) && !readiness.valid) return Response.json({ error: 'fiscal_profile_incomplete', readiness, request_id: requestId }, { status: 422 });
      if (enableProduction && (!profile.homologation_approved_at || !profile.webhook_configured)) return Response.json({ error: 'fiscal_production_prerequisites_missing', request_id: requestId }, { status: 409 });
      const patch: any = { external_requests_enabled: enableExternal, production_enabled: enableProduction, status: enableProduction ? 'active' : enableExternal ? 'ready_for_homologation' : 'suspended', updated_by_user_id: principal.user.id };
      if (body.approve_homologation === true) { patch.homologation_approved_at = new Date().toISOString(); patch.homologation_approved_by_user_id = principal.user.id; }
      if (body.webhook_configured === true) patch.webhook_configured = true;
      const updated = await db.FiscalProfile.update(profile.id, patch);
      await audit(db, principal, { action: 'status_change', entity_type: 'fiscal_profile', entity_id: profile.id, item_label: profile.trade_name || profile.legal_name, reason: changeReason, legal_entity_id: profile.legal_entity_id, unit_id: profile.unit_id, request_id: requestId, before_data: { status: profile.status, external_requests_enabled: profile.external_requests_enabled, production_enabled: profile.production_enabled }, after_data: patch });
      return Response.json({ fiscal_profile: updated, request_id: requestId });
    }

    if (action === 'prepare') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const principal = await principalFor(base44, req, auth.user, 'fiscal.manage', legalEntityId, true);
      const unitId = clean(body.unit_id, 100); await scopedUnit(db, unitId, legalEntityId);
      const profile = body.fiscal_profile_id ? await db.FiscalProfile.get(body.fiscal_profile_id).catch(() => null) : (await db.FiscalProfile.filter({ legal_entity_id: legalEntityId }, '-updated_date', 2).catch(() => []))[0];
      if (!profile || profile.legal_entity_id !== legalEntityId || !(profile.unit_ids || [profile.unit_id]).includes(unitId)) return Response.json({ error: 'fiscal_profile_scope_mismatch', request_id: requestId }, { status: 409 });
      const idempotencyKey = clean(body.idempotency_key, 180); if (idempotencyKey.length < 12) return Response.json({ error: 'idempotency_key_required', request_id: requestId }, { status: 422 });
      const priorDocuments = await db.FiscalDocument.filter({ idempotency_key: idempotencyKey }, '-created_date', 2).catch(() => []);
      if (priorDocuments.length) return Response.json({ fiscal_document: priorDocuments[0], duplicate: true, request_id: requestId });
      let statement = null; const orderIds = [...new Set((body.order_ids || []).map((value: any) => clean(value, 100)))];
      if (body.billing_statement_id) { statement = await db.BillingStatement.get(body.billing_statement_id).catch(() => null); if (!statement || statement.legal_entity_id !== legalEntityId || statement.unit_id !== unitId) return Response.json({ error: 'billing_statement_not_found', request_id: requestId }, { status: 404 }); orderIds.push(...(statement.order_ids || [])); }
      const uniqueOrderIds = [...new Set(orderIds)]; if (!uniqueOrderIds.length) return Response.json({ error: 'fiscal_source_required', request_id: requestId }, { status: 422 });
      const orders = [];
      for (const orderId of uniqueOrderIds) { const order = await db.Order.get(orderId).catch(() => null); if (!order || order.unit_id !== unitId || (order.legal_entity_id && order.legal_entity_id !== legalEntityId)) return Response.json({ error: 'order_scope_mismatch', request_id: requestId }, { status: 409 }); orders.push(order); }
      const customerId = statement?.customer_id || body.customer_id || orders[0]?.customer_id;
      if (!statement && orders.some((order: any) => order.customer_id !== customerId)) return Response.json({ error: 'multiple_recipients_require_statement', request_id: requestId }, { status: 422 });
      const customer = await db.Customer.get(customerId).catch(() => null); if (!customer || (customer.legal_entity_id && customer.legal_entity_id !== legalEntityId)) return Response.json({ error: 'fiscal_recipient_not_found', request_id: requestId }, { status: 404 });
      const competenceDate = clean(body.competence_date || new Date().toISOString().slice(0, 10), 10); const draft = buildFiscalDraft({ profile, customer, orders, statement, competenceDate });
      const rpsNumber = Math.max(1, Number(profile.next_rps_number || 1)); const reservationKey = `rps:${profile.id}:${profile.rps_series}:${rpsNumber}`; const payloadHash = await sha256({ legalEntityId, unitId, orderIds: uniqueOrderIds, statementId: statement?.id, rpsNumber, total: draft.total_amount });
      const reservation = await db.FiscalSequenceReservation.create({ legal_entity_id: legalEntityId, unit_id: unitId, fiscal_profile_id: profile.id, series: profile.rps_series, number: rpsNumber, reservation_key: reservationKey, payload_hash: payloadHash, status: 'reserved', reserved_at: new Date().toISOString(), created_by_user_id: principal.user.id, metadata: { request_id: requestId } });
      const collisions = await db.FiscalSequenceReservation.filter({ fiscal_profile_id: profile.id, series: profile.rps_series, number: rpsNumber }, 'reserved_at', 10).catch(() => []);
      if (collisions.length > 1 && collisions[0].id !== reservation.id) { await db.FiscalSequenceReservation.update(reservation.id, { status: 'conflict' }); return Response.json({ error: 'rps_sequence_conflict', request_id: requestId }, { status: 409 }); }
      const document = await db.FiscalDocument.create({ ...draft, legal_entity_id: legalEntityId, business_party_id: customer.business_party_id || null, service_order_id: orders[0]?.service_order_id || null, unit_id: unitId, fiscal_profile_id: profile.id, customer_id: customer.id, order_ids: uniqueOrderIds, accounts_receivable_ids: statement?.accounts_receivable_ids || [], billing_statement_id: statement?.id, rps_number: rpsNumber, rps_series: profile.rps_series, issue_date: new Date().toISOString(), provider_payload_hash: payloadHash, attempt_count: 0, idempotency_key: idempotencyKey, created_by_user_id: principal.user.id, request_id: requestId, safe_provider_snapshot: {} });
      const providerReference = buildFocusReference({ legalEntityId, taxId: profile.tax_id, series: profile.rps_series, number: rpsNumber, documentId: document.id });
      const updatedDocument = await db.FiscalDocument.update(document.id, { provider_reference: providerReference, external_protocol: providerReference });
      await db.FiscalSequenceReservation.update(reservation.id, { fiscal_document_id: document.id, status: 'consumed', consumed_at: new Date().toISOString() }); await db.FiscalProfile.update(profile.id, { next_rps_number: rpsNumber + 1, updated_by_user_id: principal.user.id });
      for (const order of orders) await db.Order.update(order.id, { legal_entity_id: order.legal_entity_id || legalEntityId, fiscal_document_ids: [...new Set([...(order.fiscal_document_ids || []), document.id])], fiscal_status: 'draft' });
      if (statement) await db.BillingStatement.update(statement.id, { legal_entity_id: statement.legal_entity_id || legalEntityId, fiscal_document_id: document.id });
      await addEvent(db, updatedDocument, principal, requestId, 'created', 'success', 'RPS preparado localmente.', { reservation_id: reservation.id });
      return Response.json({ fiscal_document: updatedDocument, readiness: getFiscalReadiness(profile, updatedDocument), request_id: requestId }, { status: 201 });
    }

    const document = body.fiscal_document_id ? await db.FiscalDocument.get(body.fiscal_document_id).catch(() => null) : null;
    if (!document?.legal_entity_id) return Response.json({ error: 'fiscal_document_not_found', request_id: requestId }, { status: 404 });
    const profile = await db.FiscalProfile.get(document.fiscal_profile_id).catch(() => null); if (!profile || profile.legal_entity_id !== document.legal_entity_id) return Response.json({ error: 'fiscal_profile_scope_mismatch', request_id: requestId }, { status: 409 });

    if (action === 'validate') {
      const principal = await principalFor(base44, req, auth.user, 'fiscal.manage', document.legal_entity_id, true); const readiness = getFiscalReadiness(profile, document);
      const updated = await db.FiscalDocument.update(document.id, { status: readiness.structurally_ready ? 'ready' : 'draft', last_error_code: readiness.errors.length ? 'validation_failed' : null, last_error_message: readiness.errors.join(', ') || null });
      await db.FiscalProfile.update(profile.id, { status: readiness.structurally_ready ? 'ready_for_homologation' : 'draft', last_validation_at: new Date().toISOString(), last_validation_status: readiness.structurally_ready ? 'success' : 'failed', updated_by_user_id: principal.user.id });
      await addEvent(db, updated, principal, requestId, 'validated', readiness.structurally_ready ? 'success' : 'failed', readiness.structurally_ready ? 'Estrutura fiscal pronta.' : 'Documento fiscal incompleto.', { errors: readiness.errors });
      return Response.json({ fiscal_document: updated, readiness, request_id: requestId });
    }

    if (['transmit', 'queue_transmission', 'consult', 'queue_consult', 'cancel_nfse', 'queue_cancel'].includes(action)) {
      const principal = await principalFor(base44, req, auth.user, 'fiscal.transmit', document.legal_entity_id, true);
      const isCancel = ['cancel_nfse', 'queue_cancel'].includes(action); const isConsult = ['consult', 'queue_consult'].includes(action); const operation = isCancel ? 'cancel_nfse' : isConsult ? 'consult_nfse' : 'issue_nfse';
      const changeReason = reason(body.reason || (isConsult ? 'Consulta manual do estado fiscal.' : 'Comando fiscal autorizado.'), isCancel ? 15 : 8);
      if (profile.provider !== 'focusnfe') return Response.json({ error: 'provider_not_focusnfe', request_id: requestId }, { status: 409 });
      if (!isCancel && !isConsult) { const readiness = getFiscalReadiness(profile, document); if (!readiness.transmission_ready) return Response.json({ error: 'fiscal_not_ready', readiness, request_id: requestId }, { status: 422 }); if (!['draft', 'ready', 'rejected', 'error'].includes(document.status)) return Response.json({ error: 'fiscal_document_not_transmittable', request_id: requestId }, { status: 409 }); }
      if (isConsult && !document.provider_reference) return Response.json({ error: 'focusnfe_ref_required', request_id: requestId }, { status: 422 });
      if (isCancel && document.status !== 'authorized') return Response.json({ error: 'only_authorized_nfse_can_be_cancelled', request_id: requestId }, { status: 409 });
      const operationKey = clean(body.operation_key || crypto.randomUUID(), 180); const queued = await createJob(db, document, operation, operationKey, principal, { reason: changeReason });
      const nextStatus = isCancel ? 'cancel_requested' : isConsult ? document.status : 'queued';
      const updated = await db.FiscalDocument.update(document.id, { status: nextStatus, integration_job_id: queued.job.id, cancellation_reason: isCancel ? changeReason : document.cancellation_reason });
      await addEvent(db, updated, principal, requestId, isCancel ? 'cancel_requested' : 'queued', 'pending', isCancel ? 'Cancelamento enfileirado para gateway interno.' : isConsult ? 'Consulta enfileirada para gateway interno.' : 'Emissão enfileirada para gateway interno.', { job_id: queued.job.id, operation });
      await audit(db, principal, { action: isCancel ? 'cancel' : 'approve', entity_type: 'fiscal_document', entity_id: document.id, item_label: `RPS ${document.rps_series}-${document.rps_number}`, reason: changeReason, legal_entity_id: document.legal_entity_id, unit_id: document.unit_id, request_id: requestId, before_data: { status: document.status }, after_data: { status: nextStatus, integration_job_id: queued.job.id }, metadata: { operation } });
      return Response.json({ fiscal_document: updated, integration_job: queued.job, queued: true, duplicate: queued.idempotent, request_id: requestId });
    }

    if (action === 'cancel_draft' || action === 'delete' || action === 'retire') {
      const principal = await principalFor(base44, req, auth.user, 'fiscal.manage', document.legal_entity_id, true); const changeReason = reason(body.reason || 'Aposentadoria controlada do documento fiscal local.');
      if (!['draft', 'ready', 'rejected', 'error', 'cancelled'].includes(document.status)) return Response.json({ error: 'fiscal_document_not_retirable', request_id: requestId }, { status: 409 });
      const updated = await db.FiscalDocument.update(document.id, { status: document.status === 'cancelled' ? 'cancelled' : 'cancelled', cancelled_at: document.cancelled_at || new Date().toISOString(), cancellation_reason: changeReason, retired_at: new Date().toISOString(), retired_by_user_id: principal.user.id });
      for (const orderId of document.order_ids || []) { const order = await db.Order.get(orderId).catch(() => null); if (order && (order.fiscal_document_ids || []).includes(document.id)) { const remaining = (order.fiscal_document_ids || []).filter((id: string) => id !== document.id); await db.Order.update(order.id, { fiscal_document_ids: remaining, fiscal_status: remaining.length ? order.fiscal_status : 'not_issued' }); } }
      await addEvent(db, updated, principal, requestId, 'cancelled', 'success', changeReason, { retired: true });
      await audit(db, principal, { action: 'status_change', entity_type: 'fiscal_document', entity_id: document.id, item_label: `RPS ${document.rps_series}-${document.rps_number}`, reason: changeReason, legal_entity_id: document.legal_entity_id, unit_id: document.unit_id, request_id: requestId, before_data: { status: document.status }, after_data: { status: updated.status, retired_at: updated.retired_at } });
      return Response.json({ fiscal_document: updated, retired: true, request_id: requestId });
    }

    if (action === 'import_ref') return Response.json({ error: 'fiscal_import_ref_retired_use_gateway', request_id: requestId }, { status: 410 });
    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const validation = new Set(['reason_required', 'unit_company_mismatch', 'fiscal_profile_incomplete', 'fiscal_recipient_incomplete', 'fiscal_recipient_required', 'invalid_fiscal_amount']);
    return Response.json({ error: validation.has(error?.message) ? error.message : 'fiscal_operation_failed', details: error?.details, request_id: requestId }, { status: validation.has(error?.message) ? 422 : 500 });
  }
}
