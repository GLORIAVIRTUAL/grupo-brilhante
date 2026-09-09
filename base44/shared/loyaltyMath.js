export function roundMoney(value) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

export function roundPoints(value) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

export function calculateEarnedPoints(program, amount, serviceCount = 0, visitCount = 1) {
  if (!program || program.status !== 'active') return 0;
  if (program.earning_type === 'amount') return roundPoints(Math.max(0, Number(amount || 0)) * Math.max(0, Number(program.points_per_currency || 0)));
  if (program.earning_type === 'service') return roundPoints(Math.max(0, Number(serviceCount || 0)) * Math.max(0, Number(program.points_per_currency || 1)));
  if (program.earning_type === 'visit') return roundPoints(Math.max(0, Number(visitCount || 0)) * Math.max(0, Number(program.points_per_currency || 1)));
  return 0;
}

export function pointsMonetaryValue(program, points) {
  return roundMoney(Math.max(0, Number(points || 0)) * Math.max(0, Number(program?.currency_per_point || 0)));
}

export function validateRedemption({ balance, points, program, orderAmount = Number.POSITIVE_INFINITY }) {
  const requested = roundPoints(points);
  if (requested <= 0) throw new Error('invalid_points');
  if (requested > roundPoints(balance)) throw new Error('insufficient_points');
  if (requested < Number(program?.minimum_redeem_points || 0)) throw new Error('minimum_redeem_not_reached');
  const value = pointsMonetaryValue(program, requested);
  const maxValue = Number.isFinite(Number(orderAmount)) ? roundMoney(Number(orderAmount) * Math.max(0, Math.min(100, Number(program?.maximum_redeem_percent ?? 100))) / 100) : value;
  if (value > maxValue + 0.001) throw new Error('maximum_redeem_exceeded');
  return { points: requested, value };
}

export function voucherValue(voucher, orderAmount, serviceIds = []) {
  if (!voucher || !['active', 'reserved'].includes(voucher.status)) throw new Error('voucher_not_active');
  const now = Date.now();
  if (voucher.valid_from && new Date(voucher.valid_from).getTime() > now) throw new Error('voucher_not_started');
  if (voucher.valid_until && new Date(voucher.valid_until).getTime() < now) throw new Error('voucher_expired');
  if (Number(voucher.usage_count || 0) >= Number(voucher.usage_limit || 1)) throw new Error('voucher_usage_limit');
  if (Number(orderAmount || 0) < Number(voucher.minimum_order_amount || 0)) throw new Error('voucher_minimum_order');
  let value = 0;
  if (voucher.voucher_type === 'fixed_amount' || voucher.voucher_type === 'complimentary') value = Number(voucher.amount || 0);
  if (voucher.voucher_type === 'percent') value = Number(orderAmount || 0) * Math.max(0, Math.min(100, Number(voucher.percent || 0))) / 100;
  if (voucher.voucher_type === 'service') {
    if (!voucher.service_id || !serviceIds.includes(voucher.service_id)) throw new Error('voucher_service_not_found');
    value = Number(voucher.amount || 0);
  }
  if (Number(voucher.maximum_discount_amount || 0) > 0) value = Math.min(value, Number(voucher.maximum_discount_amount));
  return roundMoney(Math.min(Math.max(0, value), Math.max(0, Number(orderAmount || 0))));
}

export function packageBalanceForService(pkg, serviceId) {
  return Number((pkg?.service_balances || []).find((item) => item.service_id === serviceId)?.remaining_quantity || 0);
}

export function consumePackageBalance(pkg, serviceId, quantity) {
  const requested = Math.max(0, Number(quantity || 0));
  const current = packageBalanceForService(pkg, serviceId);
  if (requested <= 0) throw new Error('invalid_package_quantity');
  if (requested > current) throw new Error('insufficient_package_balance');
  const balances = (pkg.service_balances || []).map((item) => item.service_id === serviceId ? { ...item, remaining_quantity: roundPoints(current - requested) } : item);
  const exhausted = balances.every((item) => Number(item.remaining_quantity || 0) <= 0);
  return { balances, balanceAfter: roundPoints(current - requested), exhausted };
}
