import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createGeminiClient, transcribeAudioWithGemini, bytesToBase64 } from '../../shared/geminiChat.js';
import { requireInternalRequest, securityErrorResponse } from '../../shared/functionSecurity.js';
import { getPickupDateRange, getPickupLocalHour, getPickupScheduleForDate, getPickupSlotIso } from '../../shared/pickupSchedule.js';
import { buildPickupAvailabilityResponse, resolvePickupAvailabilityRequest } from '../../shared/pickupAvailability.js';
import { detectUncheckedAvailabilityClaim, UNCHECKED_CLAIM_INSTRUCTION } from '../../shared/availabilityClaim.js';
import { buildConversationContinuityFacts, isExplicitNewQuoteIntent } from '../../shared/conversationContinuity.js';
import { buildDeliveryPriceResponse, detectDeliveryIntent, enforceDeliveryFeeNotice, enforceVariableQuoteSafety, isDeliveryPriceQuestion, resolveKnownDeliveryTotal } from '../../shared/quoteSafety.js';
import { handlePromotionToolCall, promotionAiTools } from '../../shared/promotionOrchestrator.js';
import { handlePaymentChargeToolCall } from '../../shared/paymentChargeTool.js';
import { clearDispatchGeneratedHandoff, isDispatchGeneratedHandoff } from '../../shared/dispatchReplyPolicy.js';
import { buildStainReply, detectStainInquiry, looksLikeDetailPhotos } from '../../shared/stainInquiry.js';
import { getAiSettings } from '../../shared/aiSettings.js';
import { buildSpecialServiceFact, detectSpecialServiceTiers, loadSpecialServiceRows } from '../../shared/specialServiceContext.js'; import { buildBagsContext, buildSpecialTableContext } from '../../shared/pricingContext.js';
import { buildDateFacts } from '../../shared/dateFacts.js';
import { priceItems, buildQuoteFactsText, passadoriaPrice, formatBrl as formatBrlQuote } from '../../shared/quoteBuilder.js';
import { logGuardEvent, classifyCorrection } from '../../shared/guardTelemetry.js';
import { buildMainPrompt } from '../../shared/gloriaPrompt.js';
import { loadIroningSettings, IRONING_RULE } from '../../shared/ironingSettings.js';
import { shouldIncludeInAiHistory } from '../../shared/messageOrigin.js';
import { findNextEncaixeSlot, formatEncaixeDate } from '../../shared/encaixeScheduler.js';
// Handoffs automáticos de disparo/campanha nunca bloqueiam a IA (ver dispatchReplyPolicy).

const normalizeText = (value = '') => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const IGNORED_SOLO_TEXTS = new Set(['ok', 'okkk', 'ta', 'tabom', 'beleza', 'sair', 'retorno', 'retornar']);
const shouldIgnoreSoloMessage = (text = '') => {
    const normalizedText = text.trim().toLowerCase();
    const cleanText = normalizedText.replace(/[^a-z0-9]/g, '');
    const isEmojiOnly = /^[\p{Emoji}\s]+$/u.test(text || '');

    return (isEmojiOnly && cleanText.length === 0) || IGNORED_SOLO_TEXTS.has(cleanText);
};

