import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'attendant', 'production', 'cashier']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  const allowed = new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean));
  return allowed.has(unitId);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'register_label_print' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'attendant') && !(user.permissions || []).includes('garments.print_label')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const body = await req.json();
    const garmentIds = [...new Set(Array.isArray(body.garment_item_ids) ? body.garment_item_ids.filter(Boolean) : [])];
    if (garmentIds.length === 0 || garmentIds.length > 200) return Response.json({ error: 'garment_item_ids_required', request_id: requestId }, { status: 400 });

    const garments = [];
    for (const garmentId of garmentIds) {
      const garment = await base44.asServiceRole.entities.GarmentItem.get(garmentId);
      if (!garment) return Response.json({ error: 'garment_not_found', garment_item_id: garmentId, request_id: requestId }, { status: 404 });
      if (!canAccessUnit(user, garment.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      garments.push(garment);
    }

    const reprints = garments.filter((garment) => Number(garment.label_print_count || 0) > 0);
    const reason = String(body.reprint_reason || '').trim();
    if (reprints.length > 0 && reason.length < 5) {
      return Response.json({ error: 'reprint_reason_required', reprint_count: reprints.length, request_id: requestId }, { status: 422 });
    }

    const printedAt = new Date().toISOString();
    for (const garment of garments) {
      const previousCount = Number(garment.label_print_count || 0);
      await base44.asServiceRole.entities.GarmentItem.update(garment.id, {
        label_print_count: previousCount + 1,
        label_last_printed_at: printedAt,
        label_last_printed_by_user_id: user.id,
        label_last_reprint_reason: previousCount > 0 ? reason : undefined,
      });
      await base44.asServiceRole.entities.AuditLog.create({
        action: previousCount > 0 ? 'reprint' : 'print',
        entity_type: 'garment_item',
        entity_id: garment.id,
        item_label: garment.garment_code,
        reason: previousCount > 0 ? reason : 'initial_label_print',
        user_email: user.email,
        user_name: user.full_name || user.display_name,
        user_role: user.role,
        unit_id: garment.unit_id,
        request_id: requestId,
        before_data: { label_print_count: previousCount },
        after_data: { label_print_count: previousCount + 1, printed_at: printedAt },
        success: true,
      });
    }

    return Response.json({ garments, printed_at: printedAt, reprints: reprints.length, request_id: requestId });
  } catch (error) {
    console.error(`[register_label_print:${requestId}]`, error);
    return Response.json({ error: 'label_print_registration_failed', request_id: requestId }, { status: 500 });
  }
});
