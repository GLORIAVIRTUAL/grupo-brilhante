import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import Stripe from 'npm:stripe@^14.0.0';
import { postPaymentLoyaltyEarn } from '../../shared/loyaltySettlement.js';

function orderTicket(referenceId: string) {
  return `ORD-${referenceId.slice(-8).toUpperCase()}`;
}

async function markEvent(base44: any, record: any, status: 'completed' | 'failed', details: any = {}) {
  if (!record?.id) return;
  await base44.asServiceRole.entities.ProcessedEvent.update(record.id, {
    status,
    attempts: Number(record.attempts || 1),
    completed_at: new Date().toISOString(),
    ...details,
  });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  let processedEvent: any = null;

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    if (!stripeKey || !webhookSecret) {
      console.error(`[stripe_webhook:${requestId}] integration_not_configured`);
      return Response.json({ error: 'payment_integration_not_configured', request_id: requestId }, { status: 503 });
    }

    const stripe = new Stripe(stripeKey);
    const signature = req.headers.get('stripe-signature');
    const rawBody = await req.text();

    if (!signature) {
      return Response.json({ error: 'missing_signature', request_id: requestId }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
    } catch (_) {
      return Response.json({ error: 'invalid_signature', request_id: requestId }, { status: 400 });
    }

    if (!['checkout.session.completed', 'payment_intent.succeeded'].includes(event.type)) {
      return Response.json({ received: true, ignored: event.type, request_id: requestId });
    }

    const eventKey = `stripe:${event.id}`;
    const previous = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
    const completed = previous.find((item: any) => item.status === 'completed');
    if (completed) {
      return Response.json({ received: true, duplicate: true, request_id: requestId });
    }

    processedEvent = previous[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: eventKey,
      event_type: event.type,
      source: 'stripe',
      status: 'processing',
      payload_hash: event.id,
      attempts: 1,
      started_at: new Date().toISOString(),
    });

    const object: any = event.data.object;
    const metadata = object.metadata || {};
    const quoteId = metadata.quote_id || null;
    const orderId = metadata.order_id || null;
    const customerIdFromMetadata = metadata.customer_id || null;
    const unitIdFromMetadata = metadata.unit_id || null;
    const providerReference = object.id;

    if (event.type === 'checkout.session.completed' && object.payment_status !== 'paid') {
      await markEvent(base44, processedEvent, 'completed', { result: { skipped: 'not_paid' } });
      return Response.json({ received: true, skipped: 'not_paid', request_id: requestId });
    }

    let payment: any = null;
    const byProvider = await base44.asServiceRole.entities.Payment.filter({ stripe_intent_id: providerReference });
    payment = byProvider[0] || null;

    if (!payment && orderId) {
      const byOrder = await base44.asServiceRole.entities.Payment.filter({ order_id: orderId });
      payment = byOrder.find((item: any) => item.status === 'pending') || byOrder[0] || null;
    }

    if (!payment && quoteId) {
      const byQuote = await base44.asServiceRole.entities.Payment.filter({ quote_id: quoteId });
      payment = byQuote.find((item: any) => item.status === 'pending') || byQuote[0] || null;
    }

    if (payment && payment.status !== 'succeeded') {
      await base44.asServiceRole.entities.Payment.update(payment.id, {
        status: 'succeeded',
        paid_at: new Date().toISOString(),
        stripe_intent_id: payment.stripe_intent_id || providerReference,
      });
    }

    let quote: any = null;
    if (quoteId) {
      try {
        quote = await base44.asServiceRole.entities.Quote.get(quoteId);
      } catch (_) {
        quote = null;
      }
    }

    let order: any = null;
    if (orderId) {
      try {
        order = await base44.asServiceRole.entities.Order.get(orderId);
      } catch (_) {
        order = null;
      }
    }

    if (!order && quote) {
      const linkedOrders = await base44.asServiceRole.entities.Order.filter({ source_quote_id: quote.id });
      order = linkedOrders[0] || null;

      if (!order) {
        order = await base44.asServiceRole.entities.Order.create({
          customer_id: quote.customer_id,
          source_quote_id: quote.id,
          unit_id: quote.unit_id,
          status: 'pending',
          total_amount: quote.total,
          ticket_number: orderTicket(quote.id),
          payment_status: 'paid',
        });
      }

      if (quote.status !== 'ACCEPTED') {
        await base44.asServiceRole.entities.Quote.update(quote.id, { status: 'ACCEPTED' });
      }
    } else if (order && order.status === 'pending') {
      await base44.asServiceRole.entities.Order.update(order.id, {
        status: 'processing',
        payment_status: 'paid',
      });
    }

    const customerId = order?.customer_id || quote?.customer_id || customerIdFromMetadata || payment?.customer_id;
    const unitId = order?.unit_id || quote?.unit_id || unitIdFromMetadata || payment?.unit_id;

    if (payment && order && !payment.order_id) {
      await base44.asServiceRole.entities.Payment.update(payment.id, { order_id: order.id });
    }

    if (customerId) {
      const paymentCards = await base44.asServiceRole.entities.CrmCard.filter({
        pipeline_type: 'PAYMENT',
        customer_id: customerId,
      });

      if (paymentCards.length === 0) {
        await base44.asServiceRole.entities.CrmCard.create({
          pipeline_type: 'PAYMENT',
          stage: 'Pago',
          customer_id: customerId,
          priority: 'MEDIUM',
          linked_quote_id: quote?.id,
          linked_order_id: order?.id,
          unit_id: unitId,
        });
      } else {
        for (const card of paymentCards) {
          if (!['Pago', 'Conciliado'].includes(card.stage)) {
            await base44.asServiceRole.entities.CrmCard.update(card.id, { stage: 'Pago' });
          }
        }
      }

      const newCustomerCards = await base44.asServiceRole.entities.CrmCard.filter({
        pipeline_type: 'NEW_CUSTOMER',
        customer_id: customerId,
      });
      for (const card of newCustomerCards) {
        if (card.stage !== 'Convertido') {
          await base44.asServiceRole.entities.CrmCard.update(card.id, { stage: 'Convertido' });
        }
      }
    }

    if (quote) {
      const quoteCards = await base44.asServiceRole.entities.CrmCard.filter({
        linked_quote_id: quote.id,
        pipeline_type: 'QUOTE',
      });
      for (const card of quoteCards) {
        if (card.stage !== 'Aprovado') {
          await base44.asServiceRole.entities.CrmCard.update(card.id, { stage: 'Aprovado' });
        }
      }
    }

    if (order) {
      const orderCards = await base44.asServiceRole.entities.CrmCard.filter({ linked_order_id: order.id });
      if (orderCards.length === 0) {
        await base44.asServiceRole.entities.CrmCard.create({
          pipeline_type: 'ORDER',
          stage: 'Recebido',
          customer_id: order.customer_id,
          priority: 'HIGH',
          linked_order_id: order.id,
          linked_quote_id: quote?.id,
          unit_id: unitId,
        });
      }
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'status_change',
      entity_type: 'payment',
      entity_id: payment?.id || providerReference,
      item_label: order?.ticket_number || quote?.id || providerReference,
      amount: payment?.amount || order?.total_amount || quote?.total,
      reason: 'stripe_payment_confirmed',
      unit_id: unitId,
      request_id: requestId,
      metadata: { stripe_event_id: event.id, event_type: event.type },
      success: true,
    });

    let loyaltyResult: any = { status: 'skipped', reason: 'payment_record_not_found' };
    if (payment && customerId) {
      try {
        loyaltyResult = await postPaymentLoyaltyEarn(base44, {
          customerId,
          unitId,
          orderIds: order?.id ? [order.id] : [],
          receiptId: payment.payment_receipt_id,
          paymentId: payment.id,
          amount: Number(payment.amount || object.amount_total || object.amount_received || 0) / (payment.amount ? 1 : 100),
          serviceCount: Number(order?.piece_count || 0),
          receiptSettled: true,
          user: { id: 'stripe_webhook', role: 'system' },
          requestId,
        });
      } catch (loyaltyError) {
        console.error(`[stripe_webhook:${requestId}] loyalty_sync_failed`, loyaltyError);
        loyaltyResult = { status: 'failed', error: loyaltyError instanceof Error ? loyaltyError.message : 'loyalty_sync_failed' };
      }
      await base44.asServiceRole.entities.Payment.update(payment.id, {
        metadata: { ...(payment.metadata || {}), loyalty_sync: { ...loyaltyResult, synchronized_at: new Date().toISOString() } },
      });
    }

    await markEvent(base44, processedEvent, 'completed', {
      entity_type: order ? 'order' : 'payment',
      entity_id: order?.id || payment?.id,
      unit_id: unitId,
      result: { payment_id: payment?.id, order_id: order?.id, quote_id: quote?.id, loyalty_sync_status: loyaltyResult.status },
    });

    try {
      if (customerId && order) {
        const customer = await base44.asServiceRole.entities.Customer.get(customerId);
        if (customer?.phones?.[0]) {
          await base44.asServiceRole.functions.invoke('zapi_sender', {
            phone: customer.phones[0],
            message: `✅ *Pagamento confirmado*\n\nOlá ${String(customer.full_name || 'cliente').split(' ')[0]}, o pagamento do pedido #${order.ticket_number || order.id.slice(0, 8)} foi confirmado.`,
            _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN'),
          });
        }
      }
    } catch (notificationError) {
      console.error(`[stripe_webhook:${requestId}] notification_failed`, notificationError);
    }

    return Response.json({ received: true, request_id: requestId });
  } catch (error) {
    console.error(`[stripe_webhook:${requestId}]`, error);
    try {
      if (processedEvent) {
        const base44 = createClientFromRequest(req);
        await markEvent(base44, processedEvent, 'failed', { error_message: 'processing_failed' });
      }
    } catch (_) {
      // A falha de auditoria não substitui o erro principal.
    }
    return Response.json({ error: 'webhook_processing_failed', request_id: requestId }, { status: 500 });
  }
});
