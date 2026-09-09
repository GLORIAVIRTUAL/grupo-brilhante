// Detecta perguntas sobre remoção de manchas / acidentes com a peça
// (batom, tinta, caneta, gordura, sangue, mofo etc.) e fotos que são
// etiqueta/detalhe da mancha — que NÃO devem virar itens de orçamento.

const STAIN_KEYWORDS = [
  'mancha', 'manchou', 'manchado', 'manchada', 'manchei',
  'batom', 'tinta', 'caneta', 'esferográfica', 'gordura', 'óleo', 'oleo',
  'sangue', 'mofo', 'bolor', 'ferrugem', 'encardido', 'amarelado',
  'sujou', 'sujeira impregnada', 'desbotou', 'tingiu', 'tingimento',
  'passou cor', 'vinho', 'café', 'cafe', 'graxa', 'chiclete', 'cera'
];

const REMOVAL_KEYWORDS = [
  'tirar', 'remover', 'remoção', 'remocao', 'sai', 'sair', 'salvar',
  'recuperar', 'consegue', 'fazem esse serviço', 'fazem esse servico',
  'tem como', 'da pra', 'dá pra'
];

export function detectStainInquiry(texts = []) {
  const joined = texts.filter(Boolean).join(' ').toLowerCase();
  if (!joined) return false;
  const hasStain = STAIN_KEYWORDS.some(k => joined.includes(k));
  if (!hasStain) return false;
  // Menção a mancha já é suficiente quando vem junto de pedido/pergunta
  return REMOVAL_KEYWORDS.some(k => joined.includes(k)) || hasStain;
}

// Fotos de etiqueta / close da mancha costumam voltar como "desconhecido".
// Se a maioria não foi reconhecida como peça, não é um envio para orçamento.
export function looksLikeDetailPhotos(visionResults = []) {
  if (!visionResults.length) return false;
  const recognized = visionResults.filter(
    r => (r.garment_type || '').toLowerCase() !== 'desconhecido' &&
         (r.garment_type || '').toLowerCase() !== 'peça desconhecida' &&
         (r.confidence || 0) >= 0.6
  ).length;
  return recognized <= Math.floor(visionResults.length / 2);
}

export function buildStainReply(garmentHint) {
  const peca = garmentHint ? `a sua *${garmentHint}*` : 'a sua peça';
  return `Entendi o que aconteceu, e sim — nós fazemos *remoção de manchas* (tratamento localizado) junto com a limpeza da peça. 🧴

Sobre o seu caso: manchas de batom são oleosas e com pigmento, e a secadora tende a fixar o pigmento no tecido. Por isso trabalhamos com *tentativa de remoção*, sem garantia de saída total — mas na maioria dos casos conseguimos clarear bastante ou remover.

Como funciona:
• Você traz ou nós coletamos ${peca};
• Nossa equipe avalia o tecido e a etiqueta para escolher o tratamento correto;
• O valor é o da limpeza da peça, e o tratamento de mancha é cobrado à parte, informado antes de qualquer serviço.

Quer que eu agende uma coleta para avaliarmos a peça, ou prefere levar até a loja?`;
}