import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { authorizeUserOrInternal, enforceAuthenticatedUser, securityErrorResponse } from '../../shared/functionSecurity.js';
import { assertTransition, calculateOpportunityScore, contractSnapshot, CONTRACT_TRANSITIONS, nextContractNumber, roundMoney } from '../../shared/businessCore.js';
import { recordDomainEvent } from '../../shared/domainEvents.js';

const CONTRACT_TYPES = new Set(['laundry_piece', 'laundry_weight', 'hospital_laundry', 'linen_rental', 'corporate_cleaning', 'outsourcing', 'mixed', 'other']);
const BILLING_UNITS = new Set(['piece', 'kg', 'hour', 'work_post', 'visit', 'square_meter', 'fixed_monthly', 'day', 'unit', 'other']);
const OPPORTUNITY_STAGES = new Set(['lead', 'qualification', 'diagnosis', 'proposal', 'negotiation', 'approval', 'won', 'lost', 'cancelled']);
const ACTIVITY_TYPES = new Set(['task', 'call', 'meeting', 'visit', 'email', 'proposal', 'follow_up', 'other']);

function clean(value: unknown, max = 180) { return String(value || '').trim().slice(0, max); }
function requireReason(value: unknown) { const text = clean(value, 800); if (text.length < 8) throw new Error('reason_required'); return text; }
function asDate(value: unknown) { const text = clean(value, 40); if (!text || Number.isNaN(Date.parse(text))) throw new Error('invalid_date'); return text; }
function unwrapStatus(value: unknown, allowed: Set<string>, fallback: string) { const text = clean(value, 50); return allowed.has(text) ? text : fallback; }

async function principalFor(base44: any, req: Request, user: any, permission: string, legalEntityId: string, unitId?: string, requireMfa = false) {
  return enforceAuthenticatedUser(base44, req, user, { permission, legalEntityId, unitId: unitId || null, requireMfa, source: 'manage_business_contracts' });
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
    success: true,
    domain: input.domain || 'contracts',
  });
}

async function companyCode(db: any, legalEntityId: string) {
  const company = await db.LegalEntity.get(legalEntityId).catch(() => null);
  if (!company || !['active', 'onboarding'].includes(company.status)) throw new Error('legal_entity_unavailable');
  return clean(company.code || company.trade_name || 'CTR', 12);
}

async function assertPartyRole(db: any, partyId: string, legalEntityId: string) {
  const party = await db.BusinessParty.get(partyId).catch(() => null);
  if (!party || ['blocked', 'inactive'].includes(party.status)) throw new Error('party_unavailable');
  const roles = await db.PartyRole.filter({ business_party_id: partyId, legal_entity_id: legalEntityId, status: 'active' }, '-created_date', 10).catch(() => []);
  if (!roles.length) throw new Error('party_company_role_required');
  return party;
}

