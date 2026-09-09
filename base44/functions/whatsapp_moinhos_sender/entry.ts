import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { authorizeUserOrInternal, securityErrorResponse, SecurityError } from '../../shared/functionSecurity.js';

// Envia mensagens pelo número exclusivo da unidade Moinhos via WhatsApp Cloud API (Meta).
Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
        const base44 = createClientFromRequest(req);

        const body = await req.json();
        const principal = await authorizeUserOrInternal(base44, req, body, {
            roles: ['super_admin', 'admin', 'manager', 'attendant', 'cashier', 'finance'],
            source: 'whatsapp_moinhos_sender',
        });
        const { phone, message, type = 'TEXT', mediaUrl, conversation_id, customer_id, unit_id } = body;

        const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_MOINHOS_PHONE_NUMBER_ID");
        const ACCESS_TOKEN = Deno.env.get("WHATSAPP_MOINHOS_ACCESS_TOKEN");

        if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
            throw new SecurityError('Integração WhatsApp Moinhos não configurada.', 503, 'WHATSAPP_MOINHOS_NOT_CONFIGURED');
        }

        const toPhone = String(phone || '').replace(/\D/g, '');
        if (String(phone || '').includes('@g.us') || String(phone || '').includes('-group')) throw new SecurityError('Envio para grupo bloqueado.', 400, 'GROUP_TARGET_BLOCKED');
        if (toPhone.length < 10 || toPhone.length > 15) throw new SecurityError('Número de WhatsApp inválido.', 400, 'INVALID_PHONE');
        if (!['TEXT', 'IMAGE', 'AUDIO', 'DOC'].includes(type)) throw new SecurityError('Tipo de mensagem inválido.', 400, 'INVALID_MESSAGE_TYPE');
        if (String(message || '').length > 4096) throw new SecurityError('Mensagem excede o limite permitido.', 400, 'MESSAGE_TOO_LONG');
        if (['IMAGE', 'AUDIO', 'DOC'].includes(type) && !/^https:\/\//i.test(String(mediaUrl || ''))) throw new SecurityError('Mídia deve usar uma URL HTTPS válida.', 400, 'INVALID_MEDIA_URL');

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
            if (!customerPhones.includes(toPhone)) throw new SecurityError('Telefone não pertence ao cliente informado.', 409, 'PHONE_CONTEXT_MISMATCH');
        }
        if (principal.kind === 'user') {
            if (!targetCustomer || !targetUnitId) throw new SecurityError('Cliente e unidade são obrigatórios para envio manual.', 422, 'CUSTOMER_CONTEXT_REQUIRED');
            if (principal.role !== 'super_admin' && !principal.permissions.includes('*') && !principal.unitIds.includes(targetUnitId)) throw new SecurityError('Unidade fora do seu escopo.', 403, 'UNIT_SCOPE_DENIED');
        }

        // Delay humano aleatório entre 3 e 8 segundos (anti-spam)
        const humanDelayMs = 3000 + Math.floor(Math.random() * 5000);
        await new Promise((resolve) => setTimeout(resolve, humanDelayMs));

        const graphUrl = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

        // Monta o payload conforme o tipo
        let graphPayload = {
            messaging_product: "whatsapp",
            to: toPhone,
            type: "text",
            text: { body: message || '' }
        };

        if (type === 'IMAGE') {
            graphPayload = {
                messaging_product: "whatsapp",
                to: toPhone,
                type: "image",
                image: { link: mediaUrl, caption: message || '' }
            };
        } else if (type === 'AUDIO') {
            graphPayload = {
                messaging_product: "whatsapp",
                to: toPhone,
                type: "audio",
                audio: { link: mediaUrl }
            };
        } else if (type === 'DOC') {
            graphPayload = {
                messaging_product: "whatsapp",
                to: toPhone,
                type: "document",
                document: { link: mediaUrl, caption: message || '' }
            };
        }

        const response = await fetch(graphUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ACCESS_TOKEN}`
            },
            body: JSON.stringify(graphPayload),
            signal: AbortSignal.timeout(15000)
        });

        const responseData = await response.json();

        if (!response.ok) {
            console.error('WhatsApp Cloud API request failed', { status: response.status, type, unit_id: targetUnitId });
            throw new Error(`Cloud API request failed (${response.status})`);
        }

        const waMessageId = responseData.messages?.[0]?.id || null;

        // Registra a mensagem na conversa do cliente, quando houver.
        if (!finalConversationId && targetCustomer) {
            const conversations = await base44.asServiceRole.entities.Conversation.filter({
                customer_id: targetCustomer.id,
                channel: 'WHATSAPP'
            });
            if (conversations.length > 0) finalConversationId = conversations[0].id;
        }

        let newMessage = null;
        if (finalConversationId) {
            newMessage = await base44.asServiceRole.entities.Message.create({
                conversation_id: finalConversationId,
                direction: 'OUT',
                type: type,
                text: message || (type === 'IMAGE' ? 'Imagem enviada' : type === 'AUDIO' ? 'Áudio enviado' : ''),
                media_file_id: mediaUrl,
                raw_payload: { ...responseData, wa_message_id: waMessageId, source: 'whatsapp_moinhos' }
            });

            await base44.asServiceRole.entities.Conversation.update(finalConversationId, {
                last_message_at: new Date().toISOString(),
                last_message_id: newMessage.id
            });
        }

        return Response.json({ ...responseData, id: newMessage?.id || null });

    } catch (error) {
        console.error("Erro no whatsapp_moinhos_sender:", error?.code || error?.message || error);
        return securityErrorResponse(error);
    }
});