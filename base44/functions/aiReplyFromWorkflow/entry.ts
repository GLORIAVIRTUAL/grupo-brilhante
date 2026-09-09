import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { secrets } from 'base44:runtime';
import { constantTimeEqual } from '../../shared/functionSecurity.js';

const ALLOWED_SOURCES = new Set(['web_widget', 'zapi', 'zapi_moinhos', 'whatsapp_moinhos', 'instagram', 'messenger']);

export default async function (req: Request) {
  const requestId = crypto.randomUUID();
  let processedEvent: any = null;
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const messageId = String(body?.message_id || '').trim();
    const workflowToken = String(body?.workflow_token || '').trim();
    if (!messageId || messageId.length > 100 || !workflowToken || workflowToken.length > 100) return Response.json({ error: 'invalid_message_id', request_id: requestId }, { status: 422 });

    const message = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!message || !constantTimeEqual(workflowToken, message.workflow_dispatch_token)) {
      return Response.json({ error: 'workflow_dispatch_unauthorized', request_id: requestId }, { status: 401 });
    }
    const source = String(message?.ai_source || message?.raw_payload?.source || '');
    const ageMs = Date.now() - new Date(message?.created_date || 0).getTime();
    if (!message || message.direction !== 'IN' || message.ai_pending !== true || !ALLOWED_SOURCES.has(source) || ageMs < 0 || ageMs > 15 * 60 * 1000) {
      return Response.json({ error: 'workflow_message_not_eligible', request_id: requestId }, { status: 403 });
    }

    const eventKey = `ai-workflow:${message.id}`;
    const previous = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: eventKey }, '-created_date', 5).catch(() => []);
    if (previous.some((event: any) => event.status === 'completed')) {
      await base44.asServiceRole.entities.Message.update(message.id, { workflow_dispatch_token: '' }).catch(() => null);
      return Response.json({ status: 'already_dispatched', request_id: requestId });
    }
    if (previous.some((event: any) => event.status === 'processing' && Date.now() - new Date(event.created_date || 0).getTime() < 5 * 60 * 1000)) {
      return Response.json({ status: 'dispatch_in_progress', request_id: requestId }, { status: 202 });
    }
    processedEvent = await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: eventKey,
      event_type: 'ai_workflow_dispatch',
      source: 'base44_workflow',
      status: 'processing',
      attempts: previous.length + 1,
      entity_type: 'message',
      entity_id: message.id,
      request_id: requestId,
    });

    const internalToken = secrets.get('INTERNAL_FUNCTION_TOKEN');
    if (!internalToken) throw new Error('internal_token_not_configured');
    const result = await base44.asServiceRole.functions.invoke('aiReplyTrigger', {
      data: { id: message.id },
      _internal_token: internalToken,
    });
    await base44.asServiceRole.entities.Message.update(message.id, { workflow_dispatch_token: '' });
    await base44.asServiceRole.entities.ProcessedEvent.update(processedEvent.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      result_summary: { dispatched: true },
    });
    return Response.json({ status: 'dispatched', trigger: result.data, request_id: requestId });
  } catch (error: any) {
    if (processedEvent?.id) {
      await createClientFromRequest(req).asServiceRole.entities.ProcessedEvent.update(processedEvent.id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_code: error?.message || 'workflow_dispatch_failed',
      }).catch(() => null);
    }
    console.error(`[aiReplyFromWorkflow:${requestId}]`, error?.message || 'workflow_dispatch_failed');
    return Response.json({ error: 'workflow_dispatch_failed', request_id: requestId }, { status: error?.message === 'internal_token_not_configured' ? 503 : 500 });
  }
}
