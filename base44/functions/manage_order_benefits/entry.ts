import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { voucherValue, consumePackageBalance } from '../../shared/loyaltyMath.js';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

const USE_ROLES = new Set(['super_admin', 'admin', 'manager', 'attendant', 'cashier']);
const RESTORE_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance']);
const money = (value: unknown) => Math.round(Math.max(0, Number(value || 0)) * 100) / 100;

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

function assertOrderEligible(order: any) {
  if (!order || order.status === 'cancelled') throw new Error('order_not_found');
  if (Number(order.paid_amount || 0) > 0.001 || !['unpaid', undefined, null].includes(order.payment_status)) {
    throw new Error('benefit_requires_unpaid_order');
  }
}

async function loadOrderContext(base44: any, user: any, orderId: string) {
  const order = await base44.asServiceRole.entities.Order.get(orderId);
  if (!order || !canAccessUnit(user, order.unit_id)) throw new Error('order_not_found');
  const customer = await base44.asServiceRole.entities.Customer.get(order.customer_id);
  if (!customer) throw new Error('customer_not_found');
  const garments = await base44.asServiceRole.entities.GarmentItem.filter({ order_id: order.id }, '-created_date', 1000);
  const serviceQuantities = new Map<string, number>();
  for (const garment of garments) {
    for (const service of garment.services || []) {
      const serviceId = service.service_id || service.id;
      if (serviceId) serviceQuantities.set(serviceId, (serviceQuantities.get(serviceId) || 0) + Math.max(0, Number(service.quantity || 1)));
    }
  }
  return { order, customer, garments, serviceQuantities };
}

function benefitMetadata(order: any) {
  return {
    vouchers: Array.isArray(order?.metadata?.benefits?.vouchers) ? order.metadata.benefits.vouchers : [],
    packages: Array.isArray(order?.metadata?.benefits?.packages) ? order.metadata.benefits.packages : [],
  };
}

async function getEvent(base44: any, eventKey: string, type: string, order: any, payloadHash: string) {
  const existing = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey }, '-created_date', 1);
  if (existing[0] && existing[0].payload_hash !== payloadHash) throw new Error('idempotency_conflict');
  if (existing[0]?.status === 'completed') return { duplicate: true, event: existing[0] };
  const event = existing[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
    event_key: eventKey,
    event_type: type,
    source: 'user_command',
    status: 'processing',
    payload_hash: payloadHash,
    attempts: 1,
    started_at: new Date().toISOString(),
    unit_id: order.unit_id,
  });
  return { duplicate: false, event };
}

async function completeEvent(base44: any, event: any, entityId: string, result: any) {
  await base44.asServiceRole.entities.ProcessedEvent.update(event.id, {
    status: 'completed', entity_type: 'order', entity_id: entityId, result, completed_at: new Date().toISOString(),
  });
}

async function audit(base44: any, user: any, requestId: string, order: any, action: string, reason: string, before: any, after: any) {
  await base44.asServiceRole.entities.AuditLog.create({
    action,
    entity_type: 'order',
    entity_id: order.id,
    item_label: order.ticket_number || order.id,
    amount: after?.benefit_value,
    reason,
    user_email: user.email,
    user_name: user.full_name || user.display_name,
    user_role: user.role,
    unit_id: order.unit_id,
    request_id: requestId,
    before_data: before,
    after_data: after,
    domain: 'loyalty',
    severity: action === 'refund' ? 'notice' : 'info',
    result: 'success',
    occurred_at: new Date().toISOString(),
    success: true,
  });
}

