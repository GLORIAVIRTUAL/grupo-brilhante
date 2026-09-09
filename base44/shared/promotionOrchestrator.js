import { calculatePromotionalQuote } from './promotionFlow.js';

export const promotionAiTools = [
  {
    type: 'function',
    function: {
      name: 'start_regular_quote',
      description: 'Inicia um orçamento normal fora das promoções de Moinhos. Use quando o cliente escolher orçamento comum após receber a lista de promoções.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_promotional_quote',
      description: 'Valida a promoção escolhida e cria o orçamento promocional SEMPRE com o valor cheio (sem desconto). O desconto é aplicado pela equipe na hora do pagamento. Use apenas no fluxo promocional de Moinhos, depois de saber promoção, itens e quantidades.',
      parameters: {
        type: 'object',
        properties: {
          promotion_title: { type: 'string', description: 'Título da promoção escolhida, exatamente como apresentado ao cliente.' },
          items: {
            type: 'array',
            description: 'Itens usando os preços-base do catálogo, antes do desconto.',
            items: {
              type: 'object',
              properties: {
                garment_type: { type: 'string' },
                qty: { type: 'number' },
                unit_price: { type: 'number' }
              },
              required: ['garment_type', 'qty', 'unit_price']
            }
          }
        },
        required: ['promotion_title', 'items']
      }
    }
  }
];

const normalize = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

export async function handlePromotionToolCall({ toolCall, base44, customer, conversation, currentState, activePromotions, activeUnitId, isMoinhos }) {
  if (!['start_regular_quote', 'create_promotional_quote'].includes(toolCall.function.name)) return null;
  if (!isMoinhos || currentState.flow !== 'MOINHOS_PROMOTION_INTEREST') {
    return { content: JSON.stringify({ success: false, error: 'Este fluxo promocional é exclusivo do chat Moinhos e exige uma oferta ativa na conversa.' }) };
  }

  if (toolCall.function.name === 'start_regular_quote') {
    const state = { flow: 'TEXT_QUOTE', step: 'COLLECTING_ITEMS_TEXT', temp_items: [], selected_promotion: null };
    const cards = await base44.asServiceRole.entities.CrmCard.filter({
      pipeline_type: 'QUOTE', customer_id: customer.id, stage: 'Coletando itens'
    });
    if (!cards.length) {
      await base44.asServiceRole.entities.CrmCard.create({
        pipeline_type: 'QUOTE', stage: 'Coletando itens', priority: 'MEDIUM', customer_id: customer.id, unit_id: activeUnitId
      });
    }
    await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState, ...state } });
    return {
      state,
      content: JSON.stringify({ success: true, instruction: 'Orçamento normal iniciado. Pergunte se o cliente prefere enviar fotos ou listar as peças e quantidades por texto.' })
    };
  }

  const args = JSON.parse(toolCall.function.arguments || '{}');
  const requested = normalize(args.promotion_title);
  const promotion = activePromotions.find((item) => {
    const title = normalize(item.title);
    return title === requested || title.includes(requested) || requested.includes(title);
  });
  const calculation = calculatePromotionalQuote(promotion, args.items || []);
  if (!calculation.valid) return { content: JSON.stringify({ success: false, error: calculation.error }) };

  // DECISÃO DE NEGÓCIO (21/08/2026): o orçamento é SEMPRE criado com o valor CHEIO
  // (sem desconto). O desconto da promoção NUNCA é calculado pela IA nem aplicado aqui —
  // a equipe aplica o desconto na hora do pagamento. O campo human_adjustments registra
  // a promoção e o desconto devido para a equipe conferir no pagamento.
  const quote = await base44.asServiceRole.entities.Quote.create({
    customer_id: customer.id,
    unit_id: activeUnitId,
    status: 'SENT',
    review_deadline_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    items: calculation.items,
    subtotal: calculation.subtotal,
    discount: 0,
    total: calculation.subtotal,
    human_adjustments: `Promoção elegível: ${calculation.promotion_title} (${calculation.qualification}). DESCONTO A APLICAR NO PAGAMENTO: ${calculation.discount > 0 ? `R$ ${calculation.discount.toFixed(2)}` : 'conforme regra da promoção'}. Orçamento informado ao cliente SEM desconto.`
  });

  const cards = await base44.asServiceRole.entities.CrmCard.filter({
    pipeline_type: 'QUOTE', customer_id: customer.id, stage: 'Coletando itens'
  });
  if (cards.length) {
    await base44.asServiceRole.entities.CrmCard.update(cards[0].id, {
      stage: 'Enviado ao cliente', linked_quote_id: quote.id, due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
  } else {
    await base44.asServiceRole.entities.CrmCard.create({
      pipeline_type: 'QUOTE', stage: 'Enviado ao cliente', priority: 'HIGH', customer_id: customer.id,
      unit_id: activeUnitId, linked_quote_id: quote.id, due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
  }

  const state = {
    flow: null,
    step: 'PROMOTIONAL_QUOTE_SENT',
    selected_promotion: calculation.promotion_title,
    promotion_quote_id: quote.id,
    temp_items: calculation.items
  };
  await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState, ...state } });

  return {
    state,
    content: JSON.stringify({
      success: true,
      promotion: calculation.promotion_title,
      qualification: calculation.qualification,
      subtotal: calculation.subtotal,
      total: calculation.subtotal,
      instruction: `O orçamento foi salvo no sistema com o valor CHEIO (sem desconto): subtotal e total = R$ ${calculation.subtotal.toFixed(2)}. Informe ao cliente SOMENTE este valor e diga: "O valor do orçamento é o valor sem desconto — o desconto da promoção ${calculation.promotion_title} será aplicado pela nossa equipe na hora do pagamento." É PROIBIDO informar o valor do desconto ou o valor com desconto. Depois pergunte se o cliente aprova o orçamento.`
    })
  };
}