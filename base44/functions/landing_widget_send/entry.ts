import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { SecurityError, securityErrorResponse } from '../../shared/functionSecurity.js';
import { authorizeWidgetSession } from '../../shared/publicWidgetSecurity.js';

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    if (body.honeypot) return Response.json({ status: 'accepted', request_id: requestId });
    const text = String(body.text || '').trim();
    if (!text || text.length > 4096) throw new SecurityError('Mensagem inválida.', 422, 'INVALID_MESSAGE');

    const session = await authorizeWidgetSession(base44, req, body, { incrementMessage: true });
    const conversation = await base44.asServiceRole.entities.Conversation.get(session.conversation_id).catch(() => null);
    if (!conversation || conversation.customer_id !== session.customer_id || conversation.metadata?.unit_id !== session.unit_id) {
      throw new SecurityError('Conversa fora da sessão.', 403, 'WIDGET_CONVERSATION_DENIED');
    }

    const now = new Date().toISOString();
    const message = await base44.asServiceRole.entities.Message.create({
      conversation_id: conversation.id,
      direction: 'IN',
      type: 'TEXT',
      text,
      ai_pending: true,
      ai_source: 'web_widget',
      workflow_dispatch_token: crypto.randomUUID(),
      raw_payload: { source: 'web_widget', from_widget: true, session_key: session.session_key, request_id: requestId },
    });
    await base44.asServiceRole.entities.Conversation.update(conversation.id, { last_message_id: message.id, last_message_at: now });
    return Response.json({ message_id: message.id, created_at: now, request_id: requestId }, { status: 201 });
  } catch (error: any) {
    console.error(`[landing_widget_send:${requestId}]`, error?.code || error?.message || 'widget_send_failed');
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    return Response.json({ error: 'Não foi possível enviar a mensagem.', request_id: requestId }, { status: 500 });
  }
});