async function contractContext(db: any, contractId: string) {
  const contract = await db.BusinessContract.get(contractId).catch(() => null);
  if (!contract) throw new Error('contract_not_found');
  return contract;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const body = await req.json();
    const action = clean(body.action, 60);
    const auth = await authorizeUserOrInternal(base44, req, body, { allowInternal: false, source: 'manage_business_contracts' });

    if (action === 'overview') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      await principalFor(base44, req, auth.user, 'contracts.view', legalEntityId, body.unit_id);
      const [opportunities, contracts, activities] = await Promise.all([
        db.SalesOpportunity.filter({ legal_entity_id: legalEntityId }, '-created_date', 1000).catch(() => []),
        db.BusinessContract.filter({ legal_entity_id: legalEntityId }, '-created_date', 1000).catch(() => []),
        db.BusinessActivity.filter({ legal_entity_id: legalEntityId }, '-starts_at', 1000).catch(() => []),
      ]);
      return Response.json({ opportunities, contracts, activities, request_id: requestId });
    }

    if (action === 'create_opportunity' || action === 'update_opportunity') {
      const existing = action === 'update_opportunity' ? await db.SalesOpportunity.get(body.opportunity_id).catch(() => null) : null;
      if (action === 'update_opportunity' && !existing) return Response.json({ error: 'opportunity_not_found', request_id: requestId }, { status: 404 });
      const legalEntityId = clean(existing?.legal_entity_id || body.legal_entity_id, 100);
      const unitId = clean(existing?.unit_id || body.unit_id, 100) || null;
      const principal = await principalFor(base44, req, auth.user, 'crm.manage', legalEntityId, unitId || undefined);
      const partyId = clean(existing?.business_party_id || body.business_party_id, 100);
      const party = await assertPartyRole(db, partyId, legalEntityId);
      const stage = unwrapStatus(body.stage || existing?.stage, OPPORTUNITY_STAGES, existing?.stage || 'lead');
      const estimatedValue = Math.max(0, roundMoney(body.estimated_value ?? existing?.estimated_value));
      const temperature = ['cold', 'warm', 'hot'].includes(body.temperature) ? body.temperature : (existing?.temperature || 'cold');
      const score = calculateOpportunityScore({ has_valid_tax_id: true, has_primary_contact: body.has_primary_contact === true, has_service_address: body.has_service_address === true, estimated_value: estimatedValue, expected_close_date: body.expected_close_date || existing?.expected_close_date, next_action_at: body.next_action_at || existing?.next_action_at, stage, temperature });
      const payload: any = {
        legal_entity_id: legalEntityId,
        unit_id: unitId,
        business_party_id: partyId,
        title: clean(body.title || existing?.title, 240),
        source: ['referral', 'website', 'whatsapp', 'prospecting', 'campaign', 'partner', 'existing_customer', 'tender', 'other'].includes(body.source) ? body.source : (existing?.source || 'other'),
        stage,
        temperature,
        score,
        estimated_value: estimatedValue,
        probability_percent: Math.max(0, Math.min(100, Number(body.probability_percent ?? existing?.probability_percent ?? 0))),
        expected_close_date: body.expected_close_date || existing?.expected_close_date || null,
        owner_user_id: clean(body.owner_user_id || existing?.owner_user_id, 100) || principal.user.id,
        next_action: clean(body.next_action || existing?.next_action, 500) || null,
        next_action_at: body.next_action_at || existing?.next_action_at || null,
        lost_reason: ['lost', 'cancelled'].includes(stage) ? clean(body.lost_reason || existing?.lost_reason, 500) || null : null,
        lost_competitor: stage === 'lost' ? clean(body.lost_competitor || existing?.lost_competitor, 180) || null : null,
        status: stage === 'won' ? 'won' : stage === 'lost' ? 'lost' : stage === 'cancelled' ? 'cancelled' : 'open',
        created_by_user_id: existing?.created_by_user_id || principal.user.id,
        updated_by_user_id: principal.user.id,
        metadata: existing?.metadata || {},
      };
      if (!payload.title) return Response.json({ error: 'opportunity_title_required', request_id: requestId }, { status: 422 });
      const changeReason = requireReason(body.reason);
      const opportunity = existing ? await db.SalesOpportunity.update(existing.id, payload) : await db.SalesOpportunity.create(payload);
      await audit(db, principal, { action: existing ? 'update' : 'create', entity_type: 'sales_opportunity', entity_id: opportunity.id, item_label: opportunity.title, reason: changeReason, legal_entity_id: legalEntityId, unit_id: unitId, request_id: requestId, before_data: existing, after_data: payload, domain: 'crm' });
      await recordDomainEvent(db, { eventType: existing ? 'sales_opportunity.updated' : 'sales_opportunity.created', aggregateType: 'SalesOpportunity', aggregateId: opportunity.id, legalEntityId, unitId, actorId: principal.user.id, payload: { stage, score, estimated_value: estimatedValue, party_name: party.trade_name || party.legal_name } });
      return Response.json({ opportunity, request_id: requestId }, { status: existing ? 200 : 201 });
    }

    if (action === 'add_activity') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const unitId = clean(body.unit_id, 100) || null;
      const principal = await principalFor(base44, req, auth.user, 'crm.manage', legalEntityId, unitId || undefined);
      const partyId = clean(body.business_party_id, 100);
      await assertPartyRole(db, partyId, legalEntityId);
      const activityType = clean(body.activity_type, 40);
      if (!ACTIVITY_TYPES.has(activityType)) return Response.json({ error: 'invalid_activity_type', request_id: requestId }, { status: 422 });
      if (body.opportunity_id) {
        const opportunity = await db.SalesOpportunity.get(body.opportunity_id).catch(() => null);
        if (!opportunity || opportunity.legal_entity_id !== legalEntityId || opportunity.business_party_id !== partyId) return Response.json({ error: 'opportunity_scope_mismatch', request_id: requestId }, { status: 409 });
      }
      const changeReason = requireReason(body.reason);
      const activity = await db.BusinessActivity.create({
        legal_entity_id: legalEntityId, unit_id: unitId, business_party_id: partyId,
        opportunity_id: clean(body.opportunity_id, 100) || null, contract_id: clean(body.contract_id, 100) || null,
        activity_type: activityType, title: clean(body.title, 240), description: clean(body.description, 3000) || null,
        owner_user_id: clean(body.owner_user_id, 100) || principal.user.id,
        participant_user_ids: Array.isArray(body.participant_user_ids) ? [...new Set(body.participant_user_ids.map(String).filter(Boolean))] : [],
        starts_at: body.starts_at || new Date().toISOString(), ends_at: body.ends_at || null,
        status: ['planned', 'in_progress', 'completed', 'cancelled', 'overdue'].includes(body.status) ? body.status : 'planned',
        result: clean(body.result, 2000) || null, next_action: clean(body.next_action, 500) || null, next_action_at: body.next_action_at || null,
        document_asset_ids: Array.isArray(body.document_asset_ids) ? body.document_asset_ids.map(String).filter(Boolean) : [],
        created_by_user_id: principal.user.id, updated_by_user_id: principal.user.id, metadata: {},
      });
      await audit(db, principal, { action: 'create', entity_type: 'business_activity', entity_id: activity.id, item_label: activity.title, reason: changeReason, legal_entity_id: legalEntityId, unit_id: unitId, request_id: requestId, domain: 'crm' });
      return Response.json({ activity, request_id: requestId }, { status: 201 });
    }

    if (action === 'create_contract') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const unitId = clean(body.unit_id, 100) || null;
      const principal = await principalFor(base44, req, auth.user, 'contracts.manage', legalEntityId, unitId || undefined);
      const partyId = clean(body.business_party_id, 100);
      await assertPartyRole(db, partyId, legalEntityId);
      const idempotencyKey = clean(body.idempotency_key, 160);
      if (idempotencyKey.length < 12) return Response.json({ error: 'idempotency_key_required', request_id: requestId }, { status: 422 });
      const prior = await db.BusinessContract.filter({ legal_entity_id: legalEntityId, idempotency_key: idempotencyKey }, '-created_date', 2).catch(() => []);
      if (prior.length) return Response.json({ contract: prior[0], idempotent: true, request_id: requestId });
      const type = clean(body.contract_type, 60);
      if (!CONTRACT_TYPES.has(type)) return Response.json({ error: 'invalid_contract_type', request_id: requestId }, { status: 422 });
      const startsOn = asDate(body.starts_on);
      const code = await companyCode(db, legalEntityId);
      const contractNumber = clean(body.contract_number, 80) || nextContractNumber(Date.now() % 999999, code);
      const changeReason = requireReason(body.reason);
      const contract = await db.BusinessContract.create({
        legal_entity_id: legalEntityId, unit_id: unitId, business_party_id: partyId, opportunity_id: clean(body.opportunity_id, 100) || null,
        contract_number: contractNumber, idempotency_key: idempotencyKey, title: clean(body.title, 240), contract_type: type,
        billing_cycle: ['per_service', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'annual'].includes(body.billing_cycle) ? body.billing_cycle : 'monthly',
        billing_day: Math.max(1, Math.min(28, Number(body.billing_day || 10))), payment_terms_days: Math.max(0, Math.min(180, Number(body.payment_terms_days || 30))),
        starts_on: startsOn, ends_on: body.ends_on || null, auto_renew: body.auto_renew === true, renewal_notice_days: Math.max(1, Math.min(365, Number(body.renewal_notice_days || 60))),
        adjustment_index: ['ipca', 'igpm', 'inpc', 'fixed', 'none', 'other'].includes(body.adjustment_index) ? body.adjustment_index : 'ipca',
        adjustment_month: Number(body.adjustment_month || new Date(startsOn).getUTCMonth() + 1), minimum_monthly_amount: Math.max(0, roundMoney(body.minimum_monthly_amount)), credit_limit: Math.max(0, roundMoney(body.credit_limit)),
        cost_center_id: clean(body.cost_center_id, 100) || null, warehouse_id: clean(body.warehouse_id, 100) || null,
        billing_contact_id: clean(body.billing_contact_id, 100) || null, service_address_id: clean(body.service_address_id, 100) || null,
        commercial_owner_user_id: clean(body.commercial_owner_user_id, 100) || principal.user.id, operational_owner_user_id: clean(body.operational_owner_user_id, 100) || null,
        sla: body.sla && typeof body.sla === 'object' ? body.sla : {}, terms: body.terms && typeof body.terms === 'object' ? body.terms : {},
        current_version_number: 0, status: 'draft', created_by_user_id: principal.user.id, updated_by_user_id: principal.user.id, metadata: {},
      });
      await audit(db, principal, { action: 'create', entity_type: 'business_contract', entity_id: contract.id, item_label: contract.contract_number, reason: changeReason, legal_entity_id: legalEntityId, unit_id: unitId, request_id: requestId, after_data: contract });
      await recordDomainEvent(db, { eventType: 'business_contract.created', aggregateType: 'BusinessContract', aggregateId: contract.id, legalEntityId, unitId, actorId: principal.user.id, eventKey: `business_contract.created:${contract.id}`, payload: { status: 'draft', contract_number: contractNumber, party_id: partyId } });
      return Response.json({ contract, request_id: requestId }, { status: 201 });
    }

    const contract = await contractContext(db, clean(body.contract_id, 100));
    const legalEntityId = contract.legal_entity_id;
    const unitId = contract.unit_id || undefined;

    if (action === 'contract_detail') {
      await principalFor(base44, req, auth.user, 'contracts.view', legalEntityId, unitId);
      const [versions, prices, activities, serviceOrders] = await Promise.all([
        db.ContractVersion.filter({ contract_id: contract.id }, '-version_number', 1000).catch(() => []),
        db.ContractPriceItem.filter({ contract_id: contract.id }, 'description', 1000).catch(() => []),
        db.BusinessActivity.filter({ contract_id: contract.id }, '-starts_at', 1000).catch(() => []),
        db.ServiceOrder.filter({ contract_id: contract.id }, '-created_date', 1000).catch(() => []),
      ]);
      return Response.json({ contract, versions, prices, activities, service_orders: serviceOrders, request_id: requestId });
    }

    if (action === 'add_price_item') {
      const principal = await principalFor(base44, req, auth.user, 'contracts.manage', legalEntityId, unitId);
      if (contract.status !== 'draft') return Response.json({ error: 'contract_not_editable', request_id: requestId }, { status: 409 });
      const billingUnit = clean(body.billing_unit, 60);
      if (!BILLING_UNITS.has(billingUnit)) return Response.json({ error: 'invalid_billing_unit', request_id: requestId }, { status: 422 });
      const unitPrice = roundMoney(body.unit_price);
      if (unitPrice < 0) return Response.json({ error: 'invalid_unit_price', request_id: requestId }, { status: 422 });
      const changeReason = requireReason(body.reason);
      const price = await db.ContractPriceItem.create({ legal_entity_id: legalEntityId, contract_id: contract.id, service_id: clean(body.service_id, 100) || null, catalog_item_id: clean(body.catalog_item_id, 100) || null, description: clean(body.description, 240), billing_unit: billingUnit, minimum_quantity: Math.max(0, Number(body.minimum_quantity || 0)), maximum_quantity: body.maximum_quantity === undefined ? null : Math.max(0, Number(body.maximum_quantity)), included_quantity: Math.max(0, Number(body.included_quantity || 0)), unit_price: unitPrice, excess_unit_price: body.excess_unit_price === undefined ? null : Math.max(0, roundMoney(body.excess_unit_price)), minimum_charge: Math.max(0, roundMoney(body.minimum_charge)), discount_percent: Math.max(0, Math.min(100, Number(body.discount_percent || 0))), tax_included: body.tax_included !== false, valid_from: body.valid_from || contract.starts_on, valid_until: body.valid_until || contract.ends_on || null, status: 'draft', created_by_user_id: principal.user.id, metadata: {} });
      await audit(db, principal, { action: 'create', entity_type: 'contract_price_item', entity_id: price.id, item_label: price.description, reason: changeReason, legal_entity_id: legalEntityId, unit_id: unitId, request_id: requestId, after_data: price });
      return Response.json({ price_item: price, request_id: requestId }, { status: 201 });
    }

    if (action === 'submit_contract') {
      const principal = await principalFor(base44, req, auth.user, 'contracts.manage', legalEntityId, unitId, true);
      assertTransition(contract.status, 'pending_approval', CONTRACT_TRANSITIONS, 'invalid_contract_transition');
      const prices = await db.ContractPriceItem.filter({ contract_id: contract.id }, 'description', 1000).catch(() => []);
      if (!prices.length) return Response.json({ error: 'contract_price_required', request_id: requestId }, { status: 409 });
      const changeReason = requireReason(body.reason);
      const nextVersion = Number(contract.current_version_number || 0) + 1;
      const version = await db.ContractVersion.create({ legal_entity_id: legalEntityId, contract_id: contract.id, version_number: nextVersion, version_type: Number(contract.current_version_number || 0) === 0 ? 'initial' : 'addendum', snapshot: contractSnapshot(contract, prices), change_summary: clean(body.change_summary, 2000) || changeReason, change_reason: changeReason, valid_from: contract.starts_on, valid_until: contract.ends_on || null, status: 'pending_approval', created_by_user_id: principal.user.id, metadata: {} });
      const updated = await db.BusinessContract.update(contract.id, { status: 'pending_approval', current_version_id: version.id, current_version_number: nextVersion, updated_by_user_id: principal.user.id });
      await audit(db, principal, { action: 'status_change', entity_type: 'business_contract', entity_id: contract.id, item_label: contract.contract_number, reason: changeReason, legal_entity_id: legalEntityId, unit_id: unitId, request_id: requestId, before_data: { status: contract.status }, after_data: { status: updated.status, version_id: version.id } });
      return Response.json({ contract: updated, version, request_id: requestId });
    }

    if (action === 'approve_contract') {
      const principal = await principalFor(base44, req, auth.user, 'contracts.approve', legalEntityId, unitId, true);
      assertTransition(contract.status, 'active', CONTRACT_TRANSITIONS, 'invalid_contract_transition');
      const changeReason = requireReason(body.reason);
      const version = contract.current_version_id ? await db.ContractVersion.get(contract.current_version_id).catch(() => null) : null;
      if (!version || version.status !== 'pending_approval') return Response.json({ error: 'pending_contract_version_required', request_id: requestId }, { status: 409 });
      const now = new Date().toISOString();
      const updatedVersion = await db.ContractVersion.update(version.id, { status: 'approved', approved_at: now, approved_by_user_id: principal.user.id });
      const prices = await db.ContractPriceItem.filter({ contract_id: contract.id, status: 'draft' }, 'description', 1000).catch(() => []);
      for (const price of prices) await db.ContractPriceItem.update(price.id, { status: 'active', contract_version_id: version.id });
      const updated = await db.BusinessContract.update(contract.id, { status: 'active', approved_at: now, approved_by_user_id: principal.user.id, updated_by_user_id: principal.user.id });
      if (contract.opportunity_id) await db.SalesOpportunity.update(contract.opportunity_id, { stage: 'won', status: 'won', won_contract_id: contract.id, probability_percent: 100, updated_by_user_id: principal.user.id }).catch(() => null);
      await audit(db, principal, { action: 'approve', entity_type: 'business_contract', entity_id: contract.id, item_label: contract.contract_number, reason: changeReason, legal_entity_id: legalEntityId, unit_id: unitId, request_id: requestId, before_data: { status: contract.status }, after_data: { status: 'active', version_id: version.id } });
      await recordDomainEvent(db, { eventType: 'business_contract.approved', aggregateType: 'BusinessContract', aggregateId: contract.id, legalEntityId, unitId, actorId: principal.user.id, eventKey: `business_contract.approved:${contract.id}:${version.id}`, payload: { contract_number: contract.contract_number, version_number: version.version_number } });
      return Response.json({ contract: updated, version: updatedVersion, request_id: requestId });
    }

    if (['suspend_contract', 'resume_contract', 'expire_contract', 'terminate_contract'].includes(action)) {
      const permission = action === 'terminate_contract' ? 'contracts.approve' : 'contracts.manage';
      const principal = await principalFor(base44, req, auth.user, permission, legalEntityId, unitId, true);
      const nextStatus = action === 'suspend_contract' ? 'suspended' : action === 'resume_contract' ? 'active' : action === 'expire_contract' ? 'expired' : 'terminated';
      assertTransition(contract.status, nextStatus, CONTRACT_TRANSITIONS, 'invalid_contract_transition');
      const changeReason = requireReason(body.reason);
      const patch: any = { status: nextStatus, updated_by_user_id: principal.user.id };
      if (nextStatus === 'terminated') { patch.terminated_at = new Date().toISOString(); patch.termination_reason = changeReason; }
      const updated = await db.BusinessContract.update(contract.id, patch);
      await audit(db, principal, { action: 'status_change', entity_type: 'business_contract', entity_id: contract.id, item_label: contract.contract_number, reason: changeReason, legal_entity_id: legalEntityId, unit_id: unitId, request_id: requestId, before_data: { status: contract.status }, after_data: { status: nextStatus } });
      await recordDomainEvent(db, { eventType: `business_contract.${nextStatus}`, aggregateType: 'BusinessContract', aggregateId: contract.id, legalEntityId, unitId, actorId: principal.user.id, payload: { previous_status: contract.status, status: nextStatus, reason: changeReason } });
      return Response.json({ contract: updated, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const validation = new Set(['reason_required', 'invalid_date', 'legal_entity_unavailable', 'party_unavailable', 'party_company_role_required', 'contract_not_found', 'invalid_contract_transition', 'domain_event_key_conflict']);
    const status = error?.message === 'contract_not_found' ? 404 : validation.has(error?.message) ? 422 : 500;
    return Response.json({ error: validation.has(error?.message) ? error.message : 'business_contract_operation_failed', request_id: requestId }, { status });
  }
});