const PRODUCT_STOPWORDS = new Set(['quanto', 'custa', 'valor', 'preco', 'para', 'pra', 'lavar', 'lavo', 'quero', 'querendo', 'to', 'estou', 'meu', 'minha', 'um', 'uma', 'o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'qual', 'produto', 'produtos', 'servico', 'servicos', 'serviço', 'serviços', 'por', 'peca', 'peça', 'lugar', 'par', 'mesmo', 'obrigado', 'obrigada', 'valeu', 'enquanto', 'isso', 'agora', 'entao', 'então', 'tchau', 'bom', 'dia', 'tarde', 'noite', 'ola', 'olá', 'oi', 'tudo', 'bem', 'sim', 'nao', 'não', 'favor', 'tele']);

const formatCurrency = (value) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;

const findRelatedCatalogProducts = (products, text = '') => {
    const normalizedText = normalizeText(text);
    const messageTokens = normalizedText
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !PRODUCT_STOPWORDS.has(token));

    if (!messageTokens.length) {
        return { exactMatches: [], relatedMatches: [], sharedToken: null };
    }

    const scoreProduct = (product) => {
        const productName = normalizeText(product.name || '');
        const productFamily = normalizeText(product.family || '');
        const haystack = `${productName} ${productFamily}`.trim();

        let score = 0;
        for (const token of messageTokens) {
            if (productFamily === token || productName === token) score += 10;
            else if (productFamily.includes(token)) score += 6;
            else if (productName.includes(token)) score += 4;
        }

        if (messageTokens.length > 1 && messageTokens.every((token) => haystack.includes(token))) {
            score += 8;
        }

        return score;
    };

    const matchedProducts = products
        .map((product) => ({ ...product, _score: scoreProduct(product) }))
        .filter((product) => product._score > 0)
        .sort((a, b) => b._score - a._score || a.price - b.price);

    if (!matchedProducts.length) {
        return { exactMatches: [], relatedMatches: [], sharedToken: null };
    }

    const bestScore = matchedProducts[0]._score;
    const exactMatches = matchedProducts
        .filter((product) => product._score === bestScore)
        .map(({ _score, ...product }) => product)
        .sort((a, b) => a.price - b.price);

    // Escolhe como token de agrupamento o termo que aparece no MAIOR número de
    // produtos do catálogo (ex: "edredom" está em 5 produtos, "queen" em 1).
    // Assim NUNCA escondemos variações por causa de uma palavra específica como "queen".
    const tokenCoverage = (token) =>
        products.filter((product) => {
            const haystack = `${normalizeText(product.name || '')} ${normalizeText(product.family || '')}`;
            return haystack.includes(token);
        }).length;

    const sharedToken = [...messageTokens].sort((a, b) => tokenCoverage(b) - tokenCoverage(a))[0];

    const relatedMatches = matchedProducts
        .filter((product) => {
            const haystack = `${normalizeText(product.name || '')} ${normalizeText(product.family || '')}`;
            return haystack.includes(sharedToken);
        })
        .map(({ _score, ...product }) => product)
        .sort((a, b) => a.price - b.price);

    return {
        exactMatches,
        relatedMatches: (relatedMatches.length ? relatedMatches : exactMatches).sort((a, b) => a.price - b.price),
        sharedToken,
    };
};

Deno.serve(async (req) => {
    const requestId = crypto.randomUUID();
    let base44 = null;
    let conversation = null;
    let customer = null;
    let senderFn = 'zapi_sender';
    let invokeSender = null;

    try {
        if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
        base44 = createClientFromRequest(req);
        const inputBody = await req.json();
        requireInternalRequest(req, inputBody);
        invokeSender = (payload) => base44.asServiceRole.functions.invoke(senderFn, {
            ...payload,
            _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
        });
        
        const updateNewCustomerStage = async (customerId, newStage) => {
            const cards = await base44.asServiceRole.entities.CrmCard.filter({ 
                pipeline_type: 'NEW_CUSTOMER', 
                customer_id: customerId 
            });
            for (const card of cards) {
                if (card.stage !== 'Convertido' && card.stage !== 'Inativo') {
                    await base44.asServiceRole.entities.CrmCard.update(card.id, { stage: newStage });
                }
            }
        };
        const { conversation_id, message_id, customer_id, payload, downloaded_file_url } = inputBody;

        // ORIGEM DA CONEXÃO: a 2ª conexão Z-API (loja Moinhos) marca source='zapi_moinhos'
        // no payload e na conversa. Quando for Moinhos, a IA responde pelo sender dedicado
        // (zapi_moinhos_sender) e usa o prompt exclusivo da loja Moinhos.
        // Detecção inicial pelo payload; reavaliada abaixo com o metadata da conversa
        // (para o caso da rede de segurança recoverUnansweredMessages, que não passa source).
        let isMoinhos = ['zapi_moinhos', 'whatsapp_moinhos'].includes(payload?.source) || ['zapi_moinhos', 'whatsapp_moinhos'].includes(inputBody.source);
        senderFn = payload?.source === 'whatsapp_moinhos'
            ? 'whatsapp_moinhos_sender'
            : isMoinhos ? 'zapi_moinhos_sender' : 'zapi_sender';

        // 1. Fetch Context
        const [loadedConversation, message, loadedCustomer] = await Promise.all([
            base44.asServiceRole.entities.Conversation.get(conversation_id),
            base44.asServiceRole.entities.Message.get(message_id),
            base44.asServiceRole.entities.Customer.get(customer_id)
        ]);

        conversation = loadedConversation;
        customer = loadedCustomer;

        if (!conversation || !message) {
            return Response.json({ error: "Context not found" }, { status: 404 });
        }

        // Reavalia a origem Moinhos usando também o metadata da conversa (fonte confiável,
        // persistida pelo webhook), cobrindo chamadas sem source no payload.
        if (!isMoinhos && ['zapi_moinhos', 'whatsapp_moinhos'].includes((conversation.metadata || {}).source)) {
            isMoinhos = true;
            senderFn = (conversation.metadata || {}).source === 'whatsapp_moinhos' ? 'whatsapp_moinhos_sender' : 'zapi_moinhos_sender';
        }

        // Agenda automaticamente a coleta pendente (salva via save_pickup_details) após pagamento confirmado.
        // Retorna o texto de confirmação para anexar à mensagem, ou '' se não havia coleta pendente / falhou.
        const autoSchedulePendingPickup = async (state) => {
            const pp = state?.pending_pickup;
            if (!pp?.date || !pp?.period) return '';
            try {
                const r = await base44.asServiceRole.functions.invoke('schedulePickupTool', {
                    ...pp,
                    customer_id: customer.id,
                    _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                });
                if (r.data?.success) {
                    const shiftInfo = pp.period === 'morning' ? 'Manhã (das 8h às 12h)' : 'Tarde (das 13h às 16h)';
                    const [, mo, d] = pp.date.split('-');
                    return `\n\n🚚 *Coleta confirmada!* Dia ${d}/${mo}, turno da ${shiftInfo}${pp.address ? `, no endereço: ${pp.address}` : ''}. Pagamento confirmado via Pix ✅`;
                }
                console.warn('Auto-schedule pending pickup returned error:', r.data?.error);
            } catch (e) {
                console.error('Auto-schedule pending pickup failed:', e);
            }
            return '';
        };

        // If message is OUTBOUND, ignore (loop prevention)
        if (message.direction === 'OUT') {
            return Response.json({ status: "ignored_outbound" });
        }

        // 🚨 TRAVA DE IDEMPOTÊNCIA: a mesma mensagem pode chegar aqui por mais de um
        // caminho (gatilho da IA + rede de segurança). Sem esta trava a Glória responde
        // duas vezes a mesma pergunta.
        if (message.ai_answered) {
            return Response.json({ status: "already_answered" });
        }
        await base44.asServiceRole.entities.Message.update(message.id, { ai_answered: true });

        if (message.type === 'AUDIO' && !message.text) {
            let audioUrl = downloaded_file_url || message.media_file_id || (payload.audio && payload.audio.audioUrl);
            if (audioUrl) {
                try {
                    const audioResponse = await fetch(audioUrl);
                    if (audioResponse.ok) {
                        const mimeType = audioResponse.headers.get('content-type')?.split(';')[0] || 'audio/ogg';
                        const base64Audio = bytesToBase64(new Uint8Array(await audioResponse.arrayBuffer()));
                        const transcript = await transcribeAudioWithGemini({
                            base64Audio,
                            mimeType,
                            model: (await getAiSettings(base44)).model
                        });
                        if (!transcript) throw new Error('Transcrição vazia');
                        message.text = transcript;
                        await base44.asServiceRole.entities.Message.update(message.id, { text: transcript });
                    }
                } catch (e) {
                    console.error("Transcription error:", e);
                    await invokeSender({
                        phone: customer.phones[0],
                        message: "Desculpe, não consegui entender o áudio. Poderia digitar, por favor?",
                        conversation_id: conversation.id
                    });
                    return Response.json({ action: "audio_failed" });
                }
            }
        }

        // Respostas a disparos continuam com a IA. Limpa apenas bloqueios automáticos
        // antigos criados por campanhas; transferências humanas legítimas permanecem intactas.
        if (conversation.handoff_required && isDispatchGeneratedHandoff(conversation.metadata)) {
            const cleanedMetadata = clearDispatchGeneratedHandoff(conversation.metadata);
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                handoff_required: false,
                metadata: cleanedMetadata
            });
            conversation.handoff_required = false;
            conversation.metadata = cleanedMetadata;
        }

        // Handoff solicitado pelo cliente/equipe continua bloqueando a IA normalmente.
        if (conversation.handoff_required) {
             console.log(`Skipping orchestrator for conversation ${conversation.id} (handoff required)`);
             return Response.json({ status: "skipped_handoff" });
        }

        const textLower = (message.text || "").trim().toLowerCase();
        const cleanText = textLower.replace(/[^a-z0-9]/g, '');
        const currentState = conversation.metadata || {};

        if (message.type === 'TEXT' && shouldIgnoreSoloMessage(message.text || '') && !currentState.flow) {
             console.log(`Skipping orchestrator due to ignored solo text: ${message.text}`);
             return Response.json({ status: "ignored_solo_text" });
        }
        // As unidades vêm SEMPRE do banco. Nada é criado automaticamente aqui.
        const units = await base44.asServiceRole.entities.Unit.list('name', 50);

        // Unidade padrão: a primeira unidade cadastrada. Não pergunta ao cliente.
        if (!customer.unit_id) {
            const defaultUnit = units[0];
            if (defaultUnit) {
                await base44.asServiceRole.entities.Customer.update(customer.id, {
                    unit_id: defaultUnit.id,
                    preferred_unit_name: defaultUnit.name
                });
                customer.unit_id = defaultUnit.id;
                customer.preferred_unit_name = defaultUnit.name;

                await updateNewCustomerStage(customer.id, 'Qualificação');

                // Backfill registros antigos do cliente sem unidade
                const [crmCards, customerQuotes, customerOrders, customerPayments] = await Promise.all([
                    base44.asServiceRole.entities.CrmCard.filter({ customer_id: customer.id }),
                    base44.asServiceRole.entities.Quote.filter({ customer_id: customer.id }),
                    base44.asServiceRole.entities.Order.filter({ customer_id: customer.id }),
                    base44.asServiceRole.entities.Payment.filter({ customer_id: customer.id })
                ]);

                await Promise.all([
                    ...crmCards.filter(c => !c.unit_id).map((card) => base44.asServiceRole.entities.CrmCard.update(card.id, { unit_id: defaultUnit.id })),
                    ...customerQuotes.filter(q => !q.unit_id).map((quote) => base44.asServiceRole.entities.Quote.update(quote.id, { unit_id: defaultUnit.id })),
                    ...customerOrders.filter(o => !o.unit_id).map((order) => base44.asServiceRole.entities.Order.update(order.id, { unit_id: defaultUnit.id })),
                    ...customerPayments.filter(p => !p.unit_id).map((payment) => base44.asServiceRole.entities.Payment.update(payment.id, { unit_id: defaultUnit.id }))
                ]);
            }
        }

        const activeUnitId = customer.unit_id || currentState.unit_id || null;
        const activeUnitName = customer.preferred_unit_name || currentState.unit_name || units.find((unit) => unit.id === activeUnitId)?.name || '5àsec';

        // Um pedido explícito de NOVO orçamento sempre encerra o estado operacional anterior,
        // mesmo quando a conversa do WhatsApp continua aberta. Mantemos apenas identidade/unidade.
        const startsNewQuote = message.type === 'TEXT' && isExplicitNewQuoteIntent(message.text || '');
        if (startsNewQuote && currentState.new_quote_message_id !== message.id) {
            const staleCollectingCards = await base44.asServiceRole.entities.CrmCard.filter({
                pipeline_type: 'QUOTE',
                customer_id: customer.id,
                stage: 'Coletando itens'
            });
            await Promise.all(staleCollectingCards.map((card) =>
                base44.asServiceRole.entities.CrmCard.update(card.id, { stage: 'Expirado' })
            ));
            await base44.asServiceRole.entities.CrmCard.create({
                pipeline_type: 'QUOTE',
                stage: 'Coletando itens',
                priority: 'MEDIUM',
                customer_id: customer.id,
                unit_id: activeUnitId
            });
            Object.assign(currentState, {
                flow: 'TEXT_QUOTE',
                step: 'COLLECTING_ITEMS_TEXT',
                temp_items: [],
                pending_pickup: null,
                delivery_requested: false,
                new_quote_message_id: message.id,
                new_quote_started_at: new Date().toISOString()
            });
            await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState } });
        }

        // 2. Global Commands
        // Handoff check
        if (textLower.includes("atendente") || textLower.includes("humano")) {
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                handoff_required: true,
                metadata: { ...currentState, flow: 'HANDOFF' }
            });
            
            await invokeSender({
                phone: customer.phones[0],
                message: "Entendido. Estou transferindo você para um de nossos atendentes humanos. Aguarde um momento.",
                conversation_id: conversation.id
            });

            await base44.asServiceRole.entities.StaffNotification.create({
                type: 'NEW_QUOTE', 
                target_team: 'support',
                payload: { conversation_id, customer_name: customer.full_name },
                sent_at: new Date().toISOString()
            });

            return Response.json({ action: "handoff" });
        }

        // 3. State Machine
        
        // Comprovantes são evidência pendente: nunca confirmam pagamento apenas pela imagem.
        if ((message.type === 'IMAGE' || message.type === 'DOC') && currentState.flow === 'WAITING_RECEIPT') {
            const receiptUrl = downloaded_file_url || message.media_file_id || (payload.image && payload.image.imageUrl) || (payload.document && payload.document.documentUrl);

            if (receiptUrl) {
                const paymentCards = await base44.asServiceRole.entities.CrmCard.filter({
                    customer_id: customer.id,
                    pipeline_type: 'PAYMENT',
                    stage: 'Aguardando Pix'
                });

                if (paymentCards.length > 0) {
                    const card = paymentCards[0];
                    await base44.asServiceRole.entities.CrmCard.update(card.id, {
                        stage: 'Em conferência',
                        receipt_url: receiptUrl
                    });

                    let amount = 0;
                    let unitId = activeUnitId;
                    if (card.linked_quote_id) {
                        const quote = await base44.asServiceRole.entities.Quote.get(card.linked_quote_id);
                        amount = Number(quote?.total || 0);
                        unitId = quote?.unit_id || unitId;
                    } else if (card.linked_order_id) {
                        const order = await base44.asServiceRole.entities.Order.get(card.linked_order_id);
                        amount = Number(order?.total_amount || 0);
                        unitId = order?.unit_id || unitId;
                    }

                    const paymentFilter = card.linked_order_id
                        ? { order_id: card.linked_order_id }
                        : { quote_id: card.linked_quote_id };
                    const existingPayments = await base44.asServiceRole.entities.Payment.filter(paymentFilter);
                    const pendingPayment = existingPayments.find((payment) => payment.status === 'pending');
                    const payment = pendingPayment || await base44.asServiceRole.entities.Payment.create({
                        customer_id: customer.id,
                        quote_id: card.linked_quote_id,
                        order_id: card.linked_order_id,
                        unit_id: unitId,
                        status: 'pending',
                        amount,
                        payment_method: 'pix',
                        notes: 'Comprovante recebido por imagem; aguardando conferência.'
                    });

                    await base44.asServiceRole.entities.HumanReview.create({
                        unit_id: unitId,
                        review_type: 'payment_receipt',
                        status: 'pending',
                        priority: 'high',
                        entity_type: 'payment',
                        entity_id: payment.id,
                        reason_codes: ['receipt_requires_settlement_confirmation'],
                        summary: `Conferir comprovante Pix de ${customer.full_name || 'cliente'}`,
                        proposed_data: {
                            receipt_url: receiptUrl,
                            amount,
                            quote_id: card.linked_quote_id,
                            order_id: card.linked_order_id
                        }
                    });

                    await base44.asServiceRole.entities.StaffNotification.create({
                        type: 'NEW_QUOTE',
                        target_team: 'support',
                        payload: {
                            conversation_id: conversation.id,
                            customer_name: customer.full_name,
                            summary: 'Comprovante recebido. Validar valor, favorecido e liquidação antes de confirmar o pagamento.'
                        },
                        sent_at: new Date().toISOString()
                    });

                    await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                        handoff_required: true,
                        metadata: { ...currentState, flow: 'HANDOFF_PAYMENT_REVIEW' }
                    });

                    await invokeSender({
                        phone: customer.phones[0],
                        message: `✅ Recebi o seu comprovante. Ele foi encaminhado para conferência e o pagamento será confirmado assim que validarmos a liquidação.`,
                        conversation_id: conversation.id
                    });

                    return Response.json({ action: 'receipt_pending_manual_review' });
                }
            }
        }

        // Um novo atendimento em outro dia deve gerar um novo card no CRM.
        // Evita reutilizar indefinidamente um card antigo que ficou em "Coletando itens".
        if (message.type === 'IMAGE' && currentState.flow !== 'WAITING_RECEIPT') {
            const collectingCards = await base44.asServiceRole.entities.CrmCard.filter({
                pipeline_type: 'QUOTE',
                customer_id: customer.id,
                stage: 'Coletando itens'
            }, '-created_date', 1);
            const brasiliaDay = (value) => new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Sao_Paulo',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(new Date(value));
            const latestCollectingCard = collectingCards[0];
            const isCardFromPreviousDay = latestCollectingCard && brasiliaDay(latestCollectingCard.created_date) !== brasiliaDay(new Date());

            if (isCardFromPreviousDay) {
                await base44.asServiceRole.entities.CrmCard.update(latestCollectingCard.id, { stage: 'Expirado' });
                await base44.asServiceRole.entities.CrmCard.create({
                    pipeline_type: 'QUOTE',
                    stage: 'Coletando itens',
                    priority: 'MEDIUM',
                    customer_id: customer.id,
                    unit_id: activeUnitId
                });
                currentState.flow = 'QUOTE';
                currentState.step = 'COLLECTING_IMAGES';
                currentState.temp_items = [];
                await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState } });
            } else if (!latestCollectingCard && currentState.flow === 'QUOTE') {
                await base44.asServiceRole.entities.CrmCard.create({
                    pipeline_type: 'QUOTE',
                    stage: 'Coletando itens',
                    priority: 'MEDIUM',
                    customer_id: customer.id,
                    unit_id: activeUnitId
                });
            }
        }

        // Auto-start quote flow if an image is sent outside of QUOTE flow and not WAITING_RECEIPT
        if (message.type === 'IMAGE' && currentState.flow !== 'QUOTE' && currentState.flow !== 'WAITING_RECEIPT') {
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                metadata: { ...currentState, flow: 'QUOTE', step: 'COLLECTING_IMAGES' }
            });
            // Set flow locally so it processes immediately below
            currentState.flow = 'QUOTE'; 

            await updateNewCustomerStage(customer.id, 'Primeiro orçamento');

            const existingQuoteCards = await base44.asServiceRole.entities.CrmCard.filter({
                pipeline_type: 'QUOTE',
                customer_id: customer.id,
                stage: 'Coletando itens'
            });
            if (existingQuoteCards.length === 0) {
                await base44.asServiceRole.entities.CrmCard.create({
                    pipeline_type: 'QUOTE',
                    stage: 'Coletando itens',
                    priority: 'MEDIUM',
                    customer_id: customer.id,
                    unit_id: activeUnitId
                });
            }
        }

        // FLOW: QUOTE (Orçamento)
        if (currentState.flow === 'QUOTE') {
            if (message.type === 'IMAGE') {
                
                // 1. Fetch recent images for this conversation
                const recentMsgs = await base44.asServiceRole.entities.Message.filter({
                    conversation_id: conversation.id,
                    type: 'IMAGE',
                    direction: 'IN'
                });
                
                const nowTime = new Date().getTime();
                const currentItems = currentState.temp_items || [];
                const processedMessageIds = currentItems.map(i => i.message_id).filter(Boolean);
                
                // Consider messages from the last 60 seconds that haven't been processed
                const unprocessedImages = recentMsgs.filter(msg => {
                    const msgTime = new Date(msg.created_date).getTime();
                    return (nowTime - msgTime < 60000) && !processedMessageIds.includes(msg.id);
                });

                // Ensure current message is included
                if (!unprocessedImages.find(m => m.id === message.id) && !processedMessageIds.includes(message.id)) {
                    unprocessedImages.push(message);
                }

                if (unprocessedImages.length === 0) {
                    return Response.json({ action: "already_processed" });
                }

                // 2. Process all unprocessed images concurrently
                const visionPromises = unprocessedImages.map(async (imgMsg) => {
                    let imgUrl = null;
                    if (imgMsg.id === message.id && downloaded_file_url) {
                        imgUrl = downloaded_file_url;
                    } else if (imgMsg.media_file_id) {
                        imgUrl = imgMsg.media_file_id;
                    } else if (imgMsg.raw_payload && imgMsg.raw_payload.image && imgMsg.raw_payload.image.imageUrl) {
                        imgUrl = imgMsg.raw_payload.image.imageUrl;
                    }

                    if (!imgUrl) return null;

                    try {
                        const visionResult = await base44.asServiceRole.functions.invoke('openai_vision', {
                            image_url: imgUrl,
                            quote_id: null,
                            _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                        }).then(res => res.data);
                        
                        return {
                            message_id: imgMsg.id,
                            garment_type: visionResult.garment_type || "Peça desconhecida",
                            confidence: visionResult.confidence || 0,
                            unit_price: visionResult.estimated_price || null,
                            image_url: imgUrl,
                            notes: visionResult.notes || "",
                            is_receipt: visionResult.is_receipt || false
                        };
                    } catch (e) {
                        console.error("Vision error for img", imgMsg.id, e);
                        return null;
                    }
                });

                const visionResults = (await Promise.all(visionPromises)).filter(Boolean);

                if (visionResults.length === 0) {
                     await invokeSender({
                        phone: customer.phones[0],
                        message: "Não consegui processar as imagens. Tente enviar novamente.",
                        conversation_id: conversation.id
                    });
                    return Response.json({ error: "No image URLs processed" });
                }

                const receiptResult = visionResults.find(r => r.is_receipt);
                if (receiptResult) {
                    const pendingQuotes = await base44.asServiceRole.entities.Quote.filter({
                        customer_id: customer.id,
                        status: 'SENT'
                    }, '-created_date', 1);
                    const quoteToReview = pendingQuotes[0] || null;
                    const receiptImgUrl = receiptResult.image_url || downloaded_file_url || null;
                    const reviewUnitId = quoteToReview?.unit_id || activeUnitId;

                    let payment = null;
                    if (quoteToReview) {
                        const existingPayments = await base44.asServiceRole.entities.Payment.filter({ quote_id: quoteToReview.id });
                        payment = existingPayments.find((candidate) => candidate.status === 'pending') || existingPayments[0] || null;
                        if (!payment) {
                            payment = await base44.asServiceRole.entities.Payment.create({
                                customer_id: customer.id,
                                quote_id: quoteToReview.id,
                                unit_id: reviewUnitId,
                                status: 'pending',
                                amount: Number(quoteToReview.total || 0),
                                payment_method: 'pix',
                                notes: 'Comprovante classificado por visão; aguardando conferência.'
                            });
                        }
                    }

                    const pendingPayCards = await base44.asServiceRole.entities.CrmCard.filter({
                        customer_id: customer.id,
                        pipeline_type: 'PAYMENT'
                    });
                    const paymentCard = pendingPayCards.find((card) => ['Aguardando Pix', 'Em conferência'].includes(card.stage));
                    if (paymentCard) {
                        await base44.asServiceRole.entities.CrmCard.update(paymentCard.id, {
                            stage: 'Em conferência',
                            receipt_url: receiptImgUrl,
                            linked_quote_id: paymentCard.linked_quote_id || quoteToReview?.id
                        });
                    } else {
                        await base44.asServiceRole.entities.CrmCard.create({
                            pipeline_type: 'PAYMENT',
                            stage: 'Em conferência',
                            priority: 'HIGH',
                            customer_id: customer.id,
                            unit_id: reviewUnitId,
                            linked_quote_id: quoteToReview?.id,
                            receipt_url: receiptImgUrl
                        });
                    }

                    await base44.asServiceRole.entities.HumanReview.create({
                        unit_id: reviewUnitId,
                        review_type: 'payment_receipt',
                        status: 'pending',
                        priority: 'high',
                        entity_type: payment ? 'payment' : 'document_asset',
                        entity_id: payment?.id || conversation.id,
                        reason_codes: quoteToReview ? ['receipt_requires_settlement_confirmation'] : ['quote_not_linked', 'receipt_requires_settlement_confirmation'],
                        summary: quoteToReview
                            ? `Conferir comprovante do orçamento ${quoteToReview.id.slice(0, 8)}`
                            : 'Comprovante recebido sem orçamento vinculado',
                        proposed_data: {
                            receipt_url: receiptImgUrl,
                            quote_id: quoteToReview?.id,
                            amount: quoteToReview?.total,
                            conversation_id: conversation.id
                        }
                    });

                    await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                        handoff_required: true,
                        metadata: { ...currentState, flow: 'HANDOFF_PAYMENT_REVIEW', temp_items: [] }
                    });
                    await base44.asServiceRole.entities.StaffNotification.create({
                        type: 'NEW_QUOTE',
                        target_team: 'support',
                        payload: {
                            conversation_id: conversation.id,
                            customer_name: customer.full_name,
                            summary: quoteToReview
                                ? 'Comprovante recebido para conferência. Não confirmar pagamento pela imagem.'
                                : 'Comprovante recebido sem orçamento vinculado. Conferir e vincular manualmente.'
                        },
                        sent_at: new Date().toISOString()
                    });
                    await invokeSender({
                        phone: customer.phones[0],
                        message: `✅ Recebi o seu comprovante e encaminhei para conferência. Assim que a liquidação for validada, confirmaremos o pagamento e daremos continuidade ao pedido.`,
                        conversation_id: conversation.id
                    });
                    return Response.json({ action: 'receipt_pending_manual_review' });
                }

                // Pergunta sobre remoção de mancha (batom, tinta, etc.): as fotos são
                // etiqueta/detalhe da mancha, não peças para orçamento em lista.
                const recentInTexts = (await base44.asServiceRole.entities.Message.filter({
                    conversation_id: conversation.id,
                    direction: 'IN',
                    type: 'TEXT'
                }, '-created_date', 6)).map(m => m.text || '');

                const isStainContext = detectStainInquiry(recentInTexts);
                const onlyDetailPhotos = looksLikeDetailPhotos(visionResults);

                if (isStainContext) {
                    const garmentHint = recentInTexts.join(' ').match(/macac[ãa]o|vestido|camisa|cal[çc]a|blusa|casaco|jaqueta|terno|saia|blazer|kimono|len[çc]ol|edredom|toalha|tapete|cortina/i)?.[0] || null;

                    await base44.asServiceRole.entities.StaffNotification.create({
                        type: 'NEW_IMAGES',
                        target_team: 'sales',
                        payload: {
                            customer_name: customer.full_name,
                            image_count: visionResults.length,
                            summary: 'Cliente pergunta sobre remoção de mancha e enviou fotos da mancha/etiqueta.'
                        },
                        sent_at: new Date().toISOString()
                    });

                    await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                        metadata: { ...currentState, flow: 'STAIN_INQUIRY', temp_items: [] }
                    });

                    await invokeSender({
                        phone: customer.phones[0],
                        message: buildStainReply(garmentHint),
                        conversation_id: conversation.id
                    });

                    return Response.json({ action: "stain_inquiry_answered" });
                }

                // Nunca listar peças "desconhecido" como orçamento: se nenhuma foto foi
                // reconhecida como peça (etiqueta, close, detalhe), perguntar antes.
                if (onlyDetailPhotos && !visionResults.some(r => (r.garment_type || '').toLowerCase() !== 'desconhecido' && (r.garment_type || '').toLowerCase() !== 'peça desconhecida' && (r.confidence || 0) >= 0.6)) {
                    await invokeSender({
                        phone: customer.phones[0],
                        message: `Recebi as suas fotos! 📸 Só não consegui identificar a peça pelas imagens (parecem ser detalhes ou etiqueta).\n\nMe diz por texto qual é a peça (ex: macacão, vestido, casaco) e o que você precisa — limpeza, passadoria ou remoção de mancha — que eu te passo o valor certinho.`,
                        conversation_id: conversation.id
                    });
                    return Response.json({ action: "images_need_clarification" });
                }

                // Update session state with new items
                currentItems.push(...visionResults);

                await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                    metadata: { ...currentState, temp_items: currentItems }
                });

                // Notify Staff about new images
                await base44.asServiceRole.entities.StaffNotification.create({
                    type: 'NEW_IMAGES',
                    target_team: 'sales',
                    payload: { customer_name: customer.full_name, image_count: visionResults.length },
                    sent_at: new Date().toISOString()
                });

                // Generate response message
                // Catálogo necessário para montar as variações de preço (era a causa do crash "products is not defined")
                const products = await base44.asServiceRole.entities.Product.filter({ active: true });
                const allRecognized = visionResults.every(r => r.garment_type.toLowerCase() !== 'desconhecido' && r.confidence >= 0.6);
                
                // Para uma peça identificada, busca TODAS as variações relacionadas no catálogo
                // (ex: casaco normal R$54, casaco especial R$88, sobretudo R$100) para nunca cravar
                // um valor único quando existem versões comum/especial.
                const buildVariationLines = (garmentType) => {
                    const { relatedMatches } = findRelatedCatalogProducts(products, garmentType);
                    if (!relatedMatches || relatedMatches.length <= 1) return null;
                    return relatedMatches.map(p => `   • ${p.name}: R$ ${p.price.toFixed(2)}`).join('\n');
                };
                const AVALIACAO_HUMANA = `\n\n⚠️ *Este valor é uma estimativa para peça comum.* As fotos serão avaliadas pela nossa equipe e, caso seja uma peça especial (tecido, marca ou detalhes que exijam cuidado extra), o valor pode mudar — nesse caso entraremos em contato antes.`;

                let msg = '';
                if (visionResults.length === 1) {
                    const r = visionResults[0];
                    if (r.garment_type.toLowerCase() === 'desconhecido' || r.confidence < 0.6) {
                        msg = `🤔 Não consegui identificar essa peça com certeza. Qual é a roupa? (Digite o nome)`;
                    } else {
                        msg = `✅ Identifiquei: *${r.garment_type}*`;
                        const variationLines = buildVariationLines(r.garment_type);
                        if (variationLines) {
                            msg += `\n\n💰 Para esse tipo de peça temos as seguintes opções de valor:\n${variationLines}`;
                        } else if (r.unit_price) {
                            msg += `\n💰 Valor estimado: R$ ${r.unit_price.toFixed(2)}`;
                        }
                        msg += AVALIACAO_HUMANA;
                        
                        const garmentLower = r.garment_type.toLowerCase();
                        if (garmentLower.includes('edredom') || garmentLower.includes('cobertor')) {
                            msg += `\n💡 *Dica:* Sugerimos o serviço *Bactericida* (+R$ 40,00) para higienização profunda (99,9%).`;
                        } else if (garmentLower.includes('casaco') || garmentLower.includes('jaqueta')) {
                            msg += `\n💡 *Dica:* Sugerimos *Impermeabilização* (+R$ 21,00) contra líquidos/manchas ou *Bactericida* (+R$ 26,00).`;
                        } else if (garmentLower.includes('cortina')) {
                            msg += `\n💡 *Dica:* Sugerimos o *Bactericida* (+R$ 25,00) para eliminar ácaros e odores.`;
                        } else if (garmentLower.includes('tapete')) {
                            msg += `\n💡 *Dica:* Para tapetes, temos o *Bactericida* (+R$ 27,00/m²).`;
                        } else if (garmentLower.includes('vestido')) {
                            msg += `\n💡 *Dica:* Sugerimos *Revitalizante/Engomagem* (+R$ 17,00) para recuperar o brilho e dar acabamento perfeito.`;
                        } else if (garmentLower.includes('macacão') || garmentLower.includes('macacao')) {
                            msg += `\n💡 *Dica:* Sugerimos *Revitalizante/Engomagem* (+R$ 15,00).`;
                        }

                        msg += `\n\n📸 Envie a próxima foto ou digite *'Finalizar'* para fechar o orçamento.`;
                    }
                } else {
                    const listable = visionResults.filter(r => {
                        const g = (r.garment_type || '').toLowerCase();
                        return g !== 'desconhecido' && g !== 'peça desconhecida' && (r.confidence || 0) >= 0.6;
                    });
                    msg = `✅ Identifiquei ${listable.length} peça(s):\n`;
                    listable.forEach(r => {
                        const variationLines = buildVariationLines(r.garment_type);
                        if (variationLines) {
                            msg += `\n- *${r.garment_type}* — opções de valor:\n${variationLines}\n`;
                        } else {
                            msg += `- ${r.garment_type} ${r.unit_price ? `(R$ ${r.unit_price.toFixed(2)})` : ''}\n`;
                        }
                    });

                    msg += AVALIACAO_HUMANA;

                    if (!allRecognized) {
                        msg += `\n\n🤔 Algumas peças não consegui identificar bem. Você pode confirmar quais são através de texto?`;
                    } else {
                        msg += `\n\n📸 Envie mais fotos ou digite *'Finalizar'* para fechar o orçamento.`;
                    }
                }

                const shouldShowQuoteButtons = allRecognized;

                await invokeSender({
                    phone: customer.phones[0],
                    message: msg,
                    conversation_id: conversation.id
                });

                if (shouldShowQuoteButtons) {
                    await invokeSender({
                        phone: customer.phones[0],
                        type: 'OPTION_LIST',
                        message: 'Escolha uma opção abaixo:',
                        optionList: {
                            title: 'Próximo passo',
                            buttonLabel: 'Abrir opções',
                            options: [
                                { id: 'more_photos', title: 'Enviar mais fotos', description: 'Continuar adicionando peças' },
                                { id: 'finish_quote', title: 'Finalizar', description: 'Fechar o orçamento agora' }
                            ]
                        },
                        conversation_id: conversation.id
                    });
                }

                return Response.json({ action: "quote_images_analyzed", count: visionResults.length });

            } else if (textLower.includes("finalizar") || textLower.includes("pode fechar") || /\b(fechar|fechado|fecha)\b/.test(textLower)) {
                // Finish quote
                const currentItems = currentState.temp_items || [];
                const total = currentItems.reduce((acc, item) => acc + (item.unit_price || 0), 0);

                await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                    metadata: { ...currentState, flow: null } // Reset
                });
                
                let finalMessage = `✅ *Orçamento Finalizado*\n\n*Resumo das peças:*\n`;
                currentItems.forEach(item => {
                    const priceText = item.unit_price ? `R$ ${item.unit_price.toFixed(2)}` : 'A definir';
                    finalMessage += `- ${item.garment_type}: ${priceText}\n`;
                });
                finalMessage += `\n💰 *Valor Total Estimado: R$ ${total.toFixed(2)}*\n\n*Esse orçamento é para peças comuns. As imagens das peças serao avaliadas por nossa equipe e caso haja alguma peça especial entraremos em contato para informar algum acrescimo ou desconto que possa ocorrer. Pode efetuar o pagamento desse orçamento sem problemas*\n\n`;
                const hasForbiddenBagItems = currentItems.some(item => {
                    const garment = normalizeText(item.garment_type);
                    return garment.includes('edredom') || garment.includes('cobert') || garment.includes('manta') || garment.includes('tapete') || garment.includes('cortina') || garment.includes('terno') || garment.includes('vestido') || garment.includes('casaco') || garment.includes('jaqueta') || garment.includes('sofa') || garment.includes('sofá');
                });

                finalMessage += `💡 *Dica:* Se preferir, temos opções de planos pré-pagos que podem ser mais vantajosas:\n\n`;
                
                if (!hasForbiddenBagItems) {
                    finalMessage += `*Bags (Pacotes de peças):*\n- Minha Bag (até 18 peças): R$ 90,00\n- Bag (até 35 peças): R$ 160,00\n- Bag Família (até 50 peças): R$ 185,00\n\n`;
                }

                const planProducts = await base44.asServiceRole.entities.Product.filter({
                    active: true,
                    category: 'Planos'
                }, 'price');
                const plansText = planProducts.length > 0
                    ? planProducts.map((product) => `- ${product.name}: ${product.description || `Pague R$ ${product.price.toFixed(2)} e receba créditos para usar na lavanderia.`}`).join('\n')
                    : '- Planos disponíveis mediante consulta na loja';

                finalMessage += `*Planos Pré-pagos:*\n${plansText}\n\n`;
                finalMessage += `Você prefere seguir com este orçamento ou tem interesse em adquirir um de nossos planos${!hasForbiddenBagItems ? ' ou bags' : ''}?`;

                await invokeSender({
                    phone: customer.phones[0],
                    message: finalMessage,
                    conversation_id: conversation.id
                });

                await invokeSender({
                    phone: customer.phones[0],
                    type: 'OPTION_LIST',
                    message: 'Escolha uma opção abaixo:',
                    optionList: {
                        title: 'Orçamento e ofertas',
                        buttonLabel: 'Abrir opções',
                        options: [
                            { id: 'follow_quote', title: 'Quero este orçamento', description: 'Seguir com este valor' },
                            { id: 'see_plans', title: 'Quero ver planos', description: 'Ver os planos pré-pagos' },
                            { id: 'see_bags', title: 'Quero ver bags', description: 'Ver os pacotes de peças' }
                        ]
                    },
                    conversation_id: conversation.id
                });
                
                // Create Quote entity here
                const newQuote = await base44.asServiceRole.entities.Quote.create({
                    customer_id: customer.id,
                    unit_id: activeUnitId,
                    status: 'SENT',
                    review_deadline_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h SLA
                    items: currentItems,
                    subtotal: total,
                    total: total
                });

                const existingQuoteCards = await base44.asServiceRole.entities.CrmCard.filter({
                    pipeline_type: 'QUOTE',
                    customer_id: customer.id,
                    stage: 'Coletando itens'
                });
                
                if (existingQuoteCards.length > 0) {
                    await base44.asServiceRole.entities.CrmCard.update(existingQuoteCards[0].id, {
                        stage: 'Enviado ao cliente',
                        linked_quote_id: newQuote.id,
                        due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
                    });
                } else {
                    await base44.asServiceRole.entities.CrmCard.create({
                        pipeline_type: 'QUOTE',
                        stage: 'Enviado ao cliente',
                        priority: 'HIGH',
                        customer_id: customer.id,
                        unit_id: activeUnitId,
                        linked_quote_id: newQuote.id,
                        due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
                    });
                }

                // Notify Staff
                await base44.asServiceRole.entities.StaffNotification.create({
                    type: 'NEW_QUOTE',
                    target_team: 'sales',
                    payload: { customer: customer.full_name, items_count: (currentState.temp_items || []).length },
                    sent_at: new Date().toISOString()
                });

                return Response.json({ action: "quote_finished" });
            }
        }



        // For all other TEXT interactions, let ChatGPT handle the natural conversation
        if (message.type === 'TEXT' || message.type === 'AUDIO') {
            const openai = createGeminiClient();

            // Determine correct greeting based on BRT timezone
            const hour = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getHours();
            let greeting = "Boa noite";
            if (hour >= 5 && hour < 12) greeting = "Bom dia";
            else if (hour >= 12 && hour < 18) greeting = "Boa tarde";

            // Perguntas diretas sobre coleta hoje/amanhã têm resposta determinística.
            // Isso impede a IA de oferecer sábado à tarde antes de consultar a agenda real.
            // EXCEÇÃO: quando payment_confirmed=true, a coleta é encaixe automático —
            // não interceptar, deixar a IA chamar schedule_pickup com encaixe=true.
            const pickupAvailabilityRequest = !currentState.payment_confirmed ? resolvePickupAvailabilityRequest(message.text || '') : null;
            if (pickupAvailabilityRequest) {
                const schedule = getPickupScheduleForDate(pickupAvailabilityRequest.date);
                let dayPickups = [];
                if (schedule.isOpen) {
                    const range = getPickupDateRange(pickupAvailabilityRequest.date);
                    dayPickups = await base44.asServiceRole.entities.Pickup.filter({
                        scheduled_at: { $gte: range.start, $lte: range.end },
                        status: { $ne: 'cancelled' }
                    });
                }
                const availability = buildPickupAvailabilityResponse({ request: pickupAvailabilityRequest, schedule, pickups: dayPickups });
                if (availability.period) {
                    currentState.pending_pickup = { ...(currentState.pending_pickup || {}), date: pickupAvailabilityRequest.date, period: availability.period };
                    await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState } });
                }
                await invokeSender({
                    phone: customer.phones[0],
                    message: availability.message,
                    conversation_id: conversation.id
                });
                return Response.json({ action: 'pickup_availability_answered', date: pickupAvailabilityRequest.date });
            }

            // ENCAIXE DETERMINÍSTICO: pagamento antecipado confirmado + cliente quer agendar coleta.
            // Não depende da IA — cria a coleta direto no próximo turno disponível.
            if (currentState.payment_confirmed && /\b(coleta|agendar|pegar|buscar|retirar)\b/i.test(message.text || '')) {
                const customerRecord = await base44.asServiceRole.entities.Customer.get(customer.id).catch(() => null);
                const hasSavedAddress = customerRecord?.address && customerRecord?.address_number;

                if (hasSavedAddress) {
                    const encaixe = await findNextEncaixeSlot(base44.asServiceRole);
                    if (encaixe) {
                        const oldPickups = await base44.asServiceRole.entities.Pickup.filter({ customer_id: customer.id, status: 'scheduled' });
                        for (const op of oldPickups) await base44.asServiceRole.entities.Pickup.update(op.id, { status: 'cancelled' });

                        const fullAddress = `${customerRecord.address}, ${customerRecord.address_number}${customerRecord.address_complement ? `, ${customerRecord.address_complement}` : ''}${customerRecord.neighborhood ? ` — ${customerRecord.neighborhood}` : ''}`;
                        await base44.asServiceRole.entities.Pickup.create({
                            customer_id: customer.id,
                            unit_id: currentState.unit_id || '6a99e42ee48200f5d8ddd176',
                            scheduled_at: encaixe.slotIso,
                            address: fullAddress,
                            neighborhood: customerRecord.neighborhood,
                            status: 'scheduled',
                            fee: 0,
                            notes: 'ENCAIXE — pagamento antecipado via Pix confirmado',
                            source: 'ai',
                            created_by_name: 'Glória (IA)',
                            metadata: { encaixe: true, payment_confirmed: true }
                        });
                        currentState.payment_confirmed = false;
                        currentState.flow = null;
                        currentState.pending_pickup = null;
                        await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState } });

                        const shiftLabel = encaixe.period === 'morning' ? 'manhã' : 'tarde';
                        await invokeSender({
                            phone: customer.phones[0],
                            message: `Recebi a confirmação do seu pagamento! ✅ Como você já pagou antecipado, sua coleta entrará como encaixe no próximo turno disponível: ${formatEncaixeDate(encaixe.date)}, turno da ${shiftLabel}. 🚚\n\nEndereço: ${fullAddress}\n\nAguarde nosso motorista! 😊`,
                            conversation_id: conversation.id
                        });
                        return Response.json({ action: 'encaixe_scheduled', date: encaixe.date, period: encaixe.period });
                    }
                    await invokeSender({
                        phone: customer.phones[0],
                        message: `Recebi a confirmação do seu pagamento! ✅ No momento não há turnos disponíveis para encaixe nos próximos dias. Vou verificar a agenda e te retornar com uma data específica. 😊`,
                        conversation_id: conversation.id
                    });
                    return Response.json({ action: 'encaixe_no_slots' });
                }
                await invokeSender({
                    phone: customer.phones[0],
                    message: `Recebi a confirmação do seu pagamento! ✅ Como você já pagou antecipado, sua coleta entrará como encaixe no próximo turno disponível. 🚚\n\nPara agendar, preciso do seu endereço completo: rua, número, complemento e bairro. 😊`,
                    conversation_id: conversation.id
                });
                return Response.json({ action: 'encaixe_needs_address' });
            }

            const fmtM2 = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

            // Contexto completo em UM ÚNICO lote paralelo (antes eram consultas sequenciais,
            // cada uma somando latência antes de a IA começar a responder).
            const [m2Records, ironing, orders, pendingQuotes, history, products, promotions, specialServiceRows, scheduledPickups] = await Promise.all([
                base44.asServiceRole.entities.SquareMeterPricing.list('', 1).catch(() => []),
                loadIroningSettings(base44),
                base44.asServiceRole.entities.Order.filter({
                    customer_id: customer.id,
                    status: { $ne: 'finished' }
                }),
                base44.asServiceRole.entities.Quote.filter({
                    customer_id: customer.id,
                    status: 'SENT'
                }, '-created_date', 1),
                base44.asServiceRole.entities.Message.filter({ conversation_id: conversation.id }, '-created_date', 25),
                base44.asServiceRole.entities.Product.filter({ active: true }),
                base44.asServiceRole.entities.Promotion.filter({ active: true }).catch(() => []),
                loadSpecialServiceRows(base44),
                base44.asServiceRole.entities.Pickup.filter({ customer_id: customer.id, status: 'scheduled' }).catch(() => [])
            ]);
            const m2 = m2Records[0] || { cortina_tipo_I: 30, cortina_tipo_II: 45, cortina_tipo_III: 65, tapete: 80 };

            // Filter out expired promotions
            const today = new Date().toISOString().slice(0, 10);
            const activePromotions = (promotions || []).filter(p => !p.valid_until || p.valid_until >= today);
            const promotionsContext = activePromotions.length > 0
                ? activePromotions.map(p => `- *${p.title}*: ${p.description}${p.valid_until ? ` (válido até ${new Date(p.valid_until).toLocaleDateString('pt-BR')})` : ''}`).join('\n')
                : 'Nenhuma promoção ativa no momento.';

            if (message.type === 'TEXT' && shouldIgnoreSoloMessage(message.text || '') && pendingQuotes.length === 0 && !currentState.flow) {
                console.log(`Skipping orchestrator due to simple acknowledgment: ${message.text}`);
                return Response.json({ status: "ignored_ack" });
            }

            const catalogContext = products.map((p) => `- ${p.name} | família: ${p.family || 'Geral'} | categoria: ${p.category || 'Sem categoria'} | descrição: ${p.description || 'Sem descrição'} | preço: R$ ${p.price.toFixed(2)}`).join("\n");

            // Agrupa produtos que compartilham a primeira palavra do nome (ex: todos os "EDREDOM").
            // Isso é injetado no prompt para que a IA NUNCA esconda variações nem invente preços.
            const variationGroups = {};
            for (const p of products) {
                const baseWord = normalizeText(p.name || '').split(/[^a-z0-9]+/).filter(w => w.length >= 3)[0];
                if (!baseWord) continue;
                if (!variationGroups[baseWord]) variationGroups[baseWord] = [];
                variationGroups[baseWord].push(p);
            }
            const variationContext = Object.entries(variationGroups)
                .filter(([, list]) => list.length > 1)
                .map(([word, list]) => {
                    const sorted = [...list].sort((a, b) => a.price - b.price);
                    return `${word.toUpperCase()} → ${sorted.map(p => `${p.name} (R$ ${p.price.toFixed(2)})`).join(' | ')}`;
                })
                .join('\n');

            // PONTO 1 e 4: O atalho automático de preço (buildCatalogPriceResponse) foi DESLIGADO.
            // Ele respondia direto do catálogo sem entender o contexto da conversa e, por casar
            // pedaços de palavra (ex: "casa" → "casal"/"casaco"), listava itens errados.
            // Agora é a própria IA quem responde os preços (com o catálogo no prompt + hallucinationGuard
            // conferindo os valores no final), considerando o contexto real da mensagem.
            const planProducts = products
                .filter((p) => p.category === 'Planos' || p.family === 'Planos')
                .sort((a, b) => a.price - b.price);
            const plansContext = planProducts.length > 0
                ? planProducts.map((p) => `- ${p.name}: ${p.description || `Pague R$ ${p.price.toFixed(2)} e receba créditos para usar na lavanderia.`}`).join("\n")
                : "- Planos pré-pagos disponíveis mediante consulta na loja.";

            const statusMap = {
                'pending': 'Recebido',
                'processing': 'Em processamento',
                'ready': 'Pronto para retirada',
                'delivered': 'Entregue',
                'finished': 'Finalizado'
            };
            const ordersContext = orders.length > 0 ? 
                orders.map(o => `Pedido #${o.ticket_number || o.id.slice(0,4)} - Status: ${statusMap[o.status] || o.status}`).join(" | ") : 
                "Nenhum pedido em aberto no momento.";

            // Fetch current quote context (building)
            const currentItems = currentState.temp_items || [];
            const quoteContext = currentItems.length > 0 ?
                `Itens no orçamento que está sendo montado: ${currentItems.map(i => i.garment_type).join(", ")}. Valor parcial: R$ ${currentItems.reduce((acc, item) => acc + (item.unit_price || 0), 0).toFixed(2)}.` :
                "Nenhum item no orçamento em rascunho.";

            const pendingQuoteContext = pendingQuotes.length > 0 ?
                `O cliente possui um orçamento ENVIADO aguardando aprovação no valor de R$ ${pendingQuotes[0].total.toFixed(2)}. IMPORTANTE: Se o cliente aceitar/aprovar este orçamento agora, você DEVE chamar a ferramenta 'approve_quote'. Depois informe apenas a chave Pix e peça o comprovante.` :
                "Nenhum orçamento aguardando aprovação no momento.";

            history.sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime());
            const deliveryIntentDetected = detectDeliveryIntent(history, currentState);
            if (deliveryIntentDetected && !currentState.delivery_requested) {
                currentState.delivery_requested = true;
                await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState } });
            }

            // Perguntas sobre preço do frete têm resposta determinística: não dependem da IA
            // e nunca desviam para coleta/agendamento antes de informar o valor.
            if (message.type === 'TEXT' && isDeliveryPriceQuestion(message.text || '')) {
                const knownTotal = resolveKnownDeliveryTotal({ pendingQuotes, state: currentState, history });
                await invokeSender({
                    phone: customer.phones[0],
                    message: buildDeliveryPriceResponse(knownTotal),
                    conversation_id: conversation.id
                });
                return Response.json({ action: 'delivery_price_answered', total: knownTotal });
            }

            const continuityFacts = buildConversationContinuityFacts(history, currentState); const bagsContext = buildBagsContext(products); const specialTableContext = buildSpecialTableContext(specialServiceRows);

            // COLETAS AGENDADAS DO CLIENTE: a IA precisa ENXERGAR a coleta que já existe para
            // tratar "quero trocar a data" como REMARCAÇÃO (reutilizando endereço/pagamento já
            // combinados), e não como uma coleta nova do zero.
            const pickupContext = scheduledPickups.length > 0
                ? scheduledPickups.map((p) => {
                    const dBRT = new Date(new Date(p.scheduled_at).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
                    const dateLabel = `${String(dBRT.getDate()).padStart(2, '0')}/${String(dBRT.getMonth() + 1).padStart(2, '0')}/${dBRT.getFullYear()}`;
                    const shiftLabel = dBRT.getHours() < 13 ? 'Manhã' : 'Tarde';
                    const feeLabel = Number(p.fee || 0) > 0 ? `taxa R$ ${Number(p.fee).toFixed(2)}` : 'tele grátis';
                    return `Coleta agendada: ${dateLabel}, turno da ${shiftLabel}, endereço: ${p.address || 'não informado'}${p.neighborhood ? ` (${p.neighborhood})` : ''}, ${feeLabel}${p.notes ? `. Obs: ${p.notes}` : ''}`;
                }).join(' | ')
                : 'Nenhuma coleta agendada no momento.';

            const chatMessages = [
                {
                    role: "system",
                    content: buildMainPrompt({
                        customerName: customer.full_name,
                        activeUnitName,
                        ordersContext,
                        quoteContext,
                        pendingQuoteContext,
                        pickupContext,
                        greeting,
                        continuityFacts,
                        bagsContext,
                        plansContext,
                        catalogContext,
                        variationContext,
                        promotionsContext,
                        specialTableContext,
                        m2,
                        ironing
                    })
                }
            ];

            // PROMPT EXCLUSIVO DA LOJA MOINHOS (2ª conexão Z-API).
            // Mantém TODAS as regras de preços/serviços/coleta do prompt principal, mas fixa a
            // identidade em UMA única loja (Moinhos), com endereço e telefones fixos, e proíbe
            // listar/oferecer as outras unidades.
            if (isMoinhos) {
                chatMessages.push({
                    role: "system",
                    content: `🏪 IDENTIDADE FIXA DESTE ATENDIMENTO — LOJA MOINHOS SHOPPING (REGRA PRIORITÁRIA):
                    Este atendimento é EXCLUSIVO da nossa unidade *Moinhos Shopping*. Você é a Glória, atendente da 5àsec Moinhos Shopping. TODAS as regras de preços, serviços, catálogo, orçamento, coleta e pagamento acima continuam valendo integralmente — muda APENAS a loja de referência:

                    - Ao se apresentar/cumprimentar, diga que é a Glória da *5àsec Moinhos Shopping* (NÃO cite "Rio Branco" nem outra loja).
                    - 🚫 É TERMINANTEMENTE PROIBIDO listar, oferecer ou sugerir qualquer OUTRA loja (Rio Branco, Petrópolis, Zaffari, Bourbon Wallig). Se o cliente pedir endereço, telefone, localização ou "onde levar", forneça SOMENTE os dados da loja Moinhos abaixo.
                    - Se o cliente optar por levar/retirar na loja, indique SEMPRE a loja Moinhos (nunca liste as 5 lojas).

                    📍 DADOS FIXOS DA LOJA MOINHOS (use somente estes):
                    🏪 5àsec Moinhos Shopping
                    📌 Endereço: Rua Olavo Barreto Viana, 36 — Loja C (Subsolo 1) — Moinhos de Vento, Porto Alegre/RS
                    🗺️ Mapa: https://www.google.com/maps/place/30%C2%B001'23.3%22S+51%C2%B012'03.8%22W/@-30.0231323,-51.2036361,1219m/data=!3m2!1e3!4b1!4m4!3m3!8m2!3d-30.0231323!4d-51.2010612?hl=pt-BR
                    📞 Fixo: (51) 3273-7823 | 📱 Celular: (51) 98992-5334
                    🕒 Horário: Seg a Sáb 11h-20h | Dom/Feriados: Fechado

                    FLUXO EXCLUSIVO DE PROMOÇÕES DE MOINHOS:
                    - Estado atual: ${currentState.flow || 'sem fluxo promocional'} / ${currentState.step || 'sem etapa'}.
                    - O envio automático das promoções acontece SOMENTE quando o webhook confirma um SIM ligado a uma solicitação de consentimento pendente. Você NUNCA deve reiniciar esse fluxo por causa de outro "SIM" durante a conversa; nesse caso, continue exatamente o fluxo atual.
                    - Se o estado for MOINHOS_PROMOTION_INTEREST, descubra se o cliente quer uma das promoções apresentadas ou um orçamento normal fora delas.
                    - Se quiser orçamento normal, chame 'start_regular_quote' e siga o fluxo padrão, aceitando fotos ou lista escrita.
                    - Se escolher uma promoção, pergunte qual promoção, quais itens e as quantidades. Quando tiver esses dados, use SOMENTE preços-base do catálogo e chame 'create_promotional_quote'. Nunca calcule nem aplique desconto promocional por conta própria.
                    - A ferramenta valida quantidade/composição e cria o orçamento SEMPRE com o valor CHEIO (sem desconto). Se a condição não for atendida, explique o requisito retornado e peça a correção.
                    - 🚨 Ao informar o orçamento promocional, apresente SOMENTE o valor sem desconto e diga: "O valor do orçamento é o valor sem desconto — o desconto da promoção será aplicado pela nossa equipe na hora do pagamento." É PROIBIDO mostrar valor com desconto ou calcular o desconto.
                    - Depois do orçamento promocional, siga o fluxo normal de aprovação, pagamento e agendamento de coleta já definido acima.

                    ⚠️ PRECEDÊNCIA: quando este bloco estiver ativo, ele SOBRESCREVE qualquer regra do bloco principal que conflite — inclusive a diretriz 2 (contatos das lojas): em Moinhos, envie SOMENTE os contatos da loja Moinhos, nunca os das outras.
                    Todo o resto (tabela de preços, bags, planos, serviços especiais, política de coleta/entrega, formas de pagamento, agendamento, prazos) permanece EXATAMENTE como definido acima.`
                });
            }

            // Datas, feriados e prazo de entrega (determinístico, ver shared/dateFacts.js)
            const dateFacts = buildDateFacts();
            chatMessages.push({ role: 'system', content: dateFacts.content });

            // Peças citadas no atendimento → valores oficiais dos serviços especiais (evita
            // aplicar a linha "Demais Peças" em edredom, casaco, cortina, tapete, vestido, macacão).
            const specialServiceContextText = [
                message.text || '',
                ...history.filter((m) => m.direction === 'IN').slice(-8).map((m) => m.text || ''),
                ...(currentState.temp_items || []).map((i) => i.garment_type || '')
            ].join(' ');
            // Turno JÁ escolhido pelo cliente: é proibido perguntar de novo "manhã ou tarde?".
            const shiftTexts = history.filter((m) => m.direction === 'IN').slice(-6).map((m) => (m.text || '').toLowerCase()).reverse();
            const statedShift = shiftTexts.map((t) => {
                if (/\bmanh[ãa]\b/.test(t)) return 'morning';
                if (/\btarde\b/.test(t)) return 'afternoon';
                return null;
            }).find(Boolean) || null;
            if (statedShift) {
                chatMessages.push({
                    role: 'system',
                    content: `🚨 TURNO JÁ ESCOLHIDO PELO CLIENTE: ${statedShift === 'morning' ? 'MANHÃ' : 'TARDE'}. É TERMINANTEMENTE PROIBIDO perguntar de novo "qual turno você prefere?" ou oferecer os dois turnos. Confirme a disponibilidade desse turno e siga direto para o agendamento (endereço/confirmação). Só ofereça outro turno se a ferramenta indicar que ESTE está lotado.`
                });
            }

            // Pagamento antecipado confirmado via Pix (Asaas) → coleta como encaixe
            if (currentState.payment_confirmed) {
                chatMessages.push({
                    role: 'system',
                    content: `🚨🚨🚨 PAGAMENTO JÁ CONFIRMADO PELO SISTEMA (ASAAS) — ESTA REGRA SOBREPOE TODAS AS DEMAIS:\n` +
                    `1. O pagamento antecipado via Pix deste cliente JÁ FOI CONFIRMADO pelo sistema Asaas. NÃO pergunte "você conseguiu finalizar o pagamento?" — o pagamento ESTÁ confirmado.\n` +
                    `2. NÃO peça foto do comprovante. NÃO informe a chave Pix. O fluxo WAITING_RECEIPT foi encerrado pelo pagamento.\n` +
                    `3. A coleta deve ser tratada como ENCAIXE: peça o ENDEREÇO COMPLETO de coleta (se ainda não tiver no histórico) e chame 'schedule_pickup' com encaixe=true e o endereço. NÃO passe date, weekday nem period — o sistema calcula automaticamente.\n` +
                    `4. Informe ao cliente: "Recebi a confirmação do seu pagamento! ✅ Como você já pagou antecipado, sua coleta entrará como encaixe no próximo turno disponível."\n` +
                    `5. Se já tiver o endereço, chame 'schedule_pickup' com encaixe=true AGORA — não pergunte mais nada.`
                });
            }

            const specialServiceFact = buildSpecialServiceFact(detectSpecialServiceTiers(specialServiceContextText, specialServiceRows));
            if (specialServiceFact) {
                chatMessages.push({ role: 'system', content: specialServiceFact });
            }

            // PASSADORIA (70% da lavagem): quando o cliente pergunta sobre "passar", o valor
            // exato é calculado AQUI em código (nunca pela IA) para cada peça citada que tenha
            // preço no catálogo, e injetado como fato determinístico.
            const asksIroning = /\b(passar|passadoria|passagem|engomar|engomagem|s[óo]\s+passar|apenas\s+passar)\b/i.test(message.text || '');
            if (asksIroning) {
                const { relatedMatches: ironingMatches } = findRelatedCatalogProducts(products, message.text || '');
                const ironingLines = (ironingMatches || []).map((p) => `- ${p.name}: lavagem ${formatBrlQuote(p.price)} → passar = ${formatBrlQuote(passadoriaPrice(p.price, ironing.percent))}`).join('\n');
                chatMessages.push({
                    role: 'system',
                    content: `${IRONING_RULE(ironing.percent)}${ironingLines ? `\n\n🚨 PASSADORIA (VALORES OFICIAIS CALCULADOS PELO SISTEMA — USE EXATAMENTE ESTES, NUNCA RECALCULE):\n${ironingLines}` : ''}`
                });
            }

            for (const msg of history) {
                // Disparos de terceiros (marketing/aviso de roupa pronta) NÃO entram no
                // histórico da IA — ver shared/messageOrigin.js.
                if (msg.direction === 'OUT' && !shouldIncludeInAiHistory(msg)) continue;
                if (msg.type === 'TEXT' || msg.type === 'AUDIO') {
                    chatMessages.push({ role: msg.direction === 'IN' ? 'user' : 'assistant', content: msg.text || "" });
                }
            }

            const aiTools = [
                    ...promotionAiTools,
                    {
                        type: "function",
                        function: {
                            name: "check_distance_to_stores",
                            description: "Consulta a distância real e o tempo de rota do endereço ou ponto de referência do cliente até as nossas lojas em Porto Alegre usando o Google Maps. Retorna a distância, o tempo estimado e o endereço da loja mais próxima.",
                            parameters: {
                                type: "object",
                                properties: {
                                    origin_address: {
                                        type: "string",
                                        description: "O endereço, bairro ou ponto de referência fornecido pelo cliente (ex: 'Shopping Iguatemi', 'Bairro Moinhos de Vento', 'Rua da Praia'). Importante: adicione 'Porto Alegre, RS' ao final se não estiver explícito para garantir a precisão."
                                    }
                                },
                                required: ["origin_address"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "calculate_area_quote",
                            description: "Calcula o valor da lavagem por metro quadrado para Cortina, Tapete quadrangular/retangular ou Tapete circular. Use SEMPRE esta ferramenta para esses produtos — nunca calcule de cabeça.",
                            parameters: {
                                type: "object",
                                properties: {
                                    product_type: {
                                        type: "string",
                                        enum: ["cortina", "tapete_quad", "tapete_circular"],
                                        description: "Tipo: 'cortina', 'tapete_quad' (quadrangular/retangular) ou 'tapete_circular'."
                                    },
                                    width: { type: "number", description: "Altura em metros (cortina e tapete_quad)." },
                                    length: { type: "number", description: "Comprimento em metros (cortina e tapete_quad)." },
                                    diameter: { type: "number", description: "Diâmetro em metros (apenas tapete_circular)." },
                                    cortina_tipo: {
                                        type: "string",
                                        enum: ["I", "II", "III"],
                                        description: `Tipo da cortina: I (${fmtM2(m2.cortina_tipo_I)}/m²), II especial (${fmtM2(m2.cortina_tipo_II)}/m²) ou III dupla (${fmtM2(m2.cortina_tipo_III)}/m²). Obrigatório para cortina.`
                                    }
                                },
                                required: ["product_type"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "check_pickup_availability",
                            description: "Consulta no sistema qual o próximo turno (manhã ou tarde) com vagas disponíveis para coleta numa data específica. SEMPRE chame esta ferramenta ANTES de oferecer um turno ao cliente, para garantir que há disponibilidade real.",
                            parameters: {
                                type: "object",
                                properties: {
                                    date: {
                                        type: "string",
                                        description: "Data desejada para a coleta no formato YYYY-MM-DD (ex: 2026-04-29)."
                                    }
                                },
                                required: ["date"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "schedule_pickup",
                            description: "Agenda uma coleta de roupas. Requer data (YYYY-MM-DD) e turno (morning/afternoon). Só chame APÓS confirmar disponibilidade via check_pickup_availability e ter o endereço completo.",
                            parameters: {
                                type: "object",
                                properties: {
                                    date: {
                                        type: "string",
                                        description: "Data da coleta no formato YYYY-MM-DD (ex: 2026-02-25). Use SEMPRE a data exata do calendário injetado que corresponde ao dia prometido ao cliente."
                                    },
                                    weekday: {
                                        type: "string",
                                        description: "OBRIGATÓRIO: o dia da semana que você prometeu ao cliente para essa data (domingo, segunda, terça, quarta, quinta, sexta ou sábado). O sistema valida e recusa o agendamento se a data não for realmente esse dia."
                                    },
                                    period: {
                                        type: "string",
                                        enum: ["morning", "afternoon"],
                                        description: "Turno da coleta: 'morning' (manhã) ou 'afternoon' (tarde)."
                                    },
                                    address: {
                                        type: "string",
                                        description: "Endereço completo para a coleta."
                                    },
                                    notes: {
                                        type: "string",
                                        description: "Observações adicionais."
                                    },
                                    encaixe: {
                                        type: "boolean",
                                        description: "Se true, o sistema calcula automaticamente o próximo turno disponível (encaixe). Use quando o pagamento foi confirmado antecipado via Pix. NÃO passe date, weekday nem period quando encaixe=true."
                                    }
                                },
                                required: ["address"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "approve_quote",
                            description: "Aprova o orçamento pendente do cliente. SE NÃO HOUVER ORÇAMENTO PENDENTE (ex: cliente não enviou fotos mas quer aprovar o serviço pelos preços informados), você DEVE preencher o campo 'items' com as peças que ele deseja lavar para criar um novo orçamento e já aprová-lo. ATENÇÃO: Para pedidos até R$ 150, pergunte antes se o cliente quer entrega/coleta por R$ 15. Passe include_delivery_fee=true se ele quiser, false se for levar na loja ou se pedido > R$ 150.",
                            parameters: {
                                type: "object",
                                properties: {
                                    include_delivery_fee: {
                                        type: "boolean",
                                        description: "True se o cliente aceitou pagar os R$ 15 da coleta/entrega, False caso contrário."
                                    },
                                    items: {
                                        type: "array",
                                        description: "Lista de peças que o cliente deseja lavar. Preencha APENAS se não houver orçamento pendente.",
                                        items: {
                                            type: "object",
                                            properties: {
                                                garment_type: { type: "string", description: "Nome da peça (ex: Edredom Casal)" },
                                                qty: { type: "number", description: "Quantidade" },
                                                unit_price: { type: "number", description: "Preço unitário da peça" }
                                            },
                                            required: ["garment_type", "qty", "unit_price"]
                                        }
                                    }
                                },
                                required: ["include_delivery_fee"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "sell_package",
                            description: "Vende uma Bag ou um Plano para o cliente, registra no CRM e prepara o fluxo para informar a chave Pix e aguardar o comprovante.",
                            parameters: {
                                type: "object",
                                properties: {
                                    package_name: {
                                        type: "string",
                                        description: "Nome exato do plano ou bag. Ex: 'Minha Bag (até 18 peças)', 'Plano 1 - R$150 + Bônus', 'Plano 5 - R$2000 + Bônus'"
                                    }
                                },
                                required: ["package_name"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "register_complaint",
                            description: "Registra uma reclamação do cliente e transfere para um atendente humano. Use esta ferramenta APENAS DEPOIS de o cliente ter explicado o motivo da reclamação.",
                            parameters: {
                                type: "object",
                                properties: {
                                    summary: {
                                        type: "string",
                                        description: "Um breve resumo da reclamação ou problema relatado pelo cliente."
                                    }
                                },
                                required: ["summary"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "request_urgent_delivery",
                            description: "Aciona a operação para verificar a possibilidade de um prazo de entrega de urgência (menor que 3 dias úteis).",
                            parameters: {
                                type: "object",
                                properties: {
                                    reason: {
                                        type: "string",
                                        description: "O motivo da urgência relatado pelo cliente."
                                    }
                                },
                                required: ["reason"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "generate_payment_charge",
                            description: "Gera a cobrança REAL no Asaas para o cliente pagar: 'pix' devolve o código Pix copia e cola, 'credit_card' devolve o link de pagamento no cartão. Chame SEMPRE que o cliente escolher pagar antecipado por Pix ou cartão. É PROIBIDO informar chave Pix manual — use SOMENTE o código que esta ferramenta devolver.",
                            parameters: {
                                type: "object",
                                properties: {
                                    billing_type: {
                                        type: "string",
                                        enum: ["pix", "credit_card"],
                                        description: "'pix' para código Pix copia e cola; 'credit_card' para link de pagamento no cartão."
                                    }
                                },
                                required: ["billing_type"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "transfer_to_human",
                            description: "Transfere o atendimento para um atendente humano. Use essa ferramenta se o cliente pedir para falar com um humano ou se perguntar sobre o status de um pedido que não consta no sistema.",
                            parameters: {
                                type: "object",
                                properties: {
                                    reason: {
                                        type: "string",
                                        description: "Motivo da transferência."
                                    }
                                },
                                required: ["reason"]
                            }
                        }
                    }
                ];

            const { model: AI_MODEL, temperature: AI_TEMP } = await getAiSettings(base44);
            const completion = await openai.chat.completions.create({
                model: AI_MODEL, temperature: AI_TEMP,
                messages: chatMessages,
                tools: aiTools
            });

            let aiResponseText = completion.choices[0].message.content;
            const responseMessage = completion.choices[0].message;

            let pickupScheduledOk = false;
            let availabilityChecked = false;
            // Guarda o resultado real da última checagem de disponibilidade para validar a resposta da IA.
            let lastAvailabilityResult = null;

            if (responseMessage.tool_calls) {
                chatMessages.push(responseMessage);
                
                for (const toolCall of responseMessage.tool_calls) {
                    const promotionResult = await handlePromotionToolCall({
                        toolCall, base44, customer, conversation, currentState, activePromotions, activeUnitId, isMoinhos
                    });
                    if (promotionResult) {
                        if (promotionResult.state) Object.assign(currentState, promotionResult.state);
                        chatMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: promotionResult.content });
                        continue;
                    }

                    if (toolCall.function.name === 'check_distance_to_stores') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            const origin = encodeURIComponent(args.origin_address);
                            const stores = [
                                { name: "Loja Rio Branco", address: "Rua Protásio Alves, 347 - Rio Branco, Porto Alegre - RS" },
                                { name: "Loja Petrópolis", address: "Av. Dr. Nilo Peçanha, 95 - Petrópolis, Porto Alegre - RS" },
                                { name: "Loja Zaffari (Protásio Alves)", address: "Av. Protásio Alves, 2700 - Petrópolis, Porto Alegre - RS" },
                                { name: "Loja Bourbon Wallig", address: "Av. Assis Brasil, 2611 - Cristo Redentor, Porto Alegre - RS" },
                                { name: "Loja Moinhos Shopping", address: "Rua Olavo Barreto Viana, 36 - Moinhos de Vento, Porto Alegre - RS" }
                            ];
                            
                            const destinations = stores.map(s => encodeURIComponent(s.address)).join('|');
                            const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
                            
                            if (!apiKey) {
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ error: "Chave do Google Maps não configurada." })
                                });
                                continue;
                            }
                            
                            const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations}&key=${apiKey}&language=pt-BR`;
                            const response = await fetch(url);
                            const data = await response.json();
                            
                            if (data.status === 'OK' && data.rows && data.rows.length > 0 && data.rows[0].elements) {
                                const elements = data.rows[0].elements;
                                let resultsText = `Resultados para a origem: ${data.origin_addresses[0]}\n`;
                                
                                stores.forEach((store, idx) => {
                                    const el = elements[idx];
                                    if (el.status === 'OK') {
                                        resultsText += `- ${store.name}: ${el.distance.text}, tempo de carro: ${el.duration.text}\n`;
                                    } else {
                                        resultsText += `- ${store.name}: Não foi possível calcular a rota.\n`;
                                    }
                                });
                                
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ success: true, results: resultsText, instruction: "Use esses dados exatos para informar ao cliente qual loja é mais próxima, a distância e o tempo estimado de chegada de carro. Dê instruções naturais e curtas." })
                                });
                            } else {
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ error: "Não foi possível calcular a distância pelo Google Maps. Peça um endereço mais específico." })
                                });
                            }
                        } catch (e) {
                            console.error("Error calling google maps", e);
                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ error: "Erro interno ao buscar distâncias." })
                            });
                        }
                    }

                    if (toolCall.function.name === 'approve_quote') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            let include_delivery_fee = args.include_delivery_fee === true;
                            const items = args.items || [];

                            let pendingQs = await base44.asServiceRole.entities.Quote.filter({
                                customer_id: customer.id,
                                status: 'SENT'
                            }, '-created_date', 1);
                            
                            let quoteToApprove = pendingQs.length > 0 ? pendingQs[0] : null;
                            let priceCorrectionNote = '';

                            if (!quoteToApprove && items.length > 0) {
                                // 🚨 PRECIFICAÇÃO DETERMINÍSTICA: os preços NUNCA vêm da IA.
                                // Cada item é re-precificado contra o catálogo oficial (Product);
                                // se a IA enviou um unit_price divergente, ele é corrigido para o
                                // valor oficial. Peça fora do catálogo fica sem preço (a equipe avalia).
                                const pricedQuote = priceItems(items, products);
                                const pricedItems = pricedQuote.items.map((item) => ({
                                    garment_type: item.garment_type,
                                    qty: item.qty,
                                    unit_price: item.unit_price || 0,
                                    notes: item.needs_review ? 'Sem preço no catálogo — equipe confirmará o valor.' : (item.price_corrected ? `Preço corrigido para o valor oficial do catálogo (${item.matched_product}).` : undefined)
                                }));
                                if (pricedQuote.any_price_corrected) {
                                    priceCorrectionNote = ' ATENÇÃO: um ou mais preços que você enviou foram corrigidos para o valor oficial do catálogo — informe ao cliente SOMENTE os valores oficiais.';
                                    await logGuardEvent(base44, {
                                        guard: 'approve_quote_price_correction',
                                        conversation_id: conversation.id,
                                        customer_name: customer.full_name,
                                        detail: `IA enviou preços divergentes do catálogo; corrigidos para os valores oficiais. Subtotal oficial: R$ ${pricedQuote.subtotal.toFixed(2)}`,
                                        excerpt: JSON.stringify(items).slice(0, 400)
                                    });
                                }
                                quoteToApprove = await base44.asServiceRole.entities.Quote.create({
                                    customer_id: customer.id,
                                    unit_id: activeUnitId,
                                    status: 'SENT',
                                    items: pricedItems,
                                    subtotal: pricedQuote.subtotal,
                                    total: pricedQuote.subtotal
                                });
                                
                                await base44.asServiceRole.entities.CrmCard.create({
                                    pipeline_type: 'QUOTE',
                                    stage: 'Enviado ao cliente',
                                    priority: 'HIGH',
                                    customer_id: customer.id,
                                    unit_id: activeUnitId,
                                    linked_quote_id: quoteToApprove.id,
                                    due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
                                });
                            }

                            if (quoteToApprove) {
                                const activePickups = await base44.asServiceRole.entities.Pickup.filter({
                                    customer_id: customer.id,
                                    status: 'scheduled'
                                });
                                const choseStoreDropoff = /(?:levar|deixar).{0,30}loja|loja.{0,30}(?:levar|deixar)/i.test(message.text || '');
                                // 🚨 REGRA DE OURO DA TAXA (decidida AQUI, nunca pela IA): a referência
                                // é o TOTAL FINAL DAS PEÇAS (subtotal - desconto). Como o desconto de
                                // promoção é aplicado pela equipe no pagamento (nunca no orçamento),
                                // o discount aqui é normalmente 0.
                                const piecesTotal = Number(quoteToApprove.subtotal ?? quoteToApprove.total ?? 0) - Number(quoteToApprove.discount || 0);
                                if (piecesTotal > 150) include_delivery_fee = false;
                                else if ((currentState.delivery_requested || activePickups.length > 0) && !choseStoreDropoff) include_delivery_fee = true;

                                let finalAmount = quoteToApprove.total;
                                let currentAddition = quoteToApprove.addition || 0;
                                
                                if (include_delivery_fee) {
                                    finalAmount += 15;
                                    currentAddition += 15;
                                    await base44.asServiceRole.entities.Quote.update(quoteToApprove.id, { 
                                        status: 'ACCEPTED',
                                        addition: currentAddition,
                                        total: finalAmount
                                    });
                                    await Promise.all(activePickups.map((pickup) =>
                                        base44.asServiceRole.entities.Pickup.update(pickup.id, {
                                            fee: 15,
                                            notes: [pickup.notes, 'Taxa fixa de coleta + entrega: R$ 15,00.'].filter(Boolean).join(' ')
                                        })
                                    ));
                                } else {
                                    await base44.asServiceRole.entities.Quote.update(quoteToApprove.id, { status: 'ACCEPTED' });
                                }

                                const crmCards = await base44.asServiceRole.entities.CrmCard.filter({ linked_quote_id: quoteToApprove.id });
                                if (crmCards.length > 0) {
                                    await base44.asServiceRole.entities.CrmCard.update(crmCards[0].id, { stage: 'Aprovado' });
                                }

                                await base44.asServiceRole.entities.CrmCard.create({
                                    pipeline_type: 'PAYMENT',
                                    stage: 'Aguardando Pix',
                                    priority: 'HIGH',
                                    customer_id: customer.id,
                                    unit_id: activeUnitId,
                                    linked_quote_id: quoteToApprove.id
                                });

                                await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                                    metadata: { ...currentState, flow: 'WAITING_RECEIPT', delivery_requested: include_delivery_fee }
                                });

                                const nextStepMsg = include_delivery_fee ? "Depois disso puxe o assunto de agendar a coleta." : "Como ele vai levar na loja, agradeça e liste OBRIGATORIAMENTE TODOS OS 5 ENDEREÇOS das nossas lojas em Porto Alegre para ele escolher qual fica melhor.";
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ success: true, pieces_total: piecesTotal, delivery_fee: include_delivery_fee ? 15 : 0, final_total: finalAmount, message: `Orçamento aprovado no sistema! Total final das peças (sem desconto): R$ ${piecesTotal.toFixed(2)}. Taxa de coleta/entrega: ${include_delivery_fee ? 'R$ 15,00 (total final ≤ R$ 150)' : 'GRÁTIS (total final > R$ 150)'}. Total a cobrar: R$ ${finalAmount.toFixed(2)}.${priceCorrectionNote} OBRIGATÓRIO: pergunte ao cliente se ele prefere pagar por Pix ou cartão de crédito e chame a ferramenta 'generate_payment_charge' para gerar a cobrança real — é PROIBIDO informar chave Pix manual. ${nextStepMsg}` })
                                });
                            } else {
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ error: "Nenhum orçamento pendente encontrado e nenhum item foi fornecido para criar um novo." })
                                });
                            }
                        } catch (e) {
                            console.error("Error approving quote", e);
                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ error: "Erro ao aprovar orçamento." })
                            });
                        }
                    }

                    if (toolCall.function.name === 'sell_package') {
                        const args = JSON.parse(toolCall.function.arguments);
                        try {
                            const products = await base44.asServiceRole.entities.Product.filter({ name: args.package_name });
                            if (products.length === 0) {
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ error: "Produto não encontrado. Tente exatamente o nome da tabela (ex: 'Minha Bag (até 18 peças)', 'Plano 1 - R$150 + Bônus')." })
                                });
                            } else {
                                const product = products[0];
                                
                                const order = await base44.asServiceRole.entities.Order.create({
                                    customer_id: customer.id,
                                    unit_id: activeUnitId,
                                    status: 'pending',
                                    total_amount: product.price
                                });
                                
                                await base44.asServiceRole.entities.CrmCard.create({
                                    pipeline_type: product.family === 'Planos' ? 'PLAN' : 'ORDER',
                                    stage: product.family === 'Planos' ? 'Oferta enviada' : 'Recebido',
                                    priority: 'HIGH',
                                    customer_id: customer.id,
                                    unit_id: activeUnitId,
                                    linked_order_id: order.id
                                });

                                await base44.asServiceRole.entities.CrmCard.create({
                                    pipeline_type: 'PAYMENT',
                                    stage: 'Aguardando Pix',
                                    priority: 'HIGH',
                                    customer_id: customer.id,
                                    unit_id: activeUnitId,
                                    linked_order_id: order.id
                                });

                                await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                                    metadata: { ...currentState, flow: 'WAITING_RECEIPT' }
                                });

                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ success: true, message: "Pacote/Plano registrado no sistema! OBRIGATÓRIO: pergunte se o cliente prefere Pix ou cartão de crédito e chame 'generate_payment_charge' para gerar a cobrança real no Asaas. É PROIBIDO informar chave Pix manual." })
                                });
                            }
                        } catch (e) {
                            console.error("Error selling package", e);
                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ error: "Erro interno no sistema." })
                            });
                        }
                    }

                    if (toolCall.function.name === 'register_complaint') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            
                            await base44.asServiceRole.entities.CrmCard.create({
                                pipeline_type: 'COMPLAINT',
                                stage: 'Aberta',
                                priority: 'HIGH',
                                customer_id: customer.id,
                                unit_id: activeUnitId,
                                complaint_summary: args.summary
                            });

                            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                                handoff_required: true,
                                metadata: { ...currentState, flow: 'HANDOFF_COMPLAINT' }
                            });

                            await base44.asServiceRole.entities.StaffNotification.create({
                                type: 'COMPLAINT', 
                                target_team: 'support',
                                payload: { conversation_id, customer_name: customer.full_name, summary: args.summary },
                                sent_at: new Date().toISOString()
                            });

                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ success: true, message: "Reclamação registrada e transferida. Avise o cliente que a nossa equipe de qualidade já foi acionada e vai resolver o problema com prioridade." })
                            });
                        } catch (e) {
                            console.error("Error registering complaint", e);
                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ error: "Erro ao registrar reclamação." })
                            });
                        }
                    }

                    if (toolCall.function.name === 'request_urgent_delivery') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            
                            await base44.asServiceRole.entities.CrmCard.create({
                                pipeline_type: 'NEW_CUSTOMER',
                                stage: 'Qualificação',
                                priority: 'CRITICAL',
                                customer_id: customer.id,
                                unit_id: activeUnitId,
                                complaint_summary: `URGENCIA (ENVIAR RESPOSTA) - Motivo: ${args.reason || 'Não informado'}`
                            });

                            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                                handoff_required: true,
                                metadata: { ...currentState, flow: 'HANDOFF_URGENCY' }
                            });

                            await base44.asServiceRole.entities.StaffNotification.create({
                                type: 'NEW_QUOTE',
                                target_team: 'support',
                                payload: { conversation_id, customer_name: customer.full_name, summary: 'Cliente solicitou urgência.' },
                                sent_at: new Date().toISOString()
                            });

                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ success: true, message: "A operação foi notificada. Avise o cliente que estamos verificando a possibilidade de encaixe e que um atendente humano dará o retorno em até 30 minutos." })
                            });
                        } catch (e) {
                            console.error("Error requesting urgent delivery", e);
                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ error: "Erro ao registrar urgência." })
                            });
                        }
                    }

                    const chargeResult = await handlePaymentChargeToolCall({ toolCall, base44, customer });
                    if (chargeResult) {
                        chatMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: chargeResult.content });
                        continue;
                    }

                    if (toolCall.function.name === 'transfer_to_human') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            
                            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                                handoff_required: true,
                                metadata: { ...currentState, flow: 'HANDOFF' }
                            });

                            await base44.asServiceRole.entities.StaffNotification.create({
                                type: 'NEW_QUOTE',
                                target_team: 'support',
                                payload: { conversation_id, customer_name: customer.full_name, summary: `Transferência solicitada via IA: ${args.reason}` },
                                sent_at: new Date().toISOString()
                            });

                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ success: true, message: "Atendimento transferido. Diga ao cliente para aguardar um momento." })
                            });
                        } catch (e) {
                            console.error("Error transferring to human", e);
                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ error: "Erro ao transferir." })
                            });
                        }
                    }

                    if (toolCall.function.name === 'calculate_area_quote') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            const r = await base44.asServiceRole.functions.invoke('calculateSquareMeterQuote', {
                                ...args,
                                _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                            });
                            if (r.data?.success) {
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({
                                        ...r.data,
                                        instruction: `Informe ao cliente o valor da lavagem do ${r.data.product_label}: ${formatCurrency(r.data.total)} (área de ${r.data.area} m² × ${formatCurrency(r.data.unit_price)}/m²). 🚨 OBRIGATÓRIO: na MESMA mensagem você DEVE informar explicitamente o prazo de entrega "${r.data.delivery_estimate}" (escreva essa frase literalmente, ex: "O prazo de entrega é de ${r.data.delivery_estimate}."). NÃO use o prazo padrão de 3 dias úteis para cortinas/tapetes — use APENAS "${r.data.delivery_estimate}". Use EXATAMENTE estes valores, não recalcule.`
                                    })
                                });
                            } else {
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ error: r.data?.error || 'Não foi possível calcular. Peça as medidas corretas ao cliente.' })
                                });
                            }
                        } catch (e) {
                            console.error("Error calculating area quote", e);
                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ error: "Erro ao calcular o valor por m²." })
                            });
                        }
                    }

                    if (toolCall.function.name === 'check_pickup_availability') {
                        try {
                            availabilityChecked = true;
                            const args = JSON.parse(toolCall.function.arguments);
                            const schedule = getPickupScheduleForDate(args.date);
                            if (!schedule.isOpen) {
                                lastAvailabilityResult = { date: args.date, morning_available_slots: 0, afternoon_available_slots: 0, next_available_shift: null };
                                chatMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ ...lastAvailabilityResult, instruction: schedule.error }) });
                                continue;
                            }
                            const MORNING_CAPACITY = schedule.morningCapacity;
                            const AFTERNOON_CAPACITY = schedule.afternoonCapacity;

                            const dayRange = getPickupDateRange(args.date);

                            const dayPickups = await base44.asServiceRole.entities.Pickup.filter({
                                scheduled_at: {
                                    $gte: dayRange.start,
                                    $lte: dayRange.end
                                },
                                status: { $ne: 'cancelled' }
                            });

                            // Count how many pickups in each shift (any pickup before 13:00 BRT = morning)
                            let morningCount = 0;
                            let afternoonCount = 0;
                            for (const p of dayPickups) {
                                if (getPickupLocalHour(p.scheduled_at) < 13) morningCount++;
                                else afternoonCount++;
                            }

                            const morningAvailable = Math.max(0, MORNING_CAPACITY - morningCount);
                            const afternoonAvailable = Math.max(0, AFTERNOON_CAPACITY - afternoonCount);

                            // Determine if morning is in the past (it's today and after noon)
                            const nowBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
                            const today = `${nowBRT.getFullYear()}-${String(nowBRT.getMonth() + 1).padStart(2, '0')}-${String(nowBRT.getDate()).padStart(2, '0')}`;
                            const isToday = args.date === today;
                            const morningPast = isToday && nowBRT.getHours() >= 12;
                            const afternoonPast = isToday && nowBRT.getHours() >= 16;

                            let nextAvailable = null;
                            if (morningAvailable > 0 && !morningPast) nextAvailable = 'morning';
                            else if (afternoonAvailable > 0 && !afternoonPast) nextAvailable = 'afternoon';

                            lastAvailabilityResult = {
                                date: args.date,
                                morning_available_slots: morningPast ? 0 : morningAvailable,
                                afternoon_available_slots: afternoonPast ? 0 : afternoonAvailable,
                                next_available_shift: nextAvailable
                            };

                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({
                                    date: args.date,
                                    morning_available_slots: morningPast ? 0 : morningAvailable,
                                    afternoon_available_slots: afternoonPast ? 0 : afternoonAvailable,
                                    next_available_shift: nextAvailable,
                                    instruction: nextAvailable
                                        ? (((morningPast ? 0 : morningAvailable) > 0 && (afternoonPast ? 0 : afternoonAvailable) > 0)
                                            ? `Os DOIS turnos têm vaga nesta data. Ofereça AMBOS ao cliente e deixe ELE escolher (ex: "Tenho vaga na *${schedule.morningLabel}* e na *Tarde (das 13h às 16h)*. Qual você prefere?"). NUNCA escolha o turno por ele e NUNCA ofereça só um quando os dois têm vaga. Depois que ele escolher, agende nesse turno.`
                                            : `Somente o turno '${nextAvailable === 'morning' ? schedule.morningLabel : 'Tarde (das 13h às 16h)'}' tem vaga nesta data. Ofereça esse turno. NUNCA ofereça um turno com 0 vagas.`)
                                        : "ATENÇÃO: NÃO há vagas disponíveis nessa data (ambos os turnos estão lotados). Você é PROIBIDO de agendar uma coleta neste dia. Recuse educadamente e sugira ao cliente escolher outra data."
                                })
                            });
                        } catch (e) {
                            console.error("Error checking pickup availability", e);
                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ error: "Erro ao consultar disponibilidade." })
                            });
                        }
                    }

                    if (toolCall.function.name === 'schedule_pickup') {
                        const args = JSON.parse(toolCall.function.arguments);
                        try {
                            // ENCAIXE: pagamento antecipado confirmado → sistema calcula próximo turno
                            if (args.encaixe) {
                                const encaixe = await findNextEncaixeSlot(base44.asServiceRole);
                                if (!encaixe) {
                                    chatMessages.push({
                                        role: "tool",
                                        tool_call_id: toolCall.id,
                                        content: JSON.stringify({ error: "Não há turnos disponíveis para encaixe nos próximos dias. Ofereça uma data específica ao cliente." })
                                    });
                                    continue;
                                }
                                args.date = encaixe.date;
                                args.period = encaixe.period;
                            }

                            const schedule = getPickupScheduleForDate(args.date);
                            if (!schedule.isOpen || (args.period === 'afternoon' && schedule.afternoonSlots.length === 0)) {
                                chatMessages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ error: !schedule.isOpen ? schedule.error : 'Aos sábados, as coletas acontecem somente pela manhã, das 9h às 12h. Ofereça o turno da manhã ou outra data.' })
                                });
                                continue;
                            }
                            const targetSlots = args.period === 'morning' ? schedule.morningSlots : schedule.afternoonSlots;
                            const MORNING_CAPACITY = schedule.morningCapacity;
                            const AFTERNOON_CAPACITY = schedule.afternoonCapacity;

                            const targetRange = getPickupDateRange(args.date);

                            const existingPickups = await base44.asServiceRole.entities.Pickup.filter({
                                scheduled_at: {
                                    $gte: targetRange.start,
                                    $lte: targetRange.end
                                },
                                status: { $ne: 'cancelled' }
                            });

                            // Count pickups in target shift to enforce capacity (excluding this customer's own pickups)
                            const otherPickups = existingPickups.filter(p => p.customer_id !== customer.id);
                            let shiftCount = 0;
                            for (const p of otherPickups) {
                                const localHour = getPickupLocalHour(p.scheduled_at);
                                if (args.period === 'morning' && localHour < 13) shiftCount++;
                                if (args.period === 'afternoon' && localHour >= 13) shiftCount++;
                            }
                            const capacity = args.period === 'morning' ? MORNING_CAPACITY : AFTERNOON_CAPACITY;
                            if (shiftCount >= capacity) {
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ error: `O turno da ${args.period === 'morning' ? 'manhã' : 'tarde'} para o dia ${args.date} está LOTADO (${shiftCount}/${capacity} vagas ocupadas). Você é PROIBIDO de agendar. Recuse educadamente e sugira outro turno ou outra data.` })
                                });
                                continue;
                            }

                            // Cancel any existing scheduled pickups for this customer before creating a new one
                            const existingCustomerPickups = await base44.asServiceRole.entities.Pickup.filter({
                                customer_id: customer.id,
                                status: 'scheduled'
                            });
                            for (const oldPickup of existingCustomerPickups) {
                                await base44.asServiceRole.entities.Pickup.update(oldPickup.id, { status: 'cancelled' });
                            }

                            // Re-fetch pickups (without cancelled customer ones) for slot collision check
                            const refreshedPickups = existingPickups.filter(p => p.customer_id !== customer.id);

                            // Find first available slot
                            let selectedSlot = null;
                            for (const slot of targetSlots) {
                                const [h, m] = slot.split(':').map(Number);
                                const isTaken = refreshedPickups.some(p => {
                                    const slotIso = getPickupSlotIso(args.date, slot);
                                    return Math.abs(new Date(p.scheduled_at).getTime() - new Date(slotIso).getTime()) < 60000;
                                });
                                
                                if (!isTaken) {
                                    selectedSlot = slot;
                                    break;
                                }
                            }

                            if (selectedSlot) {
                                const finalDate = getPickupSlotIso(args.date, selectedSlot);
                                await base44.asServiceRole.entities.Pickup.create({
                                    customer_id: customer.id,
                                    scheduled_at: finalDate,
                                    status: 'scheduled',
                                    address: args.address,
                                    notes: args.notes || '',
                                    source: 'ai',
                                    created_by_name: 'Glória (IA)'
                                });
                                
                                const shiftInfo = args.period === 'morning' ? `(turno manhã) das ${schedule.isSaturday ? '9h' : '8h'} às 12h` : '(turno tarde) das 13h às 16h';
                                pickupScheduledOk = true;
                                // Coleta agendada de fato — limpa qualquer coleta pendente salva para não duplicar depois.
                                if (currentState.pending_pickup || currentState.payment_confirmed) {
                                    currentState.pending_pickup = null;
                                    currentState.payment_confirmed = false;
                                    await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState } });
                                }
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ success: true, message: `Coleta agendada com sucesso para ${shiftInfo}. IMPORTANTE: No comprovante, NÃO mostre o horário exato, mostre apenas '${shiftInfo}'.` })
                                });
                            } else {
                                chatMessages.push({
                                    role: "tool",
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ error: `O turno da ${args.period === 'morning' ? 'manhã' : 'tarde'} para esta data está lotado. Por favor, ofereça o outro turno ou outra data.` })
                                });
                            }

                        } catch (e) {
                            console.error("Error scheduling pickup", e);
                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({ error: "Erro ao agendar coleta. Informe o cliente." })
                            });
                        }
                    }
                }
                
                // Toda tool_call precisa de uma resposta 'tool'; sem isso a API rejeita a
                // próxima chamada e a conversa cai no fallback genérico.
                const answeredToolIds = new Set(chatMessages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
                for (const toolCall of responseMessage.tool_calls.filter((tc) => !answeredToolIds.has(tc.id))) {
                    console.warn(`Tool sem resposta tratada: ${toolCall.function?.name}`);
                    chatMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: `Ferramenta '${toolCall.function?.name}' indisponível. Responda ao cliente sem usá-la.` }) });
                }

                const secondCompletion = await openai.chat.completions.create({
                    model: AI_MODEL, temperature: AI_TEMP,
                    messages: chatMessages
                });
                aiResponseText = secondCompletion.choices[0].message.content;

                // Se a segunda chamada não gerou texto (ex: modelo tentou chamar outra ferramenta
                // ou veio vazio), força um retry pedindo explicitamente uma resposta natural ao cliente.
                if (!aiResponseText) {
                    chatMessages.push({
                        role: "system",
                        content: "Responda agora DIRETAMENTE ao cliente em linguagem natural de WhatsApp, com base no que já foi processado acima. NÃO deixe a resposta vazia."
                    });
                    const retryCompletion = await openai.chat.completions.create({
                        model: AI_MODEL, temperature: AI_TEMP,
                        messages: chatMessages
                    });
                    aiResponseText = retryCompletion.choices[0].message.content;
                }
            }

            if (!aiResponseText) {
                await logGuardEvent(base44, {
                    guard: 'empty_response',
                    conversation_id: conversation.id,
                    customer_name: customer.full_name,
                    detail: 'A IA não gerou texto após o ciclo de ferramentas; aplicado fallback.',
                    excerpt: (message.text || '').slice(0, 300)
                });
                aiResponseText = "Desculpe, não entendi sua pergunta. Pode reformular, por favor?";
            }

            // 🚨 PROTEÇÃO ANTI-ALUCINAÇÃO DE AGENDAMENTO:
            // Se a IA escreveu uma confirmação de coleta NO TEXTO mas NÃO chamou 'schedule_pickup'
            // com sucesso, NÃO podemos enviar essa confirmação falsa. Forçamos a IA a executar
            // o agendamento de verdade antes de responder.
            const lowerResp = (aiResponseText || '').toLowerCase();
            const claimsPickupConfirmed = (
                (lowerResp.includes('coleta') || lowerResp.includes('agend')) &&
                (lowerResp.includes('confirmei') || lowerResp.includes('confirmada') || lowerResp.includes('agendada') || lowerResp.includes('agendei') || lowerResp.includes('marcada') || lowerResp.includes('marquei'))
            );
            if (claimsPickupConfirmed && !pickupScheduledOk) {
                console.warn('Anti-alucinação: IA tentou confirmar coleta sem chamar schedule_pickup. Forçando execução real.');
                await logGuardEvent(base44, {
                    guard: 'pickup_confirmation_without_schedule',
                    conversation_id: conversation.id,
                    customer_name: customer.full_name,
                    detail: 'IA afirmou coleta agendada sem chamar schedule_pickup com sucesso.',
                    excerpt: (aiResponseText || '').slice(0, 400)
                });
                chatMessages.push({ role: 'assistant', content: aiResponseText });
                chatMessages.push({
                    role: 'system',
                    content: "ERRO CRÍTICO: você afirmou que a coleta foi agendada, mas NÃO chamou a ferramenta 'schedule_pickup'. Você é PROIBIDA de confirmar um agendamento sem executá-lo. Se você tem data, turno e endereço, chame 'schedule_pickup' AGORA. Se ainda falta alguma informação ou o pagamento não foi confirmado, NÃO confirme — peça o que falta ao cliente em vez de confirmar."
                });
                // Reexecuta permitindo a chamada real da ferramenta de agendamento.
                const fixMessage = (await openai.chat.completions.create({
                    model: AI_MODEL, temperature: AI_TEMP, messages: chatMessages, tools: aiTools
                })).choices[0].message;
                const scheduleCall = (fixMessage.tool_calls || []).find(tc => tc.function.name === 'schedule_pickup');
                if (scheduleCall) {
                    chatMessages.push(fixMessage);
                    try {
                        const r = await base44.asServiceRole.functions.invoke('schedulePickupTool', {
                            ...JSON.parse(scheduleCall.function.arguments),
                            customer_id: customer.id,
                            _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                        });
                        if (r.data?.success) pickupScheduledOk = true;
                        chatMessages.push({ role: "tool", tool_call_id: scheduleCall.id, content: JSON.stringify(r.data || { error: 'Falha ao agendar' }) });
                    } catch (e) {
                        console.error("Protection schedule error", e);
                        chatMessages.push({ role: "tool", tool_call_id: scheduleCall.id, content: JSON.stringify({ error: "Erro ao agendar coleta." }) });
                    }
                    aiResponseText = (await openai.chat.completions.create({ model: AI_MODEL, temperature: AI_TEMP, messages: chatMessages })).choices[0].message.content || aiResponseText;
                } else {
                    aiResponseText = fixMessage.content || "Para confirmar sua coleta preciso de mais um detalhe. Pode me confirmar a data, o turno e o endereço completo, por favor?";
                }
            }

            // 🚨 PROTEÇÃO ANTI-ALUCINAÇÃO DE DISPONIBILIDADE:
            // Se a IA afirmou que NÃO há vaga / está lotado / sem disponibilidade SEM ter chamado
            // 'check_pickup_availability' nesta rodada, ela pode estar inventando. Forçamos a checagem
            // real e refazemos a resposta com base no resultado verdadeiro do sistema.
            const uncheckedClaim = availabilityChecked ? null : detectUncheckedAvailabilityClaim(aiResponseText || '');
            if (uncheckedClaim) {
                console.warn(`Anti-alucinação: IA falou de disponibilidade (${uncheckedClaim.kind}) sem chamar check_pickup_availability. Forçando checagem real.`);
                await logGuardEvent(base44, {
                    guard: uncheckedClaim.kind === 'offer' ? 'availability_offer_without_check' : 'availability_claim_without_check',
                    conversation_id: conversation.id,
                    customer_name: customer.full_name,
                    detail: uncheckedClaim.kind === 'offer'
                        ? 'IA ofereceu data/turno de coleta sem chamar check_pickup_availability.'
                        : 'IA afirmou indisponibilidade/lotado sem chamar check_pickup_availability.',
                    excerpt: (aiResponseText || '').slice(0, 400)
                });
                chatMessages.push({ role: 'assistant', content: aiResponseText });
                chatMessages.push({
                    role: 'system',
                    content: UNCHECKED_CLAIM_INSTRUCTION[uncheckedClaim.kind]
                });
                const availFix = (await openai.chat.completions.create({
                    model: AI_MODEL, temperature: AI_TEMP, messages: chatMessages, tools: aiTools
                })).choices[0].message;
                const availCall = (availFix.tool_calls || []).find(tc => tc.function.name === 'check_pickup_availability');
                if (availCall) {
                    chatMessages.push(availFix);
                    try {
                        const args = JSON.parse(availCall.function.arguments);
                        const schedule = getPickupScheduleForDate(args.date);
                        const MORNING_CAPACITY = schedule.isOpen ? schedule.morningCapacity : 0;
                        const AFTERNOON_CAPACITY = schedule.isOpen ? schedule.afternoonCapacity : 0;
                        const dayRange = getPickupDateRange(args.date);
                        const dayPickups = await base44.asServiceRole.entities.Pickup.filter({
                            scheduled_at: { $gte: dayRange.start, $lte: dayRange.end },
                            status: { $ne: 'cancelled' }
                        });
                        let morningCount = 0, afternoonCount = 0;
                        for (const p of dayPickups) {
                            const pBRT = new Date(new Date(p.scheduled_at).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
                            if (pBRT.getHours() < 13) morningCount++; else afternoonCount++;
                        }
                        const morningAvailable = Math.max(0, MORNING_CAPACITY - morningCount);
                        const afternoonAvailable = Math.max(0, AFTERNOON_CAPACITY - afternoonCount);
                        const nowBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
                        const todayStr = `${nowBRT.getFullYear()}-${String(nowBRT.getMonth() + 1).padStart(2, '0')}-${String(nowBRT.getDate()).padStart(2, '0')}`;
                        const isToday = args.date === todayStr;
                        const morningPast = isToday && nowBRT.getHours() >= 12;
                        const afternoonPast = isToday && nowBRT.getHours() >= 16;
                        let nextAvailable = null;
                        if (morningAvailable > 0 && !morningPast) nextAvailable = 'morning';
                        else if (afternoonAvailable > 0 && !afternoonPast) nextAvailable = 'afternoon';
                        chatMessages.push({
                            role: "tool",
                            tool_call_id: availCall.id,
                            content: JSON.stringify({
                                date: args.date,
                                morning_available_slots: morningPast ? 0 : morningAvailable,
                                afternoon_available_slots: afternoonPast ? 0 : afternoonAvailable,
                                next_available_shift: nextAvailable,
                                instruction: nextAvailable
                                    ? (((morningPast ? 0 : morningAvailable) > 0 && (afternoonPast ? 0 : afternoonAvailable) > 0)
                                        ? `Há VAGA nos DOIS turnos: ofereça AMBOS ('${schedule.morningLabel}' e 'Tarde (das 13h às 16h)') e deixe o cliente escolher. NÃO diga que está lotado.`
                                        : `Há VAGA disponível no turno '${nextAvailable === 'morning' ? schedule.morningLabel : 'Tarde (das 13h às 16h)'}'. Ofereça esse turno ao cliente. NÃO diga que está lotado.`)
                                    : "Confirmado: ambos os turnos estão lotados nessa data. Recuse educadamente e ofereça a próxima data com vaga."
                            })
                        });
                        availabilityChecked = true;
                        aiResponseText = (await openai.chat.completions.create({ model: AI_MODEL, temperature: AI_TEMP, messages: chatMessages })).choices[0].message.content || aiResponseText;
                    } catch (e) {
                        console.error("Availability protection error", e);
                    }
                } else {
                    aiResponseText = availFix.content || aiResponseText;
                }
            }

            // Optional: Auto-start quote state if AI detects intent
            if ((aiResponseText.toLowerCase().includes("enviar as fotos") || aiResponseText.toLowerCase().includes("mande as fotos")) && currentState.flow !== 'QUOTE') {
                await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                    metadata: { ...currentState, flow: 'QUOTE', step: 'COLLECTING_IMAGES' }
                });
            }

            // 🚨 PROTEÇÃO ANTI-ALUCINAÇÃO GLOBAL (fact-check final antes de enviar):
            // Valida toda a resposta contra os fatos reais (catálogo, variações, promoções,
            // disponibilidade, agendamento, prazo) e reescreve qualquer afirmação inventada.
            // Quando há orçamento pendente, os valores oficiais (subtotal, taxa, total) são
            // enviados como fatos estruturados para o guarda fazer fact-check NUMÉRICO.
            const pendingQuoteFacts = pendingQuotes.length > 0 ? (() => {
                const q = pendingQuotes[0];
                const pieces = Number(q.subtotal ?? q.total ?? 0) - Number(q.discount || 0);
                const fee = (deliveryIntentDetected || currentState.delivery_requested === true) && pieces <= 150 ? 15 : 0;
                return {
                    items: (q.items || []).map((item) => `${item.qty || 1}x ${item.garment_type}: ${formatCurrency(item.unit_price || 0)}`).join('; '),
                    pieces_total: pieces,
                    delivery_fee: fee,
                    final_total: pieces + fee,
                    note: 'Estes são os valores OFICIAIS do orçamento pendente (sem desconto — o desconto de promoção é aplicado pela equipe no pagamento). Se a mensagem citar valores diferentes destes, corrija para estes.'
                };
            })() : null;
            try {
                const guard = await base44.asServiceRole.functions.invoke('hallucinationGuard', {
                    draft_response: aiResponseText,
                    catalog_context: catalogContext,
                    variation_context: variationContext,
                    promotions_context: promotionsContext,
                    availability_result: lastAvailabilityResult,
                    pickup_scheduled_ok: pickupScheduledOk,
                    delivery_date: dateFacts.deliveryDateLabel,
                    date_facts: dateFacts.content,
                    m2_prices: m2,
                    special_service_fact: specialServiceFact,
                    delivery_requested: deliveryIntentDetected || currentState.delivery_requested === true,
                    quote_facts: pendingQuoteFacts
                });
                if (guard?.data?.safe_response) {
                    if (guard.data.was_corrected) {
                        // Separa correção de FATO (valor/data/horário mudou) de simples
                        // reescrita cosmética — antes tudo entrava no painel como erro.
                        const kind = classifyCorrection(aiResponseText, guard.data.safe_response);
                        console.warn(`Anti-alucinação global: resposta corrigida pelo hallucinationGuard (${kind}).`);
                        await logGuardEvent(base44, {
                            guard: kind === 'factual' ? 'hallucinationGuard' : 'hallucinationGuard_cosmetic',
                            conversation_id: conversation.id,
                            customer_name: customer.full_name,
                            detail: kind === 'factual'
                                ? 'hallucinationGuard corrigiu um FATO (valor, data, horário ou prazo) antes do envio.'
                                : 'hallucinationGuard apenas reescreveu o texto — nenhum fato foi alterado.',
                            excerpt: (aiResponseText || '').slice(0, 400)
                        });
                    }
                    aiResponseText = guard.data.safe_response;
                }
            } catch (guardError) {
                console.error('hallucinationGuard failed, using original response:', guardError);
            }

            const quoteSafety = enforceVariableQuoteSafety({
                draftResponse: aiResponseText,
                latestCustomerText: message.text || '',
                products,
                hasAnalyzedImage: (currentState.temp_items || []).some((item) => !item.is_receipt),
                deliveryRequested: deliveryIntentDetected
            });
            if (quoteSafety.corrected) {
                console.warn('Proteção de orçamento: aviso de inspeção e possível valor adicional incluído.');
                await logGuardEvent(base44, {
                    guard: 'enforceVariableQuoteSafety',
                    conversation_id: conversation.id,
                    customer_name: customer.full_name,
                    detail: 'Resposta sobre peça com variações sem o aviso de inspeção/menor valor; aviso incluído.',
                    excerpt: (aiResponseText || '').slice(0, 400)
                });
                aiResponseText = quoteSafety.response;
            }

            // Taxa fixa de R$ 15,00 quando há coleta/entrega e o total das peças é até R$ 150,00.
            const deliveryFeeSafety = enforceDeliveryFeeNotice({
                draftResponse: aiResponseText,
                deliveryRequested: deliveryIntentDetected || currentState.delivery_requested === true
            });
            if (deliveryFeeSafety.corrected) {
                console.warn('Proteção de frete: taxa fixa de R$ 15,00 incluída na resposta.');
                await logGuardEvent(base44, {
                    guard: 'enforceDeliveryFeeNotice',
                    conversation_id: conversation.id,
                    customer_name: customer.full_name,
                    detail: 'Resposta com coleta/entrega e total ≤ R$ 150 sem a taxa de R$ 15; taxa incluída.',
                    excerpt: (aiResponseText || '').slice(0, 400)
                });
                aiResponseText = deliveryFeeSafety.response;
            }

            const shouldShowApprovalButtons = pendingQuotes.length > 0 && aiResponseText && aiResponseText.toLowerCase().includes('aprovar');
            const shouldShowDeliveryButtons = aiResponseText && aiResponseText.toLowerCase().includes('coleta/entrega por r$ 15');
            const shouldShowHandoffButton = aiResponseText && aiResponseText.toLowerCase().includes('palavra "atendente"');

            await invokeSender({
                phone: customer.phones[0],
                message: aiResponseText,
                conversation_id: conversation.id
            });

            const interactivePayload = shouldShowDeliveryButtons
                ? {
                    phone: customer.phones[0],
                    type: 'OPTION_LIST',
                    message: 'Escolha uma opção abaixo:',
                    optionList: {
                        title: 'Coleta ou loja',
                        buttonLabel: 'Abrir opções',
                        options: [
                            { id: 'want_pickup', title: 'Quero coleta', description: 'Adicionar coleta/entrega' },
                            { id: 'store_dropoff', title: 'Vou levar na loja', description: 'Sem coleta/entrega' }
                        ]
                    },
                    conversation_id: conversation.id
                }
                : shouldShowApprovalButtons
                    ? {
                        phone: customer.phones[0],
                        type: 'OPTION_LIST',
                        message: 'Escolha uma opção abaixo:',
                        optionList: {
                            title: 'Aprovação do orçamento',
                            buttonLabel: 'Abrir opções',
                            options: [
                                { id: 'approve_quote', title: 'Aprovar', description: 'Seguir com o orçamento' },
                                { id: 'add_pickup', title: 'Acrescentar coleta', description: 'Adicionar coleta/entrega' }
                            ]
                        },
                        conversation_id: conversation.id
                    }
                    : shouldShowHandoffButton
                        ? {
                            phone: customer.phones[0],
                            type: 'OPTION_LIST',
                            message: 'Escolha uma opção abaixo:',
                            optionList: {
                                title: 'Atendimento',
                                buttonLabel: 'Abrir opções',
                                options: [
                                    { id: 'ask_human', title: 'Atendente', description: 'Falar com uma pessoa' }
                                ]
                            },
                            conversation_id: conversation.id
                        }
                        : null;

            if (interactivePayload) {
                await invokeSender(interactivePayload);
            }

            return Response.json({ action: "chatgpt_replied" });
        }

        return Response.json({ status: "processed" });

    } catch (error) {
        if (error?.name === 'SecurityError') return securityErrorResponse(error, requestId);
        console.error("Error in orchestrator:", error);
        if (base44 && conversation?.id) {
            try { await logGuardEvent(base44, { guard: 'orchestrator_error', conversation_id: conversation.id, customer_name: customer?.full_name, detail: `Falha na execução da IA: ${error?.message || error}`, excerpt: String(error?.stack || '').slice(0, 400) }); } catch { /* nunca bloqueia o fallback */ }
        }
        if (error.isAxiosError && error.response) {
            console.error("Axios response data:", error.response.data);
            console.error("Axios response status:", error.response.status);
        }

        if (invokeSender && base44 && customer?.phones?.[0] && conversation?.id) {
            try {
                await invokeSender({
                    phone: customer.phones[0],
                    message: 'Desculpe, não entendi sua pergunta. Pode reformular, por favor?',
                    conversation_id: conversation.id
                });
            } catch (fallbackError) {
                console.error('Error sending fallback message:', fallbackError);
            }
        }

        return Response.json({ error: error.message }, { status: 500 });
    }
});