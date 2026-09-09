import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { postPaymentLoyaltyEarn } from '../../shared/loyaltySettlement.js';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'cashier', 'attendant']);
const ALLOWED_METHODS = new Set(['cash', 'pix', 'credit', 'debit']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });

    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const principal = await authorizeUserOrInternal(base44, req, body, {
      allowInternal: false,
      source: 'record_counter_payment',
    });
    const user = principal.user;
    if (!ALLOWED_ROLES.has(user.role || 'attendant') && !(user.permissions || []).includes('payments.counter')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    if (!body.order_id || !ALLOWED_METHODS.has(body.payment_method) || body.confirmed_received !== true) {
      return Response.json({ error: 'order_method_and_confirmation_required', request_id: requestId }, { status: 422 });
    }

    const order = await base44.asServiceRole.entities.Order.get(body.order_id);
    if (!order || !canAccessUnit(user, order.unit_id)) return Response.json({ error: 'order_not_found', request_id: requestId }, { status: 404 });
    if (['cancelled', 'delivered'].includes(order.status)) return Response.json({ error: 'order_not_payable', request_id: requestId }, { status: 409 });

    const outstanding = Math.max(0, Number(order.total_amount || 0) - Number(order.paid_amount || 0));
    if (outstanding <= 0.01) return Response.json({ error: 'order_already_paid', request_id: requestId }, { status: 409 });
    const amount = body.amount == null ? outstanding : Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount - outstanding > 0.01) {
      return Response.json({ error: 'invalid_payment_amount', outstanding, request_id: requestId }, { status: 422 });
    }

    const idempotencyKey = body.idempotency_key || `${order.id}:${body.payment_method}:${amount}`;
    const eventKey = `counter_payment:${idempotencyKey}`;
    const payloadHash = `${order.id}:${body.payment_method}:${amount}`;
    const events = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
    if (events[0] && events[0].payload_hash !== payloadHash) return Response.json({ error: 'idempotency_conflict', request_id: requestId }, { status: 409 });
    const existingPayments = await base44.asServiceRole.entities.Payment.filter({ idempotency_key: idempotencyKey }, '-created_date', 2);
    if (events.some((event: any) => event.status === 'completed')) {
      return Response.json({ payment: existingPayments[0] || null, duplicate: true, request_id: requestId });
    }
    if (existingPayments.length > 0) return Response.json({ error: 'counter_payment_processing_repair_required', request_id: requestId }, { status: 409 });

    let cashSessionId = body.cash_session_id;
    if (body.payment_method === 'cash') {
      if (!cashSessionId) {
        const sessions = await base44.asServiceRole.entities.CashSession.filter({ unit_id: order.unit_id, status: 'open' }, '-opened_at', 2);
        cashSessionId = sessions[0]?.id;
      }
      if (!cashSessionId) return Response.json({ error: 'cash_session_required', request_id: requestId }, { status: 422 });
      const session = await base44.asServiceRole.entities.CashSession.get(cashSessionId);
      if (!session || session.unit_id !== order.unit_id || session.status !== 'open') return Response.json({ error: 'cash_session_not_open', request_id: requestId }, { status: 422 });
    }

    const event = events[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: eventKey,
      event_type: 'counter_payment',
      source: 'user_command',
      status: 'processing',
      payload_hash: payloadHash,
      attempts: 1,
      started_at: new Date().toISOString(),
      unit_id: order.unit_id,
    });

    const confirmedImmediately = body.payment_method === 'cash' || (['credit', 'debit'].includes(body.payment_method) && body.terminal_confirmed === true);
    const status = confirmedImmediately ? 'succeeded' : 'pending_confirmation';
    const now = new Date().toISOString();
    const feePercent = Number(body.fee_percent || 0);
    const feeAmount = feePercent > 0 ? amount * feePercent / 100 : 0;

    const payment = await base44.asServiceRole.entities.Payment.create({
      customer_id: order.customer_id,
      quote_id: order.source_quote_id,
      order_id: order.id,
      unit_id: order.unit_id,
      status,
      amount,
      paid_at: confirmedImmediately ? now : undefined,
      payment_method: body.payment_method,
      installments: body.payment_method === 'credit' ? Number(body.installments || 1) : undefined,
      card_brand: body.card_brand,
      fee_percent: feePercent || undefined,
      fee_amount: feeAmount || undefined,
      external_reference: body.external_reference,
      idempotency_key: idempotencyKey,
      confirmation_source: confirmedImmediately ? 'counter_explicit_confirmation' : 'awaiting_reconciliation',
      confirmed_at: confirmedImmediately ? now : undefined,
      confirmed_by_user_id: confirmedImmediately ? user.id : undefined,
      notes: body.notes || (confirmedImmediately ? 'Recebimento confirmado no balcão.' : 'Aguardando conciliação bancária/adquirente.'),
    });

    let updatedOrder = order;
    if (confirmedImmediately) {
      const paidAmount = Number(order.paid_amount || 0) + amount;
      updatedOrder = await base44.asServiceRole.entities.Order.update(order.id, {
        paid_amount: paidAmount,
        payment_status: paidAmount + 0.01 >= Number(order.total_amount || 0) ? 'paid' : 'partial',
      });
      if (body.payment_method === 'cash') {
        await base44.asServiceRole.entities.CashMovement.create({
          cash_session_id: cashSessionId,
          unit_id: order.unit_id,
          movement_type: 'sale',
          amount,
          payment_method: 'cash',
          payment_id: payment.id,
          order_id: order.id,
          customer_id: order.customer_id,
          reason: `Recebimento do ticket ${order.ticket_number || order.id}`,
          operator_user_id: user.id,
          occurred_at: now,
          request_id: requestId,
        });
      }
    } else {
      updatedOrder = await base44.asServiceRole.entities.Order.update(order.id, { payment_status: 'pending_confirmation' });
    }

    let loyaltyResult: any = { status: 'skipped', reason: 'payment_pending_confirmation' };
    let finalPayment = payment;
    if (confirmedImmediately) {
      try {
        loyaltyResult = await postPaymentLoyaltyEarn(base44, {
          customerId: order.customer_id,
          unitId: order.unit_id,
          orderIds: [order.id],
          paymentId: payment.id,
          amount,
          serviceCount: Number(order.piece_count || 0),
          receiptSettled: updatedOrder.payment_status === 'paid',
          user,
          requestId,
        });
      } catch (error) {
        console.error(`[loyalty_sync:${requestId}]`, error);
        loyaltyResult = { status: 'failed', error: error instanceof Error ? error.message : 'loyalty_sync_failed' };
      }
      finalPayment = await base44.asServiceRole.entities.Payment.update(payment.id, {
        metadata: {
          ...(payment.metadata || {}),
          loyalty_sync: { ...loyaltyResult, synchronized_at: now },
        },
      });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'payment',
      entity_type: 'payment',
      entity_id: payment.id,
      item_label: `Ticket ${order.ticket_number || order.id}`,
      amount,
      reason: confirmedImmediately ? 'counter_payment_confirmed' : 'counter_payment_pending_reconciliation',
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      unit_id: order.unit_id,
      request_id: requestId,
      after_data: { status, payment_method: body.payment_method, order_payment_status: updatedOrder.payment_status, loyalty_sync_status: loyaltyResult.status },
      success: true,
    });

    await base44.asServiceRole.entities.ProcessedEvent.update(event.id, {
      status: 'completed',
      entity_type: 'payment',
      entity_id: payment.id,
      result: { payment_id: payment.id, status },
      completed_at: now,
    });

    return Response.json({ payment: finalPayment, order: updatedOrder, requires_reconciliation: !confirmedImmediately, loyalty: loyaltyResult, request_id: requestId });
  } catch (error) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    console.error(`[record_counter_payment:${requestId}]`, error);
    return Response.json({ error: 'counter_payment_failed', request_id: requestId }, { status: 500 });
  }
});
