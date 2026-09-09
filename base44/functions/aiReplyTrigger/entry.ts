import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { hasRecentHumanReply } from '../../shared/humanActivity.js';
import { requireInternalRequest, securityErrorResponse } from '../../shared/functionSecurity.js';

// ============================================================================
// GATILHO DA IA (automação de entidade em Message).
//
// Por quê: chamar o orchestrator DENTRO do request do webhook da Z-API não era
// confiável — o runtime era encerrado antes da IA terminar, e quem acabava
// respondendo era a rede de segurança de 5 minutos (daí a demora de ~4 min).
//
// Agora o webhook apenas marca a mensagem com ai_pending=true e responde 200
// imediatamente. Esta automação roda em seu próprio ciclo e chama a Glória em
// poucos segundos.
// ============================================================================
Deno.serve(async (req) => {
    const requestId = crypto.randomUUID();
    try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    requireInternalRequest(req, body);
    const messageId = body?.event?.entity_id || body?.data?.id;
    if (!messageId) return Response.json({ status: 'no_message_id' });

    const message = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!message || !message.ai_pending) return Response.json({ status: 'not_pending' });
    if (message.direction !== 'IN') return Response.json({ status: 'not_inbound' });

    // Consome a marca imediatamente (evita disparo duplicado).
    await base44.asServiceRole.entities.Message.update(message.id, { ai_pending: false });

    // Janela curta para agrupar rajadas de mensagens do cliente (mantida baixa
    // para a Glória responder em segundos).
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const conversation = await base44.asServiceRole.entities.Conversation.get(message.conversation_id).catch(() => null);
    if (!conversation) return Response.json({ status: 'no_conversation' });

    // Atendimento humano: a IA nunca responde por cima.
    if (conversation.handoff_required || await hasRecentHumanReply(base44, conversation.id)) {
        return Response.json({ status: 'human_active_ai_skipped' });
    }

    // Acumulador: só a última mensagem da rajada dispara a IA.
    const inMessages = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: conversation.id, direction: 'IN' },
        '-created_date',
        3
    );
    if (inMessages[0] && inMessages[0].id !== message.id) {
        return Response.json({ status: 'superseded_by_newer' });
    }

    const source = message.ai_source || (conversation.metadata || {}).source || null;
    const interceptorArgs = {
        conversation_id: conversation.id,
        message_id: message.id,
        payload: source ? { source } : {},
        _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
    };

    // ENCAIXE DETERMINÍSTICO: roda antes do orchestrator. Se o pagamento
    // antecipado está confirmado e o cliente pede coleta, cria a coleta
    // direto — sem depender da IA.
    let interceptorResult = null;
    try {
        interceptorResult = await base44.asServiceRole.functions.invoke('encaixeInterceptor', interceptorArgs);
    } catch (e) {
        console.warn('Encaixe interceptor falhou (não fatal):', e?.message);
    }

    if (interceptorResult && interceptorResult.data && interceptorResult.data.handled) {
        return Response.json({ status: 'encaixe_intercepted', action: interceptorResult.data.action, request_id: requestId });
    }

    const args = {
        conversation_id: conversation.id,
        message_id: message.id,
        customer_id: conversation.customer_id,
        source,
        payload: source ? { ...(message.raw_payload || {}), source } : (message.raw_payload || { text: { message: message.text || '' } }),
        downloaded_file_url: null,
        _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
    };

    // Se a chamada da IA falhar (erro transitório de rede/LLM), tenta de novo NA HORA.
    // Sem isto, a mensagem só era respondida pela rede de segurança — de 5 em 5 minutos,
    // o que explica as respostas que levavam ~3 a 5 minutos.
    let result;
    try {
        result = await base44.asServiceRole.functions.invoke('orchestrator', args);
    } catch (firstError) {
        console.warn('Orchestrator falhou na 1ª tentativa, repetindo imediatamente:', firstError?.message);
        result = await base44.asServiceRole.functions.invoke('orchestrator', args);
    }

        return Response.json({ status: 'orchestrated', orchestrator: result.data, request_id: requestId });
    } catch (error) {
        return securityErrorResponse(error, requestId);
    }
});