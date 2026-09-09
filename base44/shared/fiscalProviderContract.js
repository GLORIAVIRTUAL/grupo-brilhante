function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) throw new Error('invalid_fiscal_amount');
  return Math.round(number * 100) / 100;
}

function digits(value) { return String(value || '').replace(/\D/g, ''); }
function text(value, max = 300) { return String(value || '').trim().slice(0, max); }
function envFlag(value) { return String(value || '').trim().toLowerCase() === 'true'; }

export function validateFiscalProfile(profile) {
  const missing = [];
  if (!profile?.legal_entity_id && !profile?.unit_id) missing.push('legal_entity_id');
  if (!profile?.unit_id && !Array.isArray(profile?.unit_ids)) missing.push('unit_id');
  if (!profile?.legal_name) missing.push('legal_name');
  if (![11, 14].includes(digits(profile?.tax_id).length)) missing.push('tax_id');
  if (!profile?.municipality_code || !/^\d{7}$/.test(digits(profile?.municipality_code))) missing.push('municipality_code');
  if (!profile?.municipal_registration) missing.push('municipal_registration');
  if (!profile?.service_code) missing.push('service_code');
  if (!profile?.service_description) missing.push('service_description');
  if (!profile?.rps_series) missing.push('rps_series');
  if (Number(profile?.next_rps_number || 0) < 1) missing.push('next_rps_number');
  return { valid: missing.length === 0, missing };
}

export function validateFiscalRecipient(recipient) {
  const missing = [];
  if (!recipient?.name && !recipient?.legal_name) missing.push('name');
  const taxId = digits(recipient?.tax_id);
  if (taxId && ![11, 14].includes(taxId.length)) missing.push('tax_id');
  if (!recipient?.email) missing.push('email');
  return { valid: missing.length === 0, missing };
}

export function buildFiscalDraft({ profile, customer, orders = [], statement, competenceDate }) {
  const profileCheck = validateFiscalProfile(profile);
  if (!profileCheck.valid) { const error = new Error('fiscal_profile_incomplete'); error.details = profileCheck; throw error; }
  if (!customer) throw new Error('fiscal_recipient_required');
  const customerAddress = customer.address && typeof customer.address === 'object' ? customer.address : {};
  const recipient = {
    name: customer.full_name || customer.legal_name,
    legal_name: customer.legal_name || customer.full_name,
    tax_id: digits(customer.tax_id || customer.cpf_cnpj),
    municipal_registration: customer.municipal_registration,
    email: customer.billing_email || customer.email,
    phone: digits((customer.phones || [])[0] || customer.phone),
    address: customerAddress.street || (typeof customer.address === 'string' ? customer.address : undefined),
    address_number: customerAddress.number || customer.address_number,
    address_complement: customerAddress.complement || customer.address_complement,
    district: customerAddress.district || customer.neighborhood || customer.district,
    city: customerAddress.city || customer.city,
    municipality_code: customerAddress.municipality_code || customer.municipality_code,
    state: customerAddress.state || customer.state,
    zip_code: digits(customerAddress.zip_code || customer.zip_code),
  };
  const recipientCheck = validateFiscalRecipient(recipient);
  if (!recipientCheck.valid) { const error = new Error('fiscal_recipient_incomplete'); error.details = recipientCheck; throw error; }
  const items = orders.flatMap((order) => {
    const orderItems = Array.isArray(order.items) && order.items.length ? order.items : [{ garment_type: `Serviços do pedido ${order.ticket_number || order.id}`, total_amount: order.total_amount }];
    return orderItems.map((item) => ({
      order_id: order.id,
      ticket_number: order.ticket_number,
      description: (item.services || []).length ? `${item.garment_type || item.name}: ${(item.services || []).map((service) => service.name).join(', ')}` : item.garment_type || item.name || profile.service_description,
      quantity: Math.max(1, Number(item.qty || item.quantity || 1)),
      unit_amount: money(item.unit_price || item.total_amount || item.subtotal || 0),
      total_amount: money(item.total_amount || item.subtotal || item.unit_price || 0),
      service_code: profile.service_code,
    }));
  });
  const subtotal = statement ? money(statement.subtotal || statement.total_amount) : money(orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0));
  const discount = statement ? money(statement.discount_amount || 0) : money(orders.reduce((sum, order) => sum + Number(order.discount || 0), 0));
  const total = statement ? money(statement.total_amount) : money(Math.max(0, subtotal - discount));
  const deduction = money(statement?.deduction_amount || 0);
  const taxable = money(Math.max(0, total - deduction));
  const issRate = money(profile.iss_rate || 0);
  return {
    document_type: 'rps', status: 'draft', environment: profile.environment || 'disabled', provider: profile.provider || 'focusnfe', competence_date: competenceDate,
    service_city_code: profile.municipality_code, service_code: profile.service_code, service_description: profile.service_description, taxation_code: profile.municipal_tax_code,
    subtotal, discount_amount: discount, deduction_amount: deduction, taxable_amount: taxable, iss_rate: issRate, iss_amount: money(taxable * issRate / 100), iss_withheld: profile.iss_withheld === true, total_amount: total,
    recipient, items,
    metadata: { target_standard: profile.provider === 'focusnfe' ? 'focusnfe' : 'national_nfse', municipality_name: profile.municipality_name, municipality_code: profile.municipality_code, transmission_enabled: false },
  };
}

