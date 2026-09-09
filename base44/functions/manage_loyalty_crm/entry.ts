import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { calculateEarnedPoints, pointsMonetaryValue, validateRedemption, voucherValue, consumePackageBalance, roundPoints } from '../../shared/loyaltyMath.js';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

const VIEW_ROLES = new Set(['super_admin', 'admin', 'manager', 'attendant', 'cashier', 'finance', 'auditor']);
const MANAGE_ROLES = new Set(['super_admin', 'admin', 'manager']);
const REDEEM_ROLES = new Set(['super_admin', 'admin', 'manager', 'attendant', 'cashier']);
function canAccessUnit(user: any, unitId?: string) { if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true; return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId); }
function idempotency(body: any, prefix: string) { return String(body.idempotency_key || `${prefix}:${crypto.randomUUID()}`); }
async function existingLedger(base44: any, entity: string, key: string) { const rows = await base44.asServiceRole.entities[entity].filter({ idempotency_key: key }, '-created_date', 1); return rows[0] || null; }
async function loyaltyBalance(base44: any, customerId: string, programId?: string) { const rows = programId ? await base44.asServiceRole.entities.LoyaltyLedger.filter({ customer_id: customerId, program_id: programId }, 'occurred_at', 5000) : await base44.asServiceRole.entities.LoyaltyLedger.filter({ customer_id: customerId }, 'occurred_at', 5000); return roundPoints(rows.reduce((sum: number, row: any) => sum + Number(row.points || 0), 0)); }
async function audit(base44: any, user: any, requestId: string, entityType: string, entity: any, action: string, reason: string, before?: any) { return base44.asServiceRole.entities.AuditLog.create({ action, entity_type: entityType, entity_id: entity.id, item_label: entity.name || entity.code || entity.id, reason, user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role, unit_id: entity.unit_id || user.primary_unit_id, request_id: requestId, before_data: before, after_data: entity, domain: 'loyalty', severity: ['approve', 'refund'].includes(action) ? 'notice' : 'info', result: 'success', occurred_at: new Date().toISOString(), success: true }); }

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const principal = await authorizeUserOrInternal(base44, req, body, {
      allowInternal: false,
      source: 'manage_loyalty_crm',
    });
    const user = principal.user;
    if (!VIEW_ROLES.has(user.role) && !(user.permissions || []).includes('loyalty.view')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const action = String(body.action || 'snapshot');
    const now = new Date().toISOString();

    if (action === 'save_program') {
      if (!MANAGE_ROLES.has(user.role) && !(user.permissions || []).includes('loyalty.manage')) return Response.json({ error: 'management_forbidden', request_id: requestId }, { status: 403 });
      const reason = String(body.change_reason || '').trim();
      if (!String(body.name || '').trim() || !String(body.code || '').trim() || reason.length < 8) return Response.json({ error: 'name_code_and_reason_required', request_id: requestId }, { status: 422 });
      const unitId = body.unit_id || user.primary_unit_id;
      if (unitId && !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const previous = body.program_id ? await base44.asServiceRole.entities.LoyaltyProgram.get(body.program_id) : null;
      const data = { name: String(body.name).trim(), code: String(body.code).trim().toUpperCase(), unit_id: unitId, status: body.status === 'active' ? 'active' : 'draft', earning_type: body.earning_type || 'amount', points_per_currency: Math.max(0, Number(body.points_per_currency || 0)), currency_per_point: Math.max(0, Number(body.currency_per_point || 0)), minimum_redeem_points: Math.max(0, Number(body.minimum_redeem_points || 0)), maximum_redeem_percent: Math.max(0, Math.min(100, Number(body.maximum_redeem_percent ?? 100))), expiration_days: Math.max(0, Number(body.expiration_days || 365)), eligible_service_ids: body.eligible_service_ids || [], eligible_customer_groups: body.eligible_customer_groups || [], version: Number(previous?.version || 0) + 1, valid_from: body.valid_from || now, valid_until: body.valid_until, created_by_user_id: user.id, approved_by_user_id: body.status === 'active' ? user.id : undefined, approved_at: body.status === 'active' ? now : undefined, change_reason: reason };
      const program = await base44.asServiceRole.entities.LoyaltyProgram.create(data);
      if (program.status === 'active') { const actives = await base44.asServiceRole.entities.LoyaltyProgram.filter({ unit_id: unitId, status: 'active' }, '-version', 100); for (const item of actives.filter((item: any) => item.id !== program.id && item.code === program.code)) await base44.asServiceRole.entities.LoyaltyProgram.update(item.id, { status: 'retired', valid_until: now }); }
      await audit(base44, user, requestId, 'loyalty_program', program, program.status === 'active' ? 'approve' : 'create', reason);
      return Response.json({ program, request_id: requestId });
    }

    if (action === 'post_points') {
      if (!REDEEM_ROLES.has(user.role) && !(user.permissions || []).includes('loyalty.redeem') && !(user.permissions || []).includes('loyalty.manage')) return Response.json({ error: 'points_forbidden', request_id: requestId }, { status: 403 });
      const customer = await base44.asServiceRole.entities.Customer.get(body.customer_id);
      const program = await base44.asServiceRole.entities.LoyaltyProgram.get(body.program_id || customer?.loyalty_program_id);
      if (!customer || !program || !canAccessUnit(user, customer.unit_id || program.unit_id)) return Response.json({ error: 'customer_or_program_not_found', request_id: requestId }, { status: 404 });
      const key = idempotency(body, `loyalty:${body.entry_type || 'adjustment'}:${customer.id}`);
      const existing = await existingLedger(base44, 'LoyaltyLedger', key);
      if (existing) return Response.json({ ledger: existing, balance: existing.balance_after, idempotent: true, request_id: requestId });
      const entryType = String(body.entry_type || 'adjustment');
      const reason = String(body.reason || '').trim();
      if (reason.length < 8) return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
      const balance = await loyaltyBalance(base44, customer.id, program.id);
      let points = Number(body.points || 0);
      if (entryType === 'earn' && !body.points) points = calculateEarnedPoints(program, body.amount, body.service_count, body.visit_count);
      if (['redeem', 'expire'].includes(entryType)) points = -Math.abs(points);
      if (entryType === 'redeem') validateRedemption({ balance, points: Math.abs(points), program, orderAmount: body.order_amount });
      if (entryType === 'adjustment' && !MANAGE_ROLES.has(user.role) && !(user.permissions || []).includes('loyalty.manage')) return Response.json({ error: 'adjustment_forbidden', request_id: requestId }, { status: 403 });
      const nextBalance = roundPoints(balance + points);
      if (nextBalance < 0) return Response.json({ error: 'insufficient_points', request_id: requestId }, { status: 409 });
      const ledger = await base44.asServiceRole.entities.LoyaltyLedger.create({ customer_id: customer.id, program_id: program.id, unit_id: customer.unit_id || program.unit_id, entry_type: entryType, points: roundPoints(points), balance_after: nextBalance, monetary_value: pointsMonetaryValue(program, Math.abs(points)), order_id: body.order_id, payment_receipt_id: body.payment_receipt_id, voucher_id: body.voucher_id, reference_entry_id: body.reference_entry_id, expires_at: entryType === 'earn' && program.expiration_days > 0 ? new Date(Date.now() + Number(program.expiration_days) * 86400000).toISOString() : undefined, occurred_at: now, created_by_user_id: user.id, reason, idempotency_key: key, metadata: body.metadata || {} });
      await base44.asServiceRole.entities.Customer.update(customer.id, { loyalty_points_balance: nextBalance, loyalty_program_id: program.id, last_crm_snapshot_at: now });
      await audit(base44, user, requestId, 'loyalty_ledger', ledger, entryType === 'redeem' ? 'update' : 'create', reason);
      return Response.json({ ledger, balance: nextBalance, request_id: requestId });
    }

    if (action === 'issue_voucher') {
      if (!MANAGE_ROLES.has(user.role) && !(user.permissions || []).includes('loyalty.manage')) return Response.json({ error: 'voucher_issue_forbidden', request_id: requestId }, { status: 403 });
      const customer = body.customer_id ? await base44.asServiceRole.entities.Customer.get(body.customer_id) : null;
      const unitId = body.unit_id || customer?.unit_id || user.primary_unit_id;
      if (unitId && !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const reason = String(body.reason || '').trim(); if (reason.length < 8) return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
      const code = String(body.code || `VCH-${crypto.randomUUID().slice(0, 8)}`).trim().toUpperCase();
      const same = await base44.asServiceRole.entities.Voucher.filter({ code }, '-created_date', 1); if (same.length) return Response.json({ error: 'voucher_code_exists', request_id: requestId }, { status: 409 });
      const voucher = await base44.asServiceRole.entities.Voucher.create({ code, customer_id: body.customer_id, unit_id: unitId, program_id: body.program_id, voucher_type: body.voucher_type || 'fixed_amount', amount: Math.max(0, Number(body.amount || 0)), percent: Math.max(0, Math.min(100, Number(body.percent || 0))), service_id: body.service_id, minimum_order_amount: Math.max(0, Number(body.minimum_order_amount || 0)), maximum_discount_amount: Math.max(0, Number(body.maximum_discount_amount || 0)), usage_limit: Math.max(1, Number(body.usage_limit || 1)), usage_count: 0, status: 'active', valid_from: body.valid_from || now, valid_until: body.valid_until, issued_at: now, created_by_user_id: user.id, reason, idempotency_key: idempotency(body, `voucher:${code}`), metadata: body.metadata || {} });
      await audit(base44, user, requestId, 'voucher', voucher, 'create', reason);
      return Response.json({ voucher, request_id: requestId });
    }

    if (action === 'redeem_voucher') {
      if (!REDEEM_ROLES.has(user.role) && !(user.permissions || []).includes('loyalty.redeem')) return Response.json({ error: 'voucher_redeem_forbidden', request_id: requestId }, { status: 403 });
      const matches = await base44.asServiceRole.entities.Voucher.filter({ code: String(body.code || '').trim().toUpperCase() }, '-created_date', 1);
      const voucher = matches[0]; if (!voucher || !canAccessUnit(user, voucher.unit_id)) return Response.json({ error: 'voucher_not_found', request_id: requestId }, { status: 404 });
      if (voucher.customer_id && voucher.customer_id !== body.customer_id) return Response.json({ error: 'voucher_customer_mismatch', request_id: requestId }, { status: 409 });
      const key = idempotency(body, `voucher-redeem:${voucher.id}`); if (voucher.idempotency_key === key && voucher.status === 'redeemed') return Response.json({ voucher, value: voucher.metadata?.redeemed_value, idempotent: true, request_id: requestId });
      const value = voucherValue(voucher, Number(body.order_amount || 0), body.service_ids || []);
      const updated = await base44.asServiceRole.entities.Voucher.update(voucher.id, { usage_count: Number(voucher.usage_count || 0) + 1, status: Number(voucher.usage_count || 0) + 1 >= Number(voucher.usage_limit || 1) ? 'redeemed' : 'active', redeemed_at: now, redeemed_order_id: body.order_id, idempotency_key: key, metadata: { ...(voucher.metadata || {}), redeemed_value: value, redeemed_by_user_id: user.id } });
      await audit(base44, user, requestId, 'voucher', updated, 'update', String(body.reason || 'Voucher validado e aplicado no atendimento'));
      return Response.json({ voucher: updated, value, request_id: requestId });
    }

    if (action === 'create_package') {
      if (!MANAGE_ROLES.has(user.role) && !(user.permissions || []).includes('loyalty.manage')) return Response.json({ error: 'package_create_forbidden', request_id: requestId }, { status: 403 });
      const customer = await base44.asServiceRole.entities.Customer.get(body.customer_id); if (!customer || !canAccessUnit(user, customer.unit_id)) return Response.json({ error: 'customer_not_found', request_id: requestId }, { status: 404 });
      const reason = String(body.reason || '').trim(); if (reason.length < 8 || !Array.isArray(body.service_balances) || body.service_balances.length === 0) return Response.json({ error: 'services_and_reason_required', request_id: requestId }, { status: 422 });
      const key = idempotency(body, `package:${customer.id}`); const existing = await base44.asServiceRole.entities.CustomerPackage.filter({ idempotency_key: key }, '-created_date', 1); if (existing[0]) return Response.json({ customer_package: existing[0], idempotent: true, request_id: requestId });
      const balances = body.service_balances.map((item: any) => ({ service_id: item.service_id, service_name: item.service_name, purchased_quantity: Math.max(0, Number(item.purchased_quantity || item.quantity || 0)), remaining_quantity: Math.max(0, Number(item.purchased_quantity || item.quantity || 0)), unit_value: Math.max(0, Number(item.unit_value || 0)) })).filter((item: any) => item.service_id && item.purchased_quantity > 0);
      const pkg = await base44.asServiceRole.entities.CustomerPackage.create({ customer_id: customer.id, unit_id: customer.unit_id || user.primary_unit_id, name: String(body.name || 'Pacote de serviços').trim(), code: String(body.code || `PCT-${Date.now().toString(36)}`).toUpperCase(), status: 'active', service_balances: balances, purchase_amount: Math.max(0, Number(body.purchase_amount || 0)), valid_from: body.valid_from || now, valid_until: body.valid_until, purchased_at: now, payment_receipt_id: body.payment_receipt_id, created_by_user_id: user.id, reason, idempotency_key: key, metadata: body.metadata || {} });
      for (const item of balances) await base44.asServiceRole.entities.CustomerPackageLedger.create({ customer_package_id: pkg.id, customer_id: customer.id, unit_id: pkg.unit_id, service_id: item.service_id, entry_type: 'grant', quantity: item.purchased_quantity, balance_after: item.remaining_quantity, occurred_at: now, created_by_user_id: user.id, reason, idempotency_key: `${key}:${item.service_id}` });
      await audit(base44, user, requestId, 'customer_package', pkg, 'create', reason);
      return Response.json({ customer_package: pkg, request_id: requestId });
    }

    if (action === 'consume_package') {
      if (!REDEEM_ROLES.has(user.role) && !(user.permissions || []).includes('loyalty.redeem')) return Response.json({ error: 'package_consume_forbidden', request_id: requestId }, { status: 403 });
      const pkg = await base44.asServiceRole.entities.CustomerPackage.get(body.customer_package_id); if (!pkg || !canAccessUnit(user, pkg.unit_id)) return Response.json({ error: 'package_not_found', request_id: requestId }, { status: 404 });
      if (pkg.status !== 'active' || (pkg.valid_until && new Date(pkg.valid_until).getTime() < Date.now())) return Response.json({ error: 'package_not_active', request_id: requestId }, { status: 409 });
      const key = idempotency(body, `package-consume:${pkg.id}`); const existing = await existingLedger(base44, 'CustomerPackageLedger', key); if (existing) return Response.json({ ledger: existing, idempotent: true, request_id: requestId });
      const result = consumePackageBalance(pkg, body.service_id, body.quantity);
      const updated = await base44.asServiceRole.entities.CustomerPackage.update(pkg.id, { service_balances: result.balances, status: result.exhausted ? 'exhausted' : 'active' });
      const ledger = await base44.asServiceRole.entities.CustomerPackageLedger.create({ customer_package_id: pkg.id, customer_id: pkg.customer_id, unit_id: pkg.unit_id, service_id: body.service_id, entry_type: 'consume', quantity: -Math.abs(Number(body.quantity || 0)), balance_after: result.balanceAfter, order_id: body.order_id, garment_item_id: body.garment_item_id, occurred_at: now, created_by_user_id: user.id, reason: String(body.reason || 'Consumo de pacote no atendimento'), idempotency_key: key });
      await audit(base44, user, requestId, 'customer_package', updated, 'update', ledger.reason, pkg);
      return Response.json({ customer_package: updated, ledger, request_id: requestId });
    }

    if (action === 'snapshot') {
      const customer = await base44.asServiceRole.entities.Customer.get(body.customer_id);
      if (!customer || !canAccessUnit(user, customer.unit_id)) return Response.json({ error: 'customer_not_found', request_id: requestId }, { status: 404 });
      const [orders, quotes, garments, receivables, conversations, pickups, deliveries, vouchers, packages, loyaltyEntries] = await Promise.all([
        base44.asServiceRole.entities.Order.filter({ customer_id: customer.id }, '-created_date', 5000),
        base44.asServiceRole.entities.Quote.filter({ customer_id: customer.id }, '-created_date', 5000),
        base44.asServiceRole.entities.GarmentItem.filter({ customer_id: customer.id }, '-created_date', 10000),
        base44.asServiceRole.entities.AccountsReceivable.filter({ customer_id: customer.id }, '-due_date', 5000),
        base44.asServiceRole.entities.Conversation.filter({ customer_id: customer.id }, '-updated_date', 1000),
        base44.asServiceRole.entities.Pickup.filter({ customer_id: customer.id }, '-scheduled_at', 2000),
        base44.asServiceRole.entities.DeliveryReceipt.filter({ customer_id: customer.id }, '-delivered_at', 2000),
        base44.asServiceRole.entities.Voucher.filter({ customer_id: customer.id }, '-issued_at', 1000),
        base44.asServiceRole.entities.CustomerPackage.filter({ customer_id: customer.id }, '-purchased_at', 1000),
        base44.asServiceRole.entities.LoyaltyLedger.filter({ customer_id: customer.id }, '-occurred_at', 5000),
      ]);
      const orderDates = orders.map((order: any) => new Date(order.created_date || order.created_at || 0)).filter((date: Date) => !Number.isNaN(date.getTime()));
      const lifetimeValue = orders.filter((order: any) => order.status !== 'cancelled').reduce((sum: number, order: any) => sum + Number(order.total_amount || 0), 0);
      const activeMonths = new Set(orderDates.map((date: Date) => `${date.getFullYear()}-${date.getMonth()}`)).size;
      const openReceivables = receivables.filter((item: any) => !['paid', 'cancelled', 'written_off'].includes(item.status));
      const overdue = openReceivables.filter((item: any) => item.due_date && new Date(item.due_date).getTime() < Date.now());
      const serviceCounts = new Map(); for (const garment of garments) for (const service of garment.services || []) serviceCounts.set(service.name || service.service_name || service.service_id, (serviceCounts.get(service.name || service.service_name || service.service_id) || 0) + Number(service.quantity || 1));
      const sortedServices = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
      const daysSinceLastOrder = orderDates.length ? Math.floor((Date.now() - Math.max(...orderDates.map((date: Date) => date.getTime()))) / 86400000) : null;
      const segment = customer.customer_type === 'company' || customer.billing_agreement_id ? 'corporate' : lifetimeValue >= 5000 ? 'vip' : orders.length >= 10 ? 'loyal' : daysSinceLastOrder != null && daysSinceLastOrder > 180 ? 'inactive' : daysSinceLastOrder != null && daysSinceLastOrder > 90 ? 'at_risk' : orders.length <= 1 ? 'new' : 'active';
      const metrics = { orders_count: orders.length, quotes_count: quotes.length, garments_count: garments.length, lifetime_value: Math.round(lifetimeValue * 100) / 100, average_ticket: orders.length ? Math.round(lifetimeValue / orders.length * 100) / 100 : 0, average_monthly_value: activeMonths ? Math.round(lifetimeValue / activeMonths * 100) / 100 : 0, active_months: activeMonths, first_order_at: orderDates.length ? new Date(Math.min(...orderDates.map((date: Date) => date.getTime()))).toISOString() : null, last_order_at: orderDates.length ? new Date(Math.max(...orderDates.map((date: Date) => date.getTime()))).toISOString() : null, days_since_last_order: daysSinceLastOrder, open_receivables: openReceivables.reduce((sum: number, item: any) => sum + Number(item.open_amount || 0), 0), overdue_receivables: overdue.reduce((sum: number, item: any) => sum + Number(item.open_amount || 0), 0), loyalty_points_balance: roundPoints(loyaltyEntries.reduce((sum: number, entry: any) => sum + Number(entry.points || 0), 0)), conversations_count: conversations.length, pickups_count: pickups.length, deliveries_count: deliveries.length, segment };
      const updated = await base44.asServiceRole.entities.Customer.update(customer.id, { segment, first_order_at: metrics.first_order_at || undefined, last_order_at: metrics.last_order_at || undefined, orders_count: metrics.orders_count, garments_count: metrics.garments_count, lifetime_value: metrics.lifetime_value, average_ticket: metrics.average_ticket, average_monthly_value: metrics.average_monthly_value, active_months: metrics.active_months, loyalty_points_balance: metrics.loyalty_points_balance, last_crm_snapshot_at: now, service_preferences: { top_services: sortedServices } });
      return Response.json({ customer: updated, metrics, top_services: sortedServices, recent: { orders: orders.slice(0, 10), quotes: quotes.slice(0, 10), receivables: receivables.slice(0, 10), conversations: conversations.slice(0, 10), pickups: pickups.slice(0, 10), deliveries: deliveries.slice(0, 10), vouchers: vouchers.slice(0, 10), packages: packages.slice(0, 10), loyalty_entries: loyaltyEntries.slice(0, 20) }, request_id: requestId });
    }

    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 422 });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const validation = new Set(['invalid_points', 'insufficient_points', 'minimum_redeem_not_reached', 'maximum_redeem_exceeded', 'voucher_not_active', 'voucher_not_started', 'voucher_expired', 'voucher_usage_limit', 'voucher_minimum_order', 'voucher_service_not_found', 'invalid_package_quantity', 'insufficient_package_balance']);
    return Response.json({ error: error?.message || 'loyalty_crm_failed', request_id: requestId }, { status: validation.has(error?.message) ? 422 : 500 });
  }
});
