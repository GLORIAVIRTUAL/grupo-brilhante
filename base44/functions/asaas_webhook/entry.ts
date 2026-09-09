import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from 'base44:runtime';
import { notifyPaymentConfirmed } from '../../shared/paymentConfirmationNotice.js';

// Recebe os eventos do Asaas (via gateway) e confirma o pagamento no sistema.
// Configure esta URL no painel do Asaas / gateway:
//   https://<app>/functions/asaas_webhook
// Autenticação: header "asaas-access-token" (ou ?token=) igual ao ASAAS_WEBHOOK_SECRET.

const PAID_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH']);
const REFUND_EVENTS = new Set(['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_REVERSED']);
const FAIL_EVENTS = new Set(['PAYMENT_DELETED', 'PAYMENT_OVERDUE_CANCELED', 'PAYMENT_CANCELED']);

export default async function (req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const expected = secrets.get('ASAAS_WEBHOOK_SECRET');
    const provided = req.headers.get('asaas-access-token')
      || req.headers.get('x-webhook-token')
      || new URL(req.url).searchParams.get('token');
    if (!expected || provided !== expected) {
      return Response.json({ error: 'unauthorized', request_id: requestId }, { status: 401 });
    }

    const body = await req.json();
    const event = String(body?.event || '');
    const asaasPayment = body?.payment || {};
    const asaasId = asaasPayment?.id;
    if (!event || !asaasId) {
      return Response.json({ error: 'invalid_payload', request_id: requestId }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    // Idempotência: ignora evento já processado.
    const eventKey = `asaas_webhook:${asaasId}:${event}:${body?.id || ''}`;
    const already = await db.ProcessedEvent.filter({ event_key: eventKey });
    if (already?.length) {
      return Response.json({ ok: true, duplicated: true, request_id: requestId });
    }

    // Localiza o pagamento interno pela referência externa (id do Asaas)
    let payments = await db.Payment.filter({ external_reference: asaasId });
    if (!payments?.length && asaasPayment?.externalReference) {
      // Fallback: cobrança criada fora do app — casa pelo pedido/orçamento
      const ref = asaasPayment.externalReference;
      const byOrder = await db.Payment.filter({ order_id: ref });
      const byQuote = byOrder?.length ? [] : await db.Payment.filter({ quote_id: ref });
      payments = [...(byOrder || []), ...(byQuote || [])].filter((p: any) => p.status === 'pending');
    }

    if (!payments?.length) {
      // Último recurso: cobrança gerada por checkout (sem externalReference no evento).
      // Casa por valor exato entre os pagamentos pendentes das últimas 48h, se houver apenas um.
      const value = Number(asaasPayment?.value) || 0;
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      const pending = await db.Payment.filter({ status: 'pending' }, '-created_date', 50);
      const candidates = (pending || []).filter((p: any) =>
        Math.abs((Number(p.amount) || 0) - value) < 0.01
        && new Date(p.created_date).getTime() >= cutoff);
      if (candidates.length === 1) payments = candidates;
    }

    const payment = payments?.[0];
    const nowIso = new Date().toISOString();
    let applied = 'no_matching_payment';

    if (payment) {
      if (payment.external_reference !== asaasId) {
        // Guarda o id do Asaas para que os próximos eventos casem diretamente.
        await db.Payment.update(payment.id, { external_reference: asaasId }).catch(() => null);
      }
      if (PAID_EVENTS.has(event)) {
        if (payment.status !== 'succeeded') {
          await db.Payment.update(payment.id, {
            status: 'succeeded',
            paid_at: asaasPayment?.paymentDate || asaasPayment?.confirmedDate || nowIso,
            confirmed_at: nowIso,
            settlement_status: 'settled',
            settled_at: nowIso,
            external_event_id: String(body?.id || event),
          });
        }

        const paidAmount = Number(asaasPayment?.value ?? payment.amount) || 0;

        if (payment.order_id) {
          const order = await db.Order.get(payment.order_id).catch(() => null);
          if (order) {
            const totalPaid = (Number(order.paid_amount) || 0) + paidAmount;
            const total = Number(order.total_amount) || 0;
            const open = Math.max(0, Math.round((total - totalPaid) * 100) / 100);
            await db.Order.update(order.id, {
              paid_amount: Math.round(totalPaid * 100) / 100,
              open_amount: open,
              payment_status: open <= 0 ? 'paid' : 'partial',
            });
          }
        }

        if (payment.quote_id) {
          await db.Quote.update(payment.quote_id, { status: 'ACCEPTED' }).catch(() => null);
        }

        // Avisa o cliente no WhatsApp e agenda a coleta como encaixe imediatamente.
        if (payment.customer_id) {
          await notifyPaymentConfirmed(base44, payment.customer_id).catch((err) => {
            console.error(`[asaas_webhook:${requestId}] notify_failed`, err?.message);
            return null;
          });
        }

        applied = 'payment_confirmed';
      } else if (REFUND_EVENTS.has(event)) {
        await db.Payment.update(payment.id, {
          status: 'refunded',
          refunded_amount: Number(asaasPayment?.value ?? payment.amount) || 0,
          external_event_id: String(body?.id || event),
        });
        if (payment.order_id) {
          await db.Order.update(payment.order_id, { payment_status: 'refunded' }).catch(() => null);
        }
        applied = 'payment_refunded';
      } else if (FAIL_EVENTS.has(event)) {
        if (payment.status === 'pending') {
          await db.Payment.update(payment.id, { status: 'cancelled', external_event_id: String(body?.id || event) });
        }
        applied = 'payment_cancelled';
      } else {
        applied = 'event_ignored';
      }
    }

    await db.ProcessedEvent.create({
      event_key: eventKey,
      event_type: event,
      source: 'asaas',
      status: 'completed',
      entity_type: 'payment',
      entity_id: payment?.id,
      completed_at: nowIso,
      result: {
        applied,
        asaas_payment_id: asaasId,
        asaas_external_reference: asaasPayment?.externalReference || null,
        asaas_value: asaasPayment?.value ?? null,
      },
    }).catch(() => null);

    return Response.json({ ok: true, event, applied, request_id: requestId });
  } catch (error) {
    console.error(`[asaas_webhook:${requestId}]`, error);
    return Response.json({ error: 'webhook_failed', request_id: requestId }, { status: 500 });
  }
}