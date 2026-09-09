import { authorizeUserOrInternal } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const DEFAULT_ORIGIN = 'https://lavanderia-5asec-connect-copy-d8ddd176.base44.app';

const ALLOWED_BILLING_TYPES = new Set(['pix', 'credit_card']);

// Gateway intermediário na VPS — administra a chave Asaas e o ambiente.
// A URL já termina em /v3 (não duplicar).
function gatewayBase(): string {
  const url = (Deno.env.get('ASAAS_GATEWAY_URL') || '').trim();
  if (!url) throw new Error('ASAAS_GATEWAY_URL não configurado');
  return url.replace(/\/+$/, '');
}

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId) return true;
  if (['super_admin', 'admin'].includes(user?.role)) return true;
  const allowed = new Set([
    user?.primary_unit_id,
    ...(Array.isArray(user?.allowed_unit_ids) ? user.allowed_unit_ids : []),
  ].filter(Boolean));
  return allowed.has(unitId);
}

// Headers enviados ao gateway — token do gateway, NÃO a chave Asaas.
function gatewayHeaders(gatewayToken: string) {
  return {
    'Content-Type': 'application/json',
    'X-Gateway-Token': gatewayToken,
    'accept': 'application/json',
  };
}

// Dados do pagador exigidos pelo Asaas. Retorna a lista de campos faltantes no cadastro.
function missingPayerFields(customer: any): string[] {
  const missing: string[] = [];
  if (!customer?.tax_id) missing.push('CPF/CNPJ');
  if (!customer?.address) missing.push('endereço (rua)');
  if (!customer?.address_number) missing.push('número');
  if (!customer?.zip_code) missing.push('CEP');
  if (!customer?.neighborhood) missing.push('bairro');
  return missing;
}

// Monta o objeto de pagador no formato do Asaas a partir do cadastro do CRM.
function asaasPayerData(customer: any) {
  const payer: any = { name: customer?.full_name || 'Cliente' };
  if (customer?.tax_id) payer.cpfCnpj = String(customer.tax_id).replace(/\D/g, '');
  if (customer?.email) payer.email = customer.email;
  if (customer?.phones?.length) payer.phone = String(customer.phones[0]).replace(/\D/g, '');
  if (customer?.address) payer.address = customer.address;
  if (customer?.address_number) payer.addressNumber = String(customer.address_number);
  if (customer?.address_complement) payer.complement = customer.address_complement;
  if (customer?.neighborhood) payer.province = customer.neighborhood;
  if (customer?.zip_code) payer.postalCode = String(customer.zip_code).replace(/\D/g, '');
  return payer;
}

