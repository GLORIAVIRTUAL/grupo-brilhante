import { digits, validateTaxId } from './enterpriseCore.js';

export const CONTRACT_TRANSITIONS = Object.freeze({
  draft: ['pending_approval', 'terminated'],
  pending_approval: ['draft', 'active', 'terminated'],
  active: ['suspended', 'expired', 'terminated'],
  suspended: ['active', 'terminated'],
  expired: ['active', 'terminated'],
  terminated: [],
});

export const SERVICE_ORDER_TRANSITIONS = Object.freeze({
  draft: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['waiting_customer', 'quality_review', 'cancelled'],
  waiting_customer: ['in_progress', 'quality_review', 'cancelled'],
  quality_review: ['in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
});

export const OPPORTUNITY_STAGE_ORDER = Object.freeze([
  'lead', 'qualification', 'diagnosis', 'proposal', 'negotiation', 'approval', 'won', 'lost', 'cancelled',
]);

export function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function normalizePartyInput(input = {}) {
  const partyType = input.party_type === 'person' ? 'person' : 'company';
  const validation = validateTaxId(input.tax_id, partyType);
  if (!validation.valid) throw new Error(partyType === 'person' ? 'invalid_cpf' : 'invalid_cnpj');
  const legalName = String(input.legal_name || '').trim().slice(0, 180);
  if (legalName.length < 2) throw new Error('party_name_required');
  return {
    party_type: partyType,
    legal_name: legalName,
    trade_name: String(input.trade_name || legalName).trim().slice(0, 180),
    tax_id: validation.normalized,
    tax_id_type: validation.type,
  };
}

export function canonicalContact(contactType, value) {
  const type = String(contactType || '').toLowerCase();
  const text = String(value || '').trim();
  if (['phone', 'mobile', 'whatsapp'].includes(type)) {
    const normalized = digits(text);
    if (normalized.length < 10 || normalized.length > 15) throw new Error('invalid_phone');
    return normalized;
  }
  if (type === 'email') {
    const normalized = text.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 180) throw new Error('invalid_email');
    return normalized;
  }
  if (!text || text.length > 500) throw new Error('invalid_contact');
  return text;
}

export function assertTransition(current, next, transitions, errorCode = 'invalid_status_transition') {
  if (current === next) return { idempotent: true };
  if (!(transitions[current] || []).includes(next)) throw new Error(errorCode);
  return { idempotent: false };
}

export function contractSnapshot(contract, prices = []) {
  const excluded = new Set(['id', 'created_date', 'updated_date', 'created_by', 'updated_by']);
  return {
    contract: Object.fromEntries(Object.entries(contract || {}).filter(([key]) => !excluded.has(key))),
    prices: (prices || []).map((price) => Object.fromEntries(Object.entries(price).filter(([key]) => !excluded.has(key)))),
    captured_at: new Date().toISOString(),
  };
}

export function nextContractNumber(sequence, legalEntityCode = 'CTR', date = new Date()) {
  const year = date.getUTCFullYear();
  const suffix = String(Math.max(1, Number(sequence) || 1)).padStart(6, '0');
  const code = String(legalEntityCode || 'CTR').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'CTR';
  return `${code}-${year}-${suffix}`;
}

export function nextServiceOrderNumber(sequence, legalEntityCode = 'OS', date = new Date()) {
  const year = date.getUTCFullYear();
  const suffix = String(Math.max(1, Number(sequence) || 1)).padStart(7, '0');
  const code = String(legalEntityCode || 'OS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'OS';
  return `${code}-OS-${year}-${suffix}`;
}

export function calculateOpportunityScore(input = {}) {
  let score = 0;
  if (input.has_valid_tax_id) score += 15;
  if (input.has_primary_contact) score += 10;
  if (input.has_service_address) score += 10;
  if (Number(input.estimated_value) > 0) score += 15;
  if (input.expected_close_date) score += 10;
  if (input.next_action_at) score += 10;
  const stageIndex = OPPORTUNITY_STAGE_ORDER.indexOf(input.stage);
  if (stageIndex >= 0 && stageIndex <= 5) score += Math.min(25, stageIndex * 5);
  if (input.temperature === 'hot') score += 15;
  else if (input.temperature === 'warm') score += 8;
  return Math.max(0, Math.min(100, score));
}
