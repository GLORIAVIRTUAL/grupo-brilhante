import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { secrets } from 'base44:runtime';
import { buildFiscalDraft, getFiscalReadiness, validateFiscalProfile, buildFocusNfePayload, getFocusNfeBaseUrl } from '../../shared/fiscalProviderContract.js';

const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);
const OPERATOR_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance', 'cashier']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

async function addEvent(base44: any, document: any, user: any, requestId: string, eventType: string, status: string, message: string, payload = {}) {
  return base44.asServiceRole.entities.FiscalEvent.create({
    fiscal_document_id: document.id,
    unit_id: document.unit_id,
    event_type: eventType,
    status,
    provider: document.provider,
    environment: document.environment,
    code: payload.code,
    message,
    payload_hash: document.provider_payload_hash,
    occurred_at: new Date().toISOString(),
    actor_user_id: user?.id || 'system',
    actor_name: user?.full_name || user?.display_name || 'Sistema',
    request_id: requestId,
    metadata: { ...payload, sequence: Number(document.attempt_count || 0) + 1 },
  });
}

function focusNfeAuthHeader() {
  const token = secrets.get('FOCUSNFE_TOKEN');
  if (!token) throw Object.assign(new Error('focusnfe_token_not_configured'), { code: 'focusnfe_token_not_configured' });
  const encoded = btoa(`${token}:`);
  return `Basic ${encoded}`;
}