// Find or create an Asaas customer via gateway, returns Asaas customer ID
async function ensureAsaasCustomer(gatewayToken: string, customer: any): Promise<string | null> {
  if (!customer) return null;
  const base = gatewayBase();

  // Search by CPF/CNPJ
  if (customer.tax_id) {
    try {
      const resp = await fetch(`${base}/customers?cpfCnpj=${encodeURIComponent(customer.tax_id)}`, {
        headers: gatewayHeaders(gatewayToken),
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json.data && json.data.length > 0) return json.data[0].id;
      }
    } catch (_) { /* ignore */ }
  }

  // Search by email
  if (customer.email) {
    try {
      const resp = await fetch(`${base}/customers?email=${encodeURIComponent(customer.email)}`, {
        headers: gatewayHeaders(gatewayToken),
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json.data && json.data.length > 0) return json.data[0].id;
      }
    } catch (_) { /* ignore */ }
  }

  // Create new customer
  const body: any = asaasPayerData(customer);

  try {
    const resp = await fetch(`${base}/customers`, {
      method: 'POST',
      headers: gatewayHeaders(gatewayToken),
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      const json = await resp.json();
      return json.id;
    }
    // If duplicate, try searching again by CPF/CNPJ
    if (customer.tax_id) {
      try {
        const resp2 = await fetch(`${base}/customers?cpfCnpj=${encodeURIComponent(customer.tax_id)}`, {
          headers: gatewayHeaders(gatewayToken),
        });
        if (resp2.ok) {
          const json2 = await resp2.json();
          if (json2.data && json2.data.length > 0) return json2.data[0].id;
        }
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }

  return null;
}

// Create a direct PIX payment — returns QR code + copy-paste key.
// status: 'ok' | 'error' | 'inconclusive'
// 'inconclusive' = timeout/falha de rede: a cobrança PODE ter sido criada — não repetir.
async function createDirectPixPayment(
  gatewayToken: string,
  asaasCustomerId: string,
  amount: number,
  referenceLabel: string,
  referenceId: string,
  customerName: string
): Promise<{ data: any; error: string | null; status: 'ok' | 'error' | 'inconclusive' }> {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 1);

  const body = {
    customer: asaasCustomerId,
    billingType: 'PIX',
    value: Math.round(amount * 100) / 100,
    dueDate: dueDate.toISOString().split('T')[0],
    externalReference: referenceId,
    description: `Pedido #${referenceLabel} - ${customerName || 'Cliente'}`,
  };

  try {
    const resp = await fetch(`${gatewayBase()}/payments`, {
      method: 'POST',
      headers: gatewayHeaders(gatewayToken),
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch (_) { json = null; }

    if (!resp.ok) {
      const errMsg = json?.errors?.map((e: any) => e.description).join('; ')
        || (json && JSON.stringify(json))
        || `HTTP ${resp.status}: ${text.slice(0, 200)}`;
      console.error('[generate_payment_link] Direct PIX error', resp.status);
      return { data: null, error: errMsg, status: 'error' };
    }
    if (!json) {
      // Resposta não-JSON: inconclusiva — não repetir POST.
      return { data: null, error: 'Resposta não-JSON do gateway', status: 'inconclusive' };
    }
    return { data: json, error: null, status: 'ok' };
  } catch (err) {
    // Timeout / falha de rede: a cobrança pode ter sido criada — NÃO repetir.
    console.error('[generate_payment_link] Direct PIX network error (inconclusive)');
    return { data: null, error: String(err), status: 'inconclusive' };
  }
}

// Create a checkout session (used for credit card or PIX fallback).
// status: 'ok' | 'error' | 'inconclusive'
async function createCheckoutSession(
  gatewayToken: string,
  billingType: string,
  amount: number,
  referenceLabel: string,
  referenceId: string,
  customer: any,
  origin: string
): Promise<{ data: any; error: string | null; status: 'ok' | 'error' | 'inconclusive' }> {
  const asaasBillingType = billingType === 'pix' ? 'PIX' : 'CREDIT_CARD';

  const customerData: any = asaasPayerData(customer);

  const body: any = {
    billingTypes: [asaasBillingType],
    chargeTypes: ['DETACHED'],
    minutesToExpire: 1440,
    externalReference: referenceId,
    callback: {
      successUrl: `${origin}/PaymentSuccess?reference_id=${encodeURIComponent(referenceId)}`,
      cancelUrl: `${origin}/Orders?canceled=true`,
      expiredUrl: `${origin}/Orders?expired=true`,
    },
    items: [{
      name: `Pedido #${referenceLabel}`,
      description: `Pagamento de lavanderia - ${customer?.full_name || 'Cliente'}`,
      quantity: 1,
      value: Math.round(amount * 100) / 100,
    }],
  };
  if (Object.keys(customerData).length > 0) {
    body.customerData = customerData;
  }

  try {
    const resp = await fetch(`${gatewayBase()}/checkouts`, {
      method: 'POST',
      headers: gatewayHeaders(gatewayToken),
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch (_) { json = null; }

    if (!resp.ok) {
      const errMsg = json?.errors?.map((e: any) => e.description).join('; ')
        || (json && JSON.stringify(json))
        || `HTTP ${resp.status}: ${text.slice(0, 200)}`;
      console.error('[generate_payment_link] Checkout error', resp.status);
      return { data: null, error: errMsg, status: 'error' };
    }
    if (!json) {
      return { data: null, error: 'Resposta não-JSON do gateway', status: 'inconclusive' };
    }
    return { data: json, error: null, status: 'ok' };
  } catch (err) {
    console.error('[generate_payment_link] Checkout network error (inconclusive)');
    return { data: null, error: String(err), status: 'inconclusive' };
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();
    // Aceita usuário autenticado OU chamada interna (ex: a Glória gerando a cobrança no WhatsApp).
    const auth = await authorizeUserOrInternal(base44, req, body, { source: 'generate_payment_link' });
    const isInternal = auth.kind === 'internal';
    const user = auth.user;

    const referenceId = body.order_id || body.quote_id;
    if (!referenceId || typeof referenceId !== 'string') {
      return Response.json({ error: 'order_or_quote_required', request_id: requestId }, { status: 400 });
    }

    const billingType = (body.billing_type || 'pix').toString().toLowerCase();
    if (!ALLOWED_BILLING_TYPES.has(billingType)) {
      return Response.json({ error: 'invalid_billing_type', request_id: requestId }, { status: 400 });
    }

    let order: any = null;
    let quote: any = null;
    try { order = await base44.asServiceRole.entities.Order.get(referenceId); } catch (_) { /* maybe quote */ }
    if (!order) {
      try { quote = await base44.asServiceRole.entities.Quote.get(referenceId); } catch (_) { /* not found */ }
    }

    const source = order || quote;
    if (!source) {
      return Response.json({ error: 'order_or_quote_not_found', request_id: requestId }, { status: 404 });
    }

    if (!isInternal && !canAccessUnit(user, source.unit_id)) {
      return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    }

    const amount = Number(order?.total_amount ?? quote?.total);
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: 'invalid_server_amount', request_id: requestId }, { status: 422 });
    }

    const customerId = source.customer_id;
    if (!customerId) {
      return Response.json({ error: 'customer_not_found_on_reference', request_id: requestId }, { status: 422 });
    }

    const gatewayToken = Deno.env.get('ASAAS_GATEWAY_TOKEN');
    if (!gatewayToken) {
      return Response.json({
        error: 'payment_integration_not_configured',
        message: 'Configure ASAAS_GATEWAY_TOKEN antes de gerar links.',
        request_id: requestId,
      }, { status: 503 });
    }
    // Valida presença da URL do gateway (sem expor o valor)
    try { gatewayBase(); } catch (e: any) {
      return Response.json({
        error: 'payment_integration_not_configured',
        message: 'Configure ASAAS_GATEWAY_URL antes de gerar links.',
        request_id: requestId,
      }, { status: 503 });
    }

    const customer = await base44.asServiceRole.entities.Customer.get(customerId);
    // O Asaas recusa a cobrança sem os dados do pagador — avisa antes de chamar o gateway.
    const missing = missingPayerFields(customer);
    if (missing.length) {
      return Response.json({
        error: 'customer_data_incomplete',
        missing_fields: missing,
        message: `Complete o cadastro de ${customer?.full_name || 'cliente'} antes de gerar a cobrança. Faltando: ${missing.join(', ')}.`,
        request_id: requestId,
      }, { status: 422 });
    }

    const origin = DEFAULT_ORIGIN;
    const referenceLabel = order?.ticket_number || referenceId.slice(0, 8).toUpperCase();
    const referenceIdForAsaas = order?.id || quote?.id || referenceId;

    let result: { type: string; asaasId: string; url: string; pixQrCode?: string; pixCopyPasteKey?: string } | null = null;
    let lastError: string | null = null;
    let inconclusive = false;

    // For PIX: try direct payment first (returns QR code + copy-paste key)
    if (billingType === 'pix') {
      const asaasCustomerId = await ensureAsaasCustomer(gatewayToken, customer);
      if (asaasCustomerId) {
        const pixResult = await createDirectPixPayment(gatewayToken, asaasCustomerId, amount, referenceLabel, referenceIdForAsaas, customer?.full_name);
        if (pixResult.status === 'inconclusive') {
          // Cobrança PODE ter sido criada — não repetir, não criar checkout.
          inconclusive = true;
          lastError = pixResult.error;
        } else if (pixResult.data?.pixQrCode) {
          result = {
            type: 'direct_pix',
            asaasId: pixResult.data.id,
            url: pixResult.data.invoiceUrl,
            pixQrCode: pixResult.data.pixQrCode,
            pixCopyPasteKey: pixResult.data.pixCopyPasteKey,
          };
        } else {
          lastError = pixResult.error;
        }
      } else {
        lastError = 'Não foi possível criar/obter cliente no gateway (CPF/CNPJ pode ser necessário).';
      }
    }

    // Fallback: checkout session (apenas se não houve tentativa Pix inconclusiva)
    if (!result && !inconclusive) {
      const checkoutResult = await createCheckoutSession(gatewayToken, billingType, amount, referenceLabel, referenceIdForAsaas, customer, origin);
      if (checkoutResult.status === 'inconclusive') {
        inconclusive = true;
        lastError = checkoutResult.error;
      } else if (checkoutResult.data) {
        result = {
          type: 'checkout',
          asaasId: checkoutResult.data.id,
          url: checkoutResult.data.link || `https://asaas.com/checkoutSession/show?id=${checkoutResult.data.id}`,
        };
      } else {
        lastError = checkoutResult.error || lastError;
      }
    }

    if (inconclusive) {
      // A cobrança pode ter sido criada — sinaliza verificação pendente.
      return Response.json({
        status: 'pending_verification',
        message: 'Requisição ao gateway não retornou resposta conclusiva. A cobrança pode ter sido criada — verifique via webhook/consulta antes de repetir.',
        reference_id: referenceIdForAsaas,
        request_id: requestId,
      }, { status: 202 });
    }

    if (!result) {
      return Response.json({
        error: 'asaas_request_failed',
        asaas_error: lastError,
        message: lastError || 'Falha ao comunicar com o gateway Asaas.',
        request_id: requestId,
      }, { status: 502 });
    }

    // Create internal payment record
    const payment = await base44.asServiceRole.entities.Payment.create({
      customer_id: customerId,
      quote_id: quote?.id,
      order_id: order?.id,
      unit_id: source.unit_id,
      status: 'pending',
      amount,
      payment_method: billingType === 'pix' ? 'pix' : 'credit_card',
      external_reference: result.asaasId,
      idempotency_key: `asaas:${result.asaasId}`,
      notes: result.type === 'direct_pix'
        ? `Pix direto Asaas. request_id=${requestId}`
        : `Checkout Asaas. request_id=${requestId}`,
    });

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'create',
      entity_type: 'payment',
      entity_id: payment.id,
      item_label: referenceLabel,
      customer_name: customer?.full_name,
      amount,
      reason: result.type === 'direct_pix' ? 'pix_payment_created_asaas' : 'payment_link_created_asaas',
      user_email: user?.email || 'gloria-ia@sistema',
      user_name: user?.full_name || user?.display_name || 'Glória (IA)',
      user_role: user?.role || 'internal',
      unit_id: source.unit_id,
      request_id: requestId,
      success: true,
    });

    return Response.json({
      url: result.url,
      pix_qr_code: result.pixQrCode || null,
      pix_copy_paste_key: result.pixCopyPasteKey || null,
      checkout_id: result.type === 'checkout' ? result.asaasId : null,
      payment_id: payment.id,
      billing_type: billingType,
      payment_type: result.type,
      request_id: requestId,
    });
  } catch (error) {
    console.error(`[generate_payment_link:${requestId}]`, error);
    // Falhas de autorização devem informar o motivo real, não virar 500 genérico.
    if ((error as any)?.name === 'SecurityError') {
      return Response.json({
        error: (error as any).code || 'ACCESS_DENIED',
        message: (error as any).message,
        request_id: requestId,
      }, { status: Number((error as any).status) || 403 });
    }
    return Response.json({ error: 'payment_link_failed', request_id: requestId }, { status: 500 });
  }
});