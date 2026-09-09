function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) throw new Error('invalid_fiscal_amount');
  return Math.round(number * 100) / 100;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function validateFiscalProfile(profile) {
  const missing = [];
  if (!profile?.unit_id) missing.push('unit_id');
  if (!profile?.legal_name) missing.push('legal_name');
  if (![11, 14].includes(digits(profile?.tax_id).length)) missing.push('tax_id');
  if (!profile?.municipality_code) missing.push('municipality_code');
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
  if (!profileCheck.valid) {
    const error = new Error('fiscal_profile_incomplete');
    error.details = profileCheck;
    throw error;
  }
  if (!customer) throw new Error('fiscal_recipient_required');

  const recipient = {
    name: customer.full_name,
    legal_name: customer.legal_name || customer.full_name,
    tax_id: digits(customer.tax_id || customer.cpf_cnpj),
    municipal_registration: customer.municipal_registration,
    email: customer.billing_email || customer.email,
    phone: (customer.phones || [])[0] || customer.phone,
    address: customer.address?.street || customer.address,
    address_number: customer.address?.number || customer.address_number,
    address_complement: customer.address?.complement || customer.address_complement,
    district: customer.address?.district || customer.neighborhood || customer.district,
    city: customer.address?.city || customer.city,
    state: customer.address?.state || customer.state,
    zip_code: (customer.address?.zip_code || customer.zip_code || '').replace(/\D/g, ''),
  };
  const recipientCheck = validateFiscalRecipient(recipient);
  if (!recipientCheck.valid) {
    const error = new Error('fiscal_recipient_incomplete');
    error.details = recipientCheck;
    throw error;
  }

  const items = orders.flatMap((order) => {
    const orderItems = Array.isArray(order.items) && order.items.length > 0 ? order.items : [{ garment_type: `Serviços do pedido ${order.ticket_number || order.id}`, total_amount: order.total_amount }];
    return orderItems.map((item) => ({
      order_id: order.id,
      ticket_number: order.ticket_number,
      description: (item.services || []).length > 0
        ? `${item.garment_type || item.name}: ${(item.services || []).map((service) => service.name).join(', ')}`
        : item.garment_type || item.name || profile.service_description,
      quantity: Math.max(1, Number(item.qty || item.quantity || 1)),
      unit_amount: money(item.unit_price || item.total_amount || item.subtotal || 0),
      total_amount: money(item.total_amount || item.subtotal || item.unit_price || 0),
      service_code: profile.service_code,
    }));
  });
  const subtotal = statement ? money(statement.subtotal || statement.total_amount) : money(orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0));
  const discount = statement ? money(statement.discount_amount || 0) : money(orders.reduce((sum, order) => sum + Number(order.discount || 0), 0));
  const total = statement ? money(statement.total_amount) : money(Math.max(0, subtotal - discount));
  const deduction = 0;
  const taxable = money(Math.max(0, total - deduction));
  const issRate = money(profile.iss_rate || 0);
  const issAmount = money(taxable * issRate / 100);

  return {
    document_type: 'rps',
    status: 'draft',
    environment: profile.environment || 'disabled',
    provider: profile.provider || 'focusnfe',
    competence_date: competenceDate,
    service_city_code: profile.municipality_code,
    service_code: profile.service_code,
    service_description: profile.service_description,
    taxation_code: profile.municipal_tax_code,
    subtotal,
    discount_amount: discount,
    deduction_amount: deduction,
    taxable_amount: taxable,
    iss_rate: issRate,
    iss_amount: issAmount,
    iss_withheld: profile.iss_withheld === true,
    total_amount: total,
    recipient,
    items,
    metadata: {
      target_standard: profile.provider === 'focusnfe' ? 'focusnfe' : 'national_nfse',
      municipality_name: profile.municipality_name || 'Porto Alegre',
      municipality_code: profile.municipality_code,
      transmission_enabled: profile.provider === 'focusnfe',
    },
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
  return {
    structurally_ready: errors.length === 0,
    transmission_ready: isFocusNfe && errors.length === 0,
    transmission_block_reason: isFocusNfe ? null : 'fiscal_adapter_not_activated',
    errors,
    recommended_provider: 'focusnfe',
  };
}

export function buildFocusNfePayload({ document, profile, ref }) {
  const prestadorTaxId = digits(profile.tax_id);
  const prestador = {
    cnpj: prestadorTaxId.length === 14 ? prestadorTaxId : undefined,
    cpf: prestadorTaxId.length === 11 ? prestadorTaxId : undefined,
    inscricao_municipal: profile.municipal_registration,
    codigo_municipio: profile.municipality_code,
  };

  const recipTaxId = digits(document.recipient?.tax_id);
  const recipientUf = String(document.recipient?.state || profile.state || '').trim().toUpperCase();
  const recipientCep = (document.recipient?.zip_code || '').replace(/\D/g, '');
  const endereco = {
    logradouro: document.recipient?.address || undefined,
    numero: document.recipient?.address_number || undefined,
    complemento: document.recipient?.address_complement || undefined,
    bairro: document.recipient?.district || undefined,
    codigo_municipio: profile.municipality_code,
    // O schema ABRASF exige Uf antes de Cep; sem UF o CEP nao pode ser enviado.
    uf: recipientUf || undefined,
    cep: recipientUf && recipientCep ? recipientCep : undefined,
  };
  const tomador = {
    cpf: recipTaxId.length === 11 ? recipTaxId : undefined,
    cnpj: recipTaxId.length === 14 ? recipTaxId : undefined,
    razao_social: document.recipient?.legal_name || document.recipient?.name,
    email: document.recipient?.email,
    // O endereco somente pode ser enviado com UF (exigencia do schema ABRASF).
    endereco: recipientUf ? endereco : undefined,
  };

  const discriminacao = (document.items || []).map((item) => item.description).join(' | ') || document.service_description;

  const servico = {
    aliquota: Number(profile.iss_rate || 0) / 100,
    base_calculo: document.taxable_amount,
    discriminacao,
    iss_retido: document.iss_withheld ? '1' : '2',
    item_lista_servico: profile.service_code,
    valor_iss: document.iss_amount,
    valor_liquido: document.total_amount,
    valor_servicos: document.subtotal,
    desconto_incondicionado: document.discount_amount || 0,
    desconto_condicionado: 0,
  };

  return {
    ref,
    data_emissao: new Date().toISOString(),
    natureza_operacao: '1',
    optante_simples_nacional: false,
    incentivador_cultural: false,
    prestador,
    tomador,
    servico,
  };
}

export function getFocusNfeBaseUrl() {
  const env = (typeof process !== 'undefined' && process.env?.FOCUSNFE_ENVIRONMENT) || 'homologation';
  return env === 'production'
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br';
}