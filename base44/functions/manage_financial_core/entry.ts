import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { authorizeUserOrInternal, enforceAuthenticatedUser, securityErrorResponse } from '../../shared/functionSecurity.js';
import { assertTransition, roundMoney } from '../../shared/businessCore.js';
import { competenceParts, financialPeriodBounds, financialPeriodKey, INTERCOMPANY_TRANSITIONS, isPeriodWritable, normalizeAmount, normalizeDate, weightedProjection } from '../../shared/financeCore.js';
import { recordDomainEvent } from '../../shared/domainEvents.js';

function clean(value: unknown, max = 240) { return String(value || '').trim().slice(0, max); }
function reason(value: unknown) { const text = clean(value, 800); if (text.length < 8) throw new Error('reason_required'); return text; }
function nowIso() { return new Date().toISOString(); }

async function principalFor(base44: any, req: Request, user: any, permission: string, legalEntityId: string, unitId?: string, requireMfa = false) {
  return enforceAuthenticatedUser(base44, req, user, { permission, legalEntityId, unitId: unitId || null, requireMfa, source: 'manage_financial_core' });
}

async function audit(db: any, principal: any, input: any) {
  await db.AuditLog.create({
    action: input.action,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    item_label: input.item_label,
    reason: input.reason,
    user_id: principal.user.id,
    user_email: principal.user.email,
    user_name: principal.user.full_name || principal.user.display_name || principal.user.email,
    user_role: principal.role,
    legal_entity_id: input.legal_entity_id,
    unit_id: input.unit_id,
    request_id: input.request_id,
    before_data: input.before_data,
    after_data: input.after_data,
    metadata: input.metadata || {},
    domain: 'finance',
    success: true,
  });
}

async function ensureWritablePeriod(db: any, legalEntityId: string, dateValue: string) {
  const { year, month } = competenceParts(dateValue);
  const key = financialPeriodKey(legalEntityId, year, month);
  const rows = await db.FinancialPeriod.filter({ period_key: key }, '-created_date', 2).catch(() => []);
  if (rows.length && !isPeriodWritable(rows[0])) throw new Error('financial_period_closed');
  return rows[0] || null;
}

async function validateUnit(db: any, unitId: string, legalEntityId: string) {
  const unit = await db.Unit.get(unitId).catch(() => null);
  if (!unit || unit.legal_entity_id !== legalEntityId) throw new Error('unit_company_mismatch');
  return unit;
}

