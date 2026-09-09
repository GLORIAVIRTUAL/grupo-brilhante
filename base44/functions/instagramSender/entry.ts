import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Envia uma DM do Instagram e registra a mensagem na conversa do chat.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const conversationId = body.conversation_id;
    const text = (body.message || '').trim();
    const mediaUrl = body.mediaUrl || null;
    if (!conversationId || (!text && !mediaUrl)) {
      return Response.json({ error: 'conversation_id e message são obrigatórios' }, { status: 400 });
    }

    const accessToken = Deno.env.get('INSTAGRAM_ACCESS_TOKEN');
    if (!accessToken) return Response.json({ error: 'INSTAGRAM_ACCESS_TOKEN não configurado' }, { status: 503 });

    const conversation = await base44.asServiceRole.entities.Conversation.get(conversationId);
    const recipientId = (conversation?.metadata || {}).instagram_user_id;
    if (!recipientId) return Response.json({ error: 'Conversa sem usuário do Instagram' }, { status: 409 });

    const messagePayload = mediaUrl
      ? { attachment: { type: 'image', payload: { url: mediaUrl } } }
      : { text };

    const res = await fetch(`https://graph.instagram.com/v21.0/me/messages?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: messagePayload }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Instagram send failed:', JSON.stringify(data));
      return Response.json({ error: 'instagram_send_failed', details: data }, { status: 502 });
    }

    const saved = await base44.asServiceRole.entities.Message.create({
      conversation_id: conversationId,
      direction: 'OUT',
      type: mediaUrl ? 'IMAGE' : 'TEXT',
      text,
      media_file_id: mediaUrl,
      sent_by: body.sent_by || user.full_name || 'Atendente',
      raw_payload: { instagram_message_id: data.message_id },
    });

    await base44.asServiceRole.entities.Conversation.update(conversationId, {
      last_message_id: saved.id,
      last_message_at: new Date().toISOString(),
    });

    return Response.json({ id: saved.id, instagram_message_id: data.message_id });
  } catch (error) {
    console.error('instagramSender error:', error?.message || error);
    return Response.json({ error: error?.message || 'failed' }, { status: 500 });
  }
}