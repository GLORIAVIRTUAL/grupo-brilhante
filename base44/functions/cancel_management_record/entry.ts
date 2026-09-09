import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'cancel_management_record' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role) && !(user.permissions || []).includes('records.cancel')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const { entity_type: entityType, entity_id: entityId, reason } = await req.json();
    if (!['payment', 'order', 'finance_entry'].includes(entityType) || !entityId || !String(reason || '').trim()) {
      return Response.json({ error: 'entity_and_reason_required', request_id: requestId }, { status: 422 });
    }

    const now = new Date().toISOString();
    let record: any;
    let updated: any;

    if (entityType === 'payment') {
      record = await base44.asServiceRole.entities.Payment.get(entityId);
      if (!record || !canAccessUnit(user, record.unit_id)) return Response.json({ error: 'record_not_found', request_id: requestId }, { status: 404 });
      if (['succeeded', 'partially_refunded', 'chargeback'].includes(record.status)) {
        return Response.json({ error: 'settled_payment_requires_refund', request_id: requestId }, { status: 409 });
      }
      updated = await base44.asServiceRole.entities.Payment.update(record.id, {
        status: 'cancelled',
        notes: [record.notes, `Cancelado: ${reason}`].filter(Boolean).join('\n'),
      });
    }

    if (entityType === 'finance_entry') {
      record = await base44.asServiceRole.entities.FinanceEntry.get(entityId);
      if (!record || !canAccessUnit(user, record.unit_id)) return Response.json({ error: 'record_not_found', request_id: requestId }, { status: 404 });
      updated = await base44.asServiceRole.entities.FinanceEntry.update(record.id, {
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by_user_id: user.id,
        cancel_reason: reason,
      });
    }

    if (entityType === 'order') {
      record = await base44.asServiceRole.entities.Order.get(entityId);
      if (!record || !canAccessUnit(user, record.unit_id)) return Response.json({ error: 'record_not_found', request_id: requestId }, { status: 404 });
      const payments = await base44.asServiceRole.entities.Payment.filter({ order_id: record.id });
      if (payments.some((payment: any) => ['succeeded', 'partially_refunded', 'chargeback'].includes(payment.status))) {
        return Response.json({ error: 'order_has_settled_payment', request_id: requestId }, { status: 409 });
      }

      for (const payment of payments) {
        if (!['cancelled', 'failed', 'expired'].includes(payment.status)) {
          await base44.asServiceRole.entities.Payment.update(payment.id, { status: 'cancelled', notes: `Pedido cancelado: ${reason}` });
        }
      }
      const garments = await base44.asServiceRole.entities.GarmentItem.filter({ order_id: record.id });
      for (const garment of garments) {
        if (!['delivered', 'cancelled'].includes(garment.status)) {
          await base44.asServiceRole.entities.GarmentItem.update(garment.id, { status: 'cancelled' });
          await base44.asServiceRole.entities.GarmentEvent.create({
            garment_item_id: garment.id,
            order_id: record.id,
            unit_id: record.unit_id,
            event_type: 'cancelled',
            from_status: garment.status,
            to_status: 'cancelled',
            operator_user_id: user.id,
            operator_name: user.full_name || user.display_name,
            reason,
            occurred_at: now,
            request_id: requestId,
          });
        }
      }
      if (record.source_quote_id) {
        await base44.asServiceRole.entities.Quote.update(record.source_quote_id, {
          status: 'CANCELLED',
          rejection_reason: reason,
          rejected_at: now,
        });
      }
      updated = await base44.asServiceRole.entities.Order.update(record.id, {
        status: 'cancelled',
        payment_status: 'cancelled',
        delivery_status: 'cancelled',
        cancel_reason: reason,
        cancelled_at: now,
      });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'cancel',
      entity_type: entityType,
      entity_id: entityId,
      item_label: record.ticket_number || record.description || entityId,
      amount: Number(record.amount || record.total_amount || 0),
      reason,
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      unit_id: record.unit_id,
      request_id: requestId,
      before_data: record,
      after_data: updated,
      success: true,
    });

    return Response.json({ record: updated, request_id: requestId });
  } catch (error) {
    console.error(`[cancel_management_record:${requestId}]`, error);
    return Response.json({ error: 'record_cancellation_failed', request_id: requestId }, { status: 500 });
  }
});