async function focusNfeRequest(method: string, path: string, body?: any) {
  const url = `${getFocusNfeBaseUrl()}/v2${path}`;
  const headers: Record<string, string> = {
    'Authorization': focusNfeAuthHeader(),
    'Accept': 'application/json',
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

export default async function(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_fiscal_document' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    const body = await req.json();
    const action = String(body.action || '');

    if (action === 'save_profile') {
      if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('fiscal.configure')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
      const unitId = body.unit_id || user.primary_unit_id;
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const profiles = await base44.asServiceRole.entities.FiscalProfile.filter({ unit_id: unitId });
      const current = body.fiscal_profile_id ? await base44.asServiceRole.entities.FiscalProfile.get(body.fiscal_profile_id) : profiles[0];
      const provider = body.provider || current?.provider || 'focusnfe';
      const environment = body.environment || current?.environment || (provider === 'focusnfe' ? 'homologation' : 'disabled');
      const data = {
        unit_id: unitId,
        status: 'draft',
        provider,
        environment,
        municipality_code: body.municipality_code || current?.municipality_code || '4314902',
        municipality_name: body.municipality_name || current?.municipality_name || 'Porto Alegre',
        legal_name: body.legal_name ?? current?.legal_name,
        trade_name: body.trade_name ?? current?.trade_name,
        tax_id: body.tax_id ?? current?.tax_id,
        municipal_registration: body.municipal_registration ?? current?.municipal_registration,
        tax_regime: body.tax_regime ?? current?.tax_regime,
        special_tax_regime: body.special_tax_regime ?? current?.special_tax_regime,
        service_code: body.service_code ?? current?.service_code,
        service_description: body.service_description ?? current?.service_description,
        municipal_tax_code: body.municipal_tax_code ?? current?.municipal_tax_code,
        iss_rate: Number(body.iss_rate ?? current?.iss_rate ?? 0),
        iss_withheld: body.iss_withheld ?? current?.iss_withheld ?? false,
        rps_series: body.rps_series ?? current?.rps_series ?? '1',
        next_rps_number: Math.max(1, Number(body.next_rps_number ?? current?.next_rps_number ?? 1)),
        credential_reference: body.credential_reference ?? current?.credential_reference,
        certificate_reference: body.certificate_reference ?? current?.certificate_reference,
        last_validation_status: 'not_tested',
        created_by_user_id: current?.created_by_user_id || user.id,
        updated_by_user_id: user.id,
        notes: body.notes ?? current?.notes,
        metadata: { ...(current?.metadata || {}), target_standard: provider === 'focusnfe' ? 'focusnfe' : 'national_nfse', transmission_enabled: provider === 'focusnfe' },
      };
      const profile = current
        ? await base44.asServiceRole.entities.FiscalProfile.update(current.id, data)
        : await base44.asServiceRole.entities.FiscalProfile.create(data);
      await base44.asServiceRole.entities.AuditLog.create({
        action: current ? 'update' : 'create', entity_type: 'fiscal_profile', entity_id: profile.id,
        item_label: profile.trade_name || profile.legal_name || unitId, reason: `fiscal_profile_saved_provider_${provider}`,
        user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role,
        unit_id: unitId, request_id: requestId, before_data: current || null, after_data: { ...profile, credential_reference: profile.credential_reference ? '[REFERENCE]' : undefined, certificate_reference: profile.certificate_reference ? '[REFERENCE]' : undefined }, success: true,
      });
      return Response.json({ fiscal_profile: profile, readiness: validateFiscalProfile(profile), transmission_enabled: provider === 'focusnfe', request_id: requestId });
    }

    if (!OPERATOR_ROLES.has(user.role) && !(user.permissions || []).includes('fiscal.manage')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });

    if (action === 'prepare') {
      const unitId = body.unit_id || user.primary_unit_id;
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const profiles = await base44.asServiceRole.entities.FiscalProfile.filter({ unit_id: unitId });
      const profile = body.fiscal_profile_id ? await base44.asServiceRole.entities.FiscalProfile.get(body.fiscal_profile_id) : profiles[0];
      if (!profile) return Response.json({ error: 'fiscal_profile_not_found', request_id: requestId }, { status: 404 });
      const orderIds = [...new Set(body.order_ids || [])];
      let statement = null;
      if (body.billing_statement_id) {
        statement = await base44.asServiceRole.entities.BillingStatement.get(body.billing_statement_id);
        if (!statement || statement.unit_id !== unitId) return Response.json({ error: 'billing_statement_not_found', request_id: requestId }, { status: 404 });
        orderIds.push(...(statement.order_ids || []));
      }
      const uniqueOrderIds = [...new Set(orderIds)];
      if (uniqueOrderIds.length === 0) return Response.json({ error: 'fiscal_source_required', request_id: requestId }, { status: 422 });
      const orders = [];
      for (const orderId of uniqueOrderIds) {
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if (!order || order.unit_id !== unitId) return Response.json({ error: 'order_not_found', request_id: requestId }, { status: 404 });
        orders.push(order);
      }
      const customerId = statement?.customer_id || body.customer_id || orders[0]?.customer_id;
      if (orders.some((order: any) => order.customer_id !== customerId) && !statement) return Response.json({ error: 'multiple_recipients_require_statement', request_id: requestId }, { status: 422 });
      const customer = await base44.asServiceRole.entities.Customer.get(customerId);
      const idempotencyKey = String(body.idempotency_key || '').trim();
      if (!idempotencyKey) return Response.json({ error: 'idempotency_key_required', request_id: requestId }, { status: 422 });
      const existing = await base44.asServiceRole.entities.FiscalDocument.filter({ idempotency_key: idempotencyKey });
      if (existing.length > 0) return Response.json({ fiscal_document: existing[0], duplicate: true, request_id: requestId });
      const competenceDate = body.competence_date || new Date().toISOString().slice(0, 10);
      const draft = buildFiscalDraft({ profile, customer, orders, statement, competenceDate });
      const rpsNumber = Math.max(1, Number(profile.next_rps_number || 1));
      const payloadHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ unitId, uniqueOrderIds, statementId: statement?.id, rpsNumber, total: draft.total_amount })));
      const hash = Array.from(new Uint8Array(payloadHash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const document = await base44.asServiceRole.entities.FiscalDocument.create({
        ...draft,
        unit_id: unitId,
        fiscal_profile_id: profile.id,
        customer_id: customer.id,
        order_ids: uniqueOrderIds,
        accounts_receivable_ids: statement?.accounts_receivable_ids || [],
        billing_statement_id: statement?.id,
        rps_number: rpsNumber,
        rps_series: profile.rps_series,
        issue_date: new Date().toISOString(),
        provider_payload_hash: hash,
        attempt_count: 0,
        idempotency_key: idempotencyKey,
        created_by_user_id: user.id,
        request_id: requestId,
      });
      await base44.asServiceRole.entities.FiscalProfile.update(profile.id, { next_rps_number: rpsNumber + 1, updated_by_user_id: user.id });
      for (const order of orders) await base44.asServiceRole.entities.Order.update(order.id, { fiscal_document_ids: [...new Set([...(order.fiscal_document_ids || []), document.id])], fiscal_status: 'draft' });
      if (statement) await base44.asServiceRole.entities.BillingStatement.update(statement.id, { fiscal_document_id: document.id });
      await addEvent(base44, document, user, requestId, 'created', 'success', 'RPS preparado localmente.', { transmission_enabled: draft.metadata?.transmission_enabled });
      return Response.json({ fiscal_document: document, readiness: getFiscalReadiness(profile, document), request_id: requestId });
    }

    if (action === 'import_ref') {
      const unitId = body.unit_id || user.primary_unit_id;
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const ref = String(body.ref || '').trim();
      if (!ref) return Response.json({ error: 'focusnfe_ref_required', request_id: requestId }, { status: 422 });
      const profiles = await base44.asServiceRole.entities.FiscalProfile.filter({ unit_id: unitId });
      const importProfile = profiles[0];
      if (!importProfile) return Response.json({ error: 'fiscal_profile_not_found', request_id: requestId }, { status: 404 });
      const existingByRef = await base44.asServiceRole.entities.FiscalDocument.filter({ external_protocol: ref });
      if (existingByRef.length > 0) return Response.json({ fiscal_document: existingByRef[0], duplicate: true, request_id: requestId });
      const { status: httpStatus, data: focusData } = await focusNfeRequest('GET', `/nfse/${encodeURIComponent(ref)}`);
      if (httpStatus === 404) return Response.json({ error: 'focusnfe_not_found', request_id: requestId }, { status: 404 });
      if (httpStatus >= 400) return Response.json({ error: 'focusnfe_request_failed', focusnfe_response: focusData, request_id: requestId }, { status: 502 });
      const statusMap: Record<string, string> = {
        'processando_autorizacao': 'processing',
        'autorizada': 'authorized',
        'cancelada': 'cancelled',
        'erro_autorizacao': 'rejected',
      };
      const refParts = ref.split('-');
      const imported = await base44.asServiceRole.entities.FiscalDocument.create({
        unit_id: unitId,
        fiscal_profile_id: importProfile.id,
        document_type: focusData?.numero_nfse ? 'nfse' : 'rps',
        status: statusMap[focusData?.status] || 'processing',
        environment: importProfile.environment,
        provider: 'focusnfe',
        rps_series: refParts.length > 1 ? refParts[refParts.length - 2] : importProfile.rps_series,
        rps_number: Number(refParts[refParts.length - 1]) || undefined,
        nfse_number: focusData?.numero_nfse ? String(focusData.numero_nfse) : undefined,
        verification_code: focusData?.codigo_verificacao ? String(focusData.codigo_verificacao) : undefined,
        external_protocol: ref,
        competence_date: (focusData?.data_emissao || new Date().toISOString()).slice(0, 10),
        service_description: importProfile.service_description || 'Serviços de lavanderia',
        service_code: importProfile.service_code,
        total_amount: Number(focusData?.valor_total || focusData?.valor_servicos || 0),
        taxable_amount: Number(focusData?.valor_servicos || focusData?.valor_total || 0),
        recipient: { name: focusData?.nome_tomador || focusData?.razao_social_tomador || 'Tomador importado', tax_id: focusData?.cnpj_tomador || focusData?.cpf_tomador },
        idempotency_key: `import-${ref}`,
        created_by_user_id: user.id,
        request_id: requestId,
        metadata: { focusnfe_ref: ref, focusnfe_consult: focusData, imported: true },
      });
      await addEvent(base44, imported, user, requestId, 'submitted', 'pending', `Nota importada da Focus NFe (ref ${ref}).`, { ref, focusnfe_status: focusData?.status });
      return Response.json({ fiscal_document: imported, focusnfe_status: focusData?.status, request_id: requestId });
    }

    const document = await base44.asServiceRole.entities.FiscalDocument.get(body.fiscal_document_id);
    if (!document || !canAccessUnit(user, document.unit_id)) return Response.json({ error: 'fiscal_document_not_found', request_id: requestId }, { status: 404 });
    const profile = await base44.asServiceRole.entities.FiscalProfile.get(document.fiscal_profile_id);

    if (action === 'validate') {
      const readiness = getFiscalReadiness(profile, document);
      const status = readiness.structurally_ready ? 'ready' : 'draft';
      const updated = await base44.asServiceRole.entities.FiscalDocument.update(document.id, {
        status,
        last_error_code: readiness.errors.length ? 'validation_failed' : undefined,
        last_error_message: readiness.errors.join(', ') || undefined,
      });
      await base44.asServiceRole.entities.FiscalProfile.update(profile.id, {
        status: readiness.structurally_ready ? 'ready_for_homologation' : 'draft',
        last_validation_at: new Date().toISOString(),
        last_validation_status: readiness.structurally_ready ? 'success' : 'failed',
        updated_by_user_id: user.id,
      });
      await addEvent(base44, updated, user, requestId, 'validated', readiness.structurally_ready ? 'success' : 'failed', readiness.structurally_ready ? 'Estrutura fiscal pronta.' : 'Documento fiscal incompleto.', { errors: readiness.errors });
      return Response.json({ fiscal_document: updated, readiness, request_id: requestId });
    }

    if (action === 'transmit') {
      if (profile.provider !== 'focusnfe') return Response.json({ error: 'provider_not_focusnfe', request_id: requestId }, { status: 409 });
      const readiness = getFiscalReadiness(profile, document);
      if (!readiness.transmission_ready) return Response.json({ error: 'fiscal_not_ready', readiness, request_id: requestId }, { status: 422 });
      if (!['draft', 'ready', 'rejected', 'error'].includes(document.status)) return Response.json({ error: 'fiscal_document_not_transmittable', request_id: requestId }, { status: 409 });

      const ref = `5asec-${document.unit_id}-${document.rps_series}-${document.rps_number}`;
      const payload = buildFocusNfePayload({ document, profile, ref });

      let focusResponse: any;
      try {
        focusResponse = await focusNfeRequest('POST', '/nfse', payload);
      } catch (err: any) {
        const updated = await base44.asServiceRole.entities.FiscalDocument.update(document.id, {
          status: 'error',
          last_error_code: err?.code || 'transmission_failed',
          last_error_message: err?.message || 'Falha na comunicação com a Focus NFe.',
          attempt_count: Number(document.attempt_count || 0) + 1,
        });
        await addEvent(base44, updated, user, requestId, 'error', 'failed', err?.message || 'Falha na comunicação.', { code: err?.code });
        return Response.json({ error: 'focusnfe_request_failed', fiscal_document: updated, request_id: requestId }, { status: 502 });
      }

      const { status: httpStatus, data: focusData } = focusResponse;
      // A Focus NFe aceita a emissão com HTTP 200/201/202 e status "processando_autorizacao" ou "autorizada".
      const accepted = [200, 201, 202].includes(httpStatus)
        && ['processando_autorizacao', 'autorizada'].includes(String(focusData?.status || ''));
      const updated = await base44.asServiceRole.entities.FiscalDocument.update(document.id, {
        status: accepted ? (focusData?.status === 'autorizada' ? 'authorized' : 'processing') : 'error',
        external_protocol: ref,
        attempt_count: Number(document.attempt_count || 0) + 1,
        last_error_code: accepted ? undefined : String(focusData?.codigo || focusData?.error || httpStatus),
        last_error_message: accepted ? undefined : JSON.stringify(focusData),
        metadata: { ...(document.metadata || {}), focusnfe_ref: ref, focusnfe_response: focusData },
      });

      if (accepted) {
        await addEvent(base44, updated, user, requestId, 'submitted', 'success', `NFSe enviada à Focus NFe (ref ${ref}). Aguarde autorização.`, { ref });
        return Response.json({ fiscal_document: updated, focusnfe_ref: ref, request_id: requestId });
      }
      await addEvent(base44, updated, user, requestId, 'error', 'failed', `Focus NFe rejeitou a emissão (HTTP ${httpStatus}).`, { http_status: httpStatus, response: focusData });
      return Response.json({ error: 'focusnfe_rejected', fiscal_document: updated, focusnfe_response: focusData, request_id: requestId }, { status: 422 });
    }

    if (action === 'consult') {
      const ref = document.external_protocol || `5asec-${document.unit_id}-${document.rps_series}-${document.rps_number}`;
      let focusResponse: any;
      try {
        focusResponse = await focusNfeRequest('GET', `/nfse/${encodeURIComponent(ref)}`);
      } catch (err: any) {
        return Response.json({ error: 'focusnfe_request_failed', message: err?.message, request_id: requestId }, { status: 502 });
      }
      const { status: httpStatus, data: focusData } = focusResponse;
      if (httpStatus === 404) return Response.json({ error: 'focusnfe_not_found', request_id: requestId }, { status: 404 });

      const statusMap: Record<string, string> = {
        'processando_autorizacao': 'processing',
        'autorizada': 'authorized',
        'cancelada': 'cancelled',
        'erro_autorizacao': 'rejected',
      };
      const newStatus = statusMap[focusData?.status] || document.status;
      const patch: any = { metadata: { ...(document.metadata || {}), focusnfe_consult: focusData } };
      if (newStatus !== document.status) patch.status = newStatus;
      if (focusData?.numero_nfse) { patch.nfse_number = String(focusData.numero_nfse); patch.document_type = 'nfse'; }
      if (focusData?.codigo_verificacao) patch.verification_code = String(focusData.codigo_verificacao);
      if (newStatus === 'authorized' && !document.authorized_at) {
        patch.authorized_at = new Date().toISOString();
        for (const orderId of document.order_ids || []) {
          const order = await base44.asServiceRole.entities.Order.get(orderId);
          if (order) await base44.asServiceRole.entities.Order.update(order.id, { fiscal_status: 'authorized' });
        }
      }
      if (newStatus === 'rejected') {
        patch.last_error_code = 'focusnfe_rejected';
        patch.last_error_message = JSON.stringify(focusData);
      }
      const updated = await base44.asServiceRole.entities.FiscalDocument.update(document.id, patch);
      await addEvent(base44, updated, user, requestId, 'submitted', newStatus === 'authorized' ? 'success' : newStatus === 'rejected' ? 'failed' : 'pending', `Consulta Focus NFe: ${focusData?.status || 'sem status'}`, { ref, focusnfe_status: focusData?.status });
      return Response.json({ fiscal_document: updated, focusnfe_status: focusData?.status, request_id: requestId });
    }

    if (action === 'cancel_nfse') {
      if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('fiscal.cancel')) return Response.json({ error: 'manager_approval_required', request_id: requestId }, { status: 403 });
      if (!['authorized', 'processing', 'rejected'].includes(document.status)) return Response.json({ error: 'fiscal_document_not_cancellable_remotely', request_id: requestId }, { status: 409 });
      const reason = String(body.reason || '').trim();
      if (reason.length < 15) return Response.json({ error: 'cancellation_reason_required', request_id: requestId }, { status: 422 });
      const ref = document.external_protocol || `5asec-${document.unit_id}-${document.rps_series}-${document.rps_number}`;
      let focusResponse: any;
      try {
        focusResponse = await focusNfeRequest('DELETE', `/nfse/${encodeURIComponent(ref)}`, { justificativa: reason });
      } catch (err: any) {
        return Response.json({ error: 'focusnfe_request_failed', message: err?.message, request_id: requestId }, { status: 502 });
      }
      const { status: httpStatus, data: focusData } = focusResponse;
      if (httpStatus === 200) {
        const updated = await base44.asServiceRole.entities.FiscalDocument.update(document.id, {
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason,
        });
        for (const orderId of document.order_ids || []) {
          const order = await base44.asServiceRole.entities.Order.get(orderId);
          if (order) await base44.asServiceRole.entities.Order.update(order.id, { fiscal_status: 'cancelled' });
        }
        await addEvent(base44, updated, user, requestId, 'cancelled', 'success', `NFSe cancelada na Focus NFe: ${reason}`, { ref });
        return Response.json({ fiscal_document: updated, request_id: requestId });
      }
      await addEvent(base44, document, user, requestId, 'error', 'failed', `Focus NFe rejeitou cancelamento (HTTP ${httpStatus}).`, { http_status: httpStatus, response: focusData });
      return Response.json({ error: 'focusnfe_cancel_rejected', focusnfe_response: focusData, request_id: requestId }, { status: 422 });
    }

    if (action === 'cancel_draft') {
      if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('fiscal.cancel')) return Response.json({ error: 'manager_approval_required', request_id: requestId }, { status: 403 });
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'cancellation_reason_required', request_id: requestId }, { status: 422 });
      if (!['draft', 'ready', 'rejected', 'error'].includes(document.status)) return Response.json({ error: 'fiscal_document_not_locally_cancellable', request_id: requestId }, { status: 409 });
      const now = new Date().toISOString();
      const updated = await base44.asServiceRole.entities.FiscalDocument.update(document.id, { status: 'cancelled', cancelled_at: now, cancellation_reason: reason });
      for (const orderId of document.order_ids || []) {
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if ((order?.fiscal_document_ids || []).includes(document.id)) {
          const remainingFiscalDocumentIds = (order.fiscal_document_ids || []).filter((id: string) => id !== document.id);
          await base44.asServiceRole.entities.Order.update(order.id, { fiscal_document_ids: remainingFiscalDocumentIds, fiscal_status: remainingFiscalDocumentIds.length ? order.fiscal_status : 'not_issued' });
        }
      }
      if (document.billing_statement_id) {
        const statement = await base44.asServiceRole.entities.BillingStatement.get(document.billing_statement_id);
        if (statement?.fiscal_document_id === document.id) await base44.asServiceRole.entities.BillingStatement.update(statement.id, { fiscal_document_id: undefined });
      }
      await addEvent(base44, updated, user, requestId, 'cancelled', 'success', reason);
      return Response.json({ fiscal_document: updated, request_id: requestId });
    }

    if (action === 'delete') {
      if (!MANAGER_ROLES.has(user.role) && !(user.permissions || []).includes('fiscal.cancel')) return Response.json({ error: 'manager_approval_required', request_id: requestId }, { status: 403 });
      if (document.status === 'authorized') return Response.json({ error: 'authorized_document_must_be_cancelled_first', request_id: requestId }, { status: 409 });
      for (const orderId of document.order_ids || []) {
        const order = await base44.asServiceRole.entities.Order.get(orderId);
        if ((order?.fiscal_document_ids || []).includes(document.id)) {
          const remaining = (order.fiscal_document_ids || []).filter((id: string) => id !== document.id);
          await base44.asServiceRole.entities.Order.update(order.id, { fiscal_document_ids: remaining, fiscal_status: remaining.length ? order.fiscal_status : 'not_issued' });
        }
      }
      if (document.billing_statement_id) {
        const statement = await base44.asServiceRole.entities.BillingStatement.get(document.billing_statement_id);
        if (statement?.fiscal_document_id === document.id) await base44.asServiceRole.entities.BillingStatement.update(statement.id, { fiscal_document_id: undefined });
      }
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'delete', entity_type: 'fiscal_document', entity_id: document.id,
        item_label: `RPS ${document.rps_series}-${document.rps_number}`, reason: String(body.reason || 'exclusao_registro_fiscal'),
        user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role,
        unit_id: document.unit_id, request_id: requestId, before_data: document, success: true,
      });
      await base44.asServiceRole.entities.FiscalDocument.delete(document.id);
      return Response.json({ deleted: true, fiscal_document_id: document.id, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[manage_fiscal_document:${requestId}]`, error);
    const message = error instanceof Error ? error.message : 'fiscal_operation_failed';
    const details = (error as any)?.details;
    const status = ['fiscal_profile_incomplete', 'fiscal_recipient_incomplete', 'fiscal_recipient_required', 'invalid_fiscal_amount', 'focusnfe_token_not_configured', 'provider_not_focusnfe', 'fiscal_not_ready'].includes(message) ? 422 : 500;
    return Response.json({ error: message, details, request_id: requestId }, { status });
  }
}