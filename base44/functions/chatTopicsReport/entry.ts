import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    if (!body.__internal) {
      const user = await base44.auth.me();
      await enforceExistingUserSecurity(base44, req, user, { source: 'chatTopicsReport' });
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch ALL inbound text messages (paginated)
    const all = [];
    const pageSize = 500;
    let skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Message.list('created_date', pageSize, skip);
      if (!batch || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < pageSize) break;
      skip += pageSize;
      if (skip > 200000) break;
    }

    const inboundTexts = all
      .filter(m => m.direction === 'IN' && m.type === 'TEXT' && m.text && m.text.trim().length > 1)
      .map(m => ({ c: m.conversation_id, t: m.text.trim() }));

    // Map conversation -> customer to count unique complainers
    const convs = [];
    let cskip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Conversation.list('created_date', pageSize, cskip);
      if (!batch || batch.length === 0) break;
      convs.push(...batch);
      if (batch.length < pageSize) break;
      cskip += pageSize;
    }
    const convToCustomer = {};
    for (const c of convs) convToCustomer[c.id] = c.customer_id;

    // Build the raw corpus (cap length to keep prompt within limits)
    const lines = inboundTexts.map(x => x.t);
    const joined = lines.join('\n');
    const corpus = joined.length > 90000 ? joined.slice(0, 90000) : joined;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `Você é um analista de atendimento. Abaixo está o corpus de TODAS as mensagens enviadas pelos CLIENTES (apenas mensagens recebidas/inbound) de uma lavanderia (5àsec) que usa um chatbot com IA chamado "Glória" no WhatsApp.

Analise o conteúdo e produza:
1. As principais DÚVIDAS/ASSUNTOS dos clientes, agrupadas por tema, com uma contagem aproximada de quantas mensagens se referem a cada tema, ordenadas da mais frequente para a menos frequente. Para cada tema dê um nome curto e um exemplo real de mensagem.
2. Identifique mensagens que sejam RECLAMAÇÕES ESPECIFICAMENTE SOBRE O CHATBOT/IA (ex: "isso é um robô?", "quero falar com humano", "não entendeu nada", "atendimento ruim do bot", reclamações sobre demora ou respostas erradas do bot). Liste-as e conte quantas há. NÃO inclua reclamações sobre o serviço de lavanderia em si.

Corpus:
"""
${corpus}
"""`,
      response_json_schema: {
        type: 'object',
        properties: {
          principais_duvidas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tema: { type: 'string' },
                contagem_aproximada: { type: 'number' },
                exemplo: { type: 'string' }
              }
            }
          },
          reclamacoes_sobre_chatbot: {
            type: 'object',
            properties: {
              total: { type: 'number' },
              exemplos: { type: 'array', items: { type: 'string' } }
            }
          },
          resumo: { type: 'string' }
        }
      }
    });

    return Response.json({
      total_inbound_text_messages: inboundTexts.length,
      analysis: result
    });
  } catch (error) {
    console.error('chatTopicsReport error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});