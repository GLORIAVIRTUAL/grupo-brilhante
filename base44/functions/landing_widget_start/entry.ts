import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { securityErrorResponse } from '../../shared/functionSecurity.js';
import { canonicalPhone, isPlaceholderName } from '../../shared/customerPhone.js';
import { CUSTOMER_SOURCES, ensureCustomerSourceCard } from '../../shared/customerSource.js';

// Landing pública da Unidade Teste: captura nome + telefone do lead, cria
// cliente/conversa/mensagem e dispara a Glória (ai_pending). A conversa entra
// no chat do CRM e a Glória responde pelo WhatsApp do lead.

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    if (body.honeypot) return Response.json({ status: 'spam' });

    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const text = String(body.message || '').trim();
    let unitId = body.unit_id || null;

    if (!name || name.length < 2) return Response.json({ error: 'Informe seu nome.' }, { status: 422 });
    const canon = canonicalPhone(phone);
    if (!canon) return Response.json({ error: 'Telefone inválido. Use DDD + número.' }, { status: 422 });

    // Resolve a unidade da landing quando não vier explícita (Unidade Teste).
    if (!unitId) {
      const units = await base44.asServiceRole.entities.Unit.list('name', 50);
      const active = units.find((u) => u.status === 'active') || units[0];
      unitId = active?.id || null;
    }

    // Find or create customer by canonical phone.
    let customer = null;
    const recent = await base44.asServiceRole.entities.Customer.list('-created_date', 500);
    customer = recent.find((c) => (c.phones || []).some((p) => canonicalPhone(p) === canon));

    if (!customer) {
      customer = await base44.asServiceRole.entities.Customer.create({
        full_name: name,
        phones: [canon],
        opt_in_whatsapp: false,
        whatsapp_consent_status: 'unknown',
        last_inbound_at: new Date().toISOString(),
        status: 'active',
        unit_id: unitId || undefined,
        preferred_unit_name: 'Unidade Teste',
      });
    } else {
      const isPlaceholder = isPlaceholderName(customer.full_name);
      const update = { last_inbound_at: new Date().toISOString() };
      if (isPlaceholder) update.full_name = name;
      const alreadyHas = (customer.phones || []).some((p) => canonicalPhone(p) === canon);
      if (!alreadyHas) update.phones = [...(customer.phones || []).filter((p) => p && !p.includes('@')), canon];
      if (unitId && !customer.unit_id) update.unit_id = unitId;
      await base44.asServiceRole.entities.Customer.update(customer.id, update);
    }

    await ensureCustomerSourceCard(base44, customer, unitId, CUSTOMER_SOURCES.SITE_QUOTE);

    // Find or create conversation (WHATSAPP channel so the orchestrator/zapi_sender flow works).
    let conversation = await base44.asServiceRole.entities.Conversation
      .filter({ customer_id: customer.id, channel: 'WHATSAPP' })
      .then((res) => res
        .filter((c) => (c.metadata || {}).source !== 'zapi_moinhos')
        .sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())[0]);

    if (!conversation) {
      conversation = await base44.asServiceRole.entities.Conversation.create({
        customer_id: customer.id,
        channel: 'WHATSAPP',
        status: 'OPEN',
        last_message_at: new Date().toISOString(),
        metadata: {
          source: 'web_widget',
          web_widget: true,
          unit_id: unitId || undefined,
          awaiting_unit_selection: !unitId,
          unit_confirmed: !!unitId,
        },
      });
    } else if (conversation.status === 'CLOSED') {
      await base44.asServiceRole.entities.Conversation.update(conversation.id, {
        status: 'OPEN',
        last_message_at: new Date().toISOString(),
        metadata: { ...(conversation.metadata || {}), web_widget: true, unit_id: unitId || conversation.metadata?.unit_id },
      });
      conversation.status = 'OPEN';
    }

    const initialText = text || `Olá! Sou ${name} e gostaria de um orçamento de roupas.`;
    const message = await base44.asServiceRole.entities.Message.create({
      conversation_id: conversation.id,
      direction: 'IN',
      type: 'TEXT',
      text: initialText,
      ai_pending: true,
      ai_source: 'web_widget',
      raw_payload: { source: 'web_widget', from_widget: true, name, phone: canon },
    });

    await base44.asServiceRole.entities.Conversation.update(conversation.id, {
      last_message_id: message.id,
      last_message_at: new Date().toISOString(),
    });

    return Response.json({ conversation_id: conversation.id, customer_id: customer.id, message_id: message.id });
  } catch (error) {
    console.error('landing_widget_start error:', error?.message || error);
    return securityErrorResponse(error);
  }
});