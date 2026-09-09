import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ROLES = new Set(['super_admin', 'admin', 'manager']);
const TYPES = new Set(['color', 'material', 'pattern', 'size', 'brand', 'damage', 'risk', 'garment_detail', 'pickup_failure_reason', 'delivery_failure_reason']);
function canAccessUnit(user: any, unitId?: string) { if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true; return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId); }
function slugify(value: string) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function normalizeSynonyms(values: any) { return [...new Set((Array.isArray(values) ? values : String(values || '').split(',')).map((value) => String(value).trim()).filter(Boolean))].slice(0, 50); }

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_operational_catalog' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ROLES.has(user.role) && !(user.permissions || []).includes('catalogs.manage')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const body = await req.json();
    const action = String(body.action || 'list');
    const now = new Date().toISOString();

    if (action === 'list') {
      const rows = await base44.asServiceRole.entities.OperationalCatalogEntry.list('sort_order', 5000);
      return Response.json({ entries: rows.filter((entry: any) => canAccessUnit(user, entry.unit_id)), request_id: requestId });
    }

    if (action === 'save') {
      const catalogType = String(body.catalog_type || '');
      const label = String(body.label || '').trim();
      const unitId = body.unit_id || undefined;
      const reason = String(body.change_reason || '').trim();
      if (!TYPES.has(catalogType) || label.length < 1 || reason.length < 8) return Response.json({ error: 'type_label_and_reason_required', request_id: requestId }, { status: 422 });
      if (unitId && !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const slug = slugify(label);
      const all = await base44.asServiceRole.entities.OperationalCatalogEntry.filter({ catalog_type: catalogType }, 'sort_order', 5000);
      const duplicates = all.filter((entry: any) => entry.id !== body.entry_id && (entry.unit_id || '') === (unitId || '') && (entry.slug === slug || (entry.synonyms || []).some((synonym: string) => slugify(synonym) === slug)));
      if (duplicates.length) return Response.json({ error: 'duplicate_catalog_entry', duplicate: { id: duplicates[0].id, label: duplicates[0].label }, request_id: requestId }, { status: 409 });
      const before = body.entry_id ? await base44.asServiceRole.entities.OperationalCatalogEntry.get(body.entry_id) : null;
      if (before && !canAccessUnit(user, before.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const payload = { catalog_type: catalogType, label, slug, code: String(body.code || slug.toUpperCase()).trim(), unit_id: unitId, synonyms: normalizeSynonyms(body.synonyms), category: body.category || undefined, description: body.description || undefined, color_hex: catalogType === 'color' ? body.color_hex || undefined : undefined, icon: body.icon || undefined, favorite: body.favorite === true, sort_order: Number(body.sort_order || 0), active: body.active !== false, created_by_user_id: before?.created_by_user_id || user.id, updated_by_user_id: user.id, change_reason: reason };
      const entry = before ? await base44.asServiceRole.entities.OperationalCatalogEntry.update(before.id, payload) : await base44.asServiceRole.entities.OperationalCatalogEntry.create(payload);
      await base44.asServiceRole.entities.AuditLog.create({ action: before ? 'update' : 'create', entity_type: 'operational_catalog', entity_id: entry.id, item_label: `${catalogType}: ${label}`, reason, user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role, unit_id: unitId, request_id: requestId, before_data: before, after_data: entry, domain: 'commercial', severity: 'info', result: 'success', occurred_at: now, success: true });
      return Response.json({ entry, request_id: requestId });
    }

    if (action === 'set_active') {
      const entry = await base44.asServiceRole.entities.OperationalCatalogEntry.get(body.entry_id);
      if (!entry || !canAccessUnit(user, entry.unit_id)) return Response.json({ error: 'entry_not_found', request_id: requestId }, { status: 404 });
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
      const updated = await base44.asServiceRole.entities.OperationalCatalogEntry.update(entry.id, { active: body.active === true, updated_by_user_id: user.id, change_reason: reason });
      await base44.asServiceRole.entities.AuditLog.create({ action: 'status_change', entity_type: 'operational_catalog', entity_id: entry.id, item_label: entry.label, reason, user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role, unit_id: entry.unit_id, request_id: requestId, before_data: { active: entry.active }, after_data: { active: updated.active }, domain: 'commercial', severity: 'notice', result: 'success', occurred_at: now, success: true });
      return Response.json({ entry: updated, request_id: requestId });
    }

    if (action === 'record_usage') {
      const entry = await base44.asServiceRole.entities.OperationalCatalogEntry.get(body.entry_id);
      if (!entry || !canAccessUnit(user, entry.unit_id)) return Response.json({ error: 'entry_not_found', request_id: requestId }, { status: 404 });
      const updated = await base44.asServiceRole.entities.OperationalCatalogEntry.update(entry.id, { usage_count: Number(entry.usage_count || 0) + Math.max(1, Number(body.increment || 1)), last_used_at: now });
      return Response.json({ entry: updated, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 422 });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'operational_catalog_failed', request_id: requestId }, { status: 500 });
  }
});
