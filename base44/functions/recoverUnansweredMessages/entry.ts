import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

// ============================================================================
// REDE DE SEGURANÇA: recupera mensagens de clientes que ficaram SEM resposta.
//
// Por quê: o zapi_webhook_receiver dispara o orchestrator em background
// (EdgeRuntime.waitUntil) após um pequeno debounce. Se o runtime for reciclado
// dentro dessa janela, a tarefa morre antes de chamar a IA e a mensagem do
// cliente fica órfã (caso Diogo: mandou "Olá" e a Glória não respondeu).
//
// Esta função roda periodicamente e encontra conversas com IA ATIVA cuja
// ÚLTIMA mensagem é do CLIENTE (IN), já passou tempo suficiente (a rajada já
// terminou) e ainda não houve resposta OUT. Para essas, dispara o orchestrator.
// ============================================================================
Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
        const base44 = createClientFromRequest(req);
        let body = {};
        try { body = await req.json(); } catch { body = {}; }
        await authorizeUserOrInternal(base44, req, body, {
            roles: ['super_admin', 'admin'],
            source: 'recover_unanswered_messages',
        });

        const now = Date.now();
        // Só considera mensagens que já "descansaram" o suficiente para a rajada
        // ter terminado, mas ainda recentes (evita reprocessar histórico antigo).
        const MIN_AGE_MS = 1 * 60 * 1000;   // 1 min: passou do debounce, rajada acabou
        const MAX_AGE_MS = 30 * 60 * 1000;  // 30 min: janela de recuperação

        // Traz conversas recentes com atividade (as candidatas estarão aqui).
        const convs = await base44.asServiceRole.entities.Conversation.list('-last_message_at', 150);

        const recovered = [];
        for (const conv of convs) {
            // Pula conversas em atendimento humano ou fechadas — IA não deve responder.
            if (conv.handoff_required) continue;
            if (conv.status === 'CLOSED') continue;

            const lastAt = conv.last_message_at ? new Date(conv.last_message_at).getTime() : 0;
            if (!lastAt) continue;
            const age = now - lastAt;
            // Fora da janela de recuperação.
            if (age < MIN_AGE_MS || age > MAX_AGE_MS) continue;

            // Pega as 3 últimas mensagens desta conversa para decidir.
            const msgs = await base44.asServiceRole.entities.Message.filter(
                { conversation_id: conv.id },
                '-created_date',
                3
            );
            if (!msgs || msgs.length === 0) continue;

            const last = msgs[0];
            // Só recuperamos se a ÚLTIMA mensagem for do cliente (IN) e do tipo que a IA responde.
            if (last.direction !== 'IN') continue;
            if (!['TEXT', 'IMAGE', 'AUDIO'].includes(last.type)) continue;

            // Confirma que já passou tempo suficiente desde ESSA mensagem específica.
            const lastMsgAge = now - new Date(last.created_date).getTime();
            if (lastMsgAge < MIN_AGE_MS) continue;

            const customer = await base44.asServiceRole.entities.Customer.get(conv.customer_id).catch(() => null);
            if (!customer) continue;

            try {
                await base44.asServiceRole.functions.invoke('orchestrator', {
                    conversation_id: conv.id,
                    message_id: last.id,
                    customer_id: customer.id,
                    payload: last.raw_payload || { text: { message: last.text || '' } },
                    downloaded_file_url: null,
                    _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                });
                recovered.push({ conversation_id: conv.id, message_id: last.id });
                console.log(`Recovered unanswered message ${last.id} in conversation ${conv.id}`);
            } catch (err) {
                console.error(`Failed to recover conversation ${conv.id}:`, err.message);
            }
        }

        return Response.json({ status: 'success', recovered_count: recovered.length, recovered });

    } catch (error) {
        console.error('Error in recoverUnansweredMessages:', error?.code || error?.message || error);
        return securityErrorResponse(error);
    }
});