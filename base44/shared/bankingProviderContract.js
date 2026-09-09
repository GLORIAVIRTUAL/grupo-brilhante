import { normalizeAmount, normalizeDate } from './financeCore.js';
import { roundMoney } from './businessCore.js';

export const BB_ENVIRONMENTS = new Set(['disabled', 'sandbox', 'homologation', 'production']);
export const BANK_CHARGE_TRANSITIONS = Object.freeze({
  draft: ['queued', 'cancelled'],
  queued: ['transmitting', 'cancelled', 'failed'],
  transmitting: ['active', 'failed', 'repair_required'],
  active: ['partially_paid', 'paid', 'expired', 'cancel_pending', 'refund_pending', 'repair_required'],
  partially_paid: ['paid', 'refund_pending', 'repair_required'],
  cancel_pending: ['cancelled', 'active', 'repair_required'],
  refund_pending: ['refunded', 'paid', 'repair_required'],
  paid: ['refund_pending', 'repair_required'],
  failed: ['queued', 'cancelled'],
  expired: [], cancelled: [], refunded: [], repair_required: ['queued', 'active', 'paid', 'cancelled'],
});

export function bankingRuntimeConfig(getEnv = () => '') {
  const environment = String(getEnv('BB_ENVIRONMENT') || 'disabled').toLowerCase();
  const normalizedEnvironment = BB_ENVIRONMENTS.has(environment) ? environment : 'disabled';
  return {
    environment: normalizedEnvironment,
    externalRequestsEnabled: String(getEnv('BB_EXTERNAL_REQUESTS_ENABLED') || '').toLowerCase() === 'true',
    productionEnabled: String(getEnv('BB_PRODUCTION_ENABLED') || '').toLowerCase() === 'true',
    apiBaseUrl: String(getEnv('BB_API_BASE_URL') || '').replace(/\/$/, ''),
    oauthUrl: String(getEnv('BB_OAUTH_URL') || ''),
    developerApplicationKey: String(getEnv('BB_DEVELOPER_APPLICATION_KEY') || ''),
    clientId: String(getEnv('BB_CLIENT_ID') || ''),
    clientSecret: String(getEnv('BB_CLIENT_SECRET') || ''),
    agreementNumber: String(getEnv('BB_BILLING_AGREEMENT_NUMBER') || ''),
    walletNumber: String(getEnv('BB_WALLET_NUMBER') || ''),
    walletVariation: String(getEnv('BB_WALLET_VARIATION') || ''),
    pixKey: String(getEnv('BB_PIX_KEY') || ''),
  };
}

export function assertExternalBankingAllowed(config) {
  if (!config.externalRequestsEnabled || !['sandbox', 'homologation', 'production'].includes(config.environment)) throw new Error('banking_external_requests_disabled');
  if (config.environment === 'production' && !config.productionEnabled) throw new Error('banking_production_disabled');
  const required = ['apiBaseUrl', 'oauthUrl', 'developerApplicationKey', 'clientId', 'clientSecret'];
  if (required.some((field) => !config[field])) throw new Error('banking_credentials_incomplete');
  return true;
}

