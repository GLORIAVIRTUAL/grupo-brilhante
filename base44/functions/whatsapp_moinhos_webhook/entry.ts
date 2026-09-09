import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { requireMetaSignature, securityErrorResponse, SecurityError } from '../../shared/functionSecurity.js';
import { classifyConsentResponse, hasActiveConsentRequest } from '../../shared/whatsappConsent.js';
import { buildPromotionsOfferMessage, getActivePromotions } from '../../shared/promotionFlow.js';

// Unidade Moinhos Shopping — todos os clientes/conversas deste número são vinculados a ela.
const MOINHOS_UNIT_ID = '69b296b5a0216981a77970c4';
const MOINHOS_UNIT_NAME = 'Loja Moinhos Shopping';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const VERIFY_TOKEN = Deno.env.get("WHATSAPP_MOINHOS_VERIFY_TOKEN");

        // ====================================================================
        // 1. VERIFICAÇÃO DO WEBHOOK (GET) — exigida pela Meta ao configurar.
        // ====================================================================
        if (req.method === 'GET') {
            const url = new URL(req.url);
            const mode = url.searchParams.get('hub.mode');
            const token = url.searchParams.get('hub.verify_token');
            const challenge = url.searchParams.get('hub.challenge');

            if (!VERIFY_TOKEN) throw new SecurityError('Token de verificação Meta não configurado.', 503, 'META_VERIFY_TOKEN_NOT_CONFIGURED');
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log("Webhook Moinhos verificado com sucesso.");
                return new Response(challenge, { status: 200 });
            }
            console.warn('Falha na verificação do webhook Moinhos.');
            return new Response("Forbidden", { status: 403 });
        }

        // ====================================================================
        // 2. RECEBIMENTO DE MENSAGENS (POST)
        // ====================================================================
        const rawBody = await req.text();
        await requireMetaSignature(req, rawBody, 'WHATSAPP_MOINHOS_APP_SECRET');
        const payload = JSON.parse(rawBody);
        console.log('Webhook Moinhos payload recebido.', { entries: payload.entry?.length || 0 });

        const entry = payload.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;

        // Ignora notificações de status (sent/delivered/read) — só processamos mensagens.
        if (!value?.messages || value.messages.length === 0) {
            return Response.json({ status: "ignored_no_message" });
        }

        const msg = value.messages[0];
        const contact = value.contacts?.[0];
        const waMessageId = msg.id;
        const phone = (msg.from || '').replace(/\D/g, ''); // ex: 5551999999999
        const profileName = (contact?.profile?.name || '').toString().trim();

        if (!phone || !waMessageId) {
            return Response.json({ status: "ignored_missing_fields" });
        }

        // DEDUPLICAÇÃO: verifica os registros recentes pelo id da mensagem da Meta.
        const recentMsgs = await base44.asServiceRole.entities.Message.list('-created_date', 8);
        const duplicate = recentMsgs.find(m => {
            const raw = m.raw_payload || {};
            return raw.wa_message_id === waMessageId;
        });
        if (duplicate) {
            console.log("Mensagem duplicada ignorada (Moinhos):", waMessageId);
            return Response.json({ status: "ignored_duplicate" });
        }

        const checkInvalidName = (n) => !n || /^\+?\d{8,}$/.test((n || '').replace(/\s/g, ''));
        const senderName = checkInvalidName(profileName) ? "Novo Cliente" : profileName;

        // ====================================================================
        // 3. ENCONTRA OU CRIA O CLIENTE (vinculado à unidade Moinhos)
        // ====================================================================
        const phoneNoCountry = phone.startsWith('55') && phone.length > 11 ? phone.substring(2) : phone;

        let customer = await base44.asServiceRole.entities.Customer.filter({ phones: phone }).then(res => res[0]);

        if (!customer && phoneNoCountry !== phone) {
            customer = await base44.asServiceRole.entities.Customer.filter({ phones: phoneNoCountry }).then(res => res[0]);
        }

        // Trata o 9º dígito brasileiro
        if (!customer && phone.startsWith('55') && (phone.length === 12 || phone.length === 13)) {
            const ddd = phone.substring(2, 4);
            const num = phone.substring(4);
            let altPhone;
            if (num.length === 8) altPhone = `55${ddd}9${num}`;
            else if (num.length === 9 && num.startsWith('9')) altPhone = `55${ddd}${num.substring(1)}`;
            if (altPhone) {
                customer = await base44.asServiceRole.entities.Customer.filter({ phones: altPhone }).then(res => res[0]);
            }
        }

        // Fallback: últimos 10 dígitos
        if (!customer) {
            const last10 = phone.slice(-10);
            if (last10.length >= 10) {
                const recentCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 300);
                customer = recentCustomers.find(c => c.phones?.some(p => p.replace(/\D/g, '').slice(-10) === last10));
            }
        }

        if (!customer) {
            customer = await base44.asServiceRole.entities.Customer.create({
                full_name: senderName,
                phones: [phone],
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
                /^\+?\d{8,}$/.test(currentName.replace(/\s/g, ''));
            const updatePayload = {
                last_inbound_at: new Date().toISOString(),
                // Este número é EXCLUSIVO da unidade Moinhos — sempre força o vínculo,
                // mesmo que o cliente já existisse (ex: criado antes pela Z-API).
                unit_id: MOINHOS_UNIT_ID,
                preferred_unit_name: MOINHOS_UNIT_NAME
            };
            if (isPlaceholder && !checkInvalidName(profileName)) updatePayload.full_name = senderName;
            await base44.asServiceRole.entities.Customer.update(customer.id, updatePayload);
        }

        // ====================================================================
        // 4. ENCONTRA OU CRIA A CONVERSA
        // ====================================================================
        let conversation = await base44.asServiceRole.entities.Conversation.filter({
            customer_id: customer.id,
            channel: 'WHATSAPP'
        }).then(res => res.sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())[0]);

        if (!conversation) {
            conversation = await base44.asServiceRole.entities.Conversation.create({
                customer_id: customer.id,
                channel: 'WHATSAPP',
                status: 'OPEN',
                last_message_at: new Date().toISOString(),
                metadata: {
                    source: 'whatsapp_moinhos',
                    unit_id: MOINHOS_UNIT_ID,
                    unit_name: MOINHOS_UNIT_NAME,
                    awaiting_unit_selection: false,
                    unit_confirmed: true
                }
            });
        } else if (conversation.status === 'CLOSED') {
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                status: 'OPEN',
                last_message_at: new Date().toISOString(),
                metadata: {
                    ...(conversation.metadata || {}),
                    source: 'whatsapp_moinhos',
                    unit_id: MOINHOS_UNIT_ID,
                    unit_name: MOINHOS_UNIT_NAME,
                    awaiting_unit_selection: false,
                    unit_confirmed: true
                }
            });
            conversation.status = 'OPEN';
        }

        // ====================================================================
        // 5. DETERMINA TIPO E CONTEÚDO DA MENSAGEM
        // ====================================================================
        let type = 'TEXT';
        let text = '';
        let mediaId = null; // id de mídia da Meta (precisa baixar via Graph API depois)

        if (msg.type === 'text') {
            type = 'TEXT';
            text = msg.text?.body || '';
        } else if (msg.type === 'image') {
            type = 'IMAGE';
            mediaId = msg.image?.id;
            text = msg.image?.caption || '';
        } else if (msg.type === 'audio') {
            type = 'AUDIO';
            mediaId = msg.audio?.id;
        } else if (msg.type === 'document') {
            type = 'DOC';
            mediaId = msg.document?.id;
            text = msg.document?.caption || msg.document?.filename || '';
        } else if (msg.type === 'button') {
            type = 'TEXT';
            text = msg.button?.text || '';
        } else if (msg.type === 'interactive') {
            type = 'TEXT';
            text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
        }

        // ====================================================================
        // 6. SALVA A MENSAGEM
        // ====================================================================
        const message = await base44.asServiceRole.entities.Message.create({
            conversation_id: conversation.id,
            direction: 'IN',
            type: type,
            text: text,
            raw_payload: { ...payload, wa_message_id: waMessageId, source: 'whatsapp_moinhos', media_id: mediaId }
        });

        await base44.asServiceRole.entities.Conversation.update(conversation.id, {
            last_message_id: message.id,
            last_message_at: new Date().toISOString()
        });

        const normalizedText = String(text || '').trim().toLowerCase();
        const consentDecision = type === 'TEXT' && hasActiveConsentRequest(customer)
            ? classifyConsentResponse(text)
            : null;
        const wantsOptOut = type === 'TEXT' && [
            'parar', 'cancelar', 'não receber mais mensagens', 'nao receber mais mensagens',
            'sair da lista', 'remover da lista', 'sair'
        ].includes(normalizedText);

        if (consentDecision) {
            const accepted = consentDecision === 'accepted';
            const decidedAt = new Date().toISOString();
            await base44.asServiceRole.entities.Customer.update(customer.id, {
                opt_in_whatsapp: accepted,
                whatsapp_consent_status: accepted ? 'accepted' : 'revoked',
                whatsapp_consent_response_text: text,
                whatsapp_consent_source: 'whatsapp_moinhos',
                last_inbound_at: decidedAt,
                ...(accepted ? { opt_in_whatsapp_at: decidedAt } : { opt_out_whatsapp_at: decidedAt })
            });
            let responseText = 'Tudo certo. Seu consentimento não foi ativado e você não receberá campanhas promocionais.';
            if (accepted) {
                const promotions = await base44.asServiceRole.entities.Promotion.filter({ active: true });
                const activePromotions = getActivePromotions(promotions);
                responseText = buildPromotionsOfferMessage(activePromotions);
                await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                    metadata: {
                        ...(conversation.metadata || {}),
                        flow: 'MOINHOS_PROMOTION_INTEREST',
                        step: 'AWAITING_PROMOTION_CHOICE',
                        promotion_offer_sent_at: decidedAt,
                        promotion_ids: activePromotions.map((promotion) => promotion.id),
                        promotion_titles: activePromotions.map((promotion) => promotion.title.trim())
                    }
                });
            }
            await base44.asServiceRole.functions.invoke('whatsapp_moinhos_sender', {
                phone,
                message: responseText,
                conversation_id: conversation.id,
                _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
            });
            return Response.json({ status: accepted ? 'consent_accepted_promotions_sent' : 'consent_declined', messageId: message.id });
        }

        if (wantsOptOut) {
            const optedOutAt = new Date().toISOString();
            await base44.asServiceRole.entities.Customer.update(customer.id, {
                opt_in_whatsapp: false,
                opt_out_whatsapp_at: optedOutAt,
                whatsapp_consent_status: 'revoked',
                whatsapp_consent_response_text: text,
                whatsapp_consent_source: 'whatsapp_moinhos',
                last_inbound_at: optedOutAt
            });
            await base44.asServiceRole.functions.invoke('whatsapp_moinhos_sender', {
                phone,
                message: 'Pronto! Você foi removido da nossa base de disparos e não receberá mais mensagens automáticas.',
                conversation_id: conversation.id,
                _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
            });
            return Response.json({ status: 'opt_out_success', messageId: message.id });
        }

        // Se já está em atendimento humano, não aciona a IA.
        if (conversation.handoff_required) {
            return Response.json({ status: 'success', messageId: message.id, note: 'handoff_no_ai' });
        }

        // ====================================================================
        // 7. DEBOUNCE + ORCHESTRATOR EM BACKGROUND (mesma lógica da Z-API)
        // ====================================================================
        if (type === 'TEXT' || type === 'IMAGE' || type === 'AUDIO') {
            (async () => {
                try {
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    const recentMessages = await base44.asServiceRole.entities.Message.filter({
                        conversation_id: conversation.id,
                        direction: 'IN'
                    });
                    recentMessages.sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime());
                    const newestMessage = recentMessages[0];
                    if (newestMessage && newestMessage.id !== message.id && new Date(newestMessage.created_date) > new Date(message.created_date)) {
                        console.log(`Pulando orchestrator (Moinhos): mensagem mais nova chegou.`);
                        return;
                    }

                    await base44.asServiceRole.functions.invoke('orchestrator', {
                        conversation_id: conversation.id,
                        message_id: message.id,
                        customer_id: customer.id,
                        payload: { ...payload, source: 'whatsapp_moinhos', phone },
                        _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                    });
                } catch (orchError) {
                    console.error("Orchestrator falhou (Moinhos, background):", orchError);
                }
            })();
        }

        return Response.json({ status: "success", messageId: message.id });

    } catch (error) {
        console.error("Erro no whatsapp_moinhos_webhook:", error?.code || error?.message || error);
        return securityErrorResponse(error);
    }
});