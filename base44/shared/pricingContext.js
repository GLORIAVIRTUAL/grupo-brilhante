// Contexto de preços SEMPRE lido do banco (nunca fixo no código).
// Bags vêm do catálogo (Product) e a tabela de serviços especiais vem de
// SpecialServicePricing — ambos editáveis nas Configurações.

const brl = (value) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;

export const buildBagsContext = (products = []) => {
    const bags = products
        .filter((p) => p.category === 'Bags' || p.family === 'Bags')
        .sort((a, b) => a.price - b.price);
    if (!bags.length) return '- Bags disponíveis mediante consulta na loja.';
    return bags.map((p) => `- ${p.name}: ${brl(p.price)}`).join('\n');
};

export const buildSpecialTableContext = (rows = []) => {
    if (!rows.length) return 'Tabela indisponível — consulte a equipe.';
    return rows.map((row) => {
        const val = (v) => (v === null || v === undefined || v === '' ? '-' : `${brl(v)}${row.per_m2 ? ' / m²' : ''}`);
        return `${row.item_label} | Bactericida: ${val(row.bactericida)} | Branco+ / Revitalizante / Engomagem: ${val(row.revitalizante)} | Impermeabilização: ${val(row.impermeabilizacao)}`;
    }).join('\n');
};