import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from 'base44:runtime';

// Ponte entre o workflow (gatilho da entidade Message) e o aiReplyTrigger,
// que exige o token interno — indisponível dentro da definição do workflow.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const messageId = body?.message_id;
    if (!messageId) return Response.json({ status: 'no_message_id' }, { status: 400 });

    const result = await base44.asServiceRole.functions.invoke('aiReplyTrigger', {
      data: { id: messageId },
      _internal_token: secrets.get('INTERNAL_FUNCTION_TOKEN'),
    });

    return Response.json({ status: 'dispatched', trigger: result.data });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}