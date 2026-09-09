// Classifica a ORIGEM de uma mensagem de saída (OUT) e decide se ela deve entrar
// no histórico que a Glória (IA) lê.
//
// PROBLEMA QUE RESOLVE: no mesmo número da Glória disparam também plataformas de
// terceiros (Biwapp = marketing, Hybex = aviso de roupa pronta) e as atendentes às
// vezes falam pelo celular/WhatsApp Web. Tudo isso volta ao sistema como eco
// `fromMe: true` e era jogado no histórico como se fosse FALA DA GLÓRIA — ela lia
// um aviso de marketing como se fosse mensagem dela e se confundia no fluxo
// (coleta, orçamento, pagamento), cometendo erros.
//
// SOLUÇÃO: classificar cada mensagem OUT pela origem e EXCLUIR do histórico da IA
// as que NÃO foram escritas pela Glória nem por um atendente humano. Assim a Glória
// só enxerga a conversa real com o cliente.

// Padrões de texto típicos de disparos automáticos de terceiros (não são fala da
// Glória nem de um atendente). Mantido conservador: só marca como disparo quando
// há sinais claros, para NUNCA esconder uma mensagem real da Glória.
const DISPATCH_TEXT_PATTERNS = [
    /roupa\s+(est[aá]\s+)?pronta/i,                 // Hybex: "sua roupa está pronta"
    /sua\s+pe[cç]a\s+(est[aá]\s+)?pronta/i,
    /j[aá]\s+pode\s+(vir\s+)?(buscar|retirar)/i,    // aviso de retirada
    /j[aá]\s+pode\s+ser\s+retirad/i,                // "seu pedido já pode ser retirado"
    /pedido\s+(est[aá]\s+)?pronto/i,                // "seu pedido está pronto"
    /promo[cç][aã]o\s+imperd[ií]vel/i,              // marketing genérico
    /oferta\s+exclusiva/i,
    /s[óo]\s+esta\s+semana/i,
    /aproveite\s+(a\s+)?promo[cç][aã]o/i,
    /voc[eê]\s+ganhou/i,
    /n[aã]o\s+perca/i,
    /cupom/i,
    /desconto\s+de\s+\d+\s*%/i,                     // "desconto de 15%"
    /responda\s+SAIR\s+para/i,                      // rodapé de opt-out de disparo
    /para\s+cancelar.{0,20}responda/i,
];

// Uma mensagem OUT é DISPARO DE TERCEIRO quando é um eco `fromMe` cujo texto tem
// padrão claro de marketing/aviso automático.
const looksLikeDispatch = (msg) => {
    const text = (msg.text || '').trim();
    if (!text) return false;
    return DISPATCH_TEXT_PATTERNS.some((re) => re.test(text));
};

// Uma mensagem OUT é da GLÓRIA quando foi registrada pelo sender SEM `sent_by`
// (a IA nunca passa sent_by) E veio por uma conexão da IA (zapi_sender /
// zapi_moinhos_sender / whatsapp_moinhos_sender). O raw_payload desse caso é a
// RESPOSTA da Z-API ao envio (tem messageId/zaapId), não um eco de webhook.
const isGloriaSent = (msg) => {
    if (msg.sent_by) return false; // com sent_by é atendente no painel
    const raw = msg.raw_payload || {};
    // Mensagem enviada pela Glória: o sender registra a resposta da Z-API, que
    // NÃO tem a flag fromMe (isso só existe em eco de webhook). Se tem fromMe=true,
    // é um eco de algo enviado por fora (celular ou disparo de terceiro).
    if (raw.fromMe === true) return false;
    return true;
};

// Uma mensagem OUT é de ATENDENTE HUMANO quando tem `sent_by` (painel) ou é um eco
// `fromMe` do celular/WhatsApp Web da loja.
const isHumanSent = (msg) => {
    if (msg.sent_by) return true;
    const raw = msg.raw_payload || {};
    // Eco fromMe SEM padrão de disparo → provavelmente a atendente no celular.
    return raw.fromMe === true && !looksLikeDispatch(msg);
};

// Classificação principal. Retorna: 'gloria' | 'human' | 'dispatch' | 'unknown'.
export function classifyOutboundOrigin(msg) {
    if (!msg || msg.direction !== 'OUT') return 'unknown';
    if (looksLikeDispatch(msg)) return 'dispatch';
    if (isGloriaSent(msg)) return 'gloria';
    if (isHumanSent(msg)) return 'human';
    return 'unknown';
}

// Decide se a mensagem OUT deve entrar no histórico que a IA lê.
// Entram: 'gloria' (fala real dela) e 'human' (contexto do atendente).
// NÃO entram: 'dispatch' (marketing/aviso de terceiro) — é isso que contaminava.
// 'unknown' entra por segurança (nunca escondemos algo que possa ser da Glória).
export function shouldIncludeInAiHistory(msg) {
    return classifyOutboundOrigin(msg) !== 'dispatch';
}