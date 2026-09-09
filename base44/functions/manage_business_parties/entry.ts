import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { authorizeUserOrInternal, enforceAuthenticatedUser, securityErrorResponse } from '../../shared/functionSecurity.js';
import { canonicalContact, normalizePartyInput, roundMoney } from '../../shared/businessCore.js';

const ROLE_TYPES = new Set(['customer', 'supplier', 'service_recipient', 'service_provider', 'carrier', 'hospital', 'partner', 'employee', 'guarantor', 'other']);
const ADDRESS_TYPES = new Set(['fiscal', 'billing', 'delivery', 'pickup', 'operational', 'headquarters', 'other']);
const CONTACT_TYPES = new Set(['phone', 'mobile', 'whatsapp', 'email', 'website', 'other']);
const SEGMENTS = new Set(['hospital', 'hotel', 'restaurant', 'industry', 'retail', 'condominium', 'office', 'public_sector', 'partner', 'individual', 'other']);

function clean(value: unknown, max = 180) { return String(value || '').trim().slice(0, max); }
function reason(value: unknown) { const text = clean(value, 500); if (text.length < 8) throw new Error('reason_required'); return text; }
function unique(values: unknown) { return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))]; }

async function audit(db: any, principal: any, input: any) {
  await db.AuditLog.create({
    action: input.action,
    entity_type: 'business_party',
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
    success: true,
    before_data: input.before_data,
    after_data: input.after_data,
    metadata: { domain: 'business_party', ...(input.metadata || {}) },
  });
}

async function emit(db: any, principal: any, input: any) {
  const payload = input.payload || {};
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const payloadHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  await db.DomainEvent.create({
    event_key: `${input.event_type}:${input.party_id}:${crypto.randomUUID()}`,
    event_type: input.event_type,
    aggregate_type: 'BusinessParty',
    aggregate_id: input.party_id,
    legal_entity_id: input.legal_entity_id,
    unit_id: input.unit_id,
    occurred_at: new Date().toISOString(),
    actor_type: 'user',
    actor_id: principal.user.id,
    schema_version: 1,
    payload,
    payload_hash: payloadHash,
    status: 'recorded',
  }).catch(() => null);
}

async function authorizeScope(base44: any, req: Request, user: any, permission: string, legalEntityId?: string, unitId?: string, requireMfa = false) {
  return enforceAuthenticatedUser(base44, req, user, {
    permission,
    legalEntityId: legalEntityId || null,
    unitId: unitId || null,
    requireMfa,
    source: 'manage_business_parties',
  });
}