async function preview(base44: any, user: any, orderId: string) {
  const { order, customer, serviceQuantities } = await loadOrderContext(base44, user, orderId);
  const [vouchers, packages] = await Promise.all([
    base44.asServiceRole.entities.Voucher.filter({ customer_id: customer.id }, '-issued_at', 200),
    base44.asServiceRole.entities.CustomerPackage.filter({ customer_id: customer.id }, '-purchased_at', 200),
  ]);
  const now = Date.now();
  return {
    order,
    vouchers: vouchers.filter((voucher: any) => ['active', 'reserved'].includes(voucher.status) && (!voucher.unit_id || voucher.unit_id === order.unit_id) && (!voucher.valid_from || new Date(voucher.valid_from).getTime() <= now) && (!voucher.valid_until || new Date(voucher.valid_until).getTime() >= now)),
    packages: packages.filter((pkg: any) => pkg.status === 'active' && (!pkg.unit_id || pkg.unit_id === order.unit_id) && (!pkg.valid_from || new Date(pkg.valid_from).getTime() <= now) && (!pkg.valid_until || new Date(pkg.valid_until).getTime() >= now)),
    service_quantities: Object.fromEntries(serviceQuantities),
    applied: benefitMetadata(order),
  };
}

async function applyVoucher(base44: any, user: any, body: any, requestId: string) {
  const { order, customer, serviceQuantities } = await loadOrderContext(base44, user, body.order_id);
  assertOrderEligible(order);
  const code = String(body.code || '').trim().toUpperCase();
  const idempotencyKey = String(body.idempotency_key || '').trim();
  if (!code || !idempotencyKey) throw new Error('voucher_code_and_idempotency_required');
  const eventState = await getEvent(base44, `order_voucher:${idempotencyKey}`, 'order_voucher', order, `${order.id}:${code}`);
  if (eventState.duplicate) return { order, duplicate: true };

  const vouchers = await base44.asServiceRole.entities.Voucher.filter({ code }, '-created_date', 1);
  const voucher = vouchers[0];
  if (!voucher || (voucher.customer_id && voucher.customer_id !== customer.id) || (voucher.unit_id && voucher.unit_id !== order.unit_id)) throw new Error('voucher_not_found');
  const benefits = benefitMetadata(order);
  const previousApplication = benefits.vouchers.find((item: any) => item.voucher_id === voucher.id && item.status === 'applied');
  if (previousApplication) {
    await completeEvent(base44, eventState.event, order.id, { voucher_id: voucher.id, duplicate: true });
    return { order, voucher, value: previousApplication.value, duplicate: true };
  }
  if (voucher.idempotency_key === idempotencyKey && voucher.redeemed_order_id === order.id) {
    const recoveredValue = money(voucher.metadata?.redeemed_value || 0);
    if (recoveredValue <= 0) throw new Error('voucher_recovery_value_missing');
    const recoveredTotal = money(Math.max(0, Number(order.total_amount || 0) - recoveredValue));
    const recoveredOrder = await base44.asServiceRole.entities.Order.update(order.id, {
      discount_amount: money(Number(order.discount_amount || 0) + recoveredValue),
      total_amount: recoveredTotal,
      open_amount: recoveredTotal,
      metadata: {
        ...(order.metadata || {}),
        benefits: {
          ...benefits,
          vouchers: [...benefits.vouchers, { voucher_id: voucher.id, code: voucher.code, value: recoveredValue, status: 'applied', applied_at: voucher.redeemed_at, idempotency_key: idempotencyKey }],
        },
      },
    });
    await completeEvent(base44, eventState.event, order.id, { voucher_id: voucher.id, value: recoveredValue, recovered: true });
    return { order: recoveredOrder, voucher, value: recoveredValue, duplicate: true };
  }

  const serviceIds = [...serviceQuantities.keys()];
  const value = voucherValue(voucher, Number(order.total_amount || 0) - Number(order.paid_amount || 0), serviceIds);
  if (value <= 0) throw new Error('voucher_has_no_value');
  const now = new Date().toISOString();
  const nextUsage = Number(voucher.usage_count || 0) + 1;
  const voucherPatch = {
    usage_count: nextUsage,
    status: nextUsage >= Number(voucher.usage_limit || 1) ? 'redeemed' : 'active',
    redeemed_at: now,
    redeemed_order_id: order.id,
    idempotency_key: idempotencyKey,
    metadata: { ...(voucher.metadata || {}), redeemed_value: value, redeemed_by_user_id: user.id },
  };
  const previousVoucher = { usage_count: voucher.usage_count, status: voucher.status, redeemed_at: voucher.redeemed_at, redeemed_order_id: voucher.redeemed_order_id, idempotency_key: voucher.idempotency_key, metadata: voucher.metadata };
  const currentDiscount = Number(order.discount_amount || 0);
  const currentTotal = Number(order.total_amount || 0);
  const orderPatch = {
    discount_amount: money(currentDiscount + value),
    total_amount: money(currentTotal - value),
    open_amount: money(currentTotal - value),
    metadata: {
      ...(order.metadata || {}),
      benefits: {
        ...benefits,
        vouchers: [...benefits.vouchers, { voucher_id: voucher.id, code: voucher.code, value, status: 'applied', applied_at: now, idempotency_key: idempotencyKey }],
      },
    },
  };

  await base44.asServiceRole.entities.Voucher.update(voucher.id, voucherPatch);
  let updatedOrder;
  try {
    updatedOrder = await base44.asServiceRole.entities.Order.update(order.id, orderPatch);
  } catch (error) {
    await base44.asServiceRole.entities.Voucher.update(voucher.id, previousVoucher).catch(() => null);
    throw error;
  }
  await audit(base44, user, requestId, order, 'update', 'voucher_applied_before_payment', { total_amount: currentTotal, voucher }, { total_amount: updatedOrder.total_amount, voucher_id: voucher.id, benefit_value: value });
  await completeEvent(base44, eventState.event, order.id, { voucher_id: voucher.id, value });
  return { order: updatedOrder, voucher: { ...voucher, ...voucherPatch }, value };
}

