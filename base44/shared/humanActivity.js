// Detecta atendimento humano ATIVO em uma conversa, independente da flag handoff_required.
//
// Por quê: a flag pode não estar ligada (atendente respondeu pelo celular/WhatsApp Web,
// ou a flag foi limpa por algum fluxo). Nesses casos a Glória voltava a responder por cima
// do atendente. Aqui olhamos os FATOS: existe mensagem de saída enviada por um humano
// (pelo painel, com sent_by, ou pelo próprio WhatsApp da loja, com fromMe) há pouco tempo?

const HUMAN_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 horas

export function isHumanSentMessage(msg) {
    if (!msg || msg.direction !== 'OUT') return false;
    if (msg.sent_by) return true; // enviada por atendente no painel
    return msg.raw_payload?.fromMe === true; // enviada pelo celular/WhatsApp Web da loja
}

export async function hasRecentHumanReply(base44, conversationId, windowMs = HUMAN_WINDOW_MS) {
    const [msgs, conversation] = await Promise.all([
        base44.asServiceRole.entities.Message.filter(
            { conversation_id: conversationId, direction: 'OUT' },
            '-created_date',
            10
        ),
        base44.asServiceRole.entities.Conversation.get(conversationId).catch(() => null)
    ]);

    // Se o atendente devolveu a conversa para a IA ("Voltar p/ IA"), as mensagens
    // humanas ANTERIORES a esse momento não podem mais silenciar a Glória.
    const resumedRaw = (conversation?.metadata || {}).ai_resumed_at;
    const resumedAt = resumedRaw ? new Date(resumedRaw).getTime() : null;

    const now = Date.now();
    return (msgs || []).some((m) => {
        if (!isHumanSentMessage(m)) return false;
        const raw = m.created_date;
        const iso = typeof raw === 'string' && !raw.endsWith('Z') ? `${raw}Z` : raw;
        const t = new Date(iso).getTime();
        if (!Number.isFinite(t)) return false;
        if (resumedAt && t <= resumedAt) return false;
        return now - t <= windowMs;
    });
}