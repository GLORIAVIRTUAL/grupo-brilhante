import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { geminiChat } from '../../shared/geminiChat.js';
import { getAiSettings } from '../../shared/aiSettings.js';
import { STORE_HOURS_FACT } from '../../shared/storeHours.js';

// 🚨 PROTEÇÃO ANTI-ALUCINAÇÃO GLOBAL
// Recebe a resposta que a Glória pretende enviar ao cliente e faz um "fact-check" final
// comparando-a contra os FATOS REAIS do sistema (catálogo de preços, disponibilidade de
// coleta, status de agendamento, prazo de entrega, promoções ativas). Se detectar qualquer
// afirmação inventada (preço fora do catálogo, promoção inexistente, coleta "confirmada" sem
// estar de fato agendada, etc.), reescreve a mensagem para ficar 100% fiel aos fatos.
//
// Retorna: { safe_response: string, was_corrected: boolean }
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const {
            draft_response,
            catalog_context,
            variation_context,
            promotions_context,
            availability_result,
            pickup_scheduled_ok,
            delivery_date,
            date_facts,
            m2_prices,
            special_service_fact,
            delivery_requested,
            quote_facts
        } = await req.json();

        const m2 = m2_prices || { cortina_tipo_I: 30, cortina_tipo_II: 45, cortina_tipo_III: 65, tapete: 80 };
        const fmtM2 = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

        if (!draft_response || !draft_response.trim()) {
            return Response.json({ safe_response: draft_response || '', was_corrected: false });
        }

        // ⚡ ATALHO DE VELOCIDADE: se o rascunho não contém NADA verificável
        // (nenhum valor, data, horário, prazo, promoção, coleta ou serviço especial),
        // não há o que checar — devolve na hora e evita uma chamada de LLM inteira.
        const risky = /\d|r\$|pre[çc]|valor|gr[áa]tis|incluso|inclui|promo|desconto|coleta|entrega|agend|prazo|pronto|hor[áa]rio|aberto|fecha|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|hoje|amanh[ãa]|manh[ãa]|tarde|bactericida|revitaliz|impermeab|engomagem|branco|taxa|m²|metro/i;
        if (!risky.test(draft_response)) {
            return Response.json({ safe_response: draft_response, was_corrected: false });
        }

        const factSheet = `
FATOS REAIS DO SISTEMA (única fonte de verdade — a resposta NÃO pode contradizer nada disto):

CATÁLOGO DE PREÇOS (use SOMENTE estes valores — qualquer preço fora desta lista é ALUCINAÇÃO):
${catalog_context || 'Catálogo indisponível.'}

GRUPOS DE VARIAÇÕES DE PREÇO (se um item tem variações, TODAS devem aparecer, sem inventar nem esconder):
${variation_context || 'Nenhum grupo de variação.'}

PROMOÇÕES ATIVAS (só pode mencionar promoções desta lista; qualquer outra é ALUCINAÇÃO):
${promotions_context || 'Nenhuma promoção ativa.'}

DISPONIBILIDADE DE COLETA (resultado real consultado no sistema):
${availability_result ? JSON.stringify(availability_result) : 'Nenhuma checagem de disponibilidade foi feita nesta rodada. Portanto a resposta NÃO pode afirmar nem negar disponibilidade de coleta.'}

AGENDAMENTO DE COLETA: ${pickup_scheduled_ok ? 'Uma coleta FOI realmente agendada no sistema com sucesso nesta rodada — pode confirmar.' : 'NENHUMA coleta foi agendada no sistema nesta rodada. A resposta NÃO pode dizer que a coleta foi confirmada/agendada/marcada.'}

PRAZO DE ENTREGA (data real calculada): ${delivery_date || 'Não informado.'} (NUNCA invente outra data.)

CALENDÁRIO E HORÁRIOS DETERMINÍSTICOS DO SISTEMA (dia da semana de cada data, datas em que a loja fecha e prazo por data de entrada — use SEMPRE isto para conferir dias da semana, domingos, feriados, horário de funcionamento e prazos):
${date_facts || 'Não informado.'}

${STORE_HOURS_FACT}

SERVIÇOS ESPECIAIS (ADICIONAIS — TODOS TÊM CUSTO EXTRA POR PEÇA, NUNCA são grátis nem inclusos):
Peça         | Bactericida | Branco+/Revitalizante/Engomagem | Impermeabilização
Edredom      | R$ 40,00    | R$ 35,00                        | R$ 35,00
Casacos      | R$ 26,00    | R$ 21,00                        | R$ 21,00
Cortinas     | R$ 25,00    | R$ 20,00                        | R$ 20,00
Tapete       | R$ 27,00/m² | -                               | -
Vestidos     | R$ 22,00    | R$ 17,00                        | R$ 17,00
Macacão      | R$ 20,00    | R$ 15,00                        | R$ 15,00
Demais Peças | R$ 14,00    | R$ 10,00                        | R$ 14,00

${special_service_fact || ''}

${delivery_requested
    ? '🚚 O CLIENTE PEDIU COLETA/ENTREGA NESTE ATENDIMENTO. REGRA OBRIGATÓRIA: toda vez que a mensagem citar um TOTAL de peças ≤ R$ 150,00, ela DEVE somar a taxa FIXA de R$ 15,00 da coleta + entrega e mostrar o total final com a taxa. Se a mensagem citar um total ≤ R$ 150,00 sem essa taxa, você é OBRIGADO a corrigir acrescentando os R$ 15,00. Se o total das peças for > R$ 150,00, a tele é GRÁTIS e é PROIBIDO cobrar os R$ 15,00.'
    : 'COLETA/ENTREGA: não identificada neste atendimento. Regra geral: total das peças ≤ R$ 150,00 → taxa fixa de R$ 15,00; acima de R$ 150,00 → tele grátis.'}

${quote_facts
    ? `🚨 VALORES OFICIAIS DO ORÇAMENTO PENDENTE (fact-check NUMÉRICO — a mensagem NÃO pode citar valores diferentes destes):\nItens: ${quote_facts.items || 'não informado'}\nTotal das peças (sem desconto): R$ ${Number(quote_facts.pieces_total || 0).toFixed(2)}\nTaxa de coleta/entrega: R$ ${Number(quote_facts.delivery_fee || 0).toFixed(2)}\nTOTAL FINAL A COBRAR: R$ ${Number(quote_facts.final_total || 0).toFixed(2)}\n${quote_facts.note || ''}`
    : 'Nenhum orçamento pendente com valores oficiais nesta rodada.'}
`;

        const completion = await geminiChat({
            model: (await getAiSettings(base44)).model,
            temperature: 0,
            responseJson: true,
            thinkingBudget: 0,
            messages: [
                {
                    role: "system",
                    content: `Você é um VERIFICADOR DE FATOS rigoroso para as respostas da atendente virtual Glória (lavanderia 5àsec). Sua tarefa é revisar a mensagem que a Glória vai enviar ao cliente e garantir que ela NÃO contenha NENHUMA informação inventada/alucinada.

${factSheet}

REGRAS DE CORREÇÃO:
1. Se a mensagem citar um PREÇO que não bate exatamente com o catálogo, corrija para o valor correto OU, se a peça não existe no catálogo, troque por: "Para identificar essa peça, descreva o tipo, material, tamanho e detalhes. Se preferir, você também pode enviar uma foto 😊". Foto é sempre opcional e nunca pode ser exigida.
   ⚠️ EXCEÇÃO IMPORTANTE — CÁLCULO POR M² (CORTINAS E TAPETES): Valores de *Cortina*, *Tapete retangular/quadrangular* e *Tapete circular* são calculados por metro quadrado e NÃO estão no catálogo de preços fixos acima. Preços por m² válidos: Cortina Tipo I = ${fmtM2(m2.cortina_tipo_I)}/m², Tipo II = ${fmtM2(m2.cortina_tipo_II)}/m², Tipo III = ${fmtM2(m2.cortina_tipo_III)}/m²; Tapetes = ${fmtM2(m2.tapete)}/m². Se a mensagem informar um valor calculado por m² para cortina/tapete (área × preço/m²), considere CORRETO e NÃO troque pela frase de "me envie uma foto". NUNCA substitua um cálculo de m² já feito por um pedido de foto.
2. Se um item tiver múltiplos preços e o cliente não identificar a variação, use o MENOR PREÇO da categoria sem bloquear o orçamento. Não exija identificação, características ou foto. Acrescente obrigatoriamente que o orçamento considera o menor valor, que a equipe irá inspecionar as peças e que, se alguma precisar ser tratada como especial, poderá haver cobrança do valor adicional. Características podem ser solicitadas apenas como opção para tornar o orçamento mais preciso.
3. Se a mensagem mencionar uma PROMOÇÃO que não está na lista de promoções ativas, REMOVA essa parte.
4. Se a mensagem AFIRMAR ou NEGAR disponibilidade de coleta sem que haja um resultado real de disponibilidade, REMOVA essa afirmação e apenas se ofereça para verificar.
5. Se a mensagem disser que a coleta foi CONFIRMADA/AGENDADA/MARCADA mas nenhuma coleta foi agendada no sistema, REMOVA a confirmação e peça os dados que faltam (data, turno, endereço, pagamento).
6. Se a mensagem citar um PRAZO/DATA de entrega diferente do real, corrija para a data real. ⚠️ EXCEÇÃO: para CORTINAS e TAPETES (cálculo por m²) o prazo NÃO é o padrão de 3 dias úteis — Cortina = "3 a 5 dias úteis", Tapetes (retangular/circular) = "10 a 15 dias". Se a mensagem for sobre cortina/tapete e informar esses prazos, está CORRETO — NÃO troque pelo prazo padrão e NÃO remova o prazo. Se a mensagem for de cortina/tapete e estiver SEM o prazo, ADICIONE o prazo correto (3 a 5 dias úteis para cortina; 10 a 15 dias para tapetes).
7. 🚨 SERVIÇOS ESPECIAIS: Se a mensagem disser que um serviço especial (Branco+, Bactericida, Revitalizante, Engomagem, Impermeabilização) "não tem custo", "é grátis", "está incluso" ou "não tem valor adicional", isso é ERRADO — CORRIJA. Esses serviços SEMPRE têm custo extra por peça conforme a tabela de Serviços Especiais acima. Informe o valor adicional correto da tabela (conforme o tipo de peça) e o benefício. Se o cliente não disse qual peça, mostre os valores por tipo de peça da tabela.
7.1. 🚨 VALOR DO SERVIÇO ESPECIAL POR PEÇA: se houver um bloco "SERVIÇOS ESPECIAIS DA(S) PEÇA(S) DESTE ATENDIMENTO" acima, ele é a ÚNICA verdade para essas peças. Se a mensagem aplicou a linha "Demais Peças" (R$ 14,00 / R$ 10,00) ou qualquer outro valor a uma dessas peças (ex: Bactericida em edredom por R$ 14,00 quando o correto é R$ 40,00), CORRIJA o valor E RECALCULE todos os totais citados na mensagem com o valor correto.
7.2. 🚨 TAXA DE COLETA/ENTREGA: se a coleta/entrega foi solicitada e o total das peças (após desconto) for ≤ R$ 150,00, a mensagem DEVE informar a taxa fixa de R$ 15,00 e somá-la ao total final. Se a mensagem omitiu essa taxa, ACRESCENTE-A e ajuste o total — isso vale MESMO que a mensagem não esteja falando de coleta naquele momento (ex: acrescente uma linha "+ R$ 15,00 da taxa fixa de coleta e entrega" e mostre o total final com a taxa). Se o total das peças for > R$ 150,00, a tele é grátis e é PROIBIDO cobrar os R$ 15,00.
7.3. 🚨 VALORES DO ORÇAMENTO PENDENTE: se houver o bloco "VALORES OFICIAIS DO ORÇAMENTO PENDENTE" acima, ele é a ÚNICA verdade numérica. Se a mensagem citar subtotal, taxa ou total final DIFERENTES desses valores, CORRIJA para os valores oficiais. O orçamento é SEMPRE sem desconto: se a mensagem mostrar um "valor com desconto" ou um desconto calculado, REMOVA esses valores e informe que o valor é sem desconto e que o desconto da promoção será aplicado pela equipe na hora do pagamento.
7.4. 🚨 PASSADORIA INCLUÍDA: o preço de catálogo de cada peça JÁ INCLUI lavagem + secagem + passadoria. Se a mensagem disser que "o valor é apenas da lavagem", que "passar tem custo adicional/varia conforme a peça", que a passadoria é cobrada à parte, ou oferecer "orçamento só de lavagem, sem passar", isso é ERRADO — CORRIJA afirmando que o valor informado já inclui lavagem, secagem e passadoria, sem custo adicional. Exceção única: BAGS (não incluem passadoria) e o serviço de APENAS PASSAR sem lavar (70% do valor da lavagem).
7.5. 🚨 DOMINGO/FERIADO: se a mensagem oferecer, sugerir, perguntar ou confirmar coleta em um DOMINGO ou FERIADO, REMOVA essa data e diga que nesse dia não há coleta, oferecendo a próxima data válida (segunda a sábado). Também é ERRADO oferecer turno da TARDE no sábado (sábado só tem manhã, 9h às 12h).
7.5.1. 🚨 PASSADORIA AVULSA (SÓ PASSAR, SEM LAVAR): existe e custa 70% do valor da lavagem da mesma peça (nunca outro percentual). E a passadoria é feita SOMENTE DE SEGUNDA A SEXTA-FEIRA: se a mensagem oferecer, agendar ou afirmar passadoria em SÁBADO, domingo ou feriado, CORRIJA dizendo que a passadoria acontece de segunda a sexta.
7.6. 🚨 HORÁRIO DA LOJA: a tabela "HORÁRIO DE FUNCIONAMENTO OFICIAL DAS LOJAS" acima é a verdade. (a) É TERMINANTEMENTE PROIBIDO REMOVER a faixa de horas da mensagem: se a mensagem disser apenas os dias (ex: "funciona de Segunda a Sábado") sem as horas, ACRESCENTE a faixa correta da loja (ex: "das 11h às 20h"). Uma resposta de horário sem a faixa de horas é ERRO GRAVE. (b) Se a faixa citada for DIFERENTE da tabela, corrija para a da tabela; se for igual, MANTENHA exatamente. (c) A faixa deve ser a do dia da semana perguntado: num SÁBADO é ERRADO citar a faixa de Seg a Sex quando a loja fecha mais cedo (Rio Branco e Petrópolis: sábado 09h-14h). Aos sábados não há serviço de passadoria, apenas lavagem.
7.7. 🚨 PRAZO NUNCA NO MESMO DIA: se a mensagem disser que a peça fica pronta no MESMO dia em que o cliente vai entregá-la (ex: "se levar na terça, fica pronto na terça"), isso é ERRADO — CORRIJA para 3 dias úteis após a entrega, usando a data real de prazo informada acima. Só é válido prazo menor se houver urgência aprovada.
8. NÃO invente informação nova. NÃO mude o tom amigável de WhatsApp da Glória. Mantenha emojis e o estilo curto.
9. Se a mensagem JÁ ESTIVER 100% correta e fiel aos fatos, devolva-a EXATAMENTE como está.

Responda em JSON: { "safe_response": "<mensagem final corrigida e segura para o cliente>", "was_corrected": <true se você alterou algo, false se não> }`
                },
                {
                    role: "user",
                    content: `Mensagem que a Glória pretende enviar ao cliente:\n"""${draft_response}"""`
                }
            ],
            response_format: { type: "json_object" }
        });

        const raw = completion.choices[0].message.content || '{}';
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            // Se o parse falhar, por segurança devolve a resposta original.
            return Response.json({ safe_response: draft_response, was_corrected: false });
        }

        const safe = (parsed.safe_response && parsed.safe_response.trim()) ? parsed.safe_response.trim() : draft_response;
        return Response.json({ safe_response: safe, was_corrected: !!parsed.was_corrected });

    } catch (error) {
        console.error("Error in hallucinationGuard:", error);
        // Em caso de erro, o orchestrator usa a resposta original (fail-safe).
        return Response.json({ error: error.message }, { status: 500 });
    }
});