async function applyPackage(base44: any, user: any, body: any, requestId: string) {
  const { order, customer, serviceQuantities } = await loadOrderContext(base44, user, body.order_id);
  assertOrderEligible(order);
  const quantity = Math.max(0, Number(body.quantity || 0));
  const serviceId = String(body.service_id || '');
  const idempotencyKey = String(body.idempotency_key || '').trim();
  if (!body.customer_package_id || !serviceId || quantity <= 0 || !idempotencyKey) throw new Error('package_service_quantity_and_idempotency_required');
  const eventState = await getEvent(base44, `order_package:${idempotencyKey}`, 'order_package', order, `${order.id}:${body.customer_package_id}:${serviceId}:${quantity}`);
  if (eventState.duplicate) return { order, duplicate: true };

  const pkg = await base44.asServiceRole.entities.CustomerPackage.get(body.customer_package_id);
  if (!pkg || pkg.customer_id !== customer.id || (pkg.unit_id && pkg.unit_id !== order.unit_id)) throw new Error('package_not_found');
  const priorLedgerRows = await base44.asServiceRole.entities.CustomerPackageLedger.filter({ idempotency_key: idempotencyKey }, '-occurred_at', 1);
  const priorLedger = priorLedgerRows[0];
  if (priorLedger) {
    const priorValue = money(priorLedger.metadata?.value || 0);
    const priorQuantity = Math.abs(Number(priorLedger.quantity || quantity));
    const benefits = benefitMetadata(order);
    const existingApplication = benefits.packages.find((item: any) => item.idempotency_key === idempotencyKey && item.status === 'applied');
    let recoveredOrder = order;
    if (!existingApplication) {
      const recoveredTotal = money(Math.max(0, Number(order.total_amount || 0) - priorValue));
      recoveredOrder = await base44.asServiceRole.entities.Order.update(order.id, {
        discount_amount: money(Number(order.discount_amount || 0) + priorValue),
        total_amount: recoveredTotal,
        open_amount: recoveredTotal,
        metadata: {
          ...(order.metadata || {}),
          benefits: {
            ...benefits,
            packages: [...benefits.packages, { customer_package_id: pkg.id, service_id: serviceId, quantity: priorQuantity, value: priorValue, status: 'applied', applied_at: priorLedger.occurred_at, idempotency_key: idempotencyKey }],
          },
        },
      });
    }
    await completeEvent(base44, eventState.event, order.id, { package_id: pkg.id, ledger_id: priorLedger.id, value: priorValue, quantity: priorQuantity, recovered: true });
    return { order: recoveredOrder, customer_package: pkg, ledger: priorLedger, value: priorValue, duplicate: true };
  }
  if (pkg.status !== 'active' || (pkg.valid_until && new Date(pkg.valid_until).getTime() < Date.now())) throw new Error('package_not_active');
  const service = (pkg.service_balances || []).find((item: any) => item.service_id === serviceId);
  if (!service || Number(service.unit_value || 0) <= 0) throw new Error('package_unit_value_required');
  const alreadyApplied = benefitMetadata(order).packages.filter((item: any) => item.service_id === serviceId && item.status === 'applied').reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
  if (quantity > Math.max(0, Number(serviceQuantities.get(serviceId) || 0) - alreadyApplied)) throw new Error('package_quantity_exceeds_order_service');
  const consumption = consumePackageBalance(pkg, serviceId, quantity);
  const currentTotal = Number(order.total_amount || 0);
  const requestedValue = money(Number(service.unit_value) * quantity);
  if (requestedValue - currentTotal > 0.001) throw new Error('package_value_exceeds_order_balance');
  const value = requestedValue;
  if (value <= 0) throw new Error('package_has_no_value');
  const benefits = benefitMetadata(order);
  const now = new Date().toISOString();
  const pkgPatch = { service_balances: consumption.balances, status: consumption.exhausted ? 'exhausted' : 'active' };
  const orderPatch = {
    discount_amount: money(Number(order.discount_amount || 0) + value),
    total_amount: money(currentTotal - value),
    open_amount: money(currentTotal - value),
    metadata: {
      ...(order.metadata || {}),
      benefits: {
        ...benefits,
        packages: [...benefits.packages, { customer_package_id: pkg.id, service_id: serviceId, quantity, value, status: 'applied', applied_at: now, idempotency_key: idempotencyKey }],
      },
    },
  };

  await base44.asServiceRole.entities.CustomerPackage.update(pkg.id, pkgPatch);
  let ledger;
  try {
    ledger = await base44.asServiceRole.entities.CustomerPackageLedger.create({
      customer_package_id: pkg.id, customer_id: customer.id, unit_id: order.unit_id, service_id: serviceId,
      entry_type: 'consume', quantity: -quantity, balance_after: consumption.balanceAfter, order_id: order.id,
      occurred_at: now, created_by_user_id: user.id, reason: 'Consumo de pacote aplicado antes do recebimento',
      idempotency_key: idempotencyKey, metadata: { value, request_id: requestId },
    });
  } catch (error) {
    await base44.asServiceRole.entities.CustomerPackage.update(pkg.id, { service_balances: pkg.service_balances, status: pkg.status }).catch(() => null);
    throw error;
  }
  const updatedOrder = await base44.asServiceRole.entities.Order.update(order.id, orderPatch);
  await audit(base44, user, requestId, order, 'update', 'package_applied_before_payment', { total_amount: currentTotal, package: pkg }, { total_amount: updatedOrder.total_amount, package_id: pkg.id, ledger_id: ledger.id, benefit_value: value });
  await completeEvent(base44, eventState.event, order.id, { package_id: pkg.id, ledger_id: ledger.id, value, quantity });
  return { order: updatedOrder, customer_package: { ...pkg, ...pkgPatch }, ledger, value };
}

