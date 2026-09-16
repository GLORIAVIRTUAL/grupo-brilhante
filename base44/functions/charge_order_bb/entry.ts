import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { enforceAuthenticatedUser, securityErrorResponse } from '../../shared/functionSecurity.js';
import { assertExternalBankingAllowed, bankingRuntimeConfig, normalizePayer, sanitizedBankResponse } from '../../shared/bankingProviderContract.js';
import { callProvider } from '../../shared/bbProviderTransport.js';

const CHARGE_TYPES = new Set(['boleto', 'pix_immediate']);

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function pixTxid() {
  return `GB${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`.slice(0, 34);
}

function payerAddress(customer) {
  const street = [customer?.address, customer?.address_number].filter(Boolean).join(', ');
  return {
    street,
    postal_code: String(customer?.zip_code || '').replace(/\D/g, ''),
    city: customer?.city || '',
    neighborhood: customer?.neighborhood || '',
    state: customer?.state || '',
    phone: String((customer?.phones || [])[0] || '').replace(/\D/g, ''),
  };
}

function missingPayerFields(customer) {
  const missing = [];
  if (!customer?.tax_id) missing.push('CPF/CNPJ');
  if (!customer?.address) missing.push('endereço');
  if (!customer?.address_number) missing.push('número');
  if (!customer?.neighborhood) missing.push('bairro');
  if (!customer?.zip_code) missing.push('CEP');
  if (!customer?.city) missing.push('cidade');
  if (!customer?.state) missing.push('UF');
  return missing;
}

async function ensureBusinessParty(db, customer, legalEntityId, unitId, userId) {
  if (customer.business_party_id) {
    const linked = await db.BusinessParty.get(customer.business_party_id).catch(() => null);
    if (linked) return linked;
  }
  const byCustomer = await db.BusinessParty.filter({ customer_id: customer.id }, '-created_date', 1).catch(() => []);
  if (byCustomer.length) return byCustomer[0];

  const taxId = String(customer.tax_id || '').replace(/\D/g, '');
  const byTaxId = await db.BusinessParty.filter({ tax_id: taxId }, '-created_date', 1).catch(() => []);
  if (byTaxId.length) {
    await db.Customer.update(customer.id, { business_party_id: byTaxId[0].id }).catch(() => null);
    return byTaxId[0];
  }

  const party = await db.BusinessParty.create({
    party_type: taxId.length === 14 ? 'company' : 'person',
    legal_name: customer.legal_name || customer.full_name,
    trade_name: customer.full_name,
    tax_id: taxId,
    tax_id_type: taxId.length === 14 ? 'cnpj' : 'cpf',
    status: 'active',
    segment: taxId.length === 14 ? 'other' : 'individual',
    default_legal_entity_id: legalEntityId,
    default_unit_id: unitId,
    customer_id: customer.id,
    source_system: 'native',
    created_by_user_id: userId,
    notes: 'Criado automaticamente ao emitir cobrança no Banco do Brasil.',
  });
  await db.Customer.update(customer.id, { business_party_id: party.id }).catch(() => null);
  return party;
}

