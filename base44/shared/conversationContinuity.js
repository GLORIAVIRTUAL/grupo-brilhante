const normalize = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

export const isExplicitNewQuoteIntent = (text = '') => {
  const value = normalize(text);
  const mentionsQuote = value.includes('orcamento');
  const asksNew = value.includes('novo') || value.includes('outro') || value.includes('mais um') || value.includes('de novo');
  return mentionsQuote && asksNew;
};

const looksLikeAddress = (text = '') => {
  const value = normalize(text);
  return /\d/.test(value) && /\b(rua|avenida|av\.?|travessa|alameda|estrada|rodovia|praca)\b/.test(value);
};

export const buildConversationContinuityFacts = (messages = [], state = {}) => {
  const inbound = messages
    .filter((message) => message.direction === 'IN' && message.text)
    .sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime());
  const inboundTexts = inbound.map((message) => message.text.trim()).filter(Boolean);
  const normalizedTexts = inboundTexts.map(normalize);
  const facts = [];

  if (normalizedTexts.some((text) => text.includes('nao tenho foto') || text.includes('sem foto'))) {
    facts.push('O cliente informou que não possui fotos; aceite a lista escrita e não peça fotos novamente.');
  }

  const paymentAtPickup = [...normalizedTexts].reverse().find((text) =>
    text.includes('pagar na hora') || text.includes('pagamento na coleta') || text.includes('dinheiro') || text.includes('cartao')
  );
  if (paymentAtPickup) {
    facts.push('O cliente escolheu pagar no momento da coleta; não volte a perguntar a forma de pagamento.');
  }

  const latestAddress = [...inboundTexts].reverse().find(looksLikeAddress);
  if (latestAddress) {
    facts.push(`Endereço já informado pelo cliente: "${latestAddress}". Não peça novamente os dados que já constam nessa frase.`);
  }

  if (state.pending_pickup?.date) facts.push(`Data de coleta em andamento: ${state.pending_pickup.date}.`);
  if (state.pending_pickup?.period) facts.push(`Turno de coleta em andamento: ${state.pending_pickup.period}.`);
  if (state.pending_pickup?.address) facts.push(`Endereço salvo no fluxo: ${state.pending_pickup.address}.`);

  return facts.length ? facts.map((fact) => `- ${fact}`).join('\n') : '- Nenhuma informação adicional já confirmada.';
};