async function restoreBenefits(base44: any, user: any, body: any, requestId: string) {
  if (!RESTORE_ROLES.has(user.role) && !(user.permissions || []).includes('loyalty.manage')) throw new Error('benefit_restore_forbidden');
  const { order } = await loadOrderContext(base44, user, body.order_id);
  if (Number(order.paid_amount || 0) > 0.001) throw new Error('benefit_restore_requires_unpaid_order');
  const reason = String(body.reason || '').trim();
  const idempotencyKey = String(body.idempotency_key || '').trim();
  if (reason.length < 8 || !idempotencyKey) throw new Error('restore_reason_and_idempotency_required');
  const eventState = await getEvent(base44, `order_benefit_restore:${idempotencyKey}`, 'order_benefit_restore', order, `${order.id}:${reason}`);
  if (eventState.duplicate) return { order, duplicate: true };
  const benefits = benefitMetadata(order);
  const appliedVouchers = benefits.vouchers.filter((item: any) => item.status === 'applied');
  const appliedPackages = benefits.packages.filter((item: any) => item.status === 'applied');
  const restoredValue = money([...appliedVouchers, ...appliedPackages].reduce((sum: number, item: any) => sum + Number(item.value || 0), 0));

  for (const application of appliedVouchers) {
    const voucher = await base44.asServiceRole.entities.Voucher.get(application.voucher_id);
    if (!voucher) continue;
    const restoreKeys = Array.isArray(voucher.metadata?.benefit_restore_keys) ? voucher.metadata.benefit_restore_keys : [];
    if (restoreKeys.includes(idempotencyKey)) continue;
    const usageCount = Math.max(0, Number(voucher.usage_count || 0) - 1);
    await base44.asServiceRole.entities.Voucher.update(voucher.id, {
      usage_count: usageCount,
      status: usageCount >= Number(voucher.usage_limit || 1) ? 'redeemed' : 'active',
      redeemed_at: voucher.redeemed_order_id === order.id ? undefined : voucher.redeemed_at,
      redeemed_order_id: voucher.redeemed_order_id === order.id ? undefined : voucher.redeemed_order_id,
      metadata: {
        ...(voucher.metadata || {}),
        benefit_restore_keys: [...new Set([...restoreKeys, idempotencyKey])].slice(-50),
        restored_order_id: order.id,
        restored_at: new Date().toISOString(),
        restore_reason: reason,
      },
    });
  }

  for (const application of appliedPackages) {
    const pkg = await base44.asServiceRole.entities.CustomerPackage.get(application.customer_package_id);
    if (!pkg) continue;
    const reverseKey = `${idempotencyKey}:${application.idempotency_key}`;
    const restoreKeys = Array.isArray(pkg.metadata?.benefit_restore_keys) ? pkg.metadata.benefit_restore_keys : [];
    if (restoreKeys.includes(reverseKey)) continue;
    const currentService = (pkg.service_balances || []).find((item: any) => item.service_id === application.service_id);
    const currentBalance = Number(currentService?.remaining_quantity || 0);
    const quantity = Number(application.quantity || 0);
    const original = await base44.asServiceRole.entities.CustomerPackageLedger.filter({ idempotency_key: application.idempotency_key }, '-occurred_at', 1);
    const priorReverse = await base44.asServiceRole.entities.CustomerPackageLedger.filter({ idempotency_key: reverseKey }, '-occurred_at', 1);
    let restoredBalance = currentBalance + quantity;
    if (priorReverse[0]) {
      const balanceBefore = Number(priorReverse[0].metadata?.balance_before);
      const balanceAfter = Number(priorReverse[0].balance_after);
      if (!Number.isFinite(balanceBefore) || !Number.isFinite(balanceAfter) || (currentBalance !== balanceBefore && currentBalance !== balanceAfter)) {
        throw new Error('package_restore_conflict');
      }
      restoredBalance = balanceAfter;
    } else {
      await base44.asServiceRole.entities.CustomerPackageLedger.create({
        customer_package_id: pkg.id, customer_id: pkg.customer_id, unit_id: pkg.unit_id, service_id: application.service_id,
        entry_type: 'reverse', quantity, balance_after: restoredBalance, order_id: order.id,
        reference_entry_id: original[0]?.id, occurred_at: new Date().toISOString(), created_by_user_id: user.id,
        reason, idempotency_key: reverseKey, metadata: { request_id: requestId, balance_before: currentBalance },
      });
    }
    const balances = (pkg.service_balances || []).map((item: any) => item.service_id === application.service_id ? { ...item, remaining_quantity: restoredBalance } : item);
    await base44.asServiceRole.entities.CustomerPackage.update(pkg.id, {
      service_balances: balances,
      status: 'active',
      metadata: { ...(pkg.metadata || {}), benefit_restore_keys: [...new Set([...restoreKeys, reverseKey])].slice(-50) },
    });
  }

  const updatedOrder = await base44.asServiceRole.entities.Order.update(order.id, {
    discount_amount: money(Math.max(0, Number(order.discount_amount || 0) - restoredValue)),
    total_amount: money(Number(order.total_amount || 0) + restoredValue),
    open_amount: money(Number(order.total_amount || 0) + restoredValue),
    metadata: {
      ...(order.metadata || {}),
      benefits: {
        vouchers: benefits.vouchers.map((item: any) => item.status === 'applied' ? { ...item, status: 'restored', restored_at: new Date().toISOString(), restore_reason: reason } : item),
        packages: benefits.packages.map((item: any) => item.status === 'applied' ? { ...item, status: 'restored', restored_at: new Date().toISOString(), restore_reason: reason } : item),
      },
    },
  });
  await audit(base44, user, requestId, order, 'refund', reason, { benefits }, { benefit_value: restoredValue, benefits: updatedOrder.metadata?.benefits });
  await completeEvent(base44, eventState.event, order.id, { restored_value: restoredValue });
  return { order: updatedOrder, restored_value: restoredValue };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const principal = await authorizeUserOrInternal(base44, req, body, {
      source: 'manage_order_benefits',
    });
    const user = principal.user ? { ...principal.user, permissions: principal.permissions } : {
      id: body.actor_user_id || 'internal_function',
      email: body.actor_email,
      full_name: body.actor_name || 'Automação interna',
      role: body.actor_role || 'system',
      permissions: body.actor_permissions || [],
    };
    const canUseBenefits = principal.kind === 'internal' || USE_ROLES.has(user.role) || (user.permissions || []).includes('loyalty.redeem') || (user.permissions || []).includes('loyalty.manage');
    if (['preview', 'apply_voucher', 'apply_package'].includes(body.action) && !canUseBenefits) throw new Error('benefit_use_forbidden');
    if (body.action === 'preview') return Response.json({ ...(await preview(base44, user, body.order_id)), request_id: requestId });
    if (body.action === 'apply_voucher') return Response.json({ ...(await applyVoucher(base44, user, body, requestId)), request_id: requestId });
    if (body.action === 'apply_package') return Response.json({ ...(await applyPackage(base44, user, body, requestId)), request_id: requestId });
    if (body.action === 'restore') return Response.json({ ...(await restoreBenefits(base44, user, body, requestId)), request_id: requestId });
    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 422 });
  } catch (error) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    console.error(`[manage_order_benefits:${requestId}]`, error);
    const code = error instanceof Error ? error.message : 'order_benefit_failed';
    const clientErrors = new Set(['order_not_found', 'customer_not_found', 'benefit_requires_unpaid_order', 'voucher_code_and_idempotency_required', 'voucher_not_found', 'voucher_has_no_value', 'voucher_recovery_value_missing', 'voucher_not_active', 'voucher_not_started', 'voucher_expired', 'voucher_usage_limit', 'voucher_minimum_order', 'voucher_service_not_found', 'package_service_quantity_and_idempotency_required', 'package_not_found', 'package_not_active', 'package_unit_value_required', 'package_quantity_exceeds_order_service', 'package_value_exceeds_order_balance', 'package_has_no_value', 'invalid_package_quantity', 'insufficient_package_balance', 'benefit_use_forbidden', 'benefit_restore_forbidden', 'benefit_restore_requires_unpaid_order', 'restore_reason_and_idempotency_required', 'idempotency_conflict', 'package_restore_conflict']);
    const status = code.endsWith('_forbidden') ? 403 : clientErrors.has(code) ? 422 : 500;
    return Response.json({ error: code, request_id: requestId }, { status });
  }
});
