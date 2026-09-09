import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { securityErrorResponse } from '../../shared/functionSecurity.js';

// Retorna as mensagens de uma conversa do widget (IN e OUT) para o polling do
// chat embutido na landing. Público (landing pública).
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const conversationId = String(body.conversation_id || '').trim();
    const since = body.since || null;
    if (!conversationId) return Response.json({ error: 'Conversa inválida.' }, { status: 422 });

    const messages = await base44.asServiceRole.entities.Message
      .filter({ conversation_id: conversationId }, 'created_date', 200)
      .catch(() => []);

    const filtered = since
      ? messages.filter((m) => new Date(m.created_date).getTime() > new Date(since).getTime())
      : messages;

    return Response.json({
      messages: filtered.map((m) => ({
        id: m.id,
        direction: m.direction,
        type: m.type,
        text: m.text || '',
        media_file_id: m.media_file_id || null,
        created_date: m.created_date,
      })),
    });
  } catch (error) {
    console.error('landing_widget_messages error:', error?.message || error);
    return securityErrorResponse(error);
  }
});