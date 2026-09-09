import { roundMoney } from './businessCore.js';

export function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  if (iso && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return iso;
  const brazilian = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brazilian) {
    const candidate = `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
    if (!Number.isNaN(Date.parse(`${candidate}T00:00:00Z`))) return candidate;
  }
  return null;
}

export function normalizeAmount(value) {
  if (typeof value === 'number') return roundMoney(value);
  const text = String(value || '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? roundMoney(number) : null;
}

export function financialPeriodKey(legalEntityId, year, month) {
  const safeYear = Number(year);
  const safeMonth = Number(month);
  if (!legalEntityId || !Number.isInteger(safeYear) || safeYear < 2000 || safeYear > 2200 || !Number.isInteger(safeMonth) || safeMonth < 1 || safeMonth > 12) throw new Error('invalid_financial_period');
  return `${legalEntityId}:${safeYear}-${String(safeMonth).padStart(2, '0')}`;
}

export function financialPeriodBounds(year, month) {
  const safeYear = Number(year);
  const safeMonth = Number(month);
  financialPeriodKey('validation', safeYear, safeMonth);
  const start = `${safeYear}-${String(safeMonth).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(safeYear, safeMonth, 0));
  const end = `${safeYear}-${String(safeMonth).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`;
  return { start, end };
}

export function competenceParts(value) {
  const date = normalizeDate(value);
  if (!date) throw new Error('invalid_competence_date');
  const [year, month] = date.split('-').map(Number);
  return { date, year, month };
}

export function isPeriodWritable(period) {
  return !period || ['open', 'reopened'].includes(period.status);
}

export function weightedProjection(amount, probabilityPercent = 100) {
  const value = normalizeAmount(amount);
  if (value === null) throw new Error('invalid_amount');
  const probability = Math.max(0, Math.min(100, Number(probabilityPercent || 0)));
  return roundMoney(value * probability / 100);
}

export function normalizeMigrationRow(batchType, row = {}) {
  const sourceId = String(row.id || row.external_id || row.codigo || row.numero || '').trim();
  const messages = [];
  const normalized = { source_record_id: sourceId || null };

  if (['accounts_payable', 'accounts_receivable'].includes(batchType)) {
    normalized.description = String(row.description || row.descricao || row.name || '').trim().slice(0, 300);
    normalized.amount = normalizeAmount(row.amount ?? row.valor);
    normalized.due_date = normalizeDate(row.due_date || row.data_vencimento || row.vencimento);
    normalized.competence_date = normalizeDate(row.competence_date || row.data_competencia || row.competencia) || normalized.due_date;
    normalized.status = String(row.status || 'open').toLowerCase();
    normalized.counterparty_tax_id = String(row.tax_id || row.cpf_cnpj || row.documento || '').replace(/\D/g, '');
    normalized.cost_center_code = String(row.cost_center || row.centro_custo || '').trim();
    normalized.category = String(row.category || row.categoria || '').trim();
    if (!normalized.description) messages.push('description_required');
    if (normalized.amount === null || normalized.amount < 0) messages.push('valid_amount_required');
    if (!normalized.due_date) messages.push('valid_due_date_required');
  } else if (batchType === 'bank_transactions') {
    normalized.external_id = sourceId;
    normalized.description = String(row.description || row.descricao || '').trim().slice(0, 300);
    normalized.amount = normalizeAmount(row.amount ?? row.valor);
    normalized.transaction_date = normalizeDate(row.transaction_date || row.data);
    normalized.transaction_type = normalized.amount !== null && normalized.amount < 0 ? 'debit' : 'credit';
    if (!normalized.external_id) messages.push('external_id_required');
    if (normalized.amount === null || normalized.amount === 0) messages.push('non_zero_amount_required');
    if (!normalized.transaction_date) messages.push('valid_transaction_date_required');
  } else if (batchType === 'parties') {
    normalized.legal_name = String(row.legal_name || row.razao_social || row.name || row.nome || '').trim().slice(0, 180);
    normalized.trade_name = String(row.trade_name || row.nome_fantasia || normalized.legal_name).trim().slice(0, 180);
    normalized.tax_id = String(row.tax_id || row.cpf_cnpj || row.documento || '').replace(/\D/g, '');
    normalized.email = String(row.email || '').trim().toLowerCase();
    normalized.phone = String(row.phone || row.telefone || '').replace(/\D/g, '');
    if (!normalized.legal_name) messages.push('party_name_required');
    if (![11, 14].includes(normalized.tax_id.length)) messages.push('valid_tax_id_required');
  } else {
    Object.assign(normalized, row);
    if (!sourceId) messages.push('source_record_id_required');
  }

  return { normalized, messages, valid: messages.length === 0 };
}

export async function sha256Json(value) {
  const stable = JSON.stringify(value, Object.keys(value || {}).sort());
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const INTERCOMPANY_TRANSITIONS = Object.freeze({
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['posted', 'cancelled'],
  posted: ['settled', 'repair_required'],
  settled: [],
  cancelled: [],
  repair_required: ['posted', 'cancelled'],
});
