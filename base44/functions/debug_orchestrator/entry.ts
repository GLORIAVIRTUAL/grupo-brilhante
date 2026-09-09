import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (Deno.env.get('ENABLE_INTERNAL_DEBUG_ENDPOINTS') !== 'true') {
      return Response.json({ error: 'not_found', request_id: requestId }, { status: 404 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'debug_orchestrator' });
    if (!user || !['super_admin', 'admin'].includes(user.role)) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const { conversation_id, message_id, customer_id } = await req.json();
    if (![conversation_id, message_id, customer_id].every((value) => typeof value === 'string' && value.length > 0)) {
      return Response.json({ error: 'invalid_debug_payload', request_id: requestId }, { status: 400 });
    }

    const result = await base44.asServiceRole.functions.invoke('orchestrator', {
      conversation_id,
      message_id,
      customer_id,
      payload: { debug_request_id: requestId },
      _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN'),
    });

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'create',
      entity_type: 'integration',
      entity_id: message_id,
      item_label: 'debug_orchestrator',
      reason: 'internal_debug_invocation',
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      request_id: requestId,
      success: true,
    });

    return Response.json({ success: true, status: result.status, request_id: requestId });
  } catch (error) {
    console.error(`[debug_orchestrator:${requestId}]`, error);
    return Response.json({ error: 'debug_invocation_failed', request_id: requestId }, { status: 500 });
  }
});
