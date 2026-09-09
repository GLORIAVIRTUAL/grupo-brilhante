// ============================================================================
// quoteBuilder — PRECIFICAÇÃO DETERMINÍSTICA DE ORÇAMENTOS
//
// Por quê: a IA (modelo de linguagem) erra aritmética e pode inventar preços.
// Toda soma de orçamento, escolha de menor preço de variação e cálculo de
// passadoria (70%) passa a ser feita AQUI, em código, contra o catálogo oficial
// (entidade Product). A IA apenas redige a fala humana em cima destes fatos.
//
// Nenhuma função aqui acessa banco: o catálogo (products) é recebido pronto.
// ============================================================================

const normalize = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const formatBrl = (value) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;

// Passadoria = percentual do valor da lavagem (padrão 70%, configurável em
// IroningSettings). Calculado SEMPRE em código.
export const passadoriaPrice = (lavagemPrice, percent = 70) =>
  roundMoney(Number(lavagemPrice || 0) * (Number(percent) > 0 ? Number(percent) : 70) / 100);

// Stopwords idênticas às do orchestrator (findRelatedCatalogProducts), para que a
// correspondência de peças seja consistente entre os dois caminhos.
const PRODUCT_STOPWORDS = new Set(['quanto', 'custa', 'valor', 'preco', 'para', 'pra', 'lavar', 'lavo', 'quero', 'querendo', 'to', 'estou', 'meu', 'minha', 'um', 'uma', 'o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'qual', 'produto', 'produtos', 'servico', 'servicos', 'por', 'peca', 'lugar', 'par', 'mesmo', 'obrigado', 'obrigada', 'valeu', 'enquanto', 'isso', 'agora', 'entao', 'tchau', 'bom', 'dia', 'tarde', 'noite', 'ola', 'oi', 'tudo', 'bem', 'sim', 'nao', 'favor', 'tele']);

// Encontra os produtos do catálogo relacionados a um nome de peça informado.
// Retorna ordenado por preço (menor primeiro). Reutiliza a mesma estratégia de
// pontuação do orchestrator para não divergir do comportamento atual.
export const findCatalogMatches = (products = [], garmentType = '') => {
  const tokens = normalize(garmentType)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !PRODUCT_STOPWORDS.has(token));
  if (!tokens.length) return [];
  const score = (product) => {
    const name = normalize(product.name || '');
    const family = normalize(product.family || '');
    const haystack = `${name} ${family}`.trim();
    let s = 0;
    for (const token of tokens) {
      if (family === token || name === token) s += 10;
      else if (family.includes(token)) s += 6;
      else if (name.includes(token)) s += 4;
    }
    if (tokens.length > 1 && tokens.every((token) => haystack.includes(token))) s += 8;
    return s;
  };
  return (products || [])
    .map((product) => ({ product, _score: score(product) }))
    .filter((entry) => entry._score > 0)
    .sort((a, b) => b._score - a._score || Number(a.product.price) - Number(b.product.price))
    .map((entry) => entry.product);
};

// Precifica UM item contra o catálogo.
// Regras:
//  - Se houver correspondência no catálogo, o preço oficial é SEMPRE o do catálogo.
//  - Se a peça tiver variações e a IA não identificou qual é, usa o MENOR preço do grupo.
//  - Se a IA enviou um unit_price divergente do catálogo, ele é corrigido (price_corrected=true).
//  - Se não houver correspondência, o item fica sem preço (needs_review=true) — nunca inventamos.
export const priceItem = (item, products = []) => {
  const qty = Math.max(1, Number(item?.qty || 1));
  const garmentType = String(item?.garment_type || '').trim();
  const matches = findCatalogMatches(products, garmentType);
  if (!matches.length) {
    return {
      garment_type: garmentType,
      qty,
      unit_price: null,
      matched_product: null,
      used_lowest_price: false,
      price_corrected: false,
      needs_review: true
    };
  }
  // Se a IA especificou uma variação que existe no catálogo (ex: "Edredom Queen"),
  // o primeiro match é a variação exata; senão, o MENOR preço do grupo.
  const chosen = matches[0];
  const officialPrice = Number(chosen.price);
  const aiPrice = Number(item?.unit_price);
  const priceCorrected = Number.isFinite(aiPrice) && aiPrice > 0 && Math.abs(aiPrice - officialPrice) >= 0.01;
  // "Menor preço" só se aplica quando a peça tem variações E a IA NÃO identificou qual é
  // (o nome informado não corresponde exatamente a nenhuma variação específica).
  const identifiedVariant = matches.some((p) => {
    const fullName = normalize(p.name || '');
    const variant = fullName.split('-').slice(1).join('-').trim();
    const text = normalize(garmentType);
    return text.includes(fullName) || (variant.length >= 4 && text.includes(variant));
  });
  const usedLowest = matches.length > 1 && !identifiedVariant;
  return {
    garment_type: garmentType,
    qty,
    unit_price: officialPrice,
    matched_product: chosen.name,
    used_lowest_price: usedLowest,
    price_corrected: priceCorrected,
    needs_review: false
  };
};

// Precifica uma lista de itens e devolve o orçamento completo, SEM desconto.
// O desconto de promoção NUNCA é calculado aqui nem pela IA: é aplicado pela
// equipe na hora do pagamento (decisão de negócio de 21/08/2026).
export const priceItems = (items = [], products = []) => {
  const priced = (items || []).map((item) => priceItem(item, products));
  const subtotal = roundMoney(
    priced.reduce((sum, item) => sum + (Number(item.unit_price || 0) * item.qty), 0)
  );
  return {
    items: priced,
    subtotal,
    total: subtotal,
    has_unpriced: priced.some((item) => item.needs_review),
    any_price_corrected: priced.some((item) => item.price_corrected),
    any_lowest_price: priced.some((item) => item.used_lowest_price)
  };
};

// Texto-fato para a IA apresentar ao cliente (a IA não calcula nada, só lê).
export const buildQuoteFactsText = (quote) => {
  if (!quote || !quote.items?.length) return '';
  const lines = quote.items.map((item) => {
    const price = item.needs_review ? 'sob avaliação da equipe' : formatBrl(item.unit_price);
    return `- ${item.qty}x ${item.garment_type}: ${price}${item.matched_product ? ` (catálogo: ${item.matched_product})` : ''}`;
  });
  const parts = [`ORÇAMENTO CALCULADO PELO SISTEMA (valores oficiais do catálogo — apresente EXATAMENTE estes valores, sem recalcular):`, ...lines, `Subtotal (sem desconto): ${formatBrl(quote.subtotal)}`];
  if (quote.any_lowest_price) {
    parts.push('Há peças com variações: o orçamento considerou o MENOR valor da categoria. Informe obrigatoriamente que a equipe irá inspecionar as peças e, se alguma precisar ser tratada como especial, poderá haver cobrança do valor adicional.');
  }
  if (quote.has_unpriced) {
    parts.push('Há peças sem preço no catálogo: NÃO invente valor — informe que a equipe confirmará o valor dessas peças.');
  }
  if (quote.any_price_corrected) {
    parts.push('ATENÇÃO: um ou mais preços que você informou foram corrigidos para o valor oficial do catálogo. Use somente os valores acima.');
  }
  return parts.join('\n');
};