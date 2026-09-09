import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);
const CATEGORY_BY_TYPE: Record<string, string> = {
  electricity_bill: 'Energia elétrica',
  water_bill: 'Água',
  gas_bill: 'Gás',
  internet_bill: 'Internet e telefonia',
  rent: 'Aluguel',
  service_invoice: 'Serviços de terceiros',
  bank_slip: 'Boletos',
  other: 'Outras despesas',
};

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'approve_financial_document' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'finance') && !(user.permissions || []).includes('finance.approve')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const { financial_document_id: financialDocumentId, overrides = {} } = await req.json();
    if (!financialDocumentId) return Response.json({ error: 'financial_document_id_required', request_id: requestId }, { status: 400 });

    const document = await base44.asServiceRole.entities.FinancialDocument.get(financialDocumentId);
    if (!document) return Response.json({ error: 'financial_document_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, document.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    if (['rejected', 'cancelled'].includes(document.status)) {
      return Response.json({ error: 'financial_document_not_approvable', request_id: requestId }, { status: 409 });
    }

    const amount = Number(overrides.amount ?? document.amount ?? 0);
    const dueDate = overrides.due_date || document.due_date;
    const issuerName = overrides.issuer_name || document.issuer_name || 'Emissor não identificado';
    if (!Number.isFinite(amount) || amount <= 0 || !dueDate) {
      return Response.json({ error: 'amount_and_due_date_required', request_id: requestId }, { status: 422 });
    }

    const eventKey = `approve_financial_document:${document.id}`;
    const events = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
    const completed = events.find((event: any) => event.status === 'completed');
    if (completed?.entity_id) {
      const payable = await base44.asServiceRole.entities.AccountsPayable.get(completed.entity_id);
      return Response.json({ accounts_payable: payable, duplicate: true, request_id: requestId });
    }

    const event = events[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: eventKey,
      event_type: 'approve_financial_document',
      source: 'user_command',
      status: 'processing',
      payload_hash: document.file_hash,
      attempts: 1,
      started_at: new Date().toISOString(),
      unit_id: document.unit_id,
    });

    const existingPayables = await base44.asServiceRole.entities.AccountsPayable.filter({ financial_document_id: document.id });
    let payable = existingPayables[0] || null;
    if (!payable) {
      payable = await base44.asServiceRole.entities.AccountsPayable.create({
        unit_id: document.unit_id,
        supplier_name: issuerName,
        financial_document_id: document.id,
        description: overrides.description || `${CATEGORY_BY_TYPE[document.document_type] || 'Despesa'} · ${issuerName}`,
        category: overrides.category || CATEGORY_BY_TYPE[document.document_type] || 'Outras despesas',
        cost_center: overrides.cost_center || 'Operação',
        competence_date: overrides.competence_date || document.competence_date || document.issue_date || new Date().toISOString(),
        issue_date: document.issue_date,
        due_date: dueDate,
        original_amount: amount,
        open_amount: amount,
        paid_amount: 0,
        status: 'pending_approval',
        approval_status: 'pending',
        document_asset_ids: [document.document_asset_id],
        metadata: {
          anomaly_status: document.anomaly_status,
          anomaly_reasons: document.anomaly_reasons || [],
          request_id: requestId,
        },
      });
    }

    const now = new Date().toISOString();
    const updatedDocument = await base44.asServiceRole.entities.FinancialDocument.update(document.id, {
      issuer_name: issuerName,
      amount,
      due_date: dueDate,
      status: 'linked',
      accounts_payable_id: payable.id,
    });

    if (document.human_review_id) {
      await base44.asServiceRole.entities.HumanReview.update(document.human_review_id, {
        status: 'approved',
        reviewed_by_user_id: user.id,
        reviewed_at: now,
        corrected_data: overrides,
        decision_reason: 'financial_document_approved',
      });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'approve',
      entity_type: 'financial_document',
      entity_id: document.id,
      item_label: document.document_number || issuerName,
      amount,
      reason: 'accounts_payable_created',
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      unit_id: document.unit_id,
      request_id: requestId,
      after_data: { accounts_payable_id: payable.id, due_date: dueDate },
      success: true,
    });

    await base44.asServiceRole.entities.ProcessedEvent.update(event.id, {
      status: 'completed',
      entity_type: 'accounts_payable',
      entity_id: payable.id,
      result: { financial_document_id: document.id, accounts_payable_id: payable.id },
      completed_at: now,
    });

    return Response.json({ financial_document: updatedDocument, accounts_payable: payable, request_id: requestId });
  } catch (error) {
    console.error(`[approve_financial_document:${requestId}]`, error);
    return Response.json({ error: 'financial_document_approval_failed', request_id: requestId }, { status: 500 });
  }
});
