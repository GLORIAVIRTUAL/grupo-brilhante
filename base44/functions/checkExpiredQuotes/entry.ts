import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

function snapshot(quote: any) {
  return {
    quote_number: quote.quote_number,
    version_number: quote.version_number,
    status: quote.status,
    origin: quote.origin,
    items: quote.items || [],
    subtotal: Number(quote.subtotal || 0),
    discount: Number(quote.discount || 0),
    addition: Number(quote.addition || 0),
    total: Number(quote.total || 0),
    price_adjustments: quote.price_adjustments || [],
    catalog_version: quote.catalog_version,
    valid_until: quote.valid_until,
    customer_message: quote.customer_message,
  };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (!['GET', 'POST'].includes(req.method)) return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const principal = await authorizeUserOrInternal(base44, req, body, { source: 'checkExpiredQuotes' });
    const user = principal.user;
    const userAuthorized = Boolean(user && (['super_admin', 'admin', 'manager'].includes(user.role) || (user.permissions || []).includes('quotes.expire')));
    if (principal.kind === 'user' && !userAuthorized) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });

    const quotes = await base44.asServiceRole.entities.Quote.filter({ status: 'SENT' });
    const now = new Date();
    const expiredIds: string[] = [];

    for (const quote of quotes) {
      const legacyFallback = new Date(new Date(quote.updated_date || quote.created_date).getTime() + 24 * 60 * 60 * 1000);
      const expiresAt = quote.valid_until ? new Date(quote.valid_until) : legacyFallback;
      if (Number.isNaN(expiresAt.getTime()) || expiresAt >= now) continue;

      const updated = await base44.asServiceRole.entities.Quote.update(quote.id, {
        status: 'EXPIRED',
        status_reason: 'validity_elapsed',
      });
      const version = await base44.asServiceRole.entities.QuoteVersion.create({
        quote_id: quote.id,
        root_quote_id: quote.root_quote_id || quote.id,
        previous_version_id: quote.current_version_id,
        unit_id: quote.unit_id,
        customer_id: quote.customer_id,
        version_number: Number(quote.version_number || 1),
        status: 'expired',
        snapshot: snapshot(updated),
        subtotal: Number(quote.subtotal || 0),
        discount_amount: Number(quote.discount || 0),
        addition_amount: Number(quote.addition || 0),
        total_amount: Number(quote.total || 0),
        valid_until: expiresAt.toISOString(),
        change_type: 'expired',
        change_reason: 'Validade do orçamento encerrada.',
        price_override: false,
        price_override_amount: 0,
        created_by_user_id: user?.id || 'system',
        created_by_name: user?.full_name || user?.display_name || 'Automação interna',
        created_at_business: now.toISOString(),
        request_id: requestId,
      });
      await base44.asServiceRole.entities.Quote.update(quote.id, { current_version_id: version.id, root_quote_id: quote.root_quote_id || quote.id });

      const cards = await base44.asServiceRole.entities.CrmCard.filter({ linked_quote_id: quote.id });
      if (cards.length > 0) await base44.asServiceRole.entities.CrmCard.update(cards[0].id, { stage: 'Expirado' });
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'status_change', entity_type: 'quote', entity_id: quote.id,
        item_label: quote.quote_number || quote.id, amount: quote.total,
        reason: 'quote_validity_elapsed', user_email: user?.email || 'automation@internal',
        user_name: user?.full_name || user?.display_name || 'Automação interna', user_role: user?.role || 'system',
        unit_id: quote.unit_id, request_id: requestId,
        before_data: { status: quote.status, valid_until: quote.valid_until }, after_data: { status: 'EXPIRED' }, success: true,
      });
      expiredIds.push(quote.id);
    }

    return Response.json({ success: true, expired_count: expiredIds.length, expired_ids: expiredIds, request_id: requestId });
  } catch (error) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    console.error(`[checkExpiredQuotes:${requestId}]`, error);
    return Response.json({ error: 'quote_expiration_failed', request_id: requestId }, { status: 500 });
  }
});
