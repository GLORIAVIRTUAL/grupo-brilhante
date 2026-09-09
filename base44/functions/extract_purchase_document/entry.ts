import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'inventory', 'finance']);

function normalize(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

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
    document_type: { type: 'string' },
    supplier: {
      type: 'object',
      properties: {
        corporate_name: { type: 'string' },
        trade_name: { type: 'string' },
        tax_id: { type: 'string' },
        state_registration: { type: 'string' },
      },
    },
    document_number: { type: 'string' },
    series: { type: 'string' },
    access_key: { type: 'string' },
    issue_date: { type: 'string' },
    due_date: { type: 'string' },
    subtotal: { type: 'number' },
    discount: { type: 'number' },
    freight: { type: 'number' },
    taxes: { type: 'number' },
    total: { type: 'number' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          supplier_code: { type: 'string' },
          description: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          unit_price: { type: 'number' },
          discount: { type: 'number' },
          taxes: { type: 'number' },
          total: { type: 'number' },
          batch_number: { type: 'string' },
          expiry_date: { type: 'string' },
        },
      },
    },
  },
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  let aiJob: any = null;

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'extract_purchase_document' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'inventory') && !(user.permissions || []).includes('documents.review')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const { document_asset_id: assetId } = await req.json();
    if (!assetId) return Response.json({ error: 'document_asset_id_required', request_id: requestId }, { status: 400 });

    const asset = await base44.asServiceRole.entities.DocumentAsset.get(assetId);
    if (!asset || asset.document_type !== 'purchase_invoice') {
      return Response.json({ error: 'invalid_purchase_asset', request_id: requestId }, { status: 422 });
    }
    if (!canAccessUnit(user, asset.unit_id)) {
      return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    }

    const duplicates = await base44.asServiceRole.entities.PurchaseDocument.filter({ file_hash: asset.sha256 });
    if (duplicates.length > 0) {
      return Response.json({ error: 'duplicate_purchase_document', purchase_document_id: duplicates[0].id, request_id: requestId }, { status: 409 });
    }

    aiJob = await base44.asServiceRole.entities.AIJob.create({
      unit_id: asset.unit_id,
      job_type: 'purchase_invoice_extraction',
      status: 'processing',
      document_asset_ids: [asset.id],
      model: 'base44_core_extractor',
      prompt_version: 'purchase-document-v1',
      attempts: 1,
      started_at: new Date().toISOString(),
      created_by_user_id: user.id,
      request_id: requestId,
    });

    let extracted: any;
    try {
      const extraction = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url: asset.storage_key,
        json_schema: extractionSchema,
      });
      extracted = extraction?.output || extraction?.data || extraction;
    } catch (error) {
      const purchaseDocument = await base44.asServiceRole.entities.PurchaseDocument.create({
        unit_id: asset.unit_id,
        document_type: 'other',
        document_asset_id: asset.id,
        file_hash: asset.sha256,
        status: 'human_review',
        ai_job_id: aiJob.id,
        extraction_confidence: 0,
        notes: 'Extração automática indisponível; preencher manualmente.',
      });
      const review = await base44.asServiceRole.entities.HumanReview.create({
        unit_id: asset.unit_id,
        review_type: 'purchase_document',
        status: 'pending',
        priority: 'high',
        entity_type: 'purchase_document',
        entity_id: purchaseDocument.id,
        ai_job_id: aiJob.id,
        document_asset_ids: [asset.id],
        reason_codes: ['extractor_unavailable'],
        summary: 'Preencher nota de compra manualmente',
        proposed_data: {},
        request_id: requestId,
      });
      await base44.asServiceRole.entities.PurchaseDocument.update(purchaseDocument.id, { human_review_id: review.id });
      await base44.asServiceRole.entities.AIJob.update(aiJob.id, {
        status: 'human_review',
        entity_type: 'purchase_document',
        entity_id: purchaseDocument.id,
        error_code: 'extractor_unavailable',
        error_message: 'Configuração de extração ainda não disponível.',
        completed_at: new Date().toISOString(),
      });
      return Response.json({ purchase_document: purchaseDocument, items: [], configured: false, human_review_required: true, request_id: requestId });
    }

    const supplierTaxId = digits(extracted?.supplier?.tax_id);
    const suppliers = supplierTaxId
      ? await base44.asServiceRole.entities.Supplier.filter({ tax_id: supplierTaxId })
      : [];
    const supplier = suppliers[0] || null;
    const stockItems = await base44.asServiceRole.entities.StockItem.filter({ unit_id: asset.unit_id });
    const extractedItems = Array.isArray(extracted?.items) ? extracted.items : [];

    const requiredSignals = [supplierTaxId.length === 14, Boolean(extracted?.document_number), extractedItems.length > 0, Number(extracted?.total || 0) > 0];
    const confidence = requiredSignals.filter(Boolean).length / requiredSignals.length;
    const needsReview = confidence < 1 || !supplier;

    const purchaseDocument = await base44.asServiceRole.entities.PurchaseDocument.create({
      unit_id: asset.unit_id,
      supplier_id: supplier?.id,
      supplier_tax_id: supplierTaxId,
      supplier_name: extracted?.supplier?.corporate_name || extracted?.supplier?.trade_name || '',
      document_type: ['nfe', 'nfce', 'invoice', 'receipt'].includes(normalize(extracted?.document_type)) ? normalize(extracted.document_type) : 'other',
      document_number: String(extracted?.document_number || ''),
      series: String(extracted?.series || ''),
      access_key: digits(extracted?.access_key),
      document_asset_id: asset.id,
      file_hash: asset.sha256,
      issue_date: extracted?.issue_date || undefined,
      entry_date: new Date().toISOString(),
      due_date: extracted?.due_date || undefined,
      subtotal: Number(extracted?.subtotal || 0),
      discount: Number(extracted?.discount || 0),
      freight: Number(extracted?.freight || 0),
      taxes: Number(extracted?.taxes || 0),
      total: Number(extracted?.total || 0),
      status: needsReview ? 'human_review' : 'received',
      extraction_confidence: confidence,
      ai_job_id: aiJob.id,
      metadata: { extracted_supplier: extracted?.supplier || {}, request_id: requestId },
    });

    const purchaseItems = [];
    let lineNumber = 0;
    for (const line of extractedItems) {
      lineNumber += 1;
      const normalizedDescription = normalize(line.description);
      const matched = stockItems.find((stock: any) => {
        const supplierCode = supplier?.id && stock.supplier_codes?.[supplier.id];
        return (line.supplier_code && supplierCode === line.supplier_code) || normalize(stock.name) === normalizedDescription;
      }) || null;
      const conversionFactor = Number(matched?.purchase_to_base_factor || 1);
      const quantity = Number(line.quantity || 0);
      const purchaseItem = await base44.asServiceRole.entities.PurchaseItem.create({
        purchase_document_id: purchaseDocument.id,
        unit_id: asset.unit_id,
        line_number: lineNumber,
        supplier_code: String(line.supplier_code || ''),
        description_original: String(line.description || `Item ${lineNumber}`),
        stock_item_id: matched?.id,
        match_status: matched ? 'matched' : 'suggested',
        match_confidence: matched ? 1 : 0,
        invoiced_quantity: quantity,
        received_quantity: 0,
        accepted_quantity: 0,
        purchase_unit: String(line.unit || matched?.purchase_unit || matched?.base_unit || 'unit'),
        conversion_factor: conversionFactor,
        base_quantity: quantity * conversionFactor,
        unit_price: Number(line.unit_price || 0),
        discount: Number(line.discount || 0),
        taxes: Number(line.taxes || 0),
        total: Number(line.total || (quantity * Number(line.unit_price || 0))),
        batch_number: line.batch_number || undefined,
        expiry_date: line.expiry_date || undefined,
      });
      purchaseItems.push(purchaseItem);
    }

    const unmatchedCount = purchaseItems.filter((item: any) => !item.stock_item_id).length;
    let review = null;
    if (needsReview || unmatchedCount > 0) {
      review = await base44.asServiceRole.entities.HumanReview.create({
        unit_id: asset.unit_id,
        review_type: 'purchase_document',
        status: 'pending',
        priority: unmatchedCount > 0 ? 'high' : 'normal',
        entity_type: 'purchase_document',
        entity_id: purchaseDocument.id,
        ai_job_id: aiJob.id,
        document_asset_ids: [asset.id],
        reason_codes: [
          ...(!supplier ? ['supplier_not_matched'] : []),
          ...(unmatchedCount > 0 ? ['stock_items_not_matched'] : []),
          ...(confidence < 1 ? ['required_fields_missing'] : []),
        ],
        summary: `Revisar nota ${purchaseDocument.document_number || purchaseDocument.id.slice(0, 8)}`,
        proposed_data: { header: extracted, unmatched_count: unmatchedCount },
        request_id: requestId,
      });
      await base44.asServiceRole.entities.PurchaseDocument.update(purchaseDocument.id, {
        status: 'human_review',
        human_review_id: review.id,
      });
    }

    await base44.asServiceRole.entities.AIJob.update(aiJob.id, {
      status: review ? 'human_review' : 'completed',
      entity_type: 'purchase_document',
      entity_id: purchaseDocument.id,
      confidence,
      field_confidence: {
        supplier_tax_id: supplierTaxId.length === 14 ? 1 : 0,
        document_number: extracted?.document_number ? 1 : 0,
        items: extractedItems.length > 0 ? 1 : 0,
        total: Number(extracted?.total || 0) > 0 ? 1 : 0,
      },
      result: { purchase_document_id: purchaseDocument.id, item_count: purchaseItems.length, unmatched_count: unmatchedCount },
      completed_at: new Date().toISOString(),
    });

    return Response.json({ purchase_document: purchaseDocument, items: purchaseItems, human_review: review, configured: true, request_id: requestId });
  } catch (error) {
    console.error(`[extract_purchase_document:${requestId}]`, error);
    try {
      if (aiJob?.id) {
        const base44 = createClientFromRequest(req);
        await base44.asServiceRole.entities.AIJob.update(aiJob.id, {
          status: 'failed',
          error_code: 'purchase_extraction_failed',
          error_message: 'Falha ao processar documento.',
          completed_at: new Date().toISOString(),
        });
      }
    } catch (_) {
      // Auditoria best-effort.
    }
    return Response.json({ error: 'purchase_extraction_failed', request_id: requestId }, { status: 500 });
  }
});