export function getFiscalReadiness(profile, document) {
  const profileCheck = validateFiscalProfile(profile);
  const recipientCheck = validateFiscalRecipient(document?.recipient || {});
  const errors = [];
  if (!profileCheck.valid) errors.push(...profileCheck.missing.map((field) => `profile.${field}`));
  if (!recipientCheck.valid) errors.push(...recipientCheck.missing.map((field) => `recipient.${field}`));
  if (Number(document?.total_amount || 0) <= 0) errors.push('document.total_amount');
  if (!Array.isArray(document?.order_ids) || document.order_ids.length === 0) errors.push('document.order_ids');
  const isFocusNfe = profile?.provider === 'focusnfe';
  return { structurally_ready: errors.length === 0, transmission_ready: isFocusNfe && errors.length === 0, transmission_block_reason: isFocusNfe ? null : 'fiscal_adapter_not_activated', errors, recommended_provider: 'focusnfe' };
}

export function buildFocusNfePayload({ document, profile }) {
  const providerTaxId = digits(profile.tax_id);
  const recipientTaxId = digits(document.recipient?.tax_id);
  const recipientUf = text(document.recipient?.state || profile.state, 2).toUpperCase();
  const recipientCep = digits(document.recipient?.zip_code);
  const municipalityCode = digits(document.recipient?.municipality_code || profile.municipality_code);
  const address = {
    logradouro: document.recipient?.address || undefined,
    numero: document.recipient?.address_number || undefined,
    complemento: document.recipient?.address_complement || undefined,
    bairro: document.recipient?.district || undefined,
    codigo_municipio: municipalityCode || undefined,
    uf: recipientUf || undefined,
    cep: recipientUf && recipientCep ? recipientCep : undefined,
  };
  const payload = {
    data_emissao: new Date().toISOString(),
    natureza_operacao: profile.operation_nature || '1',
    regime_especial_tributacao: profile.special_tax_regime || undefined,
    optante_simples_nacional: profile.simple_national_opt_in === true,
    incentivador_cultural: profile.cultural_incentive === true,
    prestador: { cnpj: providerTaxId.length === 14 ? providerTaxId : undefined, cpf: providerTaxId.length === 11 ? providerTaxId : undefined, inscricao_municipal: profile.municipal_registration, codigo_municipio: digits(profile.municipality_code) },
    tomador: {
      cpf: recipientTaxId.length === 11 ? recipientTaxId : undefined,
      cnpj: recipientTaxId.length === 14 ? recipientTaxId : undefined,
      inscricao_municipal: document.recipient?.municipal_registration || undefined,
      razao_social: document.recipient?.legal_name || document.recipient?.name,
      telefone: digits(document.recipient?.phone).slice(-11) || undefined,
      email: document.recipient?.email,
      endereco: recipientUf ? address : undefined,
    },
    servico: {
      valor_servicos: document.subtotal,
      valor_deducoes: document.deduction_amount || 0,
      valor_iss: document.iss_amount,
      valor_liquido: document.total_amount,
      base_calculo: document.taxable_amount,
      aliquota: Number(profile.iss_rate || 0) / 100,
      iss_retido: document.iss_withheld === true,
      item_lista_servico: profile.service_code,
      codigo_cnae: profile.cnae_code || undefined,
      codigo_tributario_municipio: profile.municipal_tax_code || undefined,
      discriminacao: (document.items || []).map((item) => item.description).join(' | ') || document.service_description,
      codigo_municipio: digits(document.service_city_code || profile.municipality_code),
      desconto_incondicionado: document.discount_amount || 0,
      desconto_condicionado: 0,
      codigo_nbs: profile.nbs_code || undefined,
      codigo_indicador_operacao: profile.operation_indicator_code || undefined,
      ibs_cbs_classificacao_tributaria: profile.ibs_cbs_tax_classification || undefined,
    },
  };
  return JSON.parse(JSON.stringify(payload));
}

