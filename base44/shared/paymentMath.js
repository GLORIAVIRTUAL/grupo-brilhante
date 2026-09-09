const CENTS = 100;

export function toCents(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) throw new Error('invalid_money_value');
  return Math.round((numeric + Number.EPSILON) * CENTS);
}

export function fromCents(value) {
  return Math.round(Number(value || 0)) / CENTS;
}

export function allocateCents(amountCents, targets) {
  let remaining = Math.max(0, Math.round(amountCents));
  const allocations = [];

  for (const target of targets) {
    if (remaining <= 0) break;
    const openCents = Math.max(0, Math.round(target.open_cents || 0));
    if (!openCents) continue;
    const appliedCents = Math.min(remaining, openCents);
    allocations.push({ ...target, applied_cents: appliedCents });
    remaining -= appliedCents;
  }

  return { allocations, unapplied_cents: remaining };
}

export function calculateReceiptPlan({ targets, tenders }) {
  const normalizedTargets = targets.map((target) => ({ ...target, open_cents: toCents(target.open_amount) }));
  const amountDueCents = normalizedTargets.reduce((sum, target) => sum + target.open_cents, 0);
  if (amountDueCents <= 0) throw new Error('nothing_to_receive');

  const normalizedTenders = tenders.map((tender, index) => {
    const tenderedCents = toCents(tender.amount);
    if (tenderedCents <= 0) throw new Error(`invalid_tender_amount:${index}`);
    return {
      ...tender,
      sequence: index + 1,
      tendered_cents: tenderedCents,
      confirmed: tender.confirmed === true,
    };
  });

  const nonCashTenderedCents = normalizedTenders
    .filter((tender) => tender.method !== 'cash')
    .reduce((sum, tender) => sum + tender.tendered_cents, 0);
  if (nonCashTenderedCents > amountDueCents) throw new Error('non_cash_overpayment_not_allowed');

  const totalTenderedCents = normalizedTenders.reduce((sum, tender) => sum + tender.tendered_cents, 0);
  const changeCents = Math.max(0, totalTenderedCents - amountDueCents);
  if (changeCents > 0 && !normalizedTenders.some((tender) => tender.method === 'cash')) {
    throw new Error('change_requires_cash');
  }

  let remainingTargets = normalizedTargets.map((target) => ({ ...target }));
  const plannedTenders = [];
  for (const tender of normalizedTenders) {
    const pendingCents = tender.confirmed ? 0 : tender.tendered_cents;
    let maxAppliedCents = tender.confirmed ? tender.tendered_cents : 0;
    if (tender.method === 'cash' && changeCents > 0) maxAppliedCents = Math.max(0, maxAppliedCents - changeCents);

    const { allocations, unapplied_cents: unappliedCents } = allocateCents(maxAppliedCents, remainingTargets);
    for (const allocation of allocations) {
      const target = remainingTargets.find((item) => item.key === allocation.key);
      if (target) target.open_cents -= allocation.applied_cents;
    }

    plannedTenders.push({
      ...tender,
      applied_cents: maxAppliedCents - unappliedCents,
      pending_cents: pendingCents,
      change_cents: tender.method === 'cash' ? changeCents : 0,
      allocations,
    });
  }

  const appliedCents = plannedTenders.reduce((sum, tender) => sum + tender.applied_cents, 0);
  const pendingCents = plannedTenders.reduce((sum, tender) => sum + tender.pending_cents, 0);

  return {
    amount_due: fromCents(amountDueCents),
    amount_tendered: fromCents(totalTenderedCents),
    amount_applied: fromCents(appliedCents),
    pending_amount: fromCents(pendingCents),
    change_amount: fromCents(changeCents),
    tenders: plannedTenders.map((tender) => ({
      ...tender,
      amount: fromCents(tender.tendered_cents),
      applied_amount: fromCents(tender.applied_cents),
      pending_amount: fromCents(tender.pending_cents),
      change_amount: fromCents(tender.change_cents),
      allocations: tender.allocations.map((allocation) => ({ ...allocation, amount: fromCents(allocation.applied_cents) })),
    })),
  };
}