export default async function (req) {
  const requestId = crypto.randomUUID();
  let createdCharge = null;
  let db = null;

  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });

    const base44 = createClientFromRequest(req);
    db = base44.asServiceRole.entities;
    const body = await req.json();

    const orderId = String(body.order_id || '').trim();
    const chargeType = String(body.charge_type || 'pix_immediate').trim();
    if (!orderId) return Response.json({ error: 'order_id_required', request_id: requestId }, { status: 400 });
    if (!CHARGE_TYPES.has(chargeType)) return Response.json({ error: 'invalid_charge_type', request_id: requestId }, { status: 400 });

    const order = await db.Order.get(orderId).catch(() => null);
    if (!order) return Response.json({ error: 'order_not_found', request_id: requestId }, { status: 404 });

    const unit = order.unit_id ? await db.Unit.get(order.unit_id).catch(() => null) : null;
    const legalEntityId = order.legal_entity_id || unit?.legal_entity_id || null;
    if (!legalEntityId) return Response.json({ error: 'legal_entity_not_configured', request_id: requestId }, { status: 409 });

    let user = null;
    try { user = await base44.auth.me(); } catch { user = null; }
    const principal = await enforceAuthenticatedUser(base44, req, user, {
      permission: 'banking.manage',
      legalEntityId,
      unitId: order.unit_id || null,
      source: 'charge_order_bb',
    });

    const amount = Number(order.total_amount);
    if (!Number.isFinite(amount) || amount <= 0) return Response.json({ error: 'invalid_order_amount', request_id: requestId }, { status: 422 });

    const runtime = bankingRuntimeConfig((name) => Deno.env.get(name) || '');
    assertExternalBankingAllowed(runtime);

    const accounts = await db.BankAccount.filter({ legal_entity_id: legalEntityId, status: 'active' }, '-created_date', 5).catch(() => []);
    if (!accounts.length) {
      return Response.json({
        error: 'bank_account_not_active',
        message: 'Nenhuma conta bancária ativa nesta empresa. Ative a conta do Banco do Brasil antes de emitir cobrança.',
        request_id: requestId,
      }, { status: 409 });
    }
    const account = accounts[0];

    const customer = await db.Customer.get(order.customer_id).catch(() => null);
    if (!customer) return Response.json({ error: 'customer_not_found', request_id: requestId }, { status: 404 });
    const missing = missingPayerFields(customer);
    if (missing.length) {
      return Response.json({
        error: 'customer_data_incomplete',
        missing_fields: missing,
        message: `Complete o cadastro de ${customer.full_name || 'cliente'} antes de emitir a cobrança. Faltando: ${missing.join(', ')}.`,
        request_id: requestId,
      }, { status: 422 });
    }

    const payer = normalizePayer({
      name: customer.legal_name || customer.full_name,
      tax_id: customer.tax_id,
      email: customer.billing_email || customer.email,
      address: payerAddress(customer),
    });

    const idempotencyKey = `order:${order.id}:${chargeType}`;
    const existing = await db.BankCharge.filter({ legal_entity_id: legalEntityId, idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
    if (existing.length && ['active', 'partially_paid', 'paid'].includes(existing[0].status)) {
      const previous = existing[0];
      return Response.json({
        charge_id: previous.id,
        charge_type: previous.charge_type,
        digitable_line: previous.digitable_line,
        barcode: previous.barcode,
        qr_code_text: previous.qr_code_text,
        amount: previous.amount,
        due_date: previous.due_date,
        idempotent: true,
        request_id: requestId,
      });
    }

    const party = await ensureBusinessParty(db, customer, legalEntityId, order.unit_id, principal.user.id);
    const now = new Date();
    const dueDate = new Date(now.getTime() + (chargeType === 'boleto' ? 3 : 1) * 86400000);
    const internalReference = `GB${order.id.slice(-10).toUpperCase()}`;

    createdCharge = existing.length
      ? await db.BankCharge.update(existing[0].id, { status: 'transmitting', safe_error_code: null, last_provider_request_at: now.toISOString() })
      : await db.BankCharge.create({
        legal_entity_id: legalEntityId,
        unit_id: order.unit_id,
        bank_account_id: account.id,
        business_party_id: party.id,
        charge_type: chargeType,
        provider: 'banco_do_brasil',
        provider_environment: runtime.environment,
        internal_reference: internalReference,
        txid: chargeType === 'boleto' ? null : pixTxid(),
        payer_name: payer.name,
        payer_tax_id: payer.taxId,
        payer_email: payer.email,
        payer_address: payer.address,
        amount,
        currency: 'BRL',
        issue_date: isoDate(now),
        due_date: isoDate(dueDate),
        status: 'transmitting',
        settled_amount: 0,
        idempotency_key: idempotencyKey,
        created_by_user_id: principal.user.id,
        last_provider_request_at: now.toISOString(),
        metadata: {
          order_id: order.id,
          description: `Pedido ${order.ticket_number || order.id.slice(-8)}`,
          with_pix: chargeType === 'boleto',
          modality_code: 1,
          receipt_limit_days: 0,
          expiration_seconds: 86400,
        },
      });

    const response = await callProvider('create_charge', createdCharge, runtime, (name) => Deno.env.get(name) || '', idempotencyKey);
    const safe = sanitizedBankResponse(response);

    const charge = await db.BankCharge.update(createdCharge.id, {
      status: 'active',
      provider_charge_id: safe.providerChargeId || createdCharge.provider_charge_id,
      txid: safe.txid || createdCharge.txid,
      our_number: safe.ourNumber || createdCharge.our_number,
      digitable_line: safe.digitableLine || createdCharge.digitable_line,
      barcode: safe.barcode || createdCharge.barcode,
      qr_code_text: safe.qrCodeText || createdCharge.qr_code_text,
      qr_code_location: safe.qrCodeLocation || createdCharge.qr_code_location,
      last_provider_status: safe.providerStatus,
      last_provider_response_at: new Date().toISOString(),
      safe_error_code: null,
    });

    const payment = await db.Payment.create({
      customer_id: order.customer_id,
      order_id: order.id,
      legal_entity_id: legalEntityId,
      unit_id: order.unit_id,
      status: 'pending',
      amount,
      payment_method: chargeType === 'boleto' ? 'boleto' : 'pix',
      external_reference: charge.provider_charge_id || charge.txid || charge.internal_reference,
      idempotency_key: `bb:${charge.id}`,
      notes: `Cobrança Banco do Brasil (${chargeType}). request_id=${requestId}`,
    }).catch(() => null);
    if (payment) await db.BankCharge.update(charge.id, { payment_id: payment.id }).catch(() => null);

    await db.AuditLog.create({
      action: 'create',
      entity_type: 'bank_charge',
      entity_id: charge.id,
      item_label: order.ticket_number || charge.internal_reference,
      customer_name: customer.full_name,
      amount,
      reason: 'bb_charge_created_from_order',
      user_email: principal.user.email,
      user_name: principal.user.full_name || principal.user.display_name,
      user_role: principal.role,
      legal_entity_id: legalEntityId,
      unit_id: order.unit_id,
      request_id: requestId,
      success: true,
    }).catch(() => null);

    return Response.json({
      charge_id: charge.id,
      charge_type: chargeType,
      digitable_line: charge.digitable_line,
      barcode: charge.barcode,
      qr_code_text: charge.qr_code_text,
      amount,
      due_date: charge.due_date,
      environment: runtime.environment,
      request_id: requestId,
    });
  } catch (error) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const code = String(error?.message || 'bb_charge_failed').slice(0, 120);
    console.error(`[charge_order_bb:${requestId}] ${code}`, error?.safeResponse || '');
    if (db && createdCharge?.id) {
      await db.BankCharge.update(createdCharge.id, { status: 'failed', safe_error_code: code }).catch(() => null);
    }
    const unavailable = ['banking_external_requests_disabled', 'banking_production_disabled', 'banking_credentials_incomplete', 'banking_endpoint_not_configured', 'banking_billing_contract_incomplete'].includes(code);
    return Response.json({
      error: code,
      provider_status: error?.safeResponse?.status || null,
      provider_code: error?.safeResponse?.provider_code || null,
      request_id: requestId,
    }, { status: unavailable ? 503 : 502 });
  }
}