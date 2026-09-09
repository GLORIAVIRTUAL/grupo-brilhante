import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { requireInternalRequest, securityErrorResponse } from '../../shared/functionSecurity.js';
import { findNextEncaixeSlot, formatEncaixeDate } from '../../shared/encaixeScheduler.js';

// ============================================================================
// INTERCEPTOR DE ENCAIXE (determinístico, sem IA)
//
// Roda ANTES do orchestrator. Quando o pagamento antecipado via Pix está
// confirmado (metadata.payment_confirmed=true) e o cliente pede coleta,
// cria a coleta direto no próximo turno disponível — sem esperar a IA.
//
// Retorna { handled: true } quando assumiu o atendimento (o orchestrator
// deve ser pulado), ou { handled: false } caso contrário.
// ============================================================================
export default async function(req) {
    const requestId = crypto.randomUUID();
    try {
        if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        requireInternalRequest(req, body);

        const { conversation_id, message_id, payload } = body;
        if (!conversation_id || !message_id) {
            return Response.json({ handled: false, reason: 'missing_ids', request_id: requestId });
        }

        const conversation = await base44.asServiceRole.entities.Conversation.get(conversation_id).catch(() => null);
        if (!conversation) return Response.json({ handled: false, reason: 'no_conversation', request_id: requestId });

        const message = await base44.asServiceRole.entities.Message.get(message_id).catch(() => null);
        if (!message) return Response.json({ handled: false, reason: 'no_message', request_id: requestId });

        const currentState = conversation.metadata || {};

        // Condição do encaixe: pagamento confirmado + texto menciona coleta/agendar
        const text = message.text || '';
        const wantsPickup = /\b(coleta|agendar|pegar|buscar|retirar)\b/i.test(text);

        if (!currentState.payment_confirmed || !wantsPickup) {
            return Response.json({ handled: false, reason: 'conditions_not_met', request_id: requestId });
        }

        // Determina o sender correto (zapi_sender vs zapi_moinhos_sender vs whatsapp_moinhos_sender)
        const source = message.ai_source || (conversation.metadata || {}).source || (payload && payload.source) || null;
        const isMoinhos = ['zapi_moinhos', 'whatsapp_moinhos'].includes(source);
        const senderFn = source === 'whatsapp_moinhos'
            ? 'whatsapp_moinhos_sender'
            : isMoinhos ? 'zapi_moinhos_sender' : 'zapi_sender';

        const invokeSender = (p) => base44.asServiceRole.functions.invoke(senderFn, {
            ...p,
            _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')
        });

        const customer = await base44.asServiceRole.entities.Customer.get(conversation.customer_id).catch(() => null);
        if (!customer) return Response.json({ handled: false, reason: 'no_customer', request_id: requestId });

        const hasSavedAddress = customer.address && customer.address_number;

        if (!hasSavedAddress) {
            await invokeSender({
                phone: customer.phones && customer.phones[0],
                message: `Recebi a confirmação do seu pagamento! ✅ Como você já pagou antecipado, sua coleta entrará como encaixe no próximo turno disponível. 🚚\n\nPara agendar, preciso do seu endereço completo: rua, número, complemento e bairro. 😊`,
                conversation_id: conversation.id
            });
            // Limpa o flow para a IA não reprocessar
            currentState.payment_confirmed = false;
            currentState.flow = null;
            await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState } });
            return Response.json({ handled: true, action: 'encaixe_needs_address', request_id: requestId });
        }

        const encaixe = await findNextEncaixeSlot(base44);
        if (!encaixe) {
            await invokeSender({
                phone: customer.phones && customer.phones[0],
                message: `Recebi a confirmação do seu pagamento! ✅ No momento não há turnos disponíveis para encaixe nos próximos dias. Vou verificar a agenda e te retornar com uma data específica. 😊`,
                conversation_id: conversation.id
            });
            currentState.payment_confirmed = false;
            currentState.flow = null;
            await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState } });
            return Response.json({ handled: true, action: 'encaixe_no_slots', request_id: requestId });
        }

        // Cancela coletas antigas agendadas
        const oldPickups = await base44.asServiceRole.entities.Pickup.filter({
            customer_id: customer.id,
            status: 'scheduled'
        });
        for (const op of oldPickups) {
            await base44.asServiceRole.entities.Pickup.update(op.id, { status: 'cancelled' });
        }

        const fullAddress = `${customer.address}, ${customer.address_number}${customer.address_complement ? `, ${customer.address_complement}` : ''}${customer.neighborhood ? ` — ${customer.neighborhood}` : ''}`;

        await base44.asServiceRole.entities.Pickup.create({
            customer_id: customer.id,
            unit_id: currentState.unit_id || '6a99e42ee48200f5d8ddd176',
            scheduled_at: encaixe.slotIso,
            address: fullAddress,
            neighborhood: customer.neighborhood,
            status: 'scheduled',
            fee: 0,
            notes: 'ENCAIXE — pagamento antecipado via Pix confirmado',
            source: 'ai',
            created_by_name: 'Glória (IA)',
            metadata: { encaixe: true, payment_confirmed: true }
        });

        // Limpa o estado para a IA não reprocessar
        currentState.payment_confirmed = false;
        currentState.flow = null;
        currentState.pending_pickup = null;
        await base44.asServiceRole.entities.Conversation.update(conversation.id, { metadata: { ...currentState } });

        const shiftLabel = encaixe.period === 'morning' ? 'manhã' : 'tarde';
        await invokeSender({
            phone: customer.phones && customer.phones[0],
            message: `Recebi a confirmação do seu pagamento! ✅ Como você já pagou antecipado, sua coleta entrará como encaixe no próximo turno disponível: ${formatEncaixeDate(encaixe.date)}, turno da ${shiftLabel}. 🚚\n\nEndereço: ${fullAddress}\n\nAguarde nosso motorista! 😊`,
            conversation_id: conversation.id
        });

        return Response.json({ handled: true, action: 'encaixe_scheduled', date: encaixe.date, period: encaixe.period, request_id: requestId });
    } catch (error) {
        console.error('encaixeInterceptor error:', error?.message, error?.stack);
        return securityErrorResponse(error, requestId);
    }
}