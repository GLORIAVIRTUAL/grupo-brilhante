import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { requireProviderToken, securityErrorResponse } from '../../shared/functionSecurity.js';
import { classifyConsentResponse, hasActiveConsentRequest } from '../../shared/whatsappConsent.js';
import { clearDispatchGeneratedHandoff, isDispatchGeneratedHandoff } from '../../shared/dispatchReplyPolicy.js';
import { hasRecentHumanReply } from '../../shared/humanActivity.js';
import { canonicalPhone } from '../../shared/customerPhone.js';
import { CUSTOMER_SOURCES, ensureCustomerSourceCard } from '../../shared/customerSource.js';

Deno.serve(async (req) => {
    // Helper: mantém o trabalho em background VIVO após o retorno do 200.
    // Sem isto, o runtime encerra a função assim que respondemos e o debounce/
    // orchestrator são MORTOS antes de rodar — causa real da resposta só sair no
    // próximo webhook (atraso de minutos).
    const runInBackground = (promise) => {
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
            EdgeRuntime.waitUntil(promise);
        }
    };

    try {
        const base44 = createClientFromRequest(req);
        
        // A Z-API NÃO envia o Client-Token nos webhooks. Se o cabeçalho vier (chamada
        // interna/teste), validamos; caso contrário, autenticamos pelo instanceId do payload.
        const hasProviderHeader = Boolean(req.headers.get('client-token'));
        if (hasProviderHeader) {
            requireProviderToken(req, 'ZAPI_SECURITY_TOKEN', ['client-token']);
        }
        const payload = await req.json();
        if (!hasProviderHeader) {
            const expectedInstance = Deno.env.get('ZAPI_INSTANCE_ID');
            if (expectedInstance && payload.instanceId && payload.instanceId !== expectedInstance) {
                console.log('Ignored webhook from unknown instance.');
                return Response.json({ status: 'ignored_unknown_instance' });
            }
        }
        
        console.log("Webhook received payload keys:", JSON.stringify(Object.keys(payload)));
        console.log('Webhook message received.', { has_message_id: Boolean(payload.messageId), from_me: Boolean(payload.fromMe) });
        
        // Basic validation of Z-API payload
        if (!payload.phone || !payload.messageId) {
            console.log('Ignored webhook with missing required identifiers.');
            return Response.json({ status: "ignored" });
        }

        // ============================================================================
        // BLOCK GROUP MESSAGES — the Glória assistant is strictly 1-on-1.
        // Z-API flags group chats with isGroup=true and uses a group id as "phone"
        // (e.g. "120363xxxxxxxxxx-xxxxxxxxxx@g.us" or a number ending in "-group").
        // If we don't ignore these, the group id gets saved as a customer phone and any
        // reply from the store is delivered into the WhatsApp GROUP instead of the
        // customer's private chat. We must never create a customer/conversation or
        // trigger the AI for groups.
        // ============================================================================
        const isGroupMessage =
            payload.isGroup === true ||
            payload.isgroup === true ||
            !!payload.groupId ||
            (typeof payload.phone === 'string' &&
                (payload.phone.includes('@g.us') || payload.phone.includes('-group') || payload.phone.includes('-')));
        if (isGroupMessage) {
            console.log('Ignored group message.', { has_message_id: Boolean(payload.messageId) });
            return Response.json({ status: "ignored_group" });
        }

        // Z-API sends a "waitingMessage" placeholder before the real content arrives.
        // It has no actual content — ignore it and wait for the real webhook.
        // We only care about real content fields: text, image, audio, document, buttonsResponseMessage, listResponseMessage.
        const hasRealContent = !!(payload.text || payload.image || payload.audio || payload.document || payload.buttonsResponseMessage || payload.listResponseMessage || payload.selectedOption);
        if (payload.waitingMessage === true && !hasRealContent) {
            console.log("Ignored: waitingMessage placeholder (real content will arrive in next webhook). messageId:", payload.messageId);
            return Response.json({ status: "ignored_waiting" });
        }

        // Ignore LID-only technical webhooks (phone with 15+ digits is a WhatsApp internal ID, not a real number).
        // These webhooks arrive with no real content and should not create messages.
        const phoneDigits = (payload.phone || '').replace(/\D/g, '');
        if (phoneDigits.length > 13 && !hasRealContent) {
            console.log('Ignored provider LID webhook without content.', { has_message_id: Boolean(payload.messageId) });
            return Response.json({ status: "ignored_lid_no_content" });
        }

        // Ignore template/campaign echoes — these are messages WE sent (template with hydratedButtons/templateId)
        // bouncing back as RECEIVEDCALLBACK. They are NOT customer replies, just delivery confirmations.
        const isTemplateEcho = !!(payload.hydratedButtons || payload.templateId || payload.hydratedTemplate || payload.buttonsMessage);
        if (isTemplateEcho) {
            console.log('Ignored template/campaign echo.', { has_message_id: Boolean(payload.messageId) });
            return Response.json({ status: "ignored_template_echo" });
        }

        // Detect emoji reaction (Z-API sends payload.reaction with the emoji).
        // Reactions should appear in the chat but NEVER trigger the AI.
        const reactionEmoji = payload.reaction?.value || payload.reaction?.reaction || payload.reaction?.emoji || null;
        const isReaction = !!reactionEmoji || payload.type === 'ReactionMessage' || (payload.reaction && typeof payload.reaction === 'object');

        // DEDUPLICATION: check only the most recent messages globally
        const recentMsgs = await base44.asServiceRole.entities.Message.list('-created_date', 8);
        const duplicate = recentMsgs.find(m => {
            const raw = m.raw_payload || {};
            return raw.messageId === payload.messageId || raw.id === payload.messageId;
        });

        if (duplicate) {
            console.log("Duplicate webhook detected (messageId already exists):", payload.messageId);
            return Response.json({ status: "ignored_duplicate" });
        }

        // If it's NOT a duplicate and it is 'fromMe', it means it was sent from the Phone/Web directly
        // We should process it so it appears in the chat history.
        if (payload.fromMe) {
             console.log("Processing 'fromMe' message (sent from Phone/Web):", payload.messageId);
        }

        // ============================================================================
        // PHONE NORMALIZATION — fix for duplicated customers caused by @lid webhooks.
        // Sometimes Z-API sends payload.phone as a WhatsApp internal LID id
        // (e.g. "62612603666646@lid") instead of the real number. When that happens,
        // we must try to recover the REAL phone number from other payload fields,
        // otherwise we create a duplicate customer that never matches the real one.
        // ============================================================================
        const isLidValue = (v) => typeof v === 'string' && (v.includes('@lid') || v.includes('@s.whatsapp.net') || v.replace(/\D/g, '').length > 13);

        const extractRealPhone = (v) => {
            if (!v) return null;
            const digits = String(v).replace(/\D/g, '');
            // Valid BR/international number: 10 to 13 digits
            if (digits.length >= 10 && digits.length <= 13) return digits;
            return null;
        };

        let phone = payload.phone; // Z-API usually sends format 5511999999999

        if (isLidValue(phone)) {
            // Try to recover a real number from common alternative fields
            const candidates = [
                payload.participantPhone,
                payload.senderPhone,
                payload.author,
                payload.chatName,
                payload.connectedPhone && payload.phone, // never use connectedPhone (that's OUR number)
            ];
            let recovered = null;
            for (const c of candidates) {
                const real = extractRealPhone(c);
                if (real) { recovered = real; break; }
            }
            if (recovered) {
                console.log('Recovered customer phone from provider LID metadata.');
                phone = recovered;
            } else {
                console.log('Could not recover phone from provider LID metadata; attempting non-phone matching.');
            }
        }

        const phoneIsLid = isLidValue(phone);
        // _phone is the original phone variable retained below for compatibility
        // Z-API sends the contact name in different fields depending on event type.
        // Try all of them and ignore generic placeholders.
        let rawName = (
            payload.senderName ||
            payload.chatName ||
            payload.notifyName ||
            payload.pushName ||
            payload.contact?.name ||
            payload.contactName ||
            payload.participantName ||
            payload.author ||
            payload.verifiedName ||
            payload.profileName ||
            payload.senderPhotoName ||
            ''
        ).toString().trim();

        const checkInvalidName = (n) => !n ||
            n.toLowerCase().includes('@lid') ||
            n.toLowerCase().includes('@s.whatsapp.net') ||
            /^\+?\d{8,}$/.test(n.replace(/\s/g, ''));

        // Fallback: if the payload didn't include a usable name, ask Z-API directly.
        // IMPORTANT: /contacts/{phone} only returns names for contacts ALREADY SAVED in the
        // account's address book (returns "Phone not exists" otherwise). To get the WhatsApp
        // profile name (pushname) of ANY number that messaged us — even unsaved ones — we also
        // try the /chats/{phone} endpoint, which returns the chat's name/pushname.
        if (checkInvalidName(rawName)) {
            const instanceId = Deno.env.get("ZAPI_INSTANCE_ID");
            const zapiToken = Deno.env.get("ZAPI_TOKEN");
            const zClientToken = Deno.env.get("ZAPI_SECURITY_TOKEN");
            if (instanceId && zapiToken) {
                const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${zapiToken}`;
                // Identifiers to try: the (possibly recovered) phone AND the original payload phone
                // (which may be the raw LID id like "62612603666646@lid"). Campaign/broadcast replies
                // usually carry only the LID, so querying by it is often the ONLY way to get the name.
                const lidIdRaw = String(payload.phone || '').replace(/@.*/, '').trim();
                const identifiers = [...new Set([phone, payload.phone, lidIdRaw].filter(Boolean))];
                // Multiple endpoints: /chats works for unsaved numbers, /contacts for saved ones,
                // and the contacts metadata endpoint returns profile name for LID-only contacts.
                const endpoints = [];
                for (const idf of identifiers) {
                    endpoints.push(`${baseUrl}/chats/${idf}`);
                    endpoints.push(`${baseUrl}/contacts/${idf}`);
                    endpoints.push(`${baseUrl}/contacts/${idf}/metadata`);
                }
                for (const url of endpoints) {
                    try {
                        const res = await fetch(url, {
                            headers: { "client-token": zClientToken || "" },
                            signal: AbortSignal.timeout(3000)
                        });
                        if (!res.ok) continue;
                        const data = await res.json();
                        const fetchedName = (
                            data?.name || data?.pushname || data?.short || data?.notify ||
                            data?.vname || data?.verifiedName || data?.contactName || ''
                        ).toString().trim();
                        if (fetchedName && !checkInvalidName(fetchedName)) {
                            rawName = fetchedName;
                            console.log('Recovered contact name from provider metadata.');
                            break;
                        }
                    } catch (err) {
                        console.warn('Failed to fetch contact name from provider.', err?.message || 'provider_lookup_failed');
                    }
                }
            }
        }

        const isInvalidName = checkInvalidName(rawName);
        const senderName = isInvalidName ? "Novo Cliente" : rawName;
        
        // 1. Find or Create Customer
        // Using asServiceRole because this is a webhook

        // ============================================================================
        // CANONICAL PHONE NORMALIZATION — single source of truth for matching/saving.
        // Brazilian mobile numbers vary by the extra "9" digit. We always reduce the
        // number to its canonical form (DDI 55 + DDD + 8-digit base, WITHOUT the extra 9)
        // and use THAT same key both to FIND and to SAVE. This guarantees that the same
        // person always maps to the same record — no more duplicates.
        // ============================================================================
        const canonPhone = phoneIsLid ? '' : canonicalPhone(phone);
        // Store the canonical phone (so all future webhooks match the same key).
        if (canonPhone) phone = canonPhone;

        // Single matching strategy: compare canonical forms. This collapses all the
        // old A/B/C/D variants into one reliable check and prevents duplicates.
        let customer = null;
        if (canonPhone && !phoneIsLid) {
            const recentCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 500);
            customer = recentCustomers.find(c =>
                (c.phones || []).some(p => canonicalPhone(p) === canonPhone)
            );
        }

        // Strategy E: If the phone is an unrecoverable LID, NEVER create a duplicate by the @lid id.
        // Instead, try to match an existing customer by their real WhatsApp name (senderName).
        // This is the main fix for "cliente novo entra e fica duplicado / sem nome".
        if (!customer && phoneIsLid && !isInvalidName) {
            const recentCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 400);
            const nameLower = senderName.toLowerCase();
            customer = recentCustomers.find(c => (c.full_name || '').trim().toLowerCase() === nameLower);
            if (customer) {
                console.log('Matched existing customer by normalized name to avoid LID duplicate.');
            }
        }

        // Strategy F: LID webhook WITHOUT a recoverable number AND without a usable name
        // (the WhatsApp "no-badge" case). Instead of creating a "Cliente Desconhecido",
        // reconnect to the conversation that already contains THIS SAME LID in a previous
        // message's raw_payload. That conversation is already linked to the real customer
        // (e.g. Leda), so we attach the new message to the correct record.
        if (!customer && phoneIsLid) {
            const lidId = String(payload.phone || '').toLowerCase();
            if (lidId) {
                const recentMessagesGlobal = await base44.asServiceRole.entities.Message.list('-created_date', 200);
                const priorMsg = recentMessagesGlobal.find(m => {
                    const raw = m.raw_payload || {};
                    return String(raw.phone || '').toLowerCase() === lidId;
                });
                if (priorMsg?.conversation_id) {
                    const priorConv = await base44.asServiceRole.entities.Conversation.get(priorMsg.conversation_id);
                    if (priorConv?.customer_id) {
                        customer = await base44.asServiceRole.entities.Customer.get(priorConv.customer_id);
                        if (customer) {
                            console.log('Reconnected provider LID to an existing customer via prior conversation.');
                        }
                    }
                }
            }
        }

        // Eco 'fromMe' em LID que NÃO casou com nenhum cliente existente: NÃO cria duplicado.
        // Essa mensagem (enviada pelo atendente via celular/web) já foi registrada na conversa
        // certa pelo zapi_sender. Criar um cliente/conversa novos só geraria o "Novo Cliente"
        // duplicado que estamos corrigindo. Apenas ignoramos o eco.
        if (!customer && phoneIsLid && payload.fromMe) {
            console.log("Ignored unmatched 'fromMe' LID echo already handled by sender.");
            return Response.json({ status: 'ignored_fromme_lid_echo' });
        }

        if (!customer) {
            // Avoid persisting a useless @lid string as the phone. If we couldn't recover a real
            // number, store an empty phones array so the record can be merged later when the real
            // number arrives, instead of becoming a permanent duplicate keyed by the @lid id.
            const phonesToStore = phoneIsLid ? [] : [phone];
            customer = await base44.asServiceRole.entities.Customer.create({
                full_name: senderName,
                phones: phonesToStore,
                opt_in_whatsapp: false,
                whatsapp_consent_status: 'unknown',
                last_inbound_at: new Date().toISOString(),
                status: 'active'
            });

        } else {
            // Update last interaction. If we got a real name now and the stored one is a placeholder,
            // update it so the chat list shows the actual contact name from WhatsApp.
            const currentName = (customer.full_name || '').trim();
            const isPlaceholder = !currentName ||
                currentName === 'Cliente' ||
                currentName === 'Novo Cliente' ||
                currentName.toLowerCase().includes('@lid') ||
                currentName.toLowerCase().includes('@s.whatsapp.net') ||
                /^\+?\d{8,}$/.test(currentName.replace(/\s/g, ''));
            const updatePayload = {
                last_inbound_at: new Date().toISOString()
            };
            if (isPlaceholder && !isInvalidName) {
                updatePayload.full_name = senderName;
            }
            // Consolidate: ensure the existing customer stores the CANONICAL phone, so all
            // future webhooks match the same key (no duplicates).
            if (!phoneIsLid && canonPhone) {
                const alreadyHas = (customer.phones || []).some(p => canonicalPhone(p) === canonPhone);
                if (!alreadyHas) {
                    updatePayload.phones = [...(customer.phones || []).filter(p => p && !p.includes('@')), canonPhone];
                }
            }
            await base44.asServiceRole.entities.Customer.update(customer.id, updatePayload);
        }

        await ensureCustomerSourceCard(
            base44,
            customer,
            customer.unit_id,
            payload.fromMe ? CUSTOMER_SOURCES.WHATSAPP_HUMAN : CUSTOMER_SOURCES.WHATSAPP_GLORIA
        );

        // 2. Find Conversation — SOMENTE conversas desta conexão principal.
        // Conversas da conexão Moinhos (source zapi_moinhos) são de OUTRO número e
        // ficam separadas: cada conexão Z-API tem seu próprio chat com o cliente.
        let conversation = await base44.asServiceRole.entities.Conversation.filter({
            customer_id: customer.id,
            channel: 'WHATSAPP'
        }).then(res => res
            .filter(c => (c.metadata || {}).source !== 'zapi_moinhos')
            .sort((a,b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())[0]);

        if (!conversation) {
            conversation = await base44.asServiceRole.entities.Conversation.create({
                customer_id: customer.id,
                channel: 'WHATSAPP',
                status: 'OPEN',
                zapi_instance_id: payload.instanceId,
                last_message_at: new Date().toISOString(),
                metadata: customer.unit_id ? {
                    unit_id: customer.unit_id,
                    unit_name: customer.preferred_unit_name,
                    awaiting_unit_selection: false,
                    unit_confirmed: true
                } : {
                    awaiting_unit_selection: true,
                    unit_confirmed: false
                }
            });
        } else if (conversation.status === 'CLOSED') {
            // Re-open existing conversation instead of creating a duplicate
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                status: 'OPEN',
                last_message_at: new Date().toISOString(),
                metadata: {
                    ...(conversation.metadata || {}),
                    unit_id: customer.unit_id || conversation.metadata?.unit_id,
                    unit_name: customer.preferred_unit_name || conversation.metadata?.unit_name,
                    awaiting_unit_selection: customer.unit_id ? false : (conversation.metadata?.awaiting_unit_selection ?? true),
                    unit_confirmed: customer.unit_id ? true : (conversation.metadata?.unit_confirmed ?? false)
                }
            });
            conversation.status = 'OPEN';
        }

        // 3. Determine Message Type and Content
        let type = 'TEXT';
        let text = '';
        let mediaUrl = null;
        
        // Log the explicit type for debugging
        const rawType = (payload.type || '').toUpperCase();
        console.log("Processing message type:", rawType, "Payload keys:", Object.keys(payload));

        const buttonReplyText = payload.buttonsResponseMessage?.message || payload.buttonsResponseMessage?.selectedDisplayText || null;
        const optionReplyText = payload.listResponseMessage?.title || payload.listResponseMessage?.singleSelectReply?.selectedRowTitle || payload.listResponseMessage?.singleSelectReply?.title || payload.selectedOption?.title || null;
        const optionReplyId = payload.listResponseMessage?.selectedRowId || payload.listResponseMessage?.rowId || payload.listResponseMessage?.singleSelectReply?.selectedRowId || payload.selectedOption?.id || null;

        // Prioritize detection by payload content first, as rawType can be generic (e.g. RECEIVEDCALLBACK)
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
        } else if (rawType === 'TEXT' || payload.text) {
             type = 'TEXT';
             text = payload.text?.message || payload.text || '';
        }

        console.log('Inbound message classified.', { type, has_media: Boolean(mediaUrl), has_text: Boolean(text) });

        const normalizedText = (text || '').trim().toLowerCase();
        const cleanText = normalizedText.replace(/[^a-z0-9]/g, '');
        const isEmojiOnly = /^[\p{Emoji}\s]+$/u.test(text || '') && cleanText.length === 0;
        const shouldIgnoreSoloMessage = type === 'TEXT' && [
            'ok',
            'okkk',
            'ta',
            'tabom',
            'beleza',
            'sair',
            'retorno',
            'retornar'
        ].includes(cleanText);
        const wantsOptOut = type === 'TEXT' && [
            'parar',
            'cancelar',
            'não receber mais mensagens',
            'nao receber mais mensagens',
            'sair da lista',
            'remover da lista',
            'opt_out_dispatch'
        ].includes(normalizedText);
        const consentDecision = type === 'TEXT' && hasActiveConsentRequest(customer)
            ? classifyConsentResponse(text)
            : null;

        // 4. Save Message
        // If there is media, we should ideally download it here.
        // For now we store the external URL, separate task will handle download to Base44 storage
        
        const message = await base44.asServiceRole.entities.Message.create({
            conversation_id: conversation.id,
            direction: payload.fromMe ? 'OUT' : 'IN', // Correct direction if sent from phone
            type: type,
            text: text,
            raw_payload: payload, // Store raw for debugging
            media_file_id: mediaUrl, // Set initial URL (external) so it shows up immediately
        });

        // Update conversation reference
        await base44.asServiceRole.entities.Conversation.update(conversation.id, {
            last_message_id: message.id,
            last_message_at: new Date().toISOString()
        });

        if (!payload.fromMe && consentDecision) {
            const accepted = consentDecision === 'accepted';
            const decidedAt = new Date().toISOString();
            const consentUpdate = {
                opt_in_whatsapp: accepted,
                whatsapp_consent_status: accepted ? 'accepted' : 'revoked',
                whatsapp_consent_response_text: text,
                whatsapp_consent_source: 'zapi_main',
                last_inbound_at: decidedAt,
                ...(accepted ? { opt_in_whatsapp_at: decidedAt } : { opt_out_whatsapp_at: decidedAt })
            };
            await base44.asServiceRole.entities.Customer.update(customer.id, consentUpdate);
            try {
                await base44.asServiceRole.functions.invoke('zapi_sender', {
                    phone,
                    message: accepted
                        ? 'Consentimento registrado. Você poderá receber promoções e novidades da 5àsec pelo WhatsApp. Para cancelar, responda SAIR.'
                        : 'Tudo certo. Seu consentimento não foi ativado e você não receberá campanhas promocionais.',
                    conversation_id: conversation.id,
                    _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                });
            } catch (err) {
                console.error('Failed to send consent confirmation:', err);
            }
            return Response.json({ status: accepted ? 'consent_accepted' : 'consent_declined', messageId: message.id });
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
                await base44.asServiceRole.functions.invoke('zapi_sender', {
                    phone,
                    message: 'Pronto! Você foi removido da nossa base de disparos e não receberá mais mensagens automáticas.',
                    conversation_id: conversation.id,
                    _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                });
            } catch (err) {
                console.error('Failed to send opt-out confirmation:', err);
            }

            return Response.json({ status: 'opt_out_success', messageId: message.id });
        }

        if (!payload.fromMe && type === 'TEXT' && (shouldIgnoreSoloMessage || isEmojiOnly)) {
            console.log('Skipping orchestrator for ignored standalone control text.');
            return Response.json({ status: 'ignored_solo_text', messageId: message.id });
        }

        // Reactions appear in the chat but never trigger the AI orchestrator.
        if (!payload.fromMe && isReaction) {
            console.log(`Skipping orchestrator for emoji reaction: ${reactionEmoji}`);
            return Response.json({ status: 'reaction_saved_no_ai', messageId: message.id });
        }

        // 4.5 Media Downloader — fire-and-forget (NÃO bloqueia a resposta do webhook).
        // A mensagem já foi salva com a URL externa da mídia (media_file_id), então ela
        // aparece no chat IMEDIATAMENTE. O download para o storage do Base44 acontece em
        // background e atualiza o registro depois. Aguardar aqui era a principal causa da
        // demora de vários minutos (a Z-API re-enfileirava o webhook se não recebesse 200 rápido).
        if (mediaUrl) {
            runInBackground(
                base44.asServiceRole.functions.invoke('zapi_media_downloader', {
                    message_id: message.id,
                    media_url: mediaUrl,
                    media_type: type,
                    _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
                }).catch((err) => {
                    console.error("Media download failed (background):", err);
                })
            );
        }
        const downloadedFileUrl = null;

        // Respostas a disparos/broadcasts devem continuar no atendimento da IA.
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

        if (conversation.handoff_required) {
            console.log(`Conversation ${conversation.id} in human handoff — skipping debounce/orchestrator for instant display.`);
            return Response.json({ status: 'success', messageId: message.id, note: 'handoff_no_debounce' });
        }

        // Mesmo sem a flag ligada: se um atendente já respondeu nesta conversa há pouco
        // (pelo painel ou pelo celular/WhatsApp Web da loja), o atendimento é humano.
        if (await hasRecentHumanReply(base44, conversation.id)) {
            console.log(`Conversation ${conversation.id} has a recent human reply — AI skipped.`);
            return Response.json({ status: 'success', messageId: message.id, note: 'recent_human_reply_ai_skipped' });
        }

        // 6. Dispara a IA de forma DESACOPLADA (resposta em segundos).
        // Antes o orchestrator era aguardado aqui dentro: o runtime do webhook era
        // encerrado antes da IA concluir e quem respondia era a rede de segurança de
        // 5 minutos (demora de ~4 min por interação). Agora apenas marcamos a
        // mensagem como pendente de IA e devolvemos 200 na hora — a automação
        // 'aiReplyTrigger' assume o debounce e chama a Glória em seu próprio ciclo.
        if (!payload.fromMe && (type === 'IMAGE' || type === 'TEXT' || type === 'AUDIO' || type === 'DOC')) {
            await base44.asServiceRole.entities.Message.update(message.id, { ai_pending: true });
            return Response.json({ status: "success", messageId: message.id, note: "ai_queued" });
        }

        // Para outros tipos (ex: fromMe), dispara orchestrator direto em background.
        runInBackground(
            base44.asServiceRole.functions.invoke('orchestrator', {
                conversation_id: conversation.id,
                message_id: message.id,
                customer_id: customer.id,
                payload: payload,
                downloaded_file_url: downloadedFileUrl,
                _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
            }).catch((orchError) => {
                console.error("Orchestrator failed (background):", orchError);
            })
        );

        return Response.json({ status: "success", messageId: message.id });

    } catch (error) {
        console.error("Error in zapi_webhook_receiver:", error?.code || error?.message || error);
        return securityErrorResponse(error);
    }
});