// ============================================================================
// guardTelemetry — TELEMETRIA DOS GUARDAS ANTI-ALUCINAÇÃO
//
// Por quê: os guardas (anti-alucinação de agendamento/disponibilidade,
// hallucinationGuard, enforceDeliveryFeeNotice, enforceVariableQuoteSafety)
// só faziam console.warn — ninguém media a frequência real dos erros da IA.
// Sem medir, cada erro novo virava um parágrafo novo no prompt (o ciclo de
// remendo que inchou o prompt). Agora cada disparo vira um StaffNotification
// do tipo SYSTEM_ERROR com payload estruturado, visível no painel, sem mudar
// em nada o comportamento do chat.
//
// Uso: await logGuardEvent(base44, { guard: 'hallucinationGuard', ... })
// ============================================================================

// Classifica a correção do hallucinationGuard: 'factual' (mudou algum FATO —
// valor, número, data, dia da semana, horário) ou 'cosmetic' (só reescrita de
// texto, sem mudar nenhum fato). Sem isso, toda reescrita entrava no painel
// como se fosse erro de conteúdo e inflava o ranking.
const FACT_WORDS = /(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|hoje|amanh[ãa]|manh[ãa]|tarde|gr[áa]tis|incluso|inclu[íi]d|dia[s]? [úu]teis)/gi;

export const classifyCorrection = (draft = '', safe = '') => {
  const facts = (text) => {
    const numbers = (String(text).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.'));
    const words = (String(text).match(FACT_WORDS) || []).map((w) => w.toLowerCase());
    return [...numbers, ...words].sort().join('|');
  };
  return facts(draft) === facts(safe) ? 'cosmetic' : 'factual';
};

// Fire-and-forget com proteção total: telemetria NUNCA pode derrubar o atendimento.
export const logGuardEvent = async (base44, { guard, conversation_id = null, customer_name = null, detail = '', excerpt = '' } = {}) => {
  try {
    if (!guard) return;
    await base44.asServiceRole.entities.StaffNotification.create({
      type: 'SYSTEM_ERROR',
      target_team: 'ai_quality',
      payload: {
        guard,
        conversation_id,
        customer_name,
        detail: String(detail || '').slice(0, 500),
        excerpt: String(excerpt || '').slice(0, 500)
      },
      sent_at: new Date().toISOString()
    });
  } catch (error) {
    console.warn(`guardTelemetry: falha ao registrar evento '${guard}':`, error?.message);
  }
};