import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { SecurityError, securityErrorResponse } from '../../shared/functionSecurity.js';
import { canonicalPhone, isPlaceholderName } from '../../shared/customerPhone.js';
import { CUSTOMER_SOURCES, ensureCustomerSourceCard } from '../../shared/customerSource.js';
import { createWidgetSession, requireWidgetOrigin } from '../../shared/publicWidgetSecurity.js';

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    requireWidgetOrigin(req);
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    if (body.honeypot) return Response.json({ status: 'accepted', request_id: requestId });

    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const text = String(body.message || '').trim();
    const unitId = String(body.unit_id || Deno.env.get('PUBLIC_WIDGET_DEFAULT_UNIT_ID') || '').trim();
    if (name.length < 2 || name.length > 120) throw new SecurityError('Informe um nome válido.', 422, 'INVALID_NAME');
    if (text.length > 4096) throw new SecurityError('Mensagem muito longa.', 422, 'INVALID_MESSAGE');
    const canon = canonicalPhone(phone);
    if (!canon) throw new SecurityError('Telefone inválido. Use DDD + número.', 422, 'INVALID_PHONE');
    if (!unitId) throw new SecurityError('Atendimento público indisponível: unidade não configurada.', 503, 'WIDGET_UNIT_NOT_CONFIGURED');

    const unit = await base44.asServiceRole.entities.Unit.get(unitId).catch(() => null);
    if (!unit || unit.status !== 'active') throw new SecurityError('Atendimento público indisponível para esta unidade.', 503, 'WIDGET_UNIT_UNAVAILABLE');
    if (!unit.legal_entity_id) throw new SecurityError('Atendimento público aguardando configuração empresarial.', 503, 'WIDGET_COMPANY_NOT_CONFIGURED');

    const matches = await base44.asServiceRole.entities.Customer.filter({
      canonical_phone: canon,
      legal_entity_id: unit.legal_entity_id,
    }, '-created_date', 5);
    let customer = matches[0] || null;
    const now = new Date().toISOString();
    if (!customer) {
      customer = await base44.asServiceRole.entities.Customer.create({
        full_name: name,
        phones: [canon],
        canonical_phone: canon,
        legal_entity_id: unit.legal_entity_id,
        opt_in_whatsapp: false,
        whatsapp_consent_status: 'unknown',
        last_inbound_at: now,
        status: 'active',
        unit_id: unit.id,
        preferred_unit_name: unit.name,
      });
    } else {
      const patch: any = { last_inbound_at: now, canonical_phone: canon };
      if (isPlaceholderName(customer.full_name)) patch.full_name = name;
      if (!(customer.phones || []).some((item: string) => canonicalPhone(item) === canon)) patch.phones = [...(customer.phones || []).filter((item: string) => item && !item.includes('@')), canon];
      if (!customer.unit_id) patch.unit_id = unit.id;
      if (!customer.legal_entity_id) patch.legal_entity_id = unit.legal_entity_id;
      customer = await base44.asServiceRole.entities.Customer.update(customer.id, patch);
    }

    await ensureCustomerSourceCard(base44, customer, unit.id, CUSTOMER_SOURCES.SITE_QUOTE);
    const conversations = await base44.asServiceRole.entities.Conversation.filter({ customer_id: customer.id, channel: 'WHATSAPP' }, '-last_message_at', 20);
    let conversation = conversations.find((item: any) => item.metadata?.source === 'web_widget' && item.metadata?.unit_id === unit.id) || null;
    if (!conversation) {
      conversation = await base44.asServiceRole.entities.Conversation.create({
        customer_id: customer.id,
        channel: 'WHATSAPP',
        status: 'OPEN',
        last_message_at: now,
        metadata: {
          source: 'web_widget',
          web_widget: true,
          legal_entity_id: unit.legal_entity_id,
          unit_id: unit.id,
          unit_confirmed: true,
        },
      });
    } else if (conversation.status === 'CLOSED') {
      conversation = await base44.asServiceRole.entities.Conversation.update(conversation.id, {
        status: 'OPEN',
        last_message_at: now,
        metadata: { ...(conversation.metadata || {}), source: 'web_widget', web_widget: true, legal_entity_id: unit.legal_entity_id, unit_id: unit.id, unit_confirmed: true },
      });
    }

    const initialText = text || `Olá! Sou ${name} e gostaria de falar com a equipe.`;
    const message = await base44.asServiceRole.entities.Message.create({
      conversation_id: conversation.id,
      direction: 'IN',
      type: 'TEXT',
      text: initialText,
      ai_pending: true,
      ai_source: 'web_widget',
      workflow_dispatch_token: crypto.randomUUID(),
      raw_payload: { source: 'web_widget', from_widget: true, request_id: requestId },
    });
    await base44.asServiceRole.entities.Conversation.update(conversation.id, { last_message_id: message.id, last_message_at: now });

    const { session, token } = await createWidgetSession(base44, req, {
      conversationId: conversation.id,
      customerId: customer.id,
      legalEntityId: unit.legal_entity_id,
      unitId: unit.id,
    });
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'create',
      entity_type: 'public_conversation_session',
      entity_id: session.id,
      item_label: session.session_key,
      reason: 'Sessão pública do atendimento iniciada',
      legal_entity_id: unit.legal_entity_id,
      unit_id: unit.id,
      request_id: requestId,
      domain: 'security',
      severity: 'info',
      result: 'success',
      origin: 'api',
      retention_class: 'privacy',
      occurred_at: now,
      metadata: { conversation_id: conversation.id, session_expires_at: session.expires_at },
      success: true,
    });

    return Response.json({
      session_key: session.session_key,
      session_token: token,
      conversation_id: conversation.id,
      message_id: message.id,
      expires_at: session.expires_at,
      request_id: requestId,
    }, { status: 201 });
  } catch (error: any) {
    console.error(`[landing_widget_start:${requestId}]`, error?.code || error?.message || 'widget_start_failed');
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    return Response.json({ error: 'Não foi possível iniciar o atendimento.', request_id: requestId }, { status: 500 });
  }
});
