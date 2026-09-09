// Preços dos SERVIÇOS ESPECIAIS por tipo de peça.
// A fonte da verdade é a entidade SpecialServicePricing (Configurações → Serviços Especiais).
// Os valores abaixo são apenas fallback caso o banco esteja vazio.

const DEFAULT_TIERS = [
    { item_label: 'Edredom', keywords: 'edredom,edredon,cobertor,coberta,colcha,manta,duvet', bactericida: 40, revitalizante: 35, impermeabilizacao: 35, per_m2: false, sort_order: 1 },
    { item_label: 'Casacos', keywords: 'casaco,jaqueta,sobretudo,parka', bactericida: 26, revitalizante: 21, impermeabilizacao: 21, per_m2: false, sort_order: 2 },
    { item_label: 'Cortinas', keywords: 'cortina', bactericida: 25, revitalizante: 20, impermeabilizacao: 20, per_m2: false, sort_order: 3 },
    { item_label: 'Tapete', keywords: 'tapete', bactericida: 27, revitalizante: null, impermeabilizacao: null, per_m2: true, sort_order: 4 },
    { item_label: 'Vestidos', keywords: 'vestido', bactericida: 22, revitalizante: 17, impermeabilizacao: 17, per_m2: false, sort_order: 5 },
    { item_label: 'Macacão', keywords: 'macacão,macacao', bactericida: 20, revitalizante: 15, impermeabilizacao: 15, per_m2: false, sort_order: 6 },
    { item_label: 'Demais Peças', keywords: '', bactericida: 14, revitalizante: 10, impermeabilizacao: 14, per_m2: false, sort_order: 99 }
];

const brl = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;

const normalize = (v = '') => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Lê a tabela oficial do banco de dados (com fallback para os valores padrão).
export const loadSpecialServiceRows = async (base44) => {
    try {
        const rows = await base44.asServiceRole.entities.SpecialServicePricing.list('sort_order');
        if (rows?.length) return rows;
    } catch (e) {
        console.error('Falha ao ler SpecialServicePricing, usando fallback:', e);
    }
    return DEFAULT_TIERS;
};

// Retorna as linhas cujas palavras-chave aparecem no texto do atendimento.
export const detectSpecialServiceTiers = (text = '', rows = DEFAULT_TIERS) => {
    const haystack = normalize(text || '');
    return (rows || []).filter((row) => {
        const terms = String(row.keywords || '')
            .split(',')
            .map((t) => normalize(t.trim()))
            .filter((t) => t.length >= 3);
        return terms.some((term) => haystack.includes(term));
    });
};

// Monta o bloco de FATOS com os valores oficiais das peças detectadas.
export const buildSpecialServiceFact = (tiers = []) => {
    if (!tiers.length) return '';
    const lines = tiers.map((t) => {
        const extra = t.per_m2 ? '/m²' : '';
        const outros = t.revitalizante
            ? ` | Branco+/Revitalizante/Engomagem = ${brl(t.revitalizante)}${t.impermeabilizacao ? ` | Impermeabilização = ${brl(t.impermeabilizacao)}` : ''}`
            : '';
        return `- ${t.item_label}: Bactericida = ${brl(t.bactericida)}${extra}${outros}`;
    }).join('\n');

    return `🚨 SERVIÇOS ESPECIAIS DA(S) PEÇA(S) DESTE ATENDIMENTO (VALORES OFICIAIS DO BANCO DE DADOS, USE EXATAMENTE ESTES):
${lines}
É TERMINANTEMENTE PROIBIDO usar a linha "Demais Peças" para estas peças, e proibido inventar outro valor. Se você somar o serviço especial ao total, use estes valores no cálculo.`;
};