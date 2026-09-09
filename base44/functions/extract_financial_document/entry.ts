import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);
const VALID_TYPES = new Set(['electricity_bill', 'water_bill', 'gas_bill', 'internet_bill', 'rent', 'service_invoice', 'bank_slip', 'payment_receipt', 'other']);

function digits(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

const extractionSchema = {
  type: 'object',
  properties: {
    document_type: { type: 'string', enum: [...VALID_TYPES] },
    issuer_name: { type: 'string' },
    issuer_tax_id: { type: 'string' },
    account_number: { type: 'string' },
    installation_number: { type: 'string' },
    document_number: { type: 'string' },
    competence_date: { type: 'string' },
    issue_date: { type: 'string' },
    due_date: { type: 'string' },
    amount: { type: 'number' },
    consumption_value: { type: 'number' },
    consumption_unit: { type: 'string' },
    barcode: { type: 'string' },
    pix_code: { type: 'string' },
  },
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  let aiJob: any = null;

  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'extract_financial_document' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'finance') && !(user.permissions || []).includes('documents.review')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const { document_asset_id: assetId, expected_document_type: expectedType } = await req.json();
    if (!assetId) return Response.json({ error: 'document_asset_id_required', request_id: requestId }, { status: 400 });

    const asset = await base44.asServiceRole.entities.DocumentAsset.get(assetId);
    if (!asset || !['utility_bill', 'service_invoice', 'payment_receipt', 'other'].includes(asset.document_type)) {
      return Response.json({ error: 'invalid_financial_asset', request_id: requestId }, { status: 422 });
    }
    if (!canAccessUnit(user, asset.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });

    const duplicates = await base44.asServiceRole.entities.FinancialDocument.filter({ file_hash: asset.sha256 });
    if (duplicates.length > 0) {
      return Response.json({ error: 'duplicate_financial_document', financial_document_id: duplicates[0].id, request_id: requestId }, { status: 409 });
    }

    aiJob = await base44.asServiceRole.entities.AIJob.create({
      unit_id: asset.unit_id,
      job_type: expectedType === 'payment_receipt' ? 'receipt_extraction' : 'utility_bill_extraction',
      status: 'processing',
      document_asset_ids: [asset.id],
      model: 'base44_core_extractor',
      prompt_version: 'financial-document-v1',
      attempts: 1,
      started_at: new Date().toISOString(),
      created_by_user_id: user.id,
      request_id: requestId,
    });

    let extracted: any = {};
    let extractorAvailable = true;
    try {
      const extraction = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url: asset.storage_key,
        json_schema: extractionSchema,
      });
      extracted = extraction?.output || extraction?.data || extraction || {};
    } catch (_) {
      extractorAvailable = false;
    }

    const documentType = VALID_TYPES.has(expectedType) ? expectedType : (VALID_TYPES.has(extracted?.document_type) ? extracted.document_type : 'other');
    const amount = Number(extracted?.amount || 0);
    const historical = await base44.asServiceRole.entities.FinancialDocument.filter({
      unit_id: asset.unit_id,
      document_type: documentType,
    }, '-competence_date', 12);
    const historicalAmounts = historical.map((item: any) => Number(item.amount || 0)).filter((value: number) => value > 0);
    const average = historicalAmounts.length > 0 ? historicalAmounts.reduce((sum: number, value: number) => sum + value, 0) / historicalAmounts.length : 0;
    const anomalyReasons: string[] = [];
    if (average > 0 && amount > average * 1.5) anomalyReasons.push('amount_above_historical_range');
    if (average > 0 && amount < average * 0.5) anomalyReasons.push('amount_below_historical_range');

    const fieldConfidence = {
      document_type: documentType !== 'other' ? 1 : 0,
      issuer: extracted?.issuer_name ? 1 : 0,
      due_date: extracted?.due_date ? 1 : 0,
      amount: amount > 0 ? 1 : 0,
      competence_date: extracted?.competence_date ? 1 : 0,
    };
    const confidence = extractorAvailable
      ? Object.values(fieldConfidence).reduce((sum: number, value: any) => sum + Number(value), 0) / Object.keys(fieldConfidence).length
      : 0;
    const requiresReview = !extractorAvailable || confidence < 1 || anomalyReasons.length > 0;

    const financialDocument = await base44.asServiceRole.entities.FinancialDocument.create({
      unit_id: asset.unit_id,
      document_asset_id: asset.id,
      file_hash: asset.sha256,
      document_type: documentType,
      issuer_name: extracted?.issuer_name || '',
      issuer_tax_id: digits(extracted?.issuer_tax_id),
      account_number: String(extracted?.account_number || ''),
      installation_number: String(extracted?.installation_number || ''),
      document_number: String(extracted?.document_number || ''),
      competence_date: extracted?.competence_date || undefined,
      issue_date: extracted?.issue_date || undefined,
      due_date: extracted?.due_date || undefined,
      amount,
      consumption_value: Number(extracted?.consumption_value || 0),
      consumption_unit: String(extracted?.consumption_unit || ''),
      barcode: String(extracted?.barcode || ''),
      pix_code: String(extracted?.pix_code || ''),
      status: requiresReview ? 'human_review' : 'received',
      anomaly_status: anomalyReasons.length > 0 ? (amount > average * 2 ? 'critical' : 'warning') : 'normal',
      anomaly_reasons: anomalyReasons,
      extraction_confidence: confidence,
      field_confidence: fieldConfidence,
      ai_job_id: aiJob.id,
      metadata: { historical_average: average, extractor_available: extractorAvailable, request_id: requestId },
    });

    let review = null;
    if (requiresReview) {
      review = await base44.asServiceRole.entities.HumanReview.create({
        unit_id: asset.unit_id,
        review_type: documentType === 'payment_receipt' ? 'payment_receipt' : 'financial_document',
        status: 'pending',
        priority: anomalyReasons.length > 0 ? 'high' : 'normal',
        entity_type: 'financial_document',
        entity_id: financialDocument.id,
        ai_job_id: aiJob.id,
        document_asset_ids: [asset.id],
        reason_codes: [
          ...(!extractorAvailable ? ['extractor_unavailable'] : []),
          ...(confidence < 1 ? ['required_fields_missing'] : []),
          ...anomalyReasons,
        ],
        summary: `Revisar ${documentType.replaceAll('_', ' ')} de ${extracted?.issuer_name || 'emissor não identificado'}`,
        proposed_data: extracted,
        request_id: requestId,
      });
      await base44.asServiceRole.entities.FinancialDocument.update(financialDocument.id, { human_review_id: review.id });
    }

    await base44.asServiceRole.entities.AIJob.update(aiJob.id, {
      status: requiresReview ? 'human_review' : 'completed',
      entity_type: 'financial_document',
      entity_id: financialDocument.id,
      confidence,
      field_confidence: fieldConfidence,
      result: { financial_document_id: financialDocument.id, anomaly_reasons: anomalyReasons },
      error_code: extractorAvailable ? undefined : 'extractor_unavailable',
      completed_at: new Date().toISOString(),
    });

    return Response.json({ financial_document: financialDocument, human_review: review, configured: extractorAvailable, request_id: requestId });
  } catch (error) {
    console.error(`[extract_financial_document:${requestId}]`, error);
    try {
      if (aiJob?.id) {
        const base44 = createClientFromRequest(req);
        await base44.asServiceRole.entities.AIJob.update(aiJob.id, {
          status: 'failed',
          error_code: 'financial_extraction_failed',
          completed_at: new Date().toISOString(),
        });
      }
    } catch (_) {
      // Auditoria best-effort.
    }
    return Response.json({ error: 'financial_extraction_failed', request_id: requestId }, { status: 500 });
  }
});
