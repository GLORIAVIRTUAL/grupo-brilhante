import { findNextEncaixeSlot, formatEncaixeDate } from './encaixeScheduler.js';

// Avisa o cliente no WhatsApp assim que o pagamento é confirmado pelo Asaas.
// Se o endereço já estiver salvo, cria a coleta como encaixe no próximo turno.
// Chamado direto pelo webhook do banco (não espera nova mensagem do cliente).
export async function notifyPaymentConfirmed(base44, customerId) {
  const db = base44.asServiceRole.entities;

  const conversations = await db.Conversation.filter({ customer_id: customerId, channel: 'WHATSAPP' }).catch(() => []);
  const conversation = (conversations || [])
    .filter((c) => c.status !== 'CLOSED')
    .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))[0];
  if (!conversation) return { notified: false, reason: 'no_conversation' };

  const customer = await db.Customer.get(customerId).catch(() => null);
  const phone = customer?.phones?.[0];
  if (!phone) return { notified: false, reason: 'no_phone' };

  const state = conversation.metadata || {};
  const source = state.source || null;
  const senderFn = source === 'whatsapp_moinhos'
    ? 'whatsapp_moinhos_sender'
    : source === 'zapi_moinhos' ? 'zapi_moinhos_sender' : 'zapi_sender';

  const send = (message) => base44.asServiceRole.functions.invoke(senderFn, {
    phone,
    message,
    conversation_id: conversation.id,
    _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN'),
  }).catch(() => null);

  const hasAddress = customer.address && customer.address_number;
  const encaixe = hasAddress ? await findNextEncaixeSlot(base44).catch(() => null) : null;

  if (!hasAddress) {
    await send('Recebi a confirmação do seu pagamento! ✅ Como você pagou antecipado, sua coleta entra como encaixe no próximo turno disponível. 🚚\n\nPara agendar, me envie seu endereço completo: rua, número, complemento e bairro. 😊');
    await db.Conversation.update(conversation.id, {
      metadata: { ...state, payment_confirmed: true, flow: null },
    }).catch(() => null);
    return { notified: true, action: 'needs_address' };
  }

  if (!encaixe) {
    await send('Recebi a confirmação do seu pagamento! ✅ Vou verificar o próximo turno disponível para a coleta e te retorno com a data. 😊');
    await db.Conversation.update(conversation.id, {
      metadata: { ...state, payment_confirmed: true, flow: null },
    }).catch(() => null);
    return { notified: true, action: 'no_slots' };
  }

  const fullAddress = `${customer.address}, ${customer.address_number}${customer.address_complement ? `, ${customer.address_complement}` : ''}${customer.neighborhood ? ` — ${customer.neighborhood}` : ''}`;

  await db.Pickup.create({
    customer_id: customer.id,
    unit_id: state.unit_id,
    scheduled_at: encaixe.slotIso,
    address: fullAddress,
    neighborhood: customer.neighborhood,
    status: 'scheduled',
    service_kind: 'dirty',
    fee: 0,
    notes: 'ENCAIXE — pagamento antecipado via Pix confirmado',
    source: 'ai',
    created_by_name: 'Glória (IA)',
    metadata: { encaixe: true, payment_confirmed: true },
  });

  await db.Conversation.update(conversation.id, {
    metadata: { ...state, payment_confirmed: false, flow: null, pending_pickup: null },
  }).catch(() => null);

  const shiftLabel = encaixe.period === 'morning' ? 'manhã' : 'tarde';
  await send(`Pagamento confirmado! ✅ Sua coleta entrou como encaixe em ${formatEncaixeDate(encaixe.date)}, turno da ${shiftLabel}. 🚚\n\nEndereço: ${fullAddress}\n\nAguarde nosso motorista! 😊`);

  return { notified: true, action: 'encaixe_scheduled', date: encaixe.date, period: encaixe.period };
}