export function oauthBasicHeader(config) {
  if (!config.clientId || !config.clientSecret) throw new Error('banking_credentials_incomplete');
  return `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
}

export function normalizePayer(input = {}) {
  const taxId = String(input.tax_id || '').replace(/\D/g, '');
  if (![11, 14].includes(taxId.length)) throw new Error('invalid_payer_tax_id');
  const name = String(input.name || '').trim().slice(0, 120);
  if (name.length < 2) throw new Error('payer_name_required');
  return {
    name,
    taxId,
    registrationType: taxId.length === 11 ? 1 : 2,
    email: String(input.email || '').trim().toLowerCase().slice(0, 180) || null,
    address: input.address && typeof input.address === 'object' ? input.address : {},
  };
}

export function buildBoletoPayload(charge, config) {
  const amount = normalizeAmount(charge.amount);
  const issueDate = normalizeDate(charge.issue_date);
  const dueDate = normalizeDate(charge.due_date);
  const payer = normalizePayer(charge.payer);
  if (amount === null || amount <= 0 || !issueDate || !dueDate) throw new Error('invalid_bank_charge');
  if (!config.agreementNumber || !config.walletNumber || !config.walletVariation) throw new Error('banking_billing_contract_incomplete');
  return {
    numeroConvenio: Number(config.agreementNumber),
    numeroCarteira: Number(config.walletNumber),
    numeroVariacaoCarteira: Number(config.walletVariation),
    codigoModalidade: Number(charge.modality_code || 1),
    dataEmissao: issueDate,
    dataVencimento: dueDate,
    valorOriginal: amount,
    indicadorAceiteTituloVencido: 'N',
    numeroDiasLimiteRecebimento: Number(charge.receipt_limit_days || 0),
    numeroTituloBeneficiario: String(charge.internal_reference).slice(0, 20),
    campoUtilizacaoBeneficiario: String(charge.internal_reference).slice(0, 25),
    pagador: {
      tipoInscricao: payer.registrationType,
      numeroInscricao: Number(payer.taxId),
      nome: payer.name,
      endereco: String(payer.address.street || '').slice(0, 40),
      cep: Number(String(payer.address.postal_code || '').replace(/\D/g, '') || 0),
      cidade: String(payer.address.city || '').slice(0, 20),
      bairro: String(payer.address.neighborhood || '').slice(0, 20),
      uf: String(payer.address.state || '').toUpperCase().slice(0, 2),
      telefone: String(payer.address.phone || '').replace(/\D/g, '').slice(0, 15),
    },
    indicadorPix: charge.with_pix === true ? 'S' : 'N',
  };
}

export function buildPixPayload(charge, config) {
  const amount = normalizeAmount(charge.amount);
  const payer = normalizePayer(charge.payer);
  if (amount === null || amount <= 0 || !config.pixKey) throw new Error('invalid_pix_charge');
  const dueDate = normalizeDate(charge.due_date);
  const payload = {
    devedor: payer.taxId.length === 11 ? { cpf: payer.taxId, nome: payer.name } : { cnpj: payer.taxId, nome: payer.name },
    valor: { original: amount.toFixed(2) },
    chave: config.pixKey,
    solicitacaoPagador: String(charge.description || 'Pagamento de serviços').slice(0, 140),
    infoAdicionais: [{ nome: 'Referência', valor: String(charge.internal_reference).slice(0, 50) }],
  };
  if (charge.charge_type === 'pix_due_date') {
    if (!dueDate) throw new Error('pix_due_date_required');
    return { calendario: { dataDeVencimento: dueDate, validadeAposVencimento: Number(charge.valid_after_due_days || 0) }, ...payload };
  }
  return { calendario: { expiracao: Math.max(60, Math.min(86400 * 30, Number(charge.expiration_seconds || 3600))) }, ...payload };
}

export function sanitizedBankResponse(response = {}) {
  return {
    providerChargeId: String(response.numero || response.id || response.loc?.id || '').slice(0, 120) || null,
    txid: String(response.txid || '').slice(0, 35) || null,
    ourNumber: String(response.numero || response.numeroTituloCliente || '').slice(0, 40) || null,
    digitableLine: String(response.linhaDigitavel || '').replace(/[^0-9. ]/g, '').slice(0, 80) || null,
    barcode: String(response.codigoBarraNumerico || '').replace(/\D/g, '').slice(0, 60) || null,
    qrCodeText: String(response.pix?.emv || response.brcode || response.pixCopiaECola || '').slice(0, 1000) || null,
    qrCodeLocation: String(response.location || response.loc?.location || '').slice(0, 500) || null,
    providerStatus: String(response.estado || response.status || '').slice(0, 80) || null,
  };
}

export function extractSettlementEvent(payload = {}) {
  const pix = Array.isArray(payload.pix) ? payload.pix[0] : payload.pix || null;
  const source = pix || payload;
  const txid = String(source.txid || payload.txid || '').slice(0, 35) || null;
  const providerChargeId = String(source.numeroTituloCliente || source.numero || payload.numeroTituloCliente || '').slice(0, 120) || null;
  const amount = normalizeAmount(source.valor || source.valorRecebido || payload.valorRecebido);
  const settledAt = String(source.horario || source.dataLiquidacao || payload.dataLiquidacao || new Date().toISOString());
  const eventType = amount && amount > 0 ? 'settlement' : String(payload.tipo || payload.evento || 'unknown').toLowerCase();
  return { txid, providerChargeId, amount, settledAt, eventType, endToEndId: String(source.endToEndId || '').slice(0, 80) || null };
}

export function reconciliationScore(transaction, candidate) {
  const amountDifference = roundMoney(Math.abs(Number(transaction.amount || 0) - Number(candidate.amount || candidate.open_amount || 0)));
  const transactionDate = normalizeDate(transaction.transaction_date || transaction.posted_at);
  const candidateDate = normalizeDate(candidate.due_date || candidate.issue_date || candidate.created_date);
  const dateDifferenceDays = transactionDate && candidateDate ? Math.round(Math.abs(Date.parse(transactionDate) - Date.parse(candidateDate)) / 86400000) : 999;
  let score = 0;
  const reasons = [];
  if (amountDifference === 0) { score += 60; reasons.push('exact_amount'); }
  else if (amountDifference <= 0.01) { score += 50; reasons.push('cent_difference'); }
  else if (amountDifference <= Math.max(1, Number(candidate.amount || candidate.open_amount || 0) * 0.01)) { score += 30; reasons.push('amount_within_one_percent'); }
  if (dateDifferenceDays === 0) { score += 25; reasons.push('same_date'); }
  else if (dateDifferenceDays <= 3) { score += 15; reasons.push('date_within_three_days'); }
  else if (dateDifferenceDays <= 10) { score += 5; reasons.push('date_within_ten_days'); }
  const description = String(transaction.description || '').toLowerCase();
  const reference = String(candidate.internal_reference || candidate.receivable_number || candidate.external_id || '').toLowerCase();
  if (reference && description.includes(reference)) { score += 15; reasons.push('reference_in_description'); }
  return { confidencePercent: Math.max(0, Math.min(100, score)), amountDifference, dateDifferenceDays, reasons };
}