async function validateParty(db: any, partyId: string, legalEntityId: string) {
  const party = await db.BusinessParty.get(partyId).catch(() => null);
  if (!party || ['blocked', 'inactive'].includes(party.status)) throw new Error('party_unavailable');
  const roles = await db.PartyRole.filter({ business_party_id: partyId, legal_entity_id: legalEntityId, status: 'active' }, '-created_date', 5).catch(() => []);
  if (!roles.length) throw new Error('party_company_role_required');
  return party;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const body = await req.json();
    const action = clean(body.action, 60);
    const auth = await authorizeUserOrInternal(base44, req, body, { allowInternal: false, source: 'manage_financial_core' });

    if (action === 'overview') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      await principalFor(base44, req, auth.user, 'finance.view', legalEntityId);
      const [periods, sourceEntries, destinationEntries, projections, payables, receivables] = await Promise.all([
        db.FinancialPeriod.filter({ legal_entity_id: legalEntityId }, '-period_key', 120).catch(() => []),
        db.IntercompanyEntry.filter({ source_legal_entity_id: legalEntityId }, '-created_date', 500).catch(() => []),
        db.IntercompanyEntry.filter({ destination_legal_entity_id: legalEntityId }, '-created_date', 500).catch(() => []),
        db.FinancialProjection.filter({ legal_entity_id: legalEntityId, status: 'active' }, 'projection_date', 2000).catch(() => []),
        db.AccountsPayable.filter({ legal_entity_id: legalEntityId }, '-due_date', 2000).catch(() => []),
        db.AccountsReceivable.filter({ legal_entity_id: legalEntityId }, '-due_date', 2000).catch(() => []),
      ]);
      const uniqueEntries = [...new Map([...sourceEntries, ...destinationEntries].map((entry: any) => [entry.id, entry])).values()];
      const summary = {
        payable_open: roundMoney(payables.filter((row: any) => !['paid', 'cancelled'].includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.open_amount || 0), 0)),
        receivable_open: roundMoney(receivables.filter((row: any) => !['paid', 'cancelled', 'written_off'].includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.open_amount || 0), 0)),
        projected_inflow: roundMoney(projections.filter((row: any) => row.direction === 'inflow').reduce((sum: number, row: any) => sum + weightedProjection(row.amount, row.probability_percent), 0)),
        projected_outflow: roundMoney(projections.filter((row: any) => row.direction === 'outflow').reduce((sum: number, row: any) => sum + weightedProjection(row.amount, row.probability_percent), 0)),
      };
      return Response.json({ periods, intercompany_entries: uniqueEntries, projections, payables, receivables, summary, request_id: requestId });
    }

    if (action === 'open_period') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const principal = await principalFor(base44, req, auth.user, 'finance.manage', legalEntityId, undefined, true);
      const year = Number(body.year); const month = Number(body.month);
      const periodKey = financialPeriodKey(legalEntityId, year, month);
      const existing = await db.FinancialPeriod.filter({ period_key: periodKey }, '-created_date', 2).catch(() => []);
      if (existing.length) return Response.json({ period: existing[0], idempotent: true, request_id: requestId });
      const bounds = financialPeriodBounds(year, month);
      const changeReason = reason(body.reason);
      const period = await db.FinancialPeriod.create({ legal_entity_id: legalEntityId, year, month, period_key: periodKey, starts_on: bounds.start, ends_on: bounds.end, status: 'open', created_by_user_id: principal.user.id, metadata: {} });
      await audit(db, principal, { action: 'create', entity_type: 'financial_period', entity_id: period.id, item_label: periodKey, reason: changeReason, legal_entity_id: legalEntityId, request_id: requestId, after_data: period });
      return Response.json({ period, request_id: requestId }, { status: 201 });
    }

    if (action === 'close_period' || action === 'reopen_period') {
      const period = await db.FinancialPeriod.get(body.period_id).catch(() => null);
      if (!period) return Response.json({ error: 'financial_period_not_found', request_id: requestId }, { status: 404 });
      const principal = await principalFor(base44, req, auth.user, 'finance.close_period', period.legal_entity_id, undefined, true);
      const changeReason = reason(body.reason);
      if (action === 'close_period' && !['open', 'reopened'].includes(period.status)) return Response.json({ error: 'financial_period_not_open', request_id: requestId }, { status: 409 });
      if (action === 'reopen_period' && period.status !== 'closed') return Response.json({ error: 'financial_period_not_closed', request_id: requestId }, { status: 409 });
      let patch: any;
      if (action === 'close_period') {
        const [payables, receivables, pendingMigrations] = await Promise.all([
          db.AccountsPayable.filter({ legal_entity_id: period.legal_entity_id }, '-due_date', 5000).catch(() => []),
          db.AccountsReceivable.filter({ legal_entity_id: period.legal_entity_id }, '-due_date', 5000).catch(() => []),
          db.MigrationBatch.filter({ legal_entity_id: period.legal_entity_id }, '-created_date', 200).catch(() => []),
        ]);
        if (pendingMigrations.some((batch: any) => ['processing', 'repair_required'].includes(batch.status))) return Response.json({ error: 'migration_blocks_period_close', request_id: requestId }, { status: 409 });
        const inPeriod = (row: any) => { const date = normalizeDate(row.competence_date || row.due_date); return date && date >= period.starts_on && date <= period.ends_on; };
        const snapshot = { payable_count: payables.filter(inPeriod).length, payable_open: roundMoney(payables.filter(inPeriod).reduce((sum: number, row: any) => sum + Number(row.open_amount || 0), 0)), receivable_count: receivables.filter(inPeriod).length, receivable_open: roundMoney(receivables.filter(inPeriod).reduce((sum: number, row: any) => sum + Number(row.open_amount || 0), 0)), captured_at: nowIso() };
        patch = { status: 'closed', closed_at: nowIso(), closed_by_user_id: principal.user.id, closure_reason: changeReason, closure_snapshot: snapshot };
      } else {
        patch = { status: 'reopened', reopened_at: nowIso(), reopened_by_user_id: principal.user.id, reopen_reason: changeReason };
      }
      const updated = await db.FinancialPeriod.update(period.id, patch);
      await audit(db, principal, { action: 'status_change', entity_type: 'financial_period', entity_id: period.id, item_label: period.period_key, reason: changeReason, legal_entity_id: period.legal_entity_id, request_id: requestId, before_data: { status: period.status }, after_data: patch });
      await recordDomainEvent(db, { eventType: `financial_period.${updated.status}`, aggregateType: 'FinancialPeriod', aggregateId: period.id, legalEntityId: period.legal_entity_id, actorId: principal.user.id, payload: { period_key: period.period_key, status: updated.status } });
      return Response.json({ period: updated, request_id: requestId });
    }

    if (action === 'create_projection') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const principal = await principalFor(base44, req, auth.user, 'finance.manage', legalEntityId);
      const amount = normalizeAmount(body.amount);
      const projectionDate = normalizeDate(body.projection_date);
      if (amount === null || amount < 0 || !projectionDate || !['inflow', 'outflow'].includes(body.direction)) return Response.json({ error: 'invalid_projection', request_id: requestId }, { status: 422 });
      const changeReason = reason(body.reason);
      const projection = await db.FinancialProjection.create({ legal_entity_id: legalEntityId, cost_center_id: clean(body.cost_center_id, 100) || null, scenario: ['baseline', 'optimistic', 'conservative', 'custom'].includes(body.scenario) ? body.scenario : 'baseline', projection_date: projectionDate, competence_date: normalizeDate(body.competence_date) || projectionDate, category: clean(body.category, 100) || 'other', description: clean(body.description, 300), direction: body.direction, amount, probability_percent: Math.max(0, Math.min(100, Number(body.probability_percent || 100))), source_type: ['accounts_receivable', 'accounts_payable', 'contract', 'recurring_expense', 'manual', 'migration', 'other'].includes(body.source_type) ? body.source_type : 'manual', source_id: clean(body.source_id, 100) || null, status: 'active', created_by_user_id: principal.user.id, metadata: {} });
      await audit(db, principal, { action: 'create', entity_type: 'financial_projection', entity_id: projection.id, item_label: projection.description, reason: changeReason, legal_entity_id: legalEntityId, request_id: requestId, after_data: projection });
      return Response.json({ projection, request_id: requestId }, { status: 201 });
    }

    if (action === 'create_intercompany') {
      const sourceId = clean(body.source_legal_entity_id, 100); const destinationId = clean(body.destination_legal_entity_id, 100);
      if (!sourceId || !destinationId || sourceId === destinationId) return Response.json({ error: 'invalid_intercompany_companies', request_id: requestId }, { status: 422 });
      const principal = await principalFor(base44, req, auth.user, 'finance.manage', sourceId, body.source_unit_id);
      await principalFor(base44, req, auth.user, 'finance.manage', destinationId, body.destination_unit_id);
      await validateUnit(db, body.source_unit_id, sourceId); await validateUnit(db, body.destination_unit_id, destinationId);
      await validateParty(db, body.source_business_party_id, destinationId); await validateParty(db, body.destination_business_party_id, sourceId);
      const competenceDate = normalizeDate(body.competence_date); const dueDate = normalizeDate(body.due_date); const amount = normalizeAmount(body.amount);
      if (!competenceDate || !dueDate || amount === null || amount <= 0) return Response.json({ error: 'invalid_intercompany_values', request_id: requestId }, { status: 422 });
      await ensureWritablePeriod(db, sourceId, competenceDate); await ensureWritablePeriod(db, destinationId, competenceDate);
      const idempotencyKey = clean(body.idempotency_key, 160);
      if (idempotencyKey.length < 12) return Response.json({ error: 'idempotency_key_required', request_id: requestId }, { status: 422 });
      const prior = await db.IntercompanyEntry.filter({ idempotency_key: idempotencyKey }, '-created_date', 2).catch(() => []);
      if (prior.length) return Response.json({ intercompany_entry: prior[0], idempotent: true, request_id: requestId });
      const changeReason = reason(body.reason);
      const entry = await db.IntercompanyEntry.create({ entry_key: `IC-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, source_legal_entity_id: sourceId, destination_legal_entity_id: destinationId, source_unit_id: body.source_unit_id, destination_unit_id: body.destination_unit_id, source_business_party_id: body.source_business_party_id, destination_business_party_id: body.destination_business_party_id, source_cost_center_id: clean(body.source_cost_center_id, 100) || null, destination_cost_center_id: clean(body.destination_cost_center_id, 100) || null, competence_date: competenceDate, due_date: dueDate, description: clean(body.description, 300), amount, currency: 'BRL', status: 'draft', idempotency_key: idempotencyKey, created_by_user_id: principal.user.id, metadata: {} });
      await audit(db, principal, { action: 'create', entity_type: 'intercompany_entry', entity_id: entry.id, item_label: entry.entry_key, reason: changeReason, legal_entity_id: sourceId, unit_id: body.source_unit_id, request_id: requestId, after_data: entry });
      return Response.json({ intercompany_entry: entry, request_id: requestId }, { status: 201 });
    }

    if (action === 'submit_intercompany' || action === 'approve_intercompany' || action === 'cancel_intercompany') {
      const entry = await db.IntercompanyEntry.get(body.intercompany_entry_id).catch(() => null);
      if (!entry) return Response.json({ error: 'intercompany_entry_not_found', request_id: requestId }, { status: 404 });
      const nextStatus = action === 'submit_intercompany' ? 'pending_approval' : action === 'approve_intercompany' ? 'posted' : 'cancelled';
      const approval = action === 'approve_intercompany';
      const permission = approval ? 'finance.approve' : 'finance.manage';
      const principal = await principalFor(base44, req, auth.user, permission, entry.source_legal_entity_id, entry.source_unit_id, true);
      await principalFor(base44, req, auth.user, permission, entry.destination_legal_entity_id, entry.destination_unit_id, true);
      const transition = assertTransition(entry.status, nextStatus, INTERCOMPANY_TRANSITIONS, 'invalid_intercompany_transition');
      if (transition.idempotent) return Response.json({ intercompany_entry: entry, idempotent: true, request_id: requestId });
      const changeReason = reason(body.reason);
      if (!approval) {
        const patch: any = { status: nextStatus };
        if (nextStatus === 'cancelled') { patch.cancelled_at = nowIso(); patch.cancellation_reason = changeReason; }
        const updated = await db.IntercompanyEntry.update(entry.id, patch);
        await audit(db, principal, { action: 'status_change', entity_type: 'intercompany_entry', entity_id: entry.id, item_label: entry.entry_key, reason: changeReason, legal_entity_id: entry.source_legal_entity_id, unit_id: entry.source_unit_id, request_id: requestId, before_data: { status: entry.status }, after_data: patch });
        return Response.json({ intercompany_entry: updated, request_id: requestId });
      }
      await ensureWritablePeriod(db, entry.source_legal_entity_id, entry.competence_date); await ensureWritablePeriod(db, entry.destination_legal_entity_id, entry.competence_date);
      let receivable = entry.source_accounts_receivable_id ? await db.AccountsReceivable.get(entry.source_accounts_receivable_id).catch(() => null) : null;
      let payable = entry.destination_accounts_payable_id ? await db.AccountsPayable.get(entry.destination_accounts_payable_id).catch(() => null) : null;
      try {
        if (!receivable) receivable = await db.AccountsReceivable.create({ legal_entity_id: entry.source_legal_entity_id, unit_id: entry.source_unit_id, business_party_id: entry.destination_business_party_id, customer_id: entry.destination_business_party_id, description: entry.description, competence_date: entry.competence_date, competence: entry.competence_date.slice(0, 7), issue_date: nowIso(), due_date: `${entry.due_date}T12:00:00.000Z`, original_amount: entry.amount, paid_amount: 0, open_amount: entry.amount, status: 'open', billing_type: 'invoiced', source_system: 'native', external_id: `${entry.entry_key}:AR`, cost_center_id: entry.source_cost_center_id, cost_center: entry.source_cost_center_id || null, metadata: { intercompany_entry_id: entry.id, counterparty_legal_entity_id: entry.destination_legal_entity_id } });
        if (!payable) payable = await db.AccountsPayable.create({ legal_entity_id: entry.destination_legal_entity_id, unit_id: entry.destination_unit_id, business_party_id: entry.source_business_party_id, supplier_name: entry.source_business_party_id, description: entry.description, category: 'intercompany', cost_center_id: entry.destination_cost_center_id, cost_center: entry.destination_cost_center_id || null, competence_date: `${entry.competence_date}T12:00:00.000Z`, issue_date: nowIso(), due_date: `${entry.due_date}T12:00:00.000Z`, original_amount: entry.amount, paid_amount: 0, open_amount: entry.amount, status: 'approved', approval_status: 'approved', approved_by_user_id: principal.user.id, approved_at: nowIso(), source_system: 'native', external_id: `${entry.entry_key}:AP`, metadata: { intercompany_entry_id: entry.id, counterparty_legal_entity_id: entry.source_legal_entity_id } });
      } catch {
        const repair = await db.RepairTask.create({ legal_entity_id: entry.source_legal_entity_id, unit_id: entry.source_unit_id, domain: 'finance', entity_type: 'intercompany_entry', entity_id: entry.id, title: 'Concluir lançamento intercompany', description: 'A postagem criou apenas parte dos lançamentos espelhados e exige reparo administrativo antes de nova tentativa.', status: 'open', severity: 'critical', required_permission: 'finance.approve', checkpoints: [receivable?.id ? 'receivable_created' : 'receivable_pending', payable?.id ? 'payable_created' : 'payable_pending'], context_snapshot: { receivable_id: receivable?.id || null, payable_id: payable?.id || null, safe_error_code: 'INTERCOMPANY_PARTIAL_POST', operation: 'approve_intercompany' }, created_by_user_id: principal.user.id, metadata: { repair_key: `intercompany:${entry.id}` } }).catch(() => null);
        await db.IntercompanyEntry.update(entry.id, { status: 'repair_required', source_accounts_receivable_id: receivable?.id || null, destination_accounts_payable_id: payable?.id || null, metadata: { repair_task_id: repair?.id || null } });
        return Response.json({ error: 'intercompany_repair_required', repair_task_id: repair?.id || null, request_id: requestId }, { status: 409 });
      }
      const patch = { status: 'posted', source_accounts_receivable_id: receivable.id, destination_accounts_payable_id: payable.id, approved_at: nowIso(), approved_by_user_id: principal.user.id };
      const updated = await db.IntercompanyEntry.update(entry.id, patch);
      await audit(db, principal, { action: 'approve', entity_type: 'intercompany_entry', entity_id: entry.id, item_label: entry.entry_key, reason: changeReason, legal_entity_id: entry.source_legal_entity_id, unit_id: entry.source_unit_id, request_id: requestId, before_data: { status: entry.status }, after_data: patch });
      await recordDomainEvent(db, { eventType: 'intercompany_entry.posted', aggregateType: 'IntercompanyEntry', aggregateId: entry.id, legalEntityId: entry.source_legal_entity_id, unitId: entry.source_unit_id, actorId: principal.user.id, eventKey: `intercompany_entry.posted:${entry.id}`, payload: { receivable_id: receivable.id, payable_id: payable.id, amount: entry.amount, destination_legal_entity_id: entry.destination_legal_entity_id } });
      return Response.json({ intercompany_entry: updated, receivable, payable, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const validation = new Set(['reason_required', 'invalid_financial_period', 'invalid_competence_date', 'invalid_amount', 'financial_period_closed', 'unit_company_mismatch', 'party_unavailable', 'party_company_role_required', 'invalid_intercompany_transition', 'domain_event_key_conflict']);
    return Response.json({ error: validation.has(error?.message) ? error.message : 'financial_core_operation_failed', request_id: requestId }, { status: validation.has(error?.message) ? 422 : 500 });
  }
});
