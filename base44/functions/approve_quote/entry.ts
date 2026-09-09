import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { loadLaundryPricingCatalog, priceGarmentItems } from '../../shared/laundryPricing.js';

const APPROVER_ROLES = new Set(['super_admin', 'admin', 'manager', 'attendant']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  const allowed = new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean));
  return allowed.has(unitId);
}

function itemTotal(item: any) {
  const quantity = Math.max(1, Number(item.qty || 1));
  const unitPrice = Math.max(0, Number(item.unit_price || 0));
  const subtotal = Number.isFinite(Number(item.subtotal)) ? Number(item.subtotal) : quantity * unitPrice;
  return Math.max(0, subtotal - Number(item.discount_amount || 0) + Number(item.additional_amount || 0));
}

function garmentCode(orderId: string, sequence: number) {
  return `P-${orderId.slice(-8).toUpperCase()}-${String(sequence).padStart(3, '0')}`;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  let eventRecord: any = null;
  let createdOrder: any = null;

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'approve_quote' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!APPROVER_ROLES.has(user.role || 'attendant') && !(user.permissions || []).includes('quotes.approve')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const { quote_id: quoteId } = await req.json();
    if (!quoteId) return Response.json({ error: 'quote_id_required', request_id: requestId }, { status: 400 });

    const quote = await base44.asServiceRole.entities.Quote.get(quoteId);
    if (!quote) return Response.json({ error: 'quote_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, quote.unit_id)) {
      return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    }
    if (['REJECTED', 'EXPIRED', 'CANCELLED'].includes(quote.status)) {
      return Response.json({ error: 'quote_not_approvable', request_id: requestId }, { status: 409 });
    }

    const items = Array.isArray(quote.items) ? quote.items : [];
    if (items.length === 0) return Response.json({ error: 'quote_has_no_items', request_id: requestId }, { status: 422 });

    const unresolvedItems = items.filter((item: any) =>
      item.recognition_status === 'suggested' && Number(item.confidence || 0) < 0.92
    );
    if (unresolvedItems.length > 0) {
      return Response.json({ error: 'human_review_required', unresolved_items: unresolvedItems.length, request_id: requestId }, { status: 409 });
    }

    const customerSource = quote.origin === 'customer_portal'
      ? 'SITE_QUOTE'
      : quote.origin === 'whatsapp'
        ? 'WHATSAPP_GLORIA'
        : ['management_manual', 'management_vision', 'counter'].includes(quote.origin)
          ? 'COUNTER_MANUAL'
          : undefined;

    const pricingCatalog = await loadLaundryPricingCatalog(base44, { unitId: quote.unit_id, customerId: quote.customer_id });
    const pricing = priceGarmentItems({
      items,
      catalog: pricingCatalog,
      unitId: quote.unit_id,
      priority: quote.metadata?.priority === 'CRITICAL' ? 'urgent' : quote.metadata?.priority === 'HIGH' ? 'high' : 'normal',
    });
    const pricedItems = pricing.items;

    const eventKey = `approve_quote:${quote.id}`;
    const previousEvents = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
    const completedEvent = previousEvents.find((event: any) => event.status === 'completed');
    if (completedEvent?.entity_id) {
      const existingOrder = await base44.asServiceRole.entities.Order.get(completedEvent.entity_id);
      return Response.json({ order: existingOrder, duplicate: true, request_id: requestId });
    }

    const linkedOrders = await base44.asServiceRole.entities.Order.filter({ source_quote_id: quote.id });
    if (linkedOrders.length > 0) {
      return Response.json({ order: linkedOrders[0], duplicate: true, request_id: requestId });
    }

    eventRecord = previousEvents[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: eventKey,
      event_type: 'approve_quote',
      source: 'user_command',
      status: 'processing',
      payload_hash: quote.id,
      attempts: 1,
      started_at: new Date().toISOString(),
      unit_id: quote.unit_id,
    });

    const subtotal = pricing.subtotal;
    const discount = Math.max(0, Number(quote.discount || 0));
    const addition = Math.max(0, Number(quote.addition || 0));
    const total = Math.max(0, subtotal - discount + addition);
    const pieceCount = pricedItems.reduce((sum: number, item: any) => sum + Math.max(1, Number(item.qty || 1)), 0);
    const now = new Date().toISOString();
    const longestServiceMinutes = pricedItems.reduce((maximum: number, item: any) => Math.max(maximum, Number(item.estimated_minutes || 0)), 0);
    const expectedFinishAt = quote.expected_finish_at || (longestServiceMinutes > 0 ? new Date(Date.now() + longestServiceMinutes * 60_000).toISOString() : undefined);

    createdOrder = await base44.asServiceRole.entities.Order.create({
      customer_id: quote.customer_id,
      source_quote_id: quote.id,
      unit_id: quote.unit_id,
      status: 'pending',
      payment_status: 'unpaid',
      delivery_status: 'not_scheduled',
      subtotal_amount: subtotal,
      discount_amount: discount,
      additional_amount: addition,
      total_amount: total,
      paid_amount: 0,
      ticket_number: `ORD-${quote.id.slice(-8).toUpperCase()}`,
      piece_count: pieceCount,
      ready_piece_count: 0,
      delivered_piece_count: 0,
      customer_acceptance_status: 'pending',
      approved_at: now,
      expected_finish_at: expectedFinishAt,
      operator_user_id: user.id,
      origin: quote.origin?.startsWith('management') ? 'management' : (quote.origin || 'other'),
      metadata: { request_id: requestId },
    });

    const createdGarments: any[] = [];
    let sequence = 0;
    for (const item of pricedItems) {
      const quantity = Math.max(1, Number(item.qty || 1));
      const lineTotal = itemTotal(item);
      const perPieceTotal = lineTotal / quantity;
      for (let index = 0; index < quantity; index += 1) {
        sequence += 1;
        const garment = await base44.asServiceRole.entities.GarmentItem.create({
          order_id: createdOrder.id,
          quote_id: quote.id,
          customer_id: quote.customer_id,
          unit_id: quote.unit_id,
          ticket_number: createdOrder.ticket_number,
          garment_code: garmentCode(createdOrder.id, sequence),
          product_id: item.product_id,
          product_name: item.garment_type || 'Peça não classificada',
          quantity: 1,
          attributes: item.attributes || {},
          condition: {
            damages: item.damages || [],
            risk_tags: item.risk_tags || [],
            notes: item.notes || '',
            condition_checked: item.condition_checked === true,
            customer_authorized_risks: item.customer_authorized_risks === true,
          },
          photo_asset_ids: item.document_asset_ids || item.image_ids || [],
          services: item.services || [],
          catalog_version: quote.catalog_version,
          subtotal: perPieceTotal,
          total_amount: perPieceTotal,
          recognition_confidence: item.confidence,
          recognition_status: item.recognition_status || 'manual',
          status: 'received',
          priority: quote.metadata?.priority === 'CRITICAL' ? 'urgent' : quote.metadata?.priority === 'HIGH' ? 'high' : 'normal',
          received_at: now,
          due_at: expectedFinishAt,
          metadata: {
            quote_line_id: item.line_id,
            source: quote.origin,
            pricing: item.pricing,
            estimated_minutes: item.estimated_minutes,
            production_steps: item.production_steps,
            requires_third_party: item.requires_third_party,
            request_id: requestId,
          },
        });
        createdGarments.push(garment);

        await base44.asServiceRole.entities.GarmentEvent.create({
          garment_item_id: garment.id,
          order_id: createdOrder.id,
          unit_id: quote.unit_id,
          event_type: 'created',
          to_status: 'received',
          operator_user_id: user.id,
          operator_name: user.full_name || user.display_name,
          reason: 'quote_approved',
          occurred_at: now,
          request_id: requestId,
        });
      }
    }

    await base44.asServiceRole.entities.Quote.update(quote.id, {
      status: 'ACCEPTED',
      accepted_at: now,
      reviewed_at: quote.reviewed_at || now,
      reviewed_by_user_id: quote.reviewed_by_user_id || user.id,
      items: pricedItems,
      subtotal,
      total,
      metadata: { ...(quote.metadata || {}), pricing: { source: 'server', priced_at: pricing.priced_at } },
    });

    const orderCards = await base44.asServiceRole.entities.CrmCard.filter({ linked_order_id: createdOrder.id });
    if (orderCards.length === 0) {
      await base44.asServiceRole.entities.CrmCard.create({
        pipeline_type: 'ORDER',
        stage: 'Recebido',
        customer_id: quote.customer_id,
        priority: 'HIGH',
        linked_order_id: createdOrder.id,
        linked_quote_id: quote.id,
        unit_id: quote.unit_id,
        customer_source: customerSource,
      });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'approve',
      entity_type: 'quote',
      entity_id: quote.id,
      item_label: createdOrder.ticket_number,
      amount: total,
      reason: 'quote_approved_and_order_created',
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      unit_id: quote.unit_id,
      request_id: requestId,
      after_data: { order_id: createdOrder.id, garment_count: createdGarments.length },
      success: true,
    });

    await base44.asServiceRole.entities.ProcessedEvent.update(eventRecord.id, {
      status: 'completed',
      entity_type: 'order',
      entity_id: createdOrder.id,
      result: { order_id: createdOrder.id, garment_count: createdGarments.length },
      completed_at: now,
    });

    return Response.json({ order: createdOrder, garments: createdGarments, request_id: requestId });
  } catch (error) {
    console.error(`[approve_quote:${requestId}]`, error);
    try {
      const base44 = createClientFromRequest(req);
      if (createdOrder?.id) {
        await base44.asServiceRole.entities.Order.update(createdOrder.id, {
          status: 'cancelled',
          cancel_reason: 'Falha compensada durante a conversão do orçamento',
          cancelled_at: new Date().toISOString(),
        });
      }
      if (eventRecord?.id) {
        await base44.asServiceRole.entities.ProcessedEvent.update(eventRecord.id, {
          status: 'failed',
          error_message: 'approve_quote_failed',
          completed_at: new Date().toISOString(),
        });
      }
    } catch (_) {
      // A compensação é best-effort e o request_id permite investigação.
    }
    return Response.json({ error: 'approve_quote_failed', request_id: requestId }, { status: 500 });
  }
});