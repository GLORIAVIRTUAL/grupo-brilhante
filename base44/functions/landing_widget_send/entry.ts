import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { securityErrorResponse } from '../../shared/functionSecurity.js';

// Adiciona uma nova mensagem do lead do widget à conversa existente e
// re-dispara a Glória (ai_pending). Público (landing pública).
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    if (body.honeypot) return Response.json({ status: 'spam' });

    const conversationId = String(body.conversation_id || '').trim();
    const text = String(body.text || '').trim();
    if (!conversationId) return Response.json({ error: 'Conversa inválida.' }, { status: 422 });
    if (!text || text.length > 4096) return Response.json({ error: 'Mensagem inválida.' }, { status: 422 });

    const conversation = await base44.asServiceRole.entities.Conversation.get(conversationId).catch(() => null);
    if (!conversation) return Response.json({ error: 'Conversa não encontrada.' }, { status: 404 });

    const message = await base44.asServiceRole.entities.Message.create({
      conversation_id: conversation.id,
      direction: 'IN',
      type: 'TEXT',
      text,
      ai_pending: true,
      ai_source: 'web_widget',
      raw_payload: { source: 'web_widget', from_widget: true },
    });

    await base44.asServiceRole.entities.Conversation.update(conversation.id, {
      last_message_id: message.id,
      last_message_at: new Date().toISOString(),
    });

    return Response.json({ message_id: message.id });
  } catch (error) {
    console.error('landing_widget_send error:', error?.message || error);
    return securityErrorResponse(error);
  }
});