import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const AUDIT_ROLES = new Set(['super_admin', 'admin', 'manager', 'auditor']);
const CROSS_UNIT_ROLES = new Set(['super_admin', 'admin', 'auditor']);
const SENSITIVE_KEYS = new Set(['token', 'secret', 'password', 'authorization', 'api_key', 'card_number', 'cvv', 'certificate', 'private_key']);

function allowedUnits(user: any) {
  return new Set([user.primary_unit_id, ...(user.allowed_unit_ids || [])].filter(Boolean));
}

function mask(value: any, depth = 0): any {
  if (depth > 5 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => mask(item, depth + 1));
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.has(key.toLowerCase()) ? '[MASCARADO]' : mask(item, depth + 1)]));
}

function csvCell(value: any) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return `"${String(text).replaceAll('"', '""')}"`;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'query_audit_log' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!AUDIT_ROLES.has(user.role) && !(user.permissions || []).includes('audit.view')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });

    const body = await req.json();
    const action = String(body.action || 'query');
    const requestedUnits = Array.isArray(body.unit_ids) ? body.unit_ids.filter(Boolean) : body.unit_id ? [body.unit_id] : [];
    const unitScope = CROSS_UNIT_ROLES.has(user.role) || (user.permissions || []).includes('audit.view_all')
      ? requestedUnits
      : requestedUnits.filter((id: string) => allowedUnits(user).has(id));
    if (!CROSS_UNIT_ROLES.has(user.role) && requestedUnits.some((id: string) => !allowedUnits(user).has(id))) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });

    const limit = Math.max(1, Math.min(action === 'export' ? 5000 : 500, Number(body.limit || 200)));
    const raw = await base44.asServiceRole.entities.AuditLog.list('-created_date', Math.max(limit * 4, 1000));
    const start = body.start_date ? new Date(body.start_date).getTime() : Number.NEGATIVE_INFINITY;
    const end = body.end_date ? new Date(body.end_date).getTime() + 86400000 : Number.POSITIVE_INFINITY;
    const term = String(body.search || '').trim().toLowerCase();
    const filtered = raw.filter((log: any) => {
      const timestamp = new Date(log.occurred_at || log.created_date || 0).getTime();
      if (timestamp < start || timestamp >= end) return false;
      if (unitScope.length && !unitScope.includes(log.unit_id)) return false;
      if (body.domain && log.domain !== body.domain) return false;
      if (body.action_filter && log.action !== body.action_filter) return false;
      if (body.entity_type && log.entity_type !== body.entity_type) return false;
      if (body.severity && log.severity !== body.severity) return false;
      if (body.result && (log.result || (log.success === false ? 'failure' : 'success')) !== body.result) return false;
      if (body.user_email && String(log.user_email || '').toLowerCase() !== String(body.user_email).toLowerCase()) return false;
      if (term && ![log.item_label, log.reason, log.user_name, log.user_email, log.entity_type, log.request_id].some((value) => String(value || '').toLowerCase().includes(term))) return false;
      return true;
    });

    const rows = filtered.slice(0, limit).map((log: any) => ({ ...log, before_data: mask(log.before_data), after_data: mask(log.after_data), metadata: mask(log.metadata) }));
    const summary = {
      total: filtered.length,
      success: filtered.filter((log: any) => log.success !== false).length,
      denied_or_failed: filtered.filter((log: any) => log.success === false || ['denied', 'failure', 'validation_error'].includes(log.result)).length,
      critical: filtered.filter((log: any) => log.severity === 'critical').length,
      exports: filtered.filter((log: any) => log.action === 'export').length,
    };

    if (action === 'export') {
      if (!(user.permissions || []).includes('audit.export') && !CROSS_UNIT_ROLES.has(user.role)) return Response.json({ error: 'audit_export_forbidden', request_id: requestId }, { status: 403 });
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'export_reason_required', request_id: requestId }, { status: 422 });
      const headers = ['data_hora', 'dominio', 'severidade', 'acao', 'entidade', 'item', 'resultado', 'motivo', 'usuario', 'unidade', 'request_id'];
      const lines = rows.map((log: any) => [log.occurred_at || log.created_date, log.domain || 'system', log.severity || 'info', log.action, log.entity_type, log.item_label, log.result || (log.success === false ? 'failure' : 'success'), log.reason, log.user_email || log.user_name, log.unit_id, log.request_id].map(csvCell).join(','));
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'export', entity_type: 'specialized_report', entity_id: requestId, item_label: 'Exportação de auditoria',
        reason, user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role,
        unit_id: unitScope.length === 1 ? unitScope[0] : user.primary_unit_id, request_id: requestId, domain: 'security', severity: 'notice', result: 'success', origin: 'web', retention_class: 'security', occurred_at: new Date().toISOString(), metadata: { row_count: rows.length, filters: mask(body) }, success: true,
      });
      return Response.json({ filename: `auditoria-${new Date().toISOString().slice(0, 10)}.csv`, content_type: 'text/csv;charset=utf-8', content: `\uFEFF${headers.join(',')}\n${lines.join('\n')}`, summary, request_id: requestId });
    }

    return Response.json({ rows, summary, truncated: filtered.length > rows.length, request_id: requestId });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'audit_query_failed', request_id: requestId }, { status: 500 });
  }
});
