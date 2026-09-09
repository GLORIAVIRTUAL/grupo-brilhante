import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { authorizeUserOrInternal, enforceAuthenticatedUser, securityErrorResponse } from '../../shared/functionSecurity.js';
import { normalizePartyInput, roundMoney } from '../../shared/businessCore.js';
import { normalizeMigrationRow, sha256Json } from '../../shared/financeCore.js';
import { recordDomainEvent } from '../../shared/domainEvents.js';

const SUPPORTED_BATCHES = new Set(['parties', 'accounts_payable', 'accounts_receivable', 'bank_transactions']);
function clean(value: unknown, max = 240) { return String(value || '').trim().slice(0, max); }
function reason(value: unknown) { const text = clean(value, 800); if (text.length < 8) throw new Error('reason_required'); return text; }
function enabled() { return String(Deno.env.get('CONTA_AZUL_MIGRATION_ENABLED') || '').toLowerCase() === 'true'; }

async function principalFor(base44: any, req: Request, user: any, permission: string, legalEntityId: string, requireMfa = true) {
  return enforceAuthenticatedUser(base44, req, user, { permission, legalEntityId, requireMfa, source: 'manage_conta_azul_migration' });
}

async function audit(db: any, principal: any, input: any) {
  await db.AuditLog.create({
    action: input.action,
    entity_type: input.entity_type || 'migration_batch',
    entity_id: input.entity_id,
    item_label: input.item_label,
    reason: input.reason,
    user_id: principal.user.id,
    user_email: principal.user.email,
    user_name: principal.user.full_name || principal.user.display_name || principal.user.email,
    user_role: principal.role,
    legal_entity_id: input.legal_entity_id,
    request_id: input.request_id,
    before_data: input.before_data,
    after_data: input.after_data,
    metadata: input.metadata || {},
    domain: 'integration',
    success: true,
  });
}

async function batchRecords(db: any, batchId: string) {
  return db.MigrationRecord.filter({ migration_batch_id: batchId }, 'source_sequence', 10000).catch(() => []);
}

