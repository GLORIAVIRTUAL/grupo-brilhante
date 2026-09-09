import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { authorizeUserOrInternal, enforceAuthenticatedUser, securityErrorResponse } from '../../shared/functionSecurity.js';
import { reconciliationScore } from '../../shared/bankingProviderContract.js';
import { normalizeAmount, normalizeDate, sha256Json } from '../../shared/financeCore.js';
import { roundMoney } from '../../shared/businessCore.js';

function clean(value: unknown, max = 300) { return String(value || '').trim().slice(0, max); }
function reason(value: unknown) { const text = clean(value, 800); if (text.length < 8) throw new Error('reason_required'); return text; }
async function principalFor(base44: any, req: Request, user: any, permission: string, legalEntityId: string, requireMfa = false) { return enforceAuthenticatedUser(base44, req, user, { permission, legalEntityId, requireMfa, source: 'manage_bank_reconciliation' }); }
async function audit(db: any, principal: any, input: any) { await db.AuditLog.create({ action: input.action, entity_type: input.entity_type, entity_id: input.entity_id, item_label: input.item_label, reason: input.reason, user_id: principal.user.id, user_email: principal.user.email, user_name: principal.user.full_name || principal.user.email, user_role: principal.role, legal_entity_id: input.legal_entity_id, request_id: input.request_id, before_data: input.before_data, after_data: input.after_data, metadata: input.metadata || {}, domain: 'finance', success: true }); }

function normalizeTransaction(row: any) {
  const externalId = clean(row.external_id || row.id || row.fitid || row.document_number, 160);
  const date = normalizeDate(row.transaction_date || row.date || row.data);
  const signedAmount = normalizeAmount(row.amount ?? row.valor);
  const explicitType = clean(row.transaction_type || row.type || row.tipo, 40).toLowerCase();
  const transactionType = ['credit', 'debit', 'fee', 'refund', 'transfer'].includes(explicitType) ? explicitType : Number(signedAmount) < 0 ? 'debit' : 'credit';
  const description = clean(row.description || row.memo || row.descricao, 300);
  const messages = [];
  if (!externalId) messages.push('external_id_required');
  if (!date) messages.push('transaction_date_required');
  if (signedAmount === null || signedAmount === 0) messages.push('transaction_amount_required');
  if (!description) messages.push('description_required');
  return { valid: !messages.length, messages, value: { external_id: externalId, transaction_date: date ? `${date}T12:00:00.000Z` : null, posted_at: date ? `${date}T12:00:00.000Z` : null, transaction_type: transactionType, amount: roundMoney(Math.abs(Number(signedAmount || 0))), description, counterparty_name: clean(row.counterparty_name || row.nome, 180) || null, counterparty_tax_id: clean(row.counterparty_tax_id || row.documento, 20).replace(/\D/g, '') || null } };
}

