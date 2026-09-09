import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { authorizeUserOrInternal, securityErrorResponse, SecurityError } from '../../shared/functionSecurity.js';

Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
        const base44 = createClientFromRequest(req);
        
        // 1. Parse body ONCE
        const body = await req.json();
        const principal = await authorizeUserOrInternal(base44, req, body, {
            roles: ['super_admin', 'admin', 'manager', 'attendant', 'cashier', 'finance'],
            source: 'zapi_sender',
        });
        const { phone, message, type = 'TEXT', mediaUrl, conversation_id, customer_id, unit_id, buttons = [], optionList = null, sent_by = null } = body;

        // SEGURANÇA: nunca enviar para um ID de grupo de WhatsApp.
        // Grupos têm formato "...@g.us", terminam em "-group" ou contêm "-" no id.
        // Enviar para um grupo entrega a mensagem para todos os participantes do grupo,
        // não para o chat privado do cliente. Bloqueamos para evitar vazamentos.
        const isGroupTarget = typeof phone === 'string' &&
            (phone.includes('@g.us') || phone.includes('-group'));
        if (isGroupTarget) {
            console.warn('Blocked outbound WhatsApp group target.');
            return Response.json({ error: 'Envio bloqueado: este contato é um grupo de WhatsApp, não um número individual.' }, { status: 400 });
        }

        const normalizedPhone = String(phone || '').replace(/\D/g, '');
        if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
            throw new SecurityError('Número de WhatsApp inválido.', 400, 'INVALID_PHONE');
        }
        if (!['TEXT', 'IMAGE', 'AUDIO', 'DOC', 'BUTTONS', 'OPTION_LIST'].includes(type)) {
            throw new SecurityError('Tipo de mensagem inválido.', 400, 'INVALID_MESSAGE_TYPE');
        }
        if (String(message || '').length > 4096) {
            throw new SecurityError('Mensagem excede o limite permitido.', 400, 'MESSAGE_TOO_LONG');
        }
        if (['IMAGE', 'AUDIO', 'DOC'].includes(type) && !/^https:\/\//i.test(String(mediaUrl || ''))) {
            throw new SecurityError('Mídia deve usar uma URL HTTPS válida.', 400, 'INVALID_MEDIA_URL');
        }
        if (type === 'BUTTONS' && (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3 || buttons.some((button) => !String(button?.label || '').trim() || String(button.label).length > 80))) {
            throw new SecurityError('Lista de botões inválida.', 400, 'INVALID_BUTTONS');
        }
        if (type === 'OPTION_LIST' && (!Array.isArray(optionList?.options) || optionList.options.length < 1 || optionList.options.length > 10)) {
            throw new SecurityError('Lista de opções inválida.', 400, 'INVALID_OPTION_LIST');
        }

        let finalConversationId = conversation_id || null;
        let targetCustomer = customer_id ? await base44.asServiceRole.entities.Customer.get(customer_id) : null;
        if (finalConversationId) {
            const conversation = await base44.asServiceRole.entities.Conversation.get(finalConversationId);
            if (!conversation) throw new SecurityError('Conversa não encontrada.', 404, 'CONVERSATION_NOT_FOUND');
            if (targetCustomer && conversation.customer_id !== targetCustomer.id) throw new SecurityError('Cliente não corresponde à conversa.', 409, 'CUSTOMER_CONTEXT_MISMATCH');
            targetCustomer = targetCustomer || await base44.asServiceRole.entities.Customer.get(conversation.customer_id);
        }
        if (!targetCustomer && principal.kind === 'internal' && phone) {
            const customers = await base44.asServiceRole.entities.Customer.filter({ phones: phone });
            targetCustomer = customers.find((customer) => !unit_id || customer.unit_id === unit_id) || null;
        }
        const targetUnitId = targetCustomer?.unit_id || unit_id || null;
        if (targetCustomer && unit_id && targetCustomer.unit_id && targetCustomer.unit_id !== unit_id) throw new SecurityError('Unidade não corresponde ao cliente.', 409, 'UNIT_CONTEXT_MISMATCH');
        if (targetCustomer) {
            const customerPhones = (targetCustomer.phones || []).map((value) => String(value || '').replace(/\D/g, ''));
            if (!customerPhones.includes(normalizedPhone)) throw new SecurityError('Telefone não pertence ao cliente informado.', 409, 'PHONE_CONTEXT_MISMATCH');
        }
        if (principal.kind === 'user') {
            if (!targetCustomer || !targetUnitId) throw new SecurityError('Cliente e unidade são obrigatórios para envio manual.', 422, 'CUSTOMER_CONTEXT_REQUIRED');
            if (principal.role !== 'super_admin' && !principal.permissions.includes('*') && !principal.unitIds.includes(targetUnitId)) {
                throw new SecurityError('Unidade fora do seu escopo.', 403, 'UNIT_SCOPE_DENIED');
            }
        }

        const INSTANCE_ID = Deno.env.get("ZAPI_INSTANCE_ID");
        const TOKEN = Deno.env.get("ZAPI_TOKEN");
        const CLIENT_TOKEN = Deno.env.get("ZAPI_SECURITY_TOKEN");

        if (!INSTANCE_ID || !TOKEN || !CLIENT_TOKEN) {
            throw new SecurityError('Integração Z-API não configurada.', 503, 'ZAPI_NOT_CONFIGURED');
        }

        // Delay humano aleatório entre 3 e 8 segundos antes de enviar (anti-spam Meta)
        const humanDelayMs = 3000 + Math.floor(Math.random() * 5000);
        await new Promise((resolve) => setTimeout(resolve, humanDelayMs));

        // 2. Determine Z-API Endpoint
        let zapiUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/send-text`;
        let payload = { phone: normalizedPhone, message, delayTyping: 4 };

        if (type === 'IMAGE') {
            zapiUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/send-image`;
            payload = { phone: normalizedPhone, image: mediaUrl, caption: message, delayTyping: 4 };
        } else if (type === 'AUDIO') {
            zapiUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/send-audio`;
            payload = { phone: normalizedPhone, audio: mediaUrl };
        } else if (type === 'DOC') {
             zapiUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/send-document`;
             payload = { phone: normalizedPhone, document: mediaUrl, caption: message, delayTyping: 3 };
        } else if (type === 'BUTTONS') {
            zapiUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/send-button-list`;
            payload = {
                phone: normalizedPhone,
                message,
                buttonList: {
                    buttons: buttons.map((button, index) => ({
                        id: button.id || String(index + 1),
                        label: button.label
                    }))
                },
                delayMessage: 2
            };
        } else if (type === 'OPTION_LIST') {
            zapiUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/send-option-list`;
            payload = {
                phone: normalizedPhone,
                message,
                optionList,
                delayMessage: 2
            };
        }

        // 3. Enviar à Z-API sem registrar URL com token nem conteúdo/telefone do cliente.
        let zapiResponseData = null;
        {
            console.log('Sending via Z-API', { type, has_conversation: Boolean(finalConversationId), unit_id: targetUnitId });

            const sendRequest = async (url, requestPayload) => {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'client-token': CLIENT_TOKEN
                    },
                    body: JSON.stringify(requestPayload),
                    signal: AbortSignal.timeout(15000)
                });

                if (!response.ok) {
                    throw new Error(`Z-API request failed (${response.status})`);
                }

                return await response.json();
            };

            try {
                zapiResponseData = await sendRequest(zapiUrl, payload);
            } catch (error) {
                const isInteractive = type === 'BUTTONS' || type === 'OPTION_LIST';
                if (!isInteractive) {
                    console.error('Z-API Error:', error.message);
                    throw error;
                }

                console.warn('Interactive message failed, retrying as plain text:', error.message);
                const fallbackMessage = type === 'BUTTONS'
                    ? `${message}\n\n${buttons.map((button) => `- ${button.label}`).join('\n')}`
                    : `${message}\n\n${optionList?.options?.map((option) => `- ${option.title}`).join('\n') || ''}`;

                zapiUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/send-text`;
                payload = { phone: normalizedPhone, message: fallbackMessage.trim(), delayTyping: 4 };
                zapiResponseData = await sendRequest(zapiUrl, payload);
            }
        }

        // 4. Vincular o log à conversa principal do cliente, quando houver.
        if (!finalConversationId && targetCustomer) {
            const conversations = await base44.asServiceRole.entities.Conversation.filter({
                customer_id: targetCustomer.id,
                channel: 'WHATSAPP'
            });
            const mainConv = conversations.find(c => (c.metadata || {}).source !== 'zapi_moinhos');
            if (mainConv) finalConversationId = mainConv.id;
        }

        let newMessage = null;

        if (finalConversationId) {
             const loggedType = ['BUTTONS', 'OPTION_LIST'].includes(type) ? 'TEXT' : type;
             newMessage = await base44.asServiceRole.entities.Message.create({
                conversation_id: finalConversationId,
                direction: 'OUT',
                type: loggedType,
                text: message || (type === 'IMAGE' ? 'Imagem enviada' : 'Áudio enviado'),
                media_file_id: mediaUrl,
                sent_by: sent_by || null,
                raw_payload: zapiResponseData
             });
            
            await base44.asServiceRole.entities.Conversation.update(finalConversationId, {
                last_message_at: new Date().toISOString(),
                last_message_id: newMessage.id
            });
        }
        
        return Response.json({ ...zapiResponseData, id: newMessage?.id || null });

    } catch (error) {
        console.error("Error in zapi_sender:", error?.code || error?.message || error);
        return securityErrorResponse(error);
    }
});