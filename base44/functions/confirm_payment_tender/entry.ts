import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { allocateCents, toCents, fromCents } from '../../shared/paymentMath.js';
import { postPaymentLoyaltyEarn } from '../../shared/loyaltySettlement.js';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

const ROLES = new Set(['super_admin', 'admin', 'manager', 'finance', 'cashier']);

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
      source: 'confirm_payment_tender',
    });
    const user = principal.user;
    if (!ROLES.has(user.role) && !(user.permissions || []).includes('payments.confirm')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const idempotencyKey = String(body.idempotency_key || '').trim();
    if (!body.payment_id || !body.confirmation_reference || !idempotencyKey) {
      return Response.json({ error: 'payment_confirmation_and_idempotency_required', request_id: requestId }, { status: 422 });
    }
    const payment = await base44.asServiceRole.entities.Payment.get(body.payment_id);
    if (!payment || !canAccessUnit(user, payment.unit_id)) return Response.json({ error: 'payment_not_found', request_id: requestId }, { status: 404 });
    const receipt = await base44.asServiceRole.entities.PaymentReceipt.get(payment.payment_receipt_id);
    if (!receipt) return Response.json({ error: 'payment_receipt_not_found', request_id: requestId }, { status: 404 });

    const eventKey = `payment_confirmation:${idempotencyKey}`;
    const payloadHash = `${payment.id}:${body.confirmation_reference}`;
    const events = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey });
    if (events[0] && events[0].payload_hash !== payloadHash) return Response.json({ error: 'idempotency_conflict', request_id: requestId }, { status: 409 });
    if (events.some((event: any) => event.status === 'completed')) return Response.json({ payment, payment_receipt: receipt, duplicate: true, request_id: requestId });
    if (events[0]) {
      const priorAllocations = await base44.asServiceRole.entities.PaymentAllocation.filter({ payment_id: payment.id }, '-allocated_at', 2);
      if (payment.status === 'succeeded' || priorAllocations.length > 0) {
        return Response.json({ error: 'confirmation_processing_repair_required', request_id: requestId }, { status: 409 });
      }
    }
    if (payment.status === 'succeeded') return Response.json({ payment, payment_receipt: receipt, duplicate: true, request_id: requestId });
    if (payment.status !== 'pending_confirmation') return Response.json({ error: 'payment_not_pending', request_id: requestId }, { status: 409 });
    const event = events[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: eventKey, event_type: 'payment_confirmation', source: body.source || 'user_command', status: 'processing',
      payload_hash: payloadHash, attempts: 1, started_at: new Date().toISOString(), unit_id: payment.unit_id,
    });

    const targets: any[] = [];
    for (const orderId of receipt.order_ids || []) {
      const order = await base44.asServiceRole.entities.Order.get(orderId);
      const openCents = Math.max(0, toCents(order.total_amount || 0) - toCents(order.paid_amount || 0));
      if (openCents > 0) targets.push({ key: `order:${order.id}`, type: 'order', id: order.id, open_cents: openCents, record: order });
    }
    for (const receivableId of receipt.accounts_receivable_ids || []) {
      const receivable = await base44.asServiceRole.entities.AccountsReceivable.get(receivableId);
      const openCents = Math.max(0, toCents(receivable.open_amount || 0));
      if (openCents > 0) targets.push({ key: `receivable:${receivable.id}`, type: 'receivable', id: receivable.id, open_cents: openCents, record: receivable });
    }

    const paymentCents = toCents(payment.tendered_amount ?? payment.amount);
    const { allocations, unapplied_cents: unappliedCents } = allocateCents(paymentCents, targets);
    if (unappliedCents > 0) return Response.json({ error: 'confirmation_exceeds_current_balance', unapplied_amount: fromCents(unappliedCents), request_id: requestId }, { status: 409 });

    const now = new Date().toISOString();
    const allocationIds: string[] = [];
    for (const allocation of allocations) {
      const record = await base44.asServiceRole.entities.PaymentAllocation.create({
        unit_id: payment.unit_id, payment_id: payment.id, payment_receipt_id: receipt.id,
        accounts_receivable_id: allocation.type === 'receivable' ? allocation.id : undefined,
        order_id: allocation.type === 'order' ? allocation.id : undefined,
        amount: fromCents(allocation.applied_cents), allocation_type: 'receipt', status: 'posted',
        sequence: (receipt.allocation_ids || []).length + allocationIds.length + 1,
        allocated_at: now, allocated_by_user_id: user.id, request_id: requestId,
      });
      allocationIds.push(record.id);
      if (allocation.type === 'order') {
        const order = allocation.record;
        const paidAmount = fromCents(toCents(order.paid_amount || 0) + allocation.applied_cents);
        const openAmount = Math.max(0, fromCents(toCents(order.total_amount || 0) - toCents(paidAmount)));
        await base44.asServiceRole.entities.Order.update(order.id, {
          paid_amount: paidAmount, open_amount: openAmount, payment_status: openAmount <= 0.01 ? 'paid' : 'partial',
          payment_receipt_ids: [...new Set([...(order.payment_receipt_ids || []), receipt.id])],
        });
      } else {
        const receivable = allocation.record;
        const paidAmount = fromCents(toCents(receivable.paid_amount || 0) + allocation.applied_cents);
        const openAmount = Math.max(0, fromCents(toCents(receivable.open_amount || 0) - allocation.applied_cents));
        await base44.asServiceRole.entities.AccountsReceivable.update(receivable.id, {
          paid_amount: paidAmount, open_amount: openAmount, status: openAmount <= 0.01 ? 'paid' : 'partially_paid',
          paid_at: openAmount <= 0.01 ? now : undefined,
          payment_receipt_ids: [...new Set([...(receivable.payment_receipt_ids || []), receipt.id])],
          payment_allocation_ids: [...new Set([...(receivable.payment_allocation_ids || []), record.id])],
        });
      }
    }

    const appliedAmount = fromCents(paymentCents);
    const updatedPayment = await base44.asServiceRole.entities.Payment.update(payment.id, {
      status: 'succeeded', amount: appliedAmount, applied_amount: appliedAmount,
      confirmed_at: now, confirmed_by_user_id: user.id, paid_at: now,
      settlement_status: 'settled', settled_at: now, external_reference: body.confirmation_reference,
      allocation_ids: [...new Set([...(payment.allocation_ids || []), ...allocationIds])],
    });
    const nextApplied = fromCents(toCents(receipt.amount_applied || 0) + paymentCents);
    const nextPending = Math.max(0, fromCents(toCents(receipt.pending_amount || 0) - paymentCents));
    const updatedTenders = (receipt.tenders || []).map((tender: any) => tender.payment_id === payment.id
      ? { ...tender, status: 'succeeded', applied_amount: appliedAmount, external_reference: body.confirmation_reference }
      : tender);
    let loyaltyResult: any;
    try {
      loyaltyResult = await postPaymentLoyaltyEarn(base44, {
        customerId: receipt.customer_id,
        unitId: receipt.unit_id,
        orderIds: receipt.order_ids || [],
        receiptId: receipt.id,
        receiptNumber: receipt.receipt_number,
        paymentId: payment.id,
        amount: appliedAmount,
        serviceCount: targets.filter((target) => target.type === 'order').reduce((sum, target) => sum + Number(target.record?.piece_count || 0), 0),
        receiptSettled: nextPending <= 0.01,
        user,
        requestId,
      });
    } catch (error) {
      console.error(`[loyalty_sync:${requestId}]`, error);
      loyaltyResult = { status: 'failed', error: error instanceof Error ? error.message : 'loyalty_sync_failed' };
    }
    const updatedReceipt = await base44.asServiceRole.entities.PaymentReceipt.update(receipt.id, {
      amount_applied: nextApplied, pending_amount: nextPending,
      status: nextPending <= 0.01 ? 'settled' : 'partially_settled',
      settled_at: nextPending <= 0.01 ? now : undefined,
      allocation_ids: [...new Set([...(receipt.allocation_ids || []), ...allocationIds])],
      tenders: updatedTenders,
      metadata: {
        ...(receipt.metadata || {}),
        loyalty_sync: { status: loyaltyResult.status === 'failed' ? 'attention_required' : 'completed', results: [loyaltyResult], synchronized_at: now },
      },
    });

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'payment', entity_type: 'payment', entity_id: payment.id, item_label: receipt.receipt_number,
      amount: appliedAmount, reason: 'pending_tender_confirmed', user_email: user.email,
      user_name: user.full_name || user.display_name, user_role: user.role, unit_id: payment.unit_id,
      request_id: requestId, after_data: { confirmation_reference: body.confirmation_reference, receipt_status: updatedReceipt.status }, success: true,
    });
    await base44.asServiceRole.entities.ProcessedEvent.update(event.id, {
      status: 'completed', entity_type: 'payment', entity_id: payment.id,
      result: { payment_id: payment.id, receipt_id: receipt.id, amount: appliedAmount }, completed_at: now,
    });
    return Response.json({ payment: updatedPayment, payment_receipt: updatedReceipt, request_id: requestId });
  } catch (error) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    console.error(`[confirm_payment_tender:${requestId}]`, error);
    const message = error instanceof Error ? error.message : 'payment_confirmation_failed';
    return Response.json({ error: message, request_id: requestId }, { status: ['idempotency_conflict', 'confirmation_processing_repair_required'].includes(message) ? 409 : 500 });
  }
});