async function partyScope(db: any, partyId: string) {
  const roles = await db.PartyRole.filter({ business_party_id: partyId, status: 'active' }, '-created_date', 1000).catch(() => []);
  return {
    roles,
    legalEntityIds: unique(roles.map((role: any) => role.legal_entity_id)),
    unitIds: unique(roles.map((role: any) => role.unit_id)),
  };
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const body = await req.json();
    const action = clean(body.action, 60);
    const auth = await authorizeUserOrInternal(base44, req, body, { allowInternal: false, source: 'manage_business_parties' });

    if (action === 'overview' || action === 'list') {
      const requestedLegalEntityId = clean(body.legal_entity_id, 100) || null;
      const principal = await authorizeScope(base44, req, auth.user, 'parties.view', requestedLegalEntityId || undefined);
      const canViewAll = principal.permissions.includes('*') || principal.permissions.includes('companies.view_all');
      const legalEntityIds = requestedLegalEntityId ? [requestedLegalEntityId] : (canViewAll ? [] : principal.legalEntityIds);
      let roles: any[] = [];
      if (legalEntityIds.length) {
        roles = (await Promise.all(legalEntityIds.map((id: string) => db.PartyRole.filter({ legal_entity_id: id }, '-created_date', 1000).catch(() => [])))).flat();
      } else if (canViewAll) {
        roles = await db.PartyRole.list('-created_date', 2000).catch(() => []);
      }
      const partyIds = unique(roles.map((row: any) => row.business_party_id));
      let parties = (await Promise.all(partyIds.slice(0, 500).map((id: string) => db.BusinessParty.get(id).catch(() => null)))).filter(Boolean);
      const search = clean(body.search, 120).toLowerCase();
      if (search) parties = parties.filter((party: any) => [party.legal_name, party.trade_name, party.tax_id].some((value) => String(value || '').toLowerCase().includes(search)));
      const statuses = body.status ? new Set([body.status]) : new Set(['draft', 'active', 'blocked', 'inactive']);
      parties = parties.filter((party: any) => statuses.has(party.status));
      return Response.json({ parties: parties.slice(0, 500), roles, request_id: requestId });
    }

    if (action === 'create') {
      const legalEntityId = clean(body.legal_entity_id, 100);
      const unitId = clean(body.unit_id, 100) || undefined;
      const principal = await authorizeScope(base44, req, auth.user, 'parties.manage', legalEntityId, unitId);
      const normalized = normalizePartyInput(body);
      const changeReason = reason(body.reason);
      const duplicates = await db.BusinessParty.filter({ tax_id: normalized.tax_id }, '-created_date', 10);
      if (duplicates.length) return Response.json({ error: 'party_tax_id_exists', party_id: duplicates[0].id, request_id: requestId }, { status: 409 });
      const party = await db.BusinessParty.create({
        ...normalized,
        state_registration: clean(body.state_registration, 80) || null,
        municipal_registration: clean(body.municipal_registration, 80) || null,
        status: body.status === 'active' ? 'active' : 'draft',
        segment: SEGMENTS.has(body.segment) ? body.segment : 'other',
        relationship_owner_user_id: clean(body.relationship_owner_user_id, 100) || principal.user.id,
        risk_rating: ['low', 'medium', 'high', 'restricted'].includes(body.risk_rating) ? body.risk_rating : 'medium',
        credit_limit: Math.max(0, roundMoney(body.credit_limit)),
        billing_terms_days: Math.max(0, Math.min(365, Number(body.billing_terms_days || 0))),
        default_legal_entity_id: legalEntityId,
        default_unit_id: unitId || null,
        external_ids: body.external_ids && typeof body.external_ids === 'object' ? body.external_ids : {},
        notes: clean(body.notes, 2000) || null,
        created_by_user_id: principal.user.id,
        updated_by_user_id: principal.user.id,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      const roleType = ROLE_TYPES.has(body.role_type) ? body.role_type : 'customer';
      const role = await db.PartyRole.create({ business_party_id: party.id, role_type: roleType, legal_entity_id: legalEntityId, unit_id: unitId || null, status: 'active', valid_from: new Date().toISOString(), created_by_user_id: principal.user.id, metadata: {} });
      await audit(db, principal, { action: 'create', entity_id: party.id, item_label: party.trade_name || party.legal_name, reason: changeReason, legal_entity_id: legalEntityId, unit_id: unitId, request_id: requestId, after_data: party, metadata: { role_type: roleType } });
      await emit(db, principal, { event_type: 'business_party.created', party_id: party.id, legal_entity_id: legalEntityId, unit_id: unitId, payload: { role_id: role.id, role_type: roleType } });
      return Response.json({ party, role, request_id: requestId }, { status: 201 });
    }

    const partyId = clean(body.party_id, 100);
    const party = partyId ? await db.BusinessParty.get(partyId).catch(() => null) : null;
    if (!party) return Response.json({ error: 'party_not_found', request_id: requestId }, { status: 404 });
    const scope = await partyScope(db, party.id);
    const requestedLegalEntityId = clean(body.legal_entity_id, 100) || party.default_legal_entity_id || scope.legalEntityIds[0];
    if (!requestedLegalEntityId) return Response.json({ error: 'party_company_scope_required', request_id: requestId }, { status: 409 });

    if (action === 'detail') {
      await authorizeScope(base44, req, auth.user, 'parties.view', requestedLegalEntityId);
      const [contacts, addresses, documents, opportunities, activities, contracts] = await Promise.all([
        db.PartyContact.filter({ business_party_id: party.id }, '-created_date', 1000).catch(() => []),
        db.PartyAddress.filter({ business_party_id: party.id }, '-created_date', 1000).catch(() => []),
        db.PartyDocument.filter({ business_party_id: party.id }, '-created_date', 1000).catch(() => []),
        db.SalesOpportunity.filter({ business_party_id: party.id }, '-created_date', 500).catch(() => []),
        db.BusinessActivity.filter({ business_party_id: party.id }, '-starts_at', 500).catch(() => []),
        db.BusinessContract.filter({ business_party_id: party.id }, '-created_date', 500).catch(() => []),
      ]);
      return Response.json({ party, roles: scope.roles, contacts, addresses, documents, opportunities, activities, contracts, request_id: requestId });
    }

    const principal = await authorizeScope(base44, req, auth.user, 'parties.manage', requestedLegalEntityId, body.unit_id || undefined, ['block', 'link_document'].includes(action));
    const changeReason = reason(body.reason);

    if (action === 'update') {
      const patch: any = { updated_by_user_id: principal.user.id };
      if (body.legal_name !== undefined) patch.legal_name = clean(body.legal_name);
      if (body.trade_name !== undefined) patch.trade_name = clean(body.trade_name);
      if (SEGMENTS.has(body.segment)) patch.segment = body.segment;
      if (['low', 'medium', 'high', 'restricted'].includes(body.risk_rating)) patch.risk_rating = body.risk_rating;
      if (body.credit_limit !== undefined) patch.credit_limit = Math.max(0, roundMoney(body.credit_limit));
      if (body.billing_terms_days !== undefined) patch.billing_terms_days = Math.max(0, Math.min(365, Number(body.billing_terms_days || 0)));
      if (body.notes !== undefined) patch.notes = clean(body.notes, 2000) || null;
      if (body.relationship_owner_user_id !== undefined) patch.relationship_owner_user_id = clean(body.relationship_owner_user_id, 100) || null;
      if (Object.keys(patch).length === 1) return Response.json({ error: 'no_valid_changes', request_id: requestId }, { status: 422 });
      const updated = await db.BusinessParty.update(party.id, patch);
      await audit(db, principal, { action: 'update', entity_id: party.id, item_label: updated.trade_name || updated.legal_name, reason: changeReason, legal_entity_id: requestedLegalEntityId, unit_id: body.unit_id, request_id: requestId, before_data: party, after_data: patch });
      return Response.json({ party: updated, request_id: requestId });
    }

    if (action === 'set_status' || action === 'block') {
      const status = action === 'block' ? 'blocked' : clean(body.status, 30);
      if (!['draft', 'active', 'blocked', 'inactive'].includes(status)) return Response.json({ error: 'invalid_party_status', request_id: requestId }, { status: 422 });
      const updated = await db.BusinessParty.update(party.id, { status, updated_by_user_id: principal.user.id });
      await audit(db, principal, { action: status === 'blocked' ? 'permission_change' : 'status_change', entity_id: party.id, item_label: party.trade_name || party.legal_name, reason: changeReason, legal_entity_id: requestedLegalEntityId, request_id: requestId, before_data: { status: party.status }, after_data: { status } });
      return Response.json({ party: updated, request_id: requestId });
    }

    if (action === 'add_role') {
      const roleType = clean(body.role_type, 60);
      if (!ROLE_TYPES.has(roleType)) return Response.json({ error: 'invalid_party_role', request_id: requestId }, { status: 422 });
      const active = await db.PartyRole.filter({ business_party_id: party.id, legal_entity_id: requestedLegalEntityId, role_type: roleType, status: 'active' }, '-created_date', 5);
      if (active.length) return Response.json({ role: active[0], idempotent: true, request_id: requestId });
      const role = await db.PartyRole.create({ business_party_id: party.id, role_type: roleType, legal_entity_id: requestedLegalEntityId, unit_id: clean(body.unit_id, 100) || null, status: 'active', valid_from: new Date().toISOString(), created_by_user_id: principal.user.id, metadata: {} });
      await audit(db, principal, { action: 'create', entity_id: party.id, item_label: party.trade_name || party.legal_name, reason: changeReason, legal_entity_id: requestedLegalEntityId, unit_id: body.unit_id, request_id: requestId, metadata: { operation: 'add_party_role', role_id: role.id, role_type: roleType } });
      return Response.json({ role, request_id: requestId }, { status: 201 });
    }

    if (action === 'add_contact') {
      const contactType = clean(body.contact_type, 40);
      if (!CONTACT_TYPES.has(contactType)) return Response.json({ error: 'invalid_contact_type', request_id: requestId }, { status: 422 });
      const canonicalValue = canonicalContact(contactType, body.value);
      const duplicates = await db.PartyContact.filter({ business_party_id: party.id, canonical_value: canonicalValue, status: 'active' }, '-created_date', 5);
      if (duplicates.length) return Response.json({ contact: duplicates[0], idempotent: true, request_id: requestId });
      const contact = await db.PartyContact.create({ business_party_id: party.id, contact_type: contactType, label: clean(body.label, 80) || null, contact_name: clean(body.contact_name) || null, job_title: clean(body.job_title, 120) || null, value: clean(body.value, 500), canonical_value: canonicalValue, is_primary: body.is_primary === true, allows_service_messages: body.allows_service_messages !== false, allows_marketing: body.allows_marketing === true, consent_source: ['contract', 'form', 'whatsapp', 'email', 'verbal_record', 'import'].includes(body.consent_source) ? body.consent_source : 'not_collected', consent_at: body.consent_at || null, status: 'active', created_by_user_id: principal.user.id, metadata: {} });
      await audit(db, principal, { action: 'create', entity_id: party.id, item_label: party.trade_name || party.legal_name, reason: changeReason, legal_entity_id: requestedLegalEntityId, request_id: requestId, metadata: { operation: 'add_party_contact', contact_id: contact.id, contact_type: contactType } });
      return Response.json({ contact, request_id: requestId }, { status: 201 });
    }

    if (action === 'add_address') {
      const addressType = clean(body.address_type, 40);
      if (!ADDRESS_TYPES.has(addressType)) return Response.json({ error: 'invalid_address_type', request_id: requestId }, { status: 422 });
      const required = ['street', 'number', 'city', 'state'];
      if (required.some((field) => !clean(body[field], field === 'state' ? 2 : 180))) return Response.json({ error: 'address_fields_required', request_id: requestId }, { status: 422 });
      const address = await db.PartyAddress.create({ business_party_id: party.id, address_type: addressType, label: clean(body.label, 80) || null, postal_code: clean(body.postal_code, 20), street: clean(body.street), number: clean(body.number, 30), complement: clean(body.complement, 120) || null, neighborhood: clean(body.neighborhood, 120) || null, city: clean(body.city, 120), state: clean(body.state, 2).toUpperCase(), country: 'BR', latitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null, longitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null, is_primary: body.is_primary === true, status: 'active', created_by_user_id: principal.user.id, metadata: {} });
      await audit(db, principal, { action: 'create', entity_id: party.id, item_label: party.trade_name || party.legal_name, reason: changeReason, legal_entity_id: requestedLegalEntityId, request_id: requestId, metadata: { operation: 'add_party_address', address_id: address.id, address_type: addressType } });
      return Response.json({ address, request_id: requestId }, { status: 201 });
    }

    if (action === 'link_document') {
      const asset = await db.DocumentAsset.get(body.document_asset_id).catch(() => null);
      if (!asset || asset.legal_entity_id !== requestedLegalEntityId) return Response.json({ error: 'document_scope_mismatch', request_id: requestId }, { status: 409 });
      const document = await db.PartyDocument.create({ business_party_id: party.id, legal_entity_id: requestedLegalEntityId, document_asset_id: asset.id, document_type: clean(body.document_type, 80) || 'other', document_number: clean(body.document_number, 120) || null, issued_at: body.issued_at || null, expires_at: body.expires_at || null, verification_status: 'pending', status: 'active', created_by_user_id: principal.user.id, metadata: {} });
      await db.DocumentAsset.update(asset.id, { related_entity_type: 'business_party', related_entity_id: party.id });
      await audit(db, principal, { action: 'create', entity_id: party.id, item_label: party.trade_name || party.legal_name, reason: changeReason, legal_entity_id: requestedLegalEntityId, request_id: requestId, metadata: { operation: 'link_party_document', party_document_id: document.id, document_asset_id: asset.id } });
      return Response.json({ document, request_id: requestId }, { status: 201 });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const validations = new Set(['reason_required', 'invalid_cpf', 'invalid_cnpj', 'party_name_required', 'invalid_phone', 'invalid_email', 'invalid_contact']);
    return Response.json({ error: validations.has(error?.message) ? error.message : 'business_party_operation_failed', request_id: requestId }, { status: validations.has(error?.message) ? 422 : 500 });
  }
});
