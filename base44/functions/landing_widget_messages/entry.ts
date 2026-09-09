import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { securityErrorResponse } from '../../shared/functionSecurity.js';
import { authorizeWidgetSession } from '../../shared/publicWidgetSecurity.js';

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const session = await authorizeWidgetSession(base44, req, body);
    const since = body.since ? new Date(body.since) : null;
    if (since && !Number.isFinite(since.getTime())) return Response.json({ error: 'invalid_since', request_id: requestId }, { status: 422 });

    const messages = await base44.asServiceRole.entities.Message
      .filter({ conversation_id: session.conversation_id }, 'created_date', 200)
      .catch(() => []);
    const filtered = since ? messages.filter((message: any) => new Date(message.created_date).getTime() > since.getTime()) : messages;

    return Response.json({
      messages: filtered.map((message: any) => ({
        id: message.id,
        direction: message.direction,
        type: message.type,
        text: message.text || '',
        media_file_id: message.direction === 'OUT' ? (message.media_file_id || null) : null,
        created_date: message.created_date,
      })),
      expires_at: session.expires_at,
      request_id: requestId,
    });
  } catch (error: any) {
    console.error(`[landing_widget_messages:${requestId}]`, error?.code || error?.message || 'widget_messages_failed');
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    return Response.json({ error: 'Não foi possível consultar as mensagens.', request_id: requestId }, { status: 500 });
  }
});