async function createTarget(db: any, batch: any, record: any, principal: any) {
  const row = record.normalized_payload || {};
  const unitId = batch.metadata?.unit_id || null;
  const now = new Date().toISOString();
  if (batch.batch_type === 'accounts_payable') {
    if (!unitId) throw new Error('migration_unit_required');
    return db.AccountsPayable.create({ legal_entity_id: batch.legal_entity_id, unit_id: unitId, business_party_id: batch.metadata?.default_business_party_id || null, supplier_name: row.counterparty_tax_id || 'Importação Conta Azul', description: row.description, category: row.category || 'migration', cost_center_id: batch.metadata?.default_cost_center_id || null, cost_center: row.cost_center_code || null, competence_date: `${row.competence_date}T12:00:00.000Z`, issue_date: now, due_date: `${row.due_date}T12:00:00.000Z`, original_amount: row.amount, paid_amount: 0, open_amount: row.amount, status: 'pending_approval', approval_status: 'pending', source_system: 'conta_azul', external_id: record.source_record_id, migration_record_id: record.id, metadata: { migration_batch_id: batch.id } });
  }
  if (batch.batch_type === 'accounts_receivable') {
    if (!unitId) throw new Error('migration_unit_required');
    const customerId = batch.metadata?.default_customer_id || batch.metadata?.default_business_party_id;
    if (!customerId) throw new Error('migration_customer_required');
    return db.AccountsReceivable.create({ legal_entity_id: batch.legal_entity_id, unit_id: unitId, business_party_id: batch.metadata?.default_business_party_id || null, customer_id: customerId, description: row.description, competence_date: row.competence_date, competence: row.competence_date.slice(0, 7), issue_date: now, due_date: `${row.due_date}T12:00:00.000Z`, original_amount: row.amount, paid_amount: 0, open_amount: row.amount, status: 'open', billing_type: 'invoiced', source_system: 'conta_azul', external_id: record.source_record_id, migration_record_id: record.id, metadata: { migration_batch_id: batch.id } });
  }
  if (batch.batch_type === 'bank_transactions') {
    if (!unitId || !batch.metadata?.bank_account_id) throw new Error('migration_bank_scope_required');
    return db.BankTransaction.create({ legal_entity_id: batch.legal_entity_id, unit_id: unitId, bank_account_id: batch.metadata.bank_account_id, external_id: row.external_id, transaction_date: `${row.transaction_date}T12:00:00.000Z`, posted_at: `${row.transaction_date}T12:00:00.000Z`, transaction_type: row.transaction_type, amount: Math.abs(row.amount), currency: 'BRL', description: row.description, status: 'unmatched', source_system: 'conta_azul', migration_record_id: record.id, import_hash: record.source_hash, idempotency_key: `conta_azul:${batch.id}:${record.source_record_id}`, raw_data: {}, metadata: { migration_batch_id: batch.id } });
  }
  if (batch.batch_type === 'parties') {
    const partyType = row.tax_id.length === 11 ? 'person' : 'company';
    const normalized = normalizePartyInput({ party_type: partyType, legal_name: row.legal_name, trade_name: row.trade_name, tax_id: row.tax_id });
    const duplicates = await db.BusinessParty.filter({ tax_id: normalized.tax_id }, '-created_date', 2).catch(() => []);
    if (duplicates.length) return duplicates[0];
    const party = await db.BusinessParty.create({ ...normalized, status: 'draft', segment: 'other', default_legal_entity_id: batch.legal_entity_id, default_unit_id: unitId, risk_rating: 'medium', credit_limit: 0, billing_terms_days: 0, source_system: 'conta_azul', external_ids: { conta_azul: record.source_record_id }, created_by_user_id: principal.user.id, updated_by_user_id: principal.user.id, metadata: { migration_batch_id: batch.id, migration_record_id: record.id } });
    await db.PartyRole.create({ business_party_id: party.id, role_type: batch.metadata?.party_role_type || 'customer', legal_entity_id: batch.legal_entity_id, unit_id: unitId, status: 'active', valid_from: now, created_by_user_id: principal.user.id, metadata: { migration_batch_id: batch.id } });
    if (row.email) await db.PartyContact.create({ business_party_id: party.id, contact_type: 'email', value: row.email, canonical_value: row.email, is_primary: true, allows_service_messages: true, allows_marketing: false, consent_source: 'import', status: 'active', created_by_user_id: principal.user.id, metadata: { migration_batch_id: batch.id } }).catch(() => null);
    return party;
  }
  throw new Error('unsupported_migration_batch');
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const body = await req.json();
    const action = clean(body.action, 60);
    const auth = await authorizeUserOrInternal(base44, req, body, { allowInternal: false, source: 'manage_conta_azul_migration' });

    if (action === 'overview') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      await principalFor(base44, req, auth.user, 'migration.view', legalEntityId);
      const batches = await db.MigrationBatch.filter({ legal_entity_id: legalEntityId, source_system: 'conta_azul' }, '-created_date', 500).catch(() => []);
      return Response.json({ batches, execution_enabled: enabled(), request_id: requestId });
    }

    if (action === 'create_batch') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const principal = await principalFor(base44, req, auth.user, 'migration.execute', legalEntityId);
      const batchType = clean(body.batch_type, 60);
      if (!SUPPORTED_BATCHES.has(batchType)) return Response.json({ error: 'unsupported_migration_batch', request_id: requestId }, { status: 422 });
      const asset = await db.DocumentAsset.get(body.document_asset_id).catch(() => null);
      if (!asset || asset.legal_entity_id !== legalEntityId || asset.status !== 'active') return Response.json({ error: 'migration_document_scope_mismatch', request_id: requestId }, { status: 409 });
      const idempotencyKey = clean(body.idempotency_key, 160);
      if (idempotencyKey.length < 12) return Response.json({ error: 'idempotency_key_required', request_id: requestId }, { status: 422 });
      const prior = await db.MigrationBatch.filter({ idempotency_key: idempotencyKey }, '-created_date', 2).catch(() => []);
      if (prior.length) return Response.json({ batch: prior[0], idempotent: true, request_id: requestId });
      const changeReason = reason(body.reason);
      const batch = await db.MigrationBatch.create({ legal_entity_id: legalEntityId, source_system: 'conta_azul', batch_type: batchType, document_asset_id: asset.id, source_hash: asset.file_hash, mapping_version: clean(body.mapping_version, 50) || 'conta-azul-v1', status: 'draft', total_records: 0, valid_records: 0, warning_records: 0, error_records: 0, imported_records: 0, skipped_records: 0, idempotency_key: idempotencyKey, created_by_user_id: principal.user.id, metadata: { unit_id: clean(body.unit_id, 100) || null, bank_account_id: clean(body.bank_account_id, 100) || null, default_cost_center_id: clean(body.default_cost_center_id, 100) || null, default_business_party_id: clean(body.default_business_party_id, 100) || null, default_customer_id: clean(body.default_customer_id, 100) || null, party_role_type: clean(body.party_role_type, 60) || 'customer' } });
      await audit(db, principal, { action: 'create', entity_id: batch.id, item_label: `${batchType}:${asset.original_name || asset.id}`, reason: changeReason, legal_entity_id: legalEntityId, request_id: requestId, after_data: batch });
      return Response.json({ batch, request_id: requestId }, { status: 201 });
    }

    const batch = await db.MigrationBatch.get(body.batch_id).catch(() => null);
    if (!batch || batch.source_system !== 'conta_azul') return Response.json({ error: 'migration_batch_not_found', request_id: requestId }, { status: 404 });

    if (action === 'detail') {
      await principalFor(base44, req, auth.user, 'migration.view', batch.legal_entity_id);
      const records = await batchRecords(db, batch.id);
      return Response.json({ batch, records: records.slice(0, 5000), execution_enabled: enabled(), request_id: requestId });
    }

    if (action === 'stage_records') {
      const principal = await principalFor(base44, req, auth.user, 'migration.execute', batch.legal_entity_id);
      if (!['draft', 'validated'].includes(batch.status)) return Response.json({ error: 'migration_batch_not_stageable', request_id: requestId }, { status: 409 });
      const rows = Array.isArray(body.records) ? body.records.slice(0, 500) : [];
      if (!rows.length) return Response.json({ error: 'migration_records_required', request_id: requestId }, { status: 422 });
      const changeReason = reason(body.reason);
      const existing = await batchRecords(db, batch.id);
      const bySource = new Map(existing.map((record: any) => [record.source_record_id, record]));
      let created = 0; let skipped = 0;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] && typeof rows[index] === 'object' ? rows[index] : {};
        const normalizedResult = normalizeMigrationRow(batch.batch_type, row);
        const sourceRecordId = clean(normalizedResult.normalized.source_record_id || `row-${existing.length + index + 1}`, 160);
        const sourceHash = await sha256Json(row);
        const duplicate = bySource.get(sourceRecordId);
        if (duplicate) {
          if (duplicate.source_hash !== sourceHash) return Response.json({ error: 'migration_source_id_conflict', source_record_id: sourceRecordId, request_id: requestId }, { status: 409 });
          skipped += 1; continue;
        }
        const record = await db.MigrationRecord.create({ migration_batch_id: batch.id, legal_entity_id: batch.legal_entity_id, source_system: 'conta_azul', source_entity: batch.batch_type, source_record_id: sourceRecordId, source_hash: sourceHash, source_sequence: existing.length + index + 1, target_entity: batch.batch_type === 'parties' ? 'BusinessParty' : batch.batch_type === 'accounts_payable' ? 'AccountsPayable' : batch.batch_type === 'accounts_receivable' ? 'AccountsReceivable' : 'BankTransaction', operation: 'create', status: normalizedResult.valid ? 'validated' : 'error', validation_messages: normalizedResult.messages, payload: row, normalized_payload: normalizedResult.normalized, reconciled: false, created_by_user_id: principal.user.id, metadata: {} });
        bySource.set(sourceRecordId, record); created += 1;
      }
      const records = await batchRecords(db, batch.id);
      const valid = records.filter((record: any) => record.status === 'validated').length;
      const errors = records.filter((record: any) => record.status === 'error').length;
      const updated = await db.MigrationBatch.update(batch.id, { status: errors ? 'draft' : 'validated', total_records: records.length, valid_records: valid, error_records: errors, skipped_records: Number(batch.skipped_records || 0) + skipped });
      await audit(db, principal, { action: 'upload', entity_id: batch.id, item_label: `${batch.batch_type}:${batch.id}`, reason: changeReason, legal_entity_id: batch.legal_entity_id, request_id: requestId, before_data: { total_records: batch.total_records }, after_data: { total_records: records.length, valid_records: valid, error_records: errors }, metadata: { created, skipped } });
      return Response.json({ batch: updated, created, skipped, request_id: requestId });
    }

    if (action === 'dry_run') {
      const principal = await principalFor(base44, req, auth.user, 'migration.execute', batch.legal_entity_id);
      if (!['validated', 'dry_run'].includes(batch.status)) return Response.json({ error: 'migration_batch_not_validated', request_id: requestId }, { status: 409 });
      const records = await batchRecords(db, batch.id);
      const errors = records.filter((record: any) => record.status === 'error');
      if (errors.length) return Response.json({ error: 'migration_validation_errors', count: errors.length, request_id: requestId }, { status: 409 });
      const changeReason = reason(body.reason);
      const amountTotal = roundMoney(records.reduce((sum: number, record: any) => sum + Number(record.normalized_payload?.amount || 0), 0));
      const duplicates = [];
      for (const record of records.slice(0, 2000)) {
        const entity = record.target_entity;
        if (entity === 'BusinessParty') {
          const rows = await db.BusinessParty.filter({ tax_id: record.normalized_payload?.tax_id }, '-created_date', 1).catch(() => []);
          if (rows.length) duplicates.push(record.source_record_id);
        } else if (entity && record.source_record_id) {
          const rows = await db[entity].filter({ external_id: record.source_record_id, source_system: 'conta_azul' }, '-created_date', 1).catch(() => []);
          if (rows.length) duplicates.push(record.source_record_id);
        }
      }
      const summary = { total_records: records.length, valid_records: records.length, duplicate_records: duplicates.length, amount_total: amountTotal, duplicate_source_ids: duplicates.slice(0, 100), generated_at: new Date().toISOString() };
      const updated = await db.MigrationBatch.update(batch.id, { status: 'dry_run', reconciliation_summary: summary, valid_records: records.length, error_records: 0, warning_records: duplicates.length });
      await audit(db, principal, { action: 'view', entity_id: batch.id, item_label: `${batch.batch_type}:${batch.id}`, reason: changeReason, legal_entity_id: batch.legal_entity_id, request_id: requestId, after_data: summary, metadata: { operation: 'dry_run' } });
      return Response.json({ batch: updated, summary, request_id: requestId });
    }

    if (action === 'request_approval' || action === 'approve_batch') {
      const approval = action === 'approve_batch';
      const principal = await principalFor(base44, req, auth.user, approval ? 'migration.approve' : 'migration.execute', batch.legal_entity_id);
      const expected = approval ? 'pending_approval' : 'dry_run';
      if (batch.status !== expected) return Response.json({ error: approval ? 'migration_batch_not_pending_approval' : 'migration_dry_run_required', request_id: requestId }, { status: 409 });
      const changeReason = reason(body.reason);
      const patch = approval ? { status: 'approved', approved_at: new Date().toISOString(), approved_by_user_id: principal.user.id } : { status: 'pending_approval' };
      const updated = await db.MigrationBatch.update(batch.id, patch);
      await audit(db, principal, { action: approval ? 'approve' : 'status_change', entity_id: batch.id, item_label: `${batch.batch_type}:${batch.id}`, reason: changeReason, legal_entity_id: batch.legal_entity_id, request_id: requestId, before_data: { status: batch.status }, after_data: patch });
      return Response.json({ batch: updated, request_id: requestId });
    }

    if (action === 'execute_batch') {
      const principal = await principalFor(base44, req, auth.user, 'migration.approve', batch.legal_entity_id);
      if (!enabled()) return Response.json({ error: 'migration_execution_disabled', request_id: requestId }, { status: 503 });
      if (batch.status !== 'approved') return Response.json({ error: 'migration_batch_not_approved', request_id: requestId }, { status: 409 });
      const changeReason = reason(body.reason);
      await db.MigrationBatch.update(batch.id, { status: 'processing' });
      const records = await batchRecords(db, batch.id);
      let imported = 0; let skipped = 0; let failures = 0;
      for (const record of records) {
        if (record.status === 'imported') { skipped += 1; continue; }
        if (record.status !== 'validated') { failures += 1; continue; }
        try {
          const target = await createTarget(db, batch, record, principal);
          await db.MigrationRecord.update(record.id, { target_record_id: target.id, status: 'imported', processed_at: new Date().toISOString(), after_snapshot: { id: target.id }, reconciled: true });
          imported += 1;
        } catch (error: any) {
          await db.MigrationRecord.update(record.id, { status: 'repair_required', safe_error_code: clean(error?.message || 'migration_record_failed', 120), processed_at: new Date().toISOString() });
          failures += 1;
        }
      }
      const finalStatus = failures ? 'completed_with_errors' : 'completed';
      const updated = await db.MigrationBatch.update(batch.id, { status: finalStatus, imported_records: Number(batch.imported_records || 0) + imported, skipped_records: Number(batch.skipped_records || 0) + skipped, error_records: failures, processed_at: new Date().toISOString() });
      await audit(db, principal, { action: 'update', entity_id: batch.id, item_label: `${batch.batch_type}:${batch.id}`, reason: changeReason, legal_entity_id: batch.legal_entity_id, request_id: requestId, before_data: { status: batch.status }, after_data: { status: finalStatus, imported, skipped, failures }, metadata: { operation: 'execute_batch' } });
      await recordDomainEvent(db, { eventType: 'migration_batch.processed', aggregateType: 'MigrationBatch', aggregateId: batch.id, legalEntityId: batch.legal_entity_id, actorId: principal.user.id, eventKey: `migration_batch.processed:${batch.id}:${batch.processed_at || 'first'}`, payload: { batch_type: batch.batch_type, status: finalStatus, imported, skipped, failures } });
      return Response.json({ batch: updated, imported, skipped, failures, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const validation = new Set(['reason_required', 'migration_unit_required', 'migration_customer_required', 'migration_bank_scope_required', 'unsupported_migration_batch', 'invalid_cpf', 'invalid_cnpj', 'party_name_required', 'domain_event_key_conflict']);
    return Response.json({ error: validation.has(error?.message) ? error.message : 'conta_azul_migration_failed', request_id: requestId }, { status: validation.has(error?.message) ? 422 : 500 });
  }
});
