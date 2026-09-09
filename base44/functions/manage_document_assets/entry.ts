import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { authorizeUserOrInternal, enforceAuthenticatedUser, securityErrorResponse } from '../../shared/functionSecurity.js';

const DOCUMENT_TYPES = new Set([
  'garment_photo', 'garment_label', 'garment_damage', 'purchase_invoice', 'utility_bill',
  'service_invoice', 'payment_receipt', 'delivery_proof', 'third_party_document',
  'corporate_document', 'contract', 'contract_addendum', 'tax_document', 'bank_document',
  'employee_document', 'hospital_document', 'linen_liability_term', 'cleaning_evidence',
  'migration_source', 'other',
]);
const CLASSIFICATIONS = new Set(['public', 'internal', 'confidential', 'restricted']);
const VISIBILITIES = new Set(['private', 'customer_shared', 'internal_shared']);
const RETENTION_CLASSES = new Set(['standard', 'financial', 'fiscal', 'security', 'privacy', 'employment', 'contractual']);
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/xml', 'text/xml', 'text/csv', 'text/plain', 'application/json', 'application/x-ofx', 'application/octet-stream']);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_BYTES = 15 * 1024 * 1024;

function clean(value: unknown, max = 180) {
  return String(value || '').trim().slice(0, max);
}

function requireReason(value: unknown) {
  const reason = clean(value, 500);
  if (reason.length < 8) throw new Error('reason_required');
  return reason;
}

function safeStorageKey(value: unknown) {
  const key = clean(value, 2000);
  let parsed: URL;
  try { parsed = new URL(key); } catch { throw new Error('invalid_storage_key'); }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !(hostname === 'media.base44.com' || hostname.endsWith('.base44.com'))) {
    throw new Error('invalid_storage_origin');
  }
  return key;
}

function retentionFor(documentType: string) {
  if (['purchase_invoice', 'service_invoice', 'tax_document'].includes(documentType)) return 'fiscal';
  if (['payment_receipt', 'bank_document', 'utility_bill'].includes(documentType)) return 'financial';
  if (['contract', 'contract_addendum', 'linen_liability_term'].includes(documentType)) return 'contractual';
  if (documentType === 'employee_document') return 'employment';
  if (documentType === 'hospital_document') return 'privacy';
  return 'standard';
}