export function buildFocusReference({ legalEntityId, taxId, series, number, documentId }) {
  const seed = `GB${digits(taxId).slice(-8)}${text(legalEntityId, 12)}${text(series, 8)}${Number(number || 0)}${text(documentId, 16)}`;
  return seed.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 60);
}

export function focusStatusToDocumentStatus(status) {
  const normalized = text(status, 80).toLowerCase();
  if (['autorizado', 'autorizada'].includes(normalized)) return 'authorized';
  if (['cancelado', 'cancelada'].includes(normalized)) return 'cancelled';
  if (['erro_autorizacao', 'rejeitado', 'rejeitada', 'erro_cancelamento'].includes(normalized)) return 'rejected';
  if (['processando_autorizacao', 'processando_cancelamento', 'em_processamento'].includes(normalized)) return 'processing';
  return 'processing';
}

export function sanitizeFocusNfeResponse(data = {}) {
  const firstError = Array.isArray(data.erros) ? data.erros[0] : null;
  return {
    status: text(data.status, 80) || null,
    reference: text(data.ref, 100) || null,
    rpsNumber: text(data.numero_rps, 40) || null,
    rpsSeries: text(data.serie_rps, 40) || null,
    nfseNumber: text(data.numero || data.numero_nfse, 80) || null,
    verificationCode: text(data.codigo_verificacao, 100) || null,
    issuedAt: text(data.data_emissao, 80) || null,
    documentUrl: text(data.url, 1000) || null,
    xmlPath: text(data.caminho_xml_nota_fiscal, 1000) || null,
    cancellationXmlPath: text(data.caminho_xml_cancelamento, 1000) || null,
    pdfUrl: text(data.url_danfse, 1000) || null,
    errorCode: text(firstError?.codigo || data.codigo, 100) || null,
    errorMessage: text(firstError?.mensagem || data.mensagem, 500) || null,
    correction: text(firstError?.correcao || data.correcao, 500) || null,
  };
}

export function fiscalRuntimeConfig(getEnv, profile = {}) {
  const environment = ['homologation', 'production'].includes(profile.environment) ? profile.environment : 'disabled';
  return {
    environment,
    baseUrl: environment === 'production' ? 'https://api.focusnfe.com.br' : environment === 'homologation' ? 'https://homologacao.focusnfe.com.br' : '',
    token: getEnv(environment === 'production' ? 'FOCUSNFE_PRODUCTION_TOKEN' : 'FOCUSNFE_HOMOLOGATION_TOKEN') || getEnv('FOCUSNFE_TOKEN'),
    externalRequestsEnabled: envFlag(getEnv('FOCUSNFE_EXTERNAL_REQUESTS_ENABLED')) && profile.external_requests_enabled === true,
    productionEnabled: envFlag(getEnv('FOCUSNFE_PRODUCTION_ENABLED')) && profile.production_enabled === true,
  };
}

export function assertExternalFiscalAllowed(config) {
  if (!config.externalRequestsEnabled) throw new Error('fiscal_external_requests_disabled');
  if (!['homologation', 'production'].includes(config.environment)) throw new Error('fiscal_environment_disabled');
  if (config.environment === 'production' && !config.productionEnabled) throw new Error('fiscal_production_disabled');
  if (!config.token) throw new Error('focusnfe_token_not_configured');
  return true;
}

export function getFocusNfeBaseUrl(environment = 'homologation') {
  return environment === 'production' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
}
