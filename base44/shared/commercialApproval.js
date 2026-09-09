const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager']);

export function selectCommercialApprovalPolicy(policies, unitId, now = Date.now()) {
  return (Array.isArray(policies) ? policies : [])
    .filter((policy) => policy?.active === true)
    .filter((policy) => !policy.unit_id || policy.unit_id === unitId)
    .filter((policy) => !policy.valid_from || new Date(policy.valid_from).getTime() <= now)
    .filter((policy) => !policy.valid_until || new Date(policy.valid_until).getTime() >= now)
    .sort((left, right) => Number(Boolean(right.unit_id)) - Number(Boolean(left.unit_id)) || Number(right.version || 0) - Number(left.version || 0))[0] || null;
}

export function evaluateCommercialAdjustment({
  role,
  permissions = [],
  mfaStatus,
  subtotalCents,
  discountCents,
  additionCents,
  reason = '',
  policy = null,
}) {
  if (discountCents < 0 || additionCents < 0 || discountCents > subtotalCents) throw new Error('invalid_adjustment');
  const discountPercent = subtotalCents > 0 ? discountCents / subtotalCents * 100 : 0;
  const additionPercent = subtotalCents > 0 ? additionCents / subtotalCents * 100 : 0;
  const adjustmentPercent = Math.max(discountPercent, additionPercent);
  const reasonThreshold = Number(policy?.requires_reason_above_percent ?? 0);
  if ((discountCents > 0 || additionCents > 0) && (adjustmentPercent > reasonThreshold || !policy) && String(reason).trim().length < 8) {
    throw new Error('adjustment_reason_required');
  }

  const fallbackLimit = MANAGER_ROLES.has(role) ? 100 : 10;
  const discountLimit = Number(policy?.max_discount_percent ?? fallbackLimit);
  const additionLimit = Number(policy?.max_addition_percent ?? fallbackLimit);
  const amountLimitCents = Math.round(Math.max(0, Number(policy?.max_discount_amount || 0)) * 100);
  const canOverride = ['super_admin', 'admin'].includes(role) || permissions.includes('quotes.discount_override');
  const exceedsDiscount = discountPercent > discountLimit || (amountLimitCents > 0 && discountCents > amountLimitCents);
  const exceedsAddition = additionPercent > additionLimit;
  if ((exceedsDiscount || exceedsAddition) && !canOverride) throw new Error('commercial_approval_required');

  const mfaThreshold = Number(policy?.require_mfa_above_percent ?? Number.POSITIVE_INFINITY);
  if (adjustmentPercent >= mfaThreshold && mfaStatus !== 'verified') throw new Error('mfa_required_for_adjustment');
  return { discountPercent, additionPercent, policy };
}