async function candidateRows(db: any, legalEntityId: string, transaction: any) {
  if (transaction.transaction_type === 'credit') {
    const [charges, receivables] = await Promise.all([
      db.BankCharge.filter({ legal_entity_id: legalEntityId }, '-created_date', 1000).catch(() => []),
      db.AccountsReceivable.filter({ legal_entity_id: legalEntityId }, '-due_date', 2000).catch(() => []),
    ]);
    return [
      ...charges.filter((row: any) => !['cancelled', 'refunded'].includes(row.status)).map((row: any) => ({ type: 'bank_charge', id: row.id, row: { ...row, amount: Number(row.amount || 0) - Number(row.settled_amount || 0) } })),
      ...receivables.filter((row: any) => !['paid', 'cancelled', 'written_off'].includes(row.status)).map((row: any) => ({ type: 'accounts_receivable', id: row.id, row })),
    ];
  }
  const payables = await db.AccountsPayable.filter({ legal_entity_id: legalEntityId }, '-due_date', 2000).catch(() => []);
  return payables.filter((row: any) => !['paid', 'cancelled'].includes(row.status)).map((row: any) => ({ type: 'accounts_payable', id: row.id, row }));
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req); const db = base44.asServiceRole.entities;
    const body = await req.json(); const action = clean(body.action, 60);
    const auth = await authorizeUserOrInternal(base44, req, body, { allowInternal: false, source: 'manage_bank_reconciliation' });

    if (action === 'overview') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      await principalFor(base44, req, auth.user, 'banking.view', legalEntityId);
      const [batches, transactions, matches] = await Promise.all([
        db.ReconciliationBatch.filter({ legal_entity_id: legalEntityId }, '-created_date', 500).catch(() => []),
        db.BankTransaction.filter({ legal_entity_id: legalEntityId }, '-transaction_date', 3000).catch(() => []),
        db.BankReconciliationMatch.filter({ legal_entity_id: legalEntityId }, '-created_date', 3000).catch(() => []),
      ]);
      return Response.json({ batches, transactions, matches, request_id: requestId });
    }

    if (action === 'create_batch') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const principal = await principalFor(base44, req, auth.user, 'banking.manage', legalEntityId, true);
      const account = await db.BankAccount.get(body.bank_account_id).catch(() => null);
      if (!account || account.legal_entity_id !== legalEntityId || account.status !== 'active') return Response.json({ error: 'bank_account_scope_mismatch', request_id: requestId }, { status: 409 });
      const unit = await db.Unit.get(body.unit_id).catch(() => null);
      if (!unit || unit.legal_entity_id !== legalEntityId) return Response.json({ error: 'unit_company_mismatch', request_id: requestId }, { status: 409 });
      const sourceType = clean(body.source_type, 40);
      if (!['ofx', 'cnab_return', 'api', 'manual', 'migration'].includes(sourceType)) return Response.json({ error: 'invalid_reconciliation_source', request_id: requestId }, { status: 422 });
      const fileHash = clean(body.file_hash, 64);
      if (sourceType !== 'api' && !/^[a-f0-9]{64}$/.test(fileHash)) return Response.json({ error: 'file_hash_required', request_id: requestId }, { status: 422 });
      const idempotencyKey = clean(body.idempotency_key, 160);
      if (idempotencyKey.length < 12) return Response.json({ error: 'idempotency_key_required', request_id: requestId }, { status: 422 });
      const prior = await db.ReconciliationBatch.filter({ idempotency_key: idempotencyKey }, '-created_date', 2).catch(() => []);
      if (prior.length) return Response.json({ batch: prior[0], idempotent: true, request_id: requestId });
      const changeReason = reason(body.reason);
      const batch = await db.ReconciliationBatch.create({ legal_entity_id: legalEntityId, bank_account_id: account.id, source_type: sourceType, document_asset_id: clean(body.document_asset_id, 100) || null, file_hash: fileHash || `api-${crypto.randomUUID()}`, period_start: normalizeDate(body.period_start), period_end: normalizeDate(body.period_end), status: 'uploaded', total_records: 0, matched_records: 0, unmatched_records: 0, error_records: 0, total_credit_amount: 0, total_debit_amount: 0, idempotency_key: idempotencyKey, created_by_user_id: principal.user.id, metadata: { unit_id: unit.id } });
      await audit(db, principal, { action: 'create', entity_type: 'reconciliation_batch', entity_id: batch.id, item_label: `${sourceType}:${account.name}`, reason: changeReason, legal_entity_id: legalEntityId, request_id: requestId, after_data: batch });
      return Response.json({ batch, request_id: requestId }, { status: 201 });
    }

    const batch = body.batch_id ? await db.ReconciliationBatch.get(body.batch_id).catch(() => null) : null;

    if (action === 'stage_transactions') {
      if (!batch) return Response.json({ error: 'reconciliation_batch_not_found', request_id: requestId }, { status: 404 });
      const principal = await principalFor(base44, req, auth.user, 'banking.manage', batch.legal_entity_id, true);
      if (!['uploaded', 'ready'].includes(batch.status)) return Response.json({ error: 'reconciliation_batch_not_stageable', request_id: requestId }, { status: 409 });
      const rows = Array.isArray(body.transactions) ? body.transactions.slice(0, 1000) : [];
      if (!rows.length) return Response.json({ error: 'transactions_required', request_id: requestId }, { status: 422 });
      const changeReason = reason(body.reason); let created = 0; let skipped = 0; let errors = 0; let credits = 0; let debits = 0;
      for (const row of rows) {
        const parsed = normalizeTransaction(row);
        if (!parsed.valid) { errors += 1; continue; }
        const existing = await db.BankTransaction.filter({ bank_account_id: batch.bank_account_id, external_id: parsed.value.external_id }, '-created_date', 2).catch(() => []);
        const hash = await sha256Json(parsed.value);
        if (existing.length) { if (existing[0].import_hash !== hash) return Response.json({ error: 'bank_transaction_conflict', external_id: parsed.value.external_id, request_id: requestId }, { status: 409 }); skipped += 1; continue; }
        await db.BankTransaction.create({ ...parsed.value, legal_entity_id: batch.legal_entity_id, unit_id: batch.metadata?.unit_id, bank_account_id: batch.bank_account_id, source_system: batch.source_type === 'api' ? 'provider' : 'bank', reconciliation_batch_id: batch.id, import_hash: hash, idempotency_key: `reconciliation:${batch.id}:${parsed.value.external_id}`, status: 'unmatched', raw_data: {}, metadata: {} });
        created += 1; if (parsed.value.transaction_type === 'credit') credits += parsed.value.amount; else debits += parsed.value.amount;
      }
      const transactions = await db.BankTransaction.filter({ reconciliation_batch_id: batch.id }, 'transaction_date', 5000).catch(() => []);
      const updated = await db.ReconciliationBatch.update(batch.id, { status: errors ? 'completed_with_errors' : 'ready', total_records: transactions.length, unmatched_records: transactions.filter((row: any) => row.status !== 'matched').length, error_records: errors, total_credit_amount: roundMoney(transactions.filter((row: any) => row.transaction_type === 'credit').reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)), total_debit_amount: roundMoney(transactions.filter((row: any) => row.transaction_type !== 'credit').reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)) });
      await audit(db, principal, { action: 'upload', entity_type: 'reconciliation_batch', entity_id: batch.id, item_label: `${batch.source_type}:${batch.id}`, reason: changeReason, legal_entity_id: batch.legal_entity_id, request_id: requestId, after_data: { created, skipped, errors, credits: roundMoney(credits), debits: roundMoney(debits) } });
      return Response.json({ batch: updated, created, skipped, errors, request_id: requestId });
    }

    if (action === 'generate_suggestions') {
      if (!batch) return Response.json({ error: 'reconciliation_batch_not_found', request_id: requestId }, { status: 404 });
      const principal = await principalFor(base44, req, auth.user, 'banking.reconcile', batch.legal_entity_id, true);
      const changeReason = reason(body.reason);
      const transactions = await db.BankTransaction.filter({ reconciliation_batch_id: batch.id }, 'transaction_date', 5000).catch(() => []);
      let suggestions = 0;
      for (const transaction of transactions.filter((row: any) => ['unmatched', 'suggested'].includes(row.status))) {
        const candidates = await candidateRows(db, batch.legal_entity_id, transaction);
        const scored = candidates.map((candidate) => ({ candidate, score: reconciliationScore(transaction, candidate.row) })).filter((item) => item.score.confidencePercent >= 55).sort((a, b) => b.score.confidencePercent - a.score.confidencePercent).slice(0, 5);
        for (const item of scored) {
          const existing = await db.BankReconciliationMatch.filter({ bank_transaction_id: transaction.id, candidate_entity_type: item.candidate.type, candidate_entity_id: item.candidate.id }, '-created_date', 2).catch(() => []);
          if (!existing.length) { await db.BankReconciliationMatch.create({ legal_entity_id: batch.legal_entity_id, reconciliation_batch_id: batch.id, bank_transaction_id: transaction.id, candidate_entity_type: item.candidate.type, candidate_entity_id: item.candidate.id, confidence_percent: item.score.confidencePercent, match_reasons: item.score.reasons, amount_difference: item.score.amountDifference, date_difference_days: item.score.dateDifferenceDays, status: 'suggested', created_by_user_id: principal.user.id, metadata: {} }); suggestions += 1; }
        }
        if (scored.length) await db.BankTransaction.update(transaction.id, { status: 'suggested', match_confidence: scored[0].score.confidencePercent });
      }
      await audit(db, principal, { action: 'update', entity_type: 'reconciliation_batch', entity_id: batch.id, item_label: `${batch.source_type}:${batch.id}`, reason: changeReason, legal_entity_id: batch.legal_entity_id, request_id: requestId, after_data: { suggestions } });
      return Response.json({ suggestions, request_id: requestId });
    }

    if (action === 'accept_match' || action === 'reject_match') {
      const match = await db.BankReconciliationMatch.get(body.match_id).catch(() => null);
      if (!match) return Response.json({ error: 'reconciliation_match_not_found', request_id: requestId }, { status: 404 });
      const principal = await principalFor(base44, req, auth.user, 'banking.reconcile', match.legal_entity_id, true);
      const transaction = await db.BankTransaction.get(match.bank_transaction_id).catch(() => null);
      if (!transaction || transaction.legal_entity_id !== match.legal_entity_id || transaction.status === 'matched') return Response.json({ error: 'bank_transaction_not_reconcilable', request_id: requestId }, { status: 409 });
      const changeReason = reason(body.reason);
      if (action === 'reject_match') {
        const updated = await db.BankReconciliationMatch.update(match.id, { status: 'rejected', decided_at: new Date().toISOString(), decided_by_user_id: principal.user.id, decision_reason: changeReason });
        await audit(db, principal, { action: 'status_change', entity_type: 'bank_reconciliation_match', entity_id: match.id, item_label: transaction.external_id, reason: changeReason, legal_entity_id: match.legal_entity_id, request_id: requestId, before_data: { status: match.status }, after_data: { status: 'rejected' } });
        return Response.json({ match: updated, request_id: requestId });
      }
      if (match.confidence_percent < 55 && principal.role !== 'admin' && principal.role !== 'super_admin') return Response.json({ error: 'low_confidence_requires_admin', request_id: requestId }, { status: 403 });
      const accepted = await db.BankReconciliationMatch.update(match.id, { status: 'accepted', decided_at: new Date().toISOString(), decided_by_user_id: principal.user.id, decision_reason: changeReason });
      const updatedTransaction = await db.BankTransaction.update(transaction.id, { status: 'matched', matched_entity_type: match.candidate_entity_type, matched_entity_id: match.candidate_entity_id, match_confidence: match.confidence_percent, reconciled_by_user_id: principal.user.id, reconciled_at: new Date().toISOString() });
      const otherMatches = await db.BankReconciliationMatch.filter({ bank_transaction_id: transaction.id, status: 'suggested' }, '-confidence_percent', 50).catch(() => []);
      await Promise.all(otherMatches.filter((item: any) => item.id !== match.id).map((item: any) => db.BankReconciliationMatch.update(item.id, { status: 'superseded' }).catch(() => null)));
      const batchId = transaction.reconciliation_batch_id;
      if (batchId) {
        const transactions = await db.BankTransaction.filter({ reconciliation_batch_id: batchId }, 'transaction_date', 5000).catch(() => []);
        const matched = transactions.filter((row: any) => row.id === transaction.id || row.status === 'matched').length;
        const remaining = Math.max(0, transactions.length - matched);
        await db.ReconciliationBatch.update(batchId, { matched_records: matched, unmatched_records: remaining, status: remaining ? 'processing' : 'completed', processed_at: remaining ? null : new Date().toISOString(), approved_at: new Date().toISOString(), approved_by_user_id: principal.user.id }).catch(() => null);
      }
      await audit(db, principal, { action: 'approve', entity_type: 'bank_reconciliation_match', entity_id: match.id, item_label: transaction.external_id, reason: changeReason, legal_entity_id: match.legal_entity_id, request_id: requestId, before_data: { status: match.status }, after_data: { status: 'accepted', transaction_status: 'matched' }, metadata: { candidate_entity_type: match.candidate_entity_type, candidate_entity_id: match.candidate_entity_id } });
      return Response.json({ match: accepted, transaction: updatedTransaction, financial_settlement_pending: true, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const validation = new Set(['reason_required', 'invalid_reconciliation_source', 'file_hash_required']);
    return Response.json({ error: validation.has(error?.message) ? error.message : 'bank_reconciliation_failed', request_id: requestId }, { status: validation.has(error?.message) ? 422 : 500 });
  }
});