function futureRetention(retentionClass: string) {
  const years = retentionClass === 'fiscal' || retentionClass === 'financial' ? 6
    : retentionClass === 'employment' ? 10
      : retentionClass === 'contractual' ? 10
        : retentionClass === 'privacy' ? 5 : 3;
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

async function audit(db: any, principal: any, input: any) {
  await db.AuditLog.create({
    action: input.action,
    entity_type: 'document_asset',
    entity_id: input.entity_id || null,
    item_label: input.item_label || null,
    reason: input.reason,
    user_id: principal.user.id,
    user_email: principal.user.email,
    user_name: principal.user.full_name || principal.user.display_name || principal.user.email,
    user_role: principal.role,
    legal_entity_id: input.legal_entity_id,
    unit_id: input.unit_id,
    request_id: input.request_id,
    success: true,
    metadata: input.details || {},
  });
}

async function scopedPrincipal(base44: any, req: Request, user: any, options: any) {
  return enforceAuthenticatedUser(base44, req, user, {
    permission: options.permission,
    legalEntityId: options.legalEntityId || null,
    unitId: options.unitId || null,
    requireMfa: options.requireMfa === true,
    source: 'manage_document_assets',
  });
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const body = await req.json();
    const action = clean(body.action, 60);
    const auth = await authorizeUserOrInternal(base44, req, body, { allowInternal: false, source: 'manage_document_assets' });

    if (action === 'list') {
      const principal = await scopedPrincipal(base44, req, auth.user, { permission: 'documents.view' });
      const requestedLegalEntityId = clean(body.legal_entity_id, 100) || null;
      if (requestedLegalEntityId && !principal.permissions.includes('*') && !principal.permissions.includes('companies.view_all') && !principal.legalEntityIds.includes(requestedLegalEntityId)) {
        return Response.json({ error: 'legal_entity_scope_denied', request_id: requestId }, { status: 403 });
      }
      const ids = requestedLegalEntityId ? [requestedLegalEntityId] : principal.legalEntityIds;
      let rows: any[] = [];
      if (principal.permissions.includes('*') || principal.permissions.includes('companies.view_all')) {
        rows = requestedLegalEntityId
          ? await db.DocumentAsset.filter({ legal_entity_id: requestedLegalEntityId }, '-created_date', 500)
          : await db.DocumentAsset.list('-created_date', 500);
      } else {
        const grouped = await Promise.all(ids.map((legalEntityId: string) => db.DocumentAsset.filter({ legal_entity_id: legalEntityId }, '-created_date', 250)));
        rows = grouped.flat();
      }
      if (body.unit_id) rows = rows.filter((row) => row.unit_id === body.unit_id);
      if (body.document_type) rows = rows.filter((row) => row.document_type === body.document_type);
      if (body.status) rows = rows.filter((row) => (row.status || 'active') === body.status);
      return Response.json({ assets: rows.slice(0, 500), request_id: requestId });
    }

    if (action === 'register') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const unitId = clean(body.unit_id, 100);
      const principal = await scopedPrincipal(base44, req, auth.user, { permission: 'documents.manage', legalEntityId, unitId });
      const documentType = clean(body.document_type, 80);
      const mimeType = clean(body.mime_type, 100).toLowerCase();
      const hash = clean(body.sha256, 64).toLowerCase();
      const sizeBytes = Number(body.size_bytes);
      if (!DOCUMENT_TYPES.has(documentType)) return Response.json({ error: 'invalid_document_type', request_id: requestId }, { status: 422 });
      if (!MIME_TYPES.has(mimeType) || !Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_BYTES || !HASH_PATTERN.test(hash)) {
        return Response.json({ error: 'invalid_file_metadata', request_id: requestId }, { status: 422 });
      }
      const reason = requireReason(body.reason);
      const duplicates = await db.DocumentAsset.filter({ legal_entity_id: legalEntityId, unit_id: unitId, sha256: hash, document_type: documentType }, '-created_date', 10);
      const duplicate = duplicates.find((row: any) => (row.status || 'active') !== 'retired');
      if (duplicate) return Response.json({ error: 'duplicate_document', asset_id: duplicate.id, request_id: requestId }, { status: 409 });
      const classification = CLASSIFICATIONS.has(body.classification) ? body.classification : 'internal';
      const visibility = VISIBILITIES.has(body.visibility) ? body.visibility : 'private';
      const retentionClass = RETENTION_CLASSES.has(body.retention_class) ? body.retention_class : retentionFor(documentType);
      const asset = await db.DocumentAsset.create({
        legal_entity_id: legalEntityId,
        unit_id: unitId,
        owner_user_id: principal.user.id,
        created_by_user_id: principal.user.id,
        customer_id: clean(body.customer_id, 100) || null,
        related_entity_type: clean(body.related_entity_type, 80) || null,
        related_entity_id: clean(body.related_entity_id, 100) || null,
        document_number: clean(body.document_number, 120) || null,
        issued_at: body.issued_at || null,
        expires_at: body.expires_at || null,
        classification,
        status: 'active',
        document_type: documentType,
        storage_key: safeStorageKey(body.storage_key),
        original_filename: clean(body.original_filename),
        safe_filename: clean(body.safe_filename),
        mime_type: mimeType,
        size_bytes: sizeBytes,
        sha256: hash,
        scan_status: 'not_configured',
        validation_status: 'pending',
        visibility,
        retention_class: retentionClass,
        retention_until: body.retention_until || futureRetention(retentionClass),
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      await audit(db, principal, { action: 'create', entity_id: asset.id, item_label: asset.original_filename, reason, legal_entity_id: legalEntityId, unit_id: unitId, request_id: requestId, details: { document_type: documentType, classification, retention_class: retentionClass } });
      return Response.json({ asset, request_id: requestId }, { status: 201 });
    }

    const assetId = clean(body.asset_id, 100);
    const asset = assetId ? await db.DocumentAsset.get(assetId).catch(() => null) : null;
    if (!asset) return Response.json({ error: 'document_not_found', request_id: requestId }, { status: 404 });
    const principal = await scopedPrincipal(base44, req, auth.user, { permission: 'documents.manage', legalEntityId: asset.legal_entity_id, unitId: asset.unit_id, requireMfa: action === 'retire' });
    const reason = requireReason(body.reason);

    if (action === 'update') {
      const patch: any = {};
      if (CLASSIFICATIONS.has(body.classification)) patch.classification = body.classification;
      if (VISIBILITIES.has(body.visibility)) patch.visibility = body.visibility;
      if (RETENTION_CLASSES.has(body.retention_class)) patch.retention_class = body.retention_class;
      if (body.expires_at !== undefined) patch.expires_at = body.expires_at || null;
      if (body.document_number !== undefined) patch.document_number = clean(body.document_number, 120) || null;
      if (!Object.keys(patch).length) return Response.json({ error: 'no_valid_changes', request_id: requestId }, { status: 422 });
      const updated = await db.DocumentAsset.update(asset.id, patch);
      await audit(db, principal, { action: 'update', entity_id: asset.id, item_label: asset.original_filename, reason, legal_entity_id: asset.legal_entity_id, unit_id: asset.unit_id, request_id: requestId, details: patch });
      return Response.json({ asset: updated, request_id: requestId });
    }

    if (action === 'retire') {
      if (asset.status === 'retired') return Response.json({ asset, idempotent: true, request_id: requestId });
      const updated = await db.DocumentAsset.update(asset.id, { status: 'retired', retired_at: new Date().toISOString(), retired_by_user_id: principal.user.id, retirement_reason: reason });
      await audit(db, principal, { action: 'status_change', entity_id: asset.id, item_label: asset.original_filename, reason, legal_entity_id: asset.legal_entity_id, unit_id: asset.unit_id, request_id: requestId });
      return Response.json({ asset: updated, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const code = ['reason_required', 'invalid_storage_key', 'invalid_storage_origin'].includes(error?.message) ? error.message : 'document_operation_failed';
    return Response.json({ error: code, request_id: requestId }, { status: code === 'document_operation_failed' ? 500 : 422 });
  }
});
