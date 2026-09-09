import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { loadLaundryPricingCatalog, priceGarmentItems } from '../../shared/laundryPricing.js';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'attendant']);

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
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'attendant') && !(user.permissions || []).includes('quotes.price')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const body = await req.json();
    const unitId = body.unit_id || user.primary_unit_id;
    if (!unitId) return Response.json({ error: 'unit_id_required', request_id: requestId }, { status: 400 });
    if (!canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 200) {
      return Response.json({ error: 'items_required', request_id: requestId }, { status: 400 });
    }

    const catalog = await loadLaundryPricingCatalog(base44, { unitId, customerId: body.customer_id });
    const result = priceGarmentItems({
      items: body.items,
      catalog,
      unitId,
      priority: body.priority || 'normal',
    });

    return Response.json({ ...result, request_id: requestId });
  } catch (error) {
    console.error(`[price_garment_services:${requestId}]`, error);
    const known = new Set(['product_not_found', 'service_not_found', 'service_not_compatible']);
    const code = known.has(error?.message) ? error.message : 'pricing_failed';
    return Response.json({ error: code, details: error?.details, request_id: requestId }, { status: known.has(code) ? 422 : 500 });
  }
});
