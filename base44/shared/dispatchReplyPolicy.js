// Um handoff só bloqueia a Glória quando tem origem CLARA:
// - fluxo de handoff da própria IA (HANDOFF, HANDOFF_COMPLAINT, HANDOFF_URGENCY, ...)
// - marcação explícita do atendente humano (metadata.handoff_source === 'human')
// Qualquer outro bloqueio (disparo de campanha, resíduo antigo sem origem) é considerado
// automático e é liberado assim que o cliente responde.
export const isDispatchGeneratedHandoff = (metadata = {}) => {
    const flow = String(metadata.flow || '');
    if (flow === 'HANDOFF_DISPATCH' || flow === 'HANDOFF_CAMPAIGN') return true;
    if (metadata.handoff_source === 'human') return false;
    return !flow.startsWith('HANDOFF');
};

export const clearDispatchGeneratedHandoff = (metadata = {}) => ({
    ...metadata,
    flow: null,
    handoff_reason: null,
    handoff_source: null
});