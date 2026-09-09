import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { requireProviderToken, securityErrorResponse } from '../../shared/functionSecurity.js';
import { classifyConsentResponse, hasActiveConsentRequest } from '../../shared/whatsappConsent.js';
import { buildPromotionsOfferMessage, getActivePromotions } from '../../shared/promotionFlow.js';
import { clearDispatchGeneratedHandoff, isDispatchGeneratedHandoff } from '../../shared/dispatchReplyPolicy.js';
import { hasRecentHumanReply } from '../../shared/humanActivity.js';

// ============================================================================
// WEBHOOK EXCLUSIVO DA 2ª CONEXÃO Z-API (Loja Moinhos Shopping).
// Recebe as mensagens da segunda instância Z-API (número dedicado de Moinhos),
// cria/atualiza clientes e conversas SEMPRE vinculados à unidade Moinhos, e
// marca a origem como 'zapi_moinhos' para o orchestrator usar o prompt e o
// sender corretos (zapi_moinhos_sender). Espelha a lógica do zapi_webhook_receiver.
// ============================================================================
const MOINHOS_UNIT_ID = '69b296b5a0216981a77970c4';
const MOINHOS_UNIT_NAME = 'Loja Moinhos Shopping';

export default async function(req) {
    const runInBackground = (promise) => {
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
            EdgeRuntime.waitUntil(promise);
        }
    };

    try {
        const base44 = createClientFromRequest(req);

        requireProviderToken(req, 'ZAPI_MOINHOS_SECURITY_TOKEN', ['client-token']);
        const payload = await req.json();
        console.log("Webhook Moinhos payload keys:", JSON.stringify(Object.keys(payload)));
        console.log('Webhook Moinhos message received.', { has_message_id: Boolean(payload.messageId), from_me: Boolean(payload.fromMe) });

        if (!payload.phone || !payload.messageId) {
            return Response.json({ status: "ignored" });
        }

        // Bloqueia mensagens de grupo (assistente é 1-a-1).
        const isGroupMessage =
            payload.isGroup === true || payload.isgroup === true || !!payload.groupId ||
            (typeof payload.phone === 'string' &&
                (payload.phone.includes('@g.us') || payload.phone.includes('-group') || payload.phone.includes('-')));
        if (isGroupMessage) {
            return Response.json({ status: "ignored_group" });
        }

        const hasRealContent = !!(payload.text || payload.image || payload.audio || payload.document || payload.buttonsResponseMessage || payload.listResponseMessage || payload.selectedOption);
        if (payload.waitingMessage === true && !hasRealContent) {
            return Response.json({ status: "ignored_waiting" });
        }

        const phoneDigits = (payload.phone || '').replace(/\D/g, '');
        if (phoneDigits.length > 13 && !hasRealContent) {
            return Response.json({ status: "ignored_lid_no_content" });
        }

        const isTemplateEcho = !!(payload.hydratedButtons || payload.templateId || payload.hydratedTemplate || payload.buttonsMessage);
        if (isTemplateEcho) {
            return Response.json({ status: "ignored_template_echo" });
        }

        const reactionEmoji = payload.reaction?.value || payload.reaction?.reaction || payload.reaction?.emoji || null;
        const isReaction = !!reactionEmoji || payload.type === 'ReactionMessage' || (payload.reaction && typeof payload.reaction === 'object');

        // Deduplicação
        const recentMsgs = await base44.asServiceRole.entities.Message.list('-created_date', 8);
        const duplicate = recentMsgs.find(m => {
            const raw = m.raw_payload || {};
            return raw.messageId === payload.messageId || raw.id === payload.messageId;
        });
        if (duplicate) {
            return Response.json({ status: "ignored_duplicate" });
        }

        // Normalização de telefone (canônica) — igual à conexão principal.
        const isLidValue = (v) => typeof v === 'string' && (v.includes('@lid') || v.includes('@s.whatsapp.net') || v.replace(/\D/g, '').length > 13);
        const extractRealPhone = (v) => {
            if (!v) return null;
            const digits = String(v).replace(/\D/g, '');
            if (digits.length >= 10 && digits.length <= 13) return digits;
            return null;
        };

        let phone = payload.phone;
        if (isLidValue(phone)) {
            const candidates = [payload.participantPhone, payload.senderPhone, payload.author, payload.chatName];
            let recovered = null;
            for (const c of candidates) {
                const real = extractRealPhone(c);
                if (real) { recovered = real; break; }
            }
            if (recovered) phone = recovered;
        }
        const phoneIsLid = isLidValue(phone);

        let rawName = (
            payload.senderName || payload.chatName || payload.notifyName || payload.pushName ||
            payload.contact?.name || payload.contactName || payload.participantName || payload.author ||
            payload.verifiedName || payload.profileName || ''
        ).toString().trim();

        const checkInvalidName = (n) => !n ||
            n.toLowerCase().includes('@lid') || n.toLowerCase().includes('@s.whatsapp.net') ||
            /^\+?\d{8,}$/.test(n.replace(/\s/g, ''));

        // Fallback de nome via Z-API (instância Moinhos)
        if (checkInvalidName(rawName)) {
            const instanceId = Deno.env.get("ZAPI_MOINHOS_INSTANCE_ID");
            const zapiToken = Deno.env.get("ZAPI_MOINHOS_TOKEN");
            const zClientToken = Deno.env.get("ZAPI_MOINHOS_SECURITY_TOKEN");
            if (instanceId && zapiToken) {
                const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${zapiToken}`;
                const lidIdRaw = String(payload.phone || '').replace(/@.*/, '').trim();
                const identifiers = [...new Set([phone, payload.phone, lidIdRaw].filter(Boolean))];
                const endpoints = [];
                for (const idf of identifiers) {
                    endpoints.push(`${baseUrl}/chats/${idf}`);
                    endpoints.push(`${baseUrl}/contacts/${idf}`);
                }
                for (const url of endpoints) {
                    try {
                        const res = await fetch(url, { headers: { "client-token": zClientToken || "" }, signal: AbortSignal.timeout(3000) });
                        if (!res.ok) continue;
                        const data = await res.json();
                        const fetchedName = (data?.name || data?.pushname || data?.short || data?.notify || '').toString().trim();
                        if (fetchedName && !checkInvalidName(fetchedName)) {
                            rawName = fetchedName;
                            break;
                        }
                    } catch (err) {
                        console.warn('Failed to fetch contact name from provider (Moinhos).', err?.message || 'provider_lookup_failed');
                    }
                }
            }
        }

        const isInvalidName = checkInvalidName(rawName);
        const senderName = isInvalidName ? "Novo Cliente" : rawName;

        const canonicalPhone = (raw) => {
            let d = String(raw || '').replace(/\D/g, '');
            if (!d) return '';
            if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
            if (d.startsWith('55') && d.length === 13 && d[4] === '9') {
                d = d.substring(0, 4) + d.substring(5);
            }
            return d;
        };

        const canonPhone = phoneIsLid ? '' : canonicalPhone(phone);
        if (canonPhone) phone = canonPhone;

        // Encontra cliente por telefone canônico
        let customer = null;
        if (canonPhone && !phoneIsLid) {
            const recentCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 500);
            customer = recentCustomers.find(c => (c.phones || []).some(p => canonicalPhone(p) === canonPhone));
        }

        // LID: tenta casar por nome, senão reconecta pela conversa anterior com o mesmo LID
        if (!customer && phoneIsLid && !isInvalidName) {
            const recentCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 400);
            const nameLower = senderName.toLowerCase();
            customer = recentCustomers.find(c => (c.full_name || '').trim().toLowerCase() === nameLower);
        }
        if (!customer && phoneIsLid) {
            const lidId = String(payload.phone || '').toLowerCase();
            if (lidId) {
                const recentMessagesGlobal = await base44.asServiceRole.entities.Message.list('-created_date', 200);
                const priorMsg = recentMessagesGlobal.find(m => String((m.raw_payload || {}).phone || '').toLowerCase() === lidId);
                if (priorMsg?.conversation_id) {
                    const priorConv = await base44.asServiceRole.entities.Conversation.get(priorMsg.conversation_id);
                    if (priorConv?.customer_id) {
                        customer = await base44.asServiceRole.entities.Customer.get(priorConv.customer_id);
                    }
                }
            }
        }

        // Eco 'fromMe' em LID sem cliente: ignora (já registrado pelo sender)
        if (!customer && phoneIsLid && payload.fromMe) {
            return Response.json({ status: 'ignored_fromme_lid_echo' });
        }

        if (!customer) {
            const phonesToStore = phoneIsLid ? [] : [phone];
            customer = await base44.asServiceRole.entities.Customer.create({
                full_name: senderName,
                phones: phonesToStore,
                opt_in_whatsapp: false,
                whatsapp_consent_status: 'unknown',
                last_inbound_at: new Date().toISOString(),
                status: 'active',
                unit_id: MOINHOS_UNIT_ID,
                preferred_unit_name: MOINHOS_UNIT_NAME
            });
            try {
                await base44.asServiceRole.entities.CrmCard.create({
                    pipeline_type: 'NEW_CUSTOMER',
                    stage: 'Novo cliente',
                    priority: 'MEDIUM',
                    customer_id: customer.id,
                    unit_id: MOINHOS_UNIT_ID
                });
            } catch (err) {
                console.error("Falha ao criar CRM card (Moinhos):", err);
            }
        } else {
            const currentName = (customer.full_name || '').trim();
            const isPlaceholder = !currentName || currentName === 'Cliente' || currentName === 'Novo Cliente' ||
                currentName.toLowerCase().includes('@lid') || currentName.toLowerCase().includes('@s.whatsapp.net') ||
                /^\+?\d{8,}$/.test(currentName.replace(/\s/g, ''));
            const updatePayload = {
                last_inbound_at: new Date().toISOString(),
                // Este número é EXCLUSIVO de Moinhos — sempre força o vínculo.
                unit_id: MOINHOS_UNIT_ID,
                preferred_unit_name: MOINHOS_UNIT_NAME
            };
            if (isPlaceholder && !isInvalidName) updatePayload.full_name = senderName;
            if (!phoneIsLid && canonPhone) {
                const alreadyHas = (customer.phones || []).some(p => canonicalPhone(p) === canonPhone);
                if (!alreadyHas) {
                    updatePayload.phones = [...(customer.phones || []).filter(p => p && !p.includes('@')), canonPhone];
                }
            }
            await base44.asServiceRole.entities.Customer.update(customer.id, updatePayload);
        }

        // Encontra/cria conversa — SOMENTE conversas da conexão Moinhos (source zapi_moinhos).
        // Cada número/conexão Z-API tem sua PRÓPRIA conversa: nunca reutiliza a conversa
        // da conexão principal (Rio Branco) do mesmo cliente.
        let conversation = await base44.asServiceRole.entities.Conversation.filter({
            customer_id: customer.id,
            channel: 'WHATSAPP'
        }).then(res => res
            .filter(c => (c.metadata || {}).source === 'zapi_moinhos')
            .sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())[0]);

        const moinhosMeta = {
            source: 'zapi_moinhos',
            unit_id: MOINHOS_UNIT_ID,
            unit_name: MOINHOS_UNIT_NAME,
            awaiting_unit_selection: false,
            unit_confirmed: true
        };

        if (!conversation) {
            conversation = await base44.asServiceRole.entities.Conversation.create({
                customer_id: customer.id,
                channel: 'WHATSAPP',
                status: 'OPEN',
                zapi_instance_id: payload.instanceId,
                last_message_at: new Date().toISOString(),
                metadata: moinhosMeta
            });
        } else if (conversation.status === 'CLOSED') {
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                status: 'OPEN',
                last_message_at: new Date().toISOString(),
                metadata: { ...(conversation.metadata || {}), ...moinhosMeta }
            });
            conversation.status = 'OPEN';
            conversation.metadata = { ...(conversation.metadata || {}), ...moinhosMeta };
        }

        // Determina tipo/conteúdo
        let type = 'TEXT';
        let text = '';
        let mediaUrl = null;

        const buttonReplyText = payload.buttonsResponseMessage?.message || payload.buttonsResponseMessage?.selectedDisplayText || null;
        const optionReplyText = payload.listResponseMessage?.title || payload.listResponseMessage?.singleSelectReply?.selectedRowTitle || payload.selectedOption?.title || null;
        const optionReplyId = payload.listResponseMessage?.selectedRowId || payload.selectedOption?.id || null;

        if (isReaction) {
            type = 'TEXT';
            text = `${reactionEmoji || '👍'} reagiu à mensagem`;
        } else if (buttonReplyText) {
            type = 'TEXT';
            text = buttonReplyText;
        } else if (optionReplyText || optionReplyId) {
            type = 'TEXT';
            text = optionReplyText || optionReplyId;
        } else if (payload.audio) {
            type = 'AUDIO';
            mediaUrl = payload.audio.audioUrl || payload.audio.url;
        } else if (payload.image) {
            type = 'IMAGE';
            mediaUrl = payload.image.imageUrl || payload.image.url;
            text = payload.image.caption || '';
        } else if (payload.document) {
            type = 'DOC';
            mediaUrl = payload.document.documentUrl || payload.document.url;
            text = payload.document.caption || '';
        } else if ((payload.type || '').toUpperCase() === 'TEXT' || payload.text) {
            type = 'TEXT';
            text = payload.text?.message || payload.text || '';
        }

        const normalizedText = (text || '').trim().toLowerCase();
        const cleanText = normalizedText.replace(/[^a-z0-9]/g, '');
        const isEmojiOnly = /^[\p{Emoji}\s]+$/u.test(text || '') && cleanText.length === 0;
        const shouldIgnoreSoloMessage = type === 'TEXT' && ['ok', 'okkk', 'ta', 'tabom', 'beleza', 'sair', 'retorno', 'retornar'].includes(cleanText);
        const wantsOptOut = type === 'TEXT' && ['parar', 'cancelar', 'não receber mais mensagens', 'nao receber mais mensagens', 'sair da lista', 'remover da lista', 'opt_out_dispatch'].includes(normalizedText);
        const classifiedConsent = type === 'TEXT' ? classifyConsentResponse(text) : null;
        const canResolveConsent = ['unknown', 'pending'].includes(customer.whatsapp_consent_status || 'unknown') && customer.opt_in_whatsapp !== true;
        let consentDecision = null;
        if (classifiedConsent && canResolveConsent) {
            let hasPendingConsent = hasActiveConsentRequest(customer);
            if (!hasPendingConsent) {
                const recentConsentDispatches = await base44.asServiceRole.entities.AutomatedDispatch.filter({
                    customer_id: customer.id,
                    type: 'consent_request'
                }, '-sent_at', 20);
                const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
                hasPendingConsent = recentConsentDispatches.some((dispatch) => {
                    const sentAt = new Date(dispatch.sent_at || dispatch.created_date).getTime();
                    return dispatch.metadata?.sender === 'moinhos' &&
                        !dispatch.metadata?.consent_decision &&
                        Number.isFinite(sentAt) && sentAt >= thirtyDaysAgo;
                });
            }
            if (hasPendingConsent) consentDecision = classifiedConsent;
        }

        // Salva a mensagem (marca a origem no raw_payload).
        const message = await base44.asServiceRole.entities.Message.create({
            conversation_id: conversation.id,
            direction: payload.fromMe ? 'OUT' : 'IN',
            type: type,
            text: text,
            raw_payload: { ...payload, source: 'zapi_moinhos' },
            media_file_id: mediaUrl
        });

        await base44.asServiceRole.entities.Conversation.update(conversation.id, {
            last_message_id: message.id,
            last_message_at: new Date().toISOString()
        });

        const intentText = normalizedText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const recentPromotionOfferAt = new Date(conversation.metadata?.promotion_offer_sent_at || '').getTime();
        const isRecentPromotionOffer = Number.isFinite(recentPromotionOfferAt) && Date.now() - recentPromotionOfferAt <= 48 * 60 * 60 * 1000;
        const wantsRegularQuote = intentText.includes('orcamento normal') || intentText.includes('fora da promocao') || intentText.includes('fora dessas promocoes');
        if (!payload.fromMe && type === 'TEXT' && isRecentPromotionOffer && wantsRegularQuote) {
            const collectingCards = await base44.asServiceRole.entities.CrmCard.filter({
                pipeline_type: 'QUOTE',
                customer_id: customer.id,
                stage: 'Coletando itens'
            });
            if (!collectingCards.length) {
                await base44.asServiceRole.entities.CrmCard.create({
                    pipeline_type: 'QUOTE',
                    stage: 'Coletando itens',
                    priority: 'MEDIUM',
                    customer_id: customer.id,
                    unit_id: MOINHOS_UNIT_ID
                });
            }
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                handoff_required: false,
                metadata: {
                    ...(conversation.metadata || {}),
                    flow: 'TEXT_QUOTE',
                    step: 'COLLECTING_ITEMS_TEXT',
                    temp_items: [],
                    selected_promotion: null,
                    handoff_reason: null
                }
            });
            await base44.asServiceRole.functions.invoke('zapi_moinhos_sender', {
                phone,
                message: 'Claro! Vamos fazer um orçamento normal 😊 Você prefere enviar fotos das peças ou listar por texto quais são as peças e as quantidades?',
                conversation_id: conversation.id,
                _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
            });
            return Response.json({ status: 'regular_quote_started', messageId: message.id });
        }

        if (!payload.fromMe && consentDecision) {
            const accepted = consentDecision === 'accepted';
            const decidedAt = new Date().toISOString();
            const consentUpdate = {
                opt_in_whatsapp: accepted,
                whatsapp_consent_status: accepted ? 'accepted' : 'revoked',
                whatsapp_consent_response_text: text,
                whatsapp_consent_source: 'zapi_moinhos',
                last_inbound_at: decidedAt,
                ...(accepted ? { opt_in_whatsapp_at: decidedAt } : { opt_out_whatsapp_at: decidedAt })
            };
            await base44.asServiceRole.entities.Customer.update(customer.id, consentUpdate);

            const consentDispatches = await base44.asServiceRole.entities.AutomatedDispatch.filter({
                customer_id: customer.id,
                type: 'consent_request'
            }, '-sent_at', 20);
            const matchingDispatch = consentDispatches.find(dispatch =>
                dispatch.metadata?.sender === 'moinhos' &&
                new Date(dispatch.sent_at || dispatch.created_date).getTime() <= new Date(decidedAt).getTime()
            );
            if (matchingDispatch) {
                await base44.asServiceRole.entities.AutomatedDispatch.update(matchingDispatch.id, {
                    status: 'read',
                    metadata: {
                        ...(matchingDispatch.metadata || {}),
                        consent_decision: consentDecision,
                        consent_response_text: text,
                        consent_responded_at: decidedAt
                    }
                });
            }

            let responseText = 'Tudo certo. Seu consentimento não foi ativado e você não receberá campanhas promocionais.';
            if (accepted) {
                const promotions = await base44.asServiceRole.entities.Promotion.filter({ active: true });
                const activePromotions = getActivePromotions(promotions);
                responseText = buildPromotionsOfferMessage(activePromotions);
                await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                    handoff_required: false,
                    metadata: {
                        ...(conversation.metadata || {}),
                        flow: 'MOINHOS_PROMOTION_INTEREST',
                        handoff_reason: null,
                        step: 'AWAITING_PROMOTION_CHOICE',
                        promotion_offer_sent_at: decidedAt,
                        promotion_ids: activePromotions.map((promotion) => promotion.id),
                        promotion_titles: activePromotions.map((promotion) => promotion.title.trim())
                    }
                });
            }
            try {
                await base44.asServiceRole.functions.invoke('zapi_moinhos_sender', {
                    phone,
                    message: responseText,
                    conversation_id: conversation.id,
                _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                });
            } catch (err) {
                console.error('Failed to send consent confirmation and promotions (Moinhos):', err);
            }
            return Response.json({ status: accepted ? 'consent_accepted_promotions_sent' : 'consent_declined', messageId: message.id });
        }

        if (!payload.fromMe && wantsOptOut) {
            const optedOutAt = new Date().toISOString();
            await base44.asServiceRole.entities.Customer.update(customer.id, {
                opt_in_whatsapp: false,
                opt_out_whatsapp_at: optedOutAt,
                whatsapp_consent_status: 'revoked',
                whatsapp_consent_response_text: text,
                last_inbound_at: optedOutAt
            });
            try {
                await base44.asServiceRole.functions.invoke('zapi_moinhos_sender', {
                    phone,
                    message: 'Pronto! Você foi removido da nossa base de disparos e não receberá mais mensagens automáticas.',
                    conversation_id: conversation.id,
                _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                });
            } catch (err) {
                console.error('Failed to send opt-out confirmation (Moinhos):', err);
            }
            return Response.json({ status: 'opt_out_success', messageId: message.id });
        }

        if (!payload.fromMe && type === 'TEXT' && (shouldIgnoreSoloMessage || isEmojiOnly)) {
            return Response.json({ status: 'ignored_solo_text', messageId: message.id });
        }
        if (!payload.fromMe && isReaction) {
            return Response.json({ status: 'reaction_saved_no_ai', messageId: message.id });
        }

        // Download de mídia em background
        if (mediaUrl) {
            runInBackground(
                base44.asServiceRole.functions.invoke('zapi_media_downloader', {
                    message_id: message.id,
                    media_url: mediaUrl,
                    media_type: type,
                    _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                }).catch((err) => console.error("Media download failed (Moinhos, background):", err))
            );
        }

        // Respostas a disparos/broadcasts continuam no atendimento da IA.
        // Limpa somente handoffs automáticos de campanha; handoffs humanos reais permanecem.
        if (conversation.handoff_required && isDispatchGeneratedHandoff(conversation.metadata)) {
            const cleanedMetadata = clearDispatchGeneratedHandoff(conversation.metadata);
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                handoff_required: false,
                metadata: cleanedMetadata
            });
            conversation.handoff_required = false;
            conversation.metadata = cleanedMetadata;
        }

        // Atendimento humano ativo: a IA NUNCA responde por cima do atendente.
        if (conversation.handoff_required) {
            return Response.json({ status: 'success', messageId: message.id, note: 'handoff_active_ai_skipped' });
        }

        // Mesmo sem a flag ligada: se um atendente já respondeu nesta conversa há pouco
        // (pelo painel ou pelo celular/WhatsApp Web da loja), o atendimento é humano.
        if (await hasRecentHumanReply(base44, conversation.id)) {
            return Response.json({ status: 'success', messageId: message.id, note: 'recent_human_reply_ai_skipped' });
        }

        // Dispara a IA de forma DESACOPLADA (mesma arquitetura da conexão principal):
        // marca a mensagem como pendente e responde 200 na hora. A automação
        // 'aiReplyTrigger' chama a Glória em segundos usando o sender de Moinhos.
        if (!payload.fromMe && (type === 'IMAGE' || type === 'TEXT' || type === 'AUDIO' || type === 'DOC')) {
            await base44.asServiceRole.entities.Message.update(message.id, {
                ai_pending: true,
                ai_source: 'zapi_moinhos'
            });
            return Response.json({ status: "success", messageId: message.id, note: "ai_queued" });
        }

        return Response.json({ status: "success", messageId: message.id });

    } catch (error) {
        console.error("Erro no zapi_moinhos_webhook:", error?.code || error?.message || error);
        return securityErrorResponse(error);
    }
}