// ============================================================================
// availabilityClaim — detecta quando a resposta da Glória FALA de disponibilidade
// de coleta (negando OU oferecendo data/turno) sem que o sistema tenha sido
// consultado nesta rodada.
//
// Antes só a NEGAÇÃO ("estamos lotados") era barrada. A telemetria mostrou que o
// erro mais frequente é o oposto: a IA OFERECE data e turno por conta própria
// ("temos hoje 8h às 12h ou 13h às 16h", "amanhã (31/08)") sem checar as vagas.
// Agora os dois casos forçam a checagem real antes de responder.
// ============================================================================

const norm = (text = '') => String(text)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const PICKUP_TOPIC = /(coleta|coletar|buscar|retirar|retirada|vaga|disponib)/;

const DENIAL = /(nao temos|nao ha|nao tem mais|lotad|sem vaga|sem disponib|esgotad|outra data)/;

// Oferta de janela: turno ("manhã"/"tarde"), faixa de horário ("9h às 12h"),
// dia da semana ou data (31/08, hoje, amanhã).
const OFFER_WINDOW = /(manha|tarde|\d{1,2}\s?h\s?(as|a|-)\s?\d{1,2}\s?h|\d{1,2}\/\d{1,2}|hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado)/;
const OFFER_VERB = /(temos|tem |disponibilidade|disponivel|posso agendar|podemos|consigo|encaixar|prefere|qual voce prefere|agendar para)/;

// Retorna null (nada a fazer) ou { kind: 'denial' | 'offer' }.
export function detectUncheckedAvailabilityClaim(draftResponse = '') {
  const value = norm(draftResponse);
  if (!PICKUP_TOPIC.test(value)) return null;
  if (DENIAL.test(value)) return { kind: 'denial' };
  if (OFFER_VERB.test(value) && OFFER_WINDOW.test(value)) return { kind: 'offer' };
  return null;
}

export const UNCHECKED_CLAIM_INSTRUCTION = {
  denial: "ERRO CRÍTICO: você afirmou que NÃO há vagas/disponibilidade de coleta, mas NÃO chamou a ferramenta 'check_pickup_availability'. Você é TERMINANTEMENTE PROIBIDA de dizer que está lotado ou sem vaga sem consultar o sistema. Chame 'check_pickup_availability' AGORA para a data que o cliente pediu (use a data de HOJE se ele disse 'hoje') e só responda com base no resultado REAL. Se houver vaga, ofereça o turno disponível proativamente.",
  offer: "ERRO CRÍTICO: você OFERECEU/SUGERIU uma data ou um turno de coleta ao cliente sem chamar a ferramenta 'check_pickup_availability'. Você é TERMINANTEMENTE PROIBIDA de citar data, turno ou faixa de horário de coleta que não tenha vindo do resultado real do sistema. Chame 'check_pickup_availability' AGORA para a data em questão (use HOJE se o cliente disse 'hoje') e ofereça SOMENTE os turnos que o sistema devolver como disponíveis."
};