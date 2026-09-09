const normalize = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const DELIVERY_TERMS = ['coleta', 'retirar', 'retirem', 'buscar', 'busquem', 'portaria', 'tele', 'tele entrega', 'frete'];

export function detectDeliveryIntent(messages = [], state = {}) {
  if (state.delivery_requested) return true;
  return messages.some((message) => {
    if (message.direction !== 'IN') return false;
    const text = normalize(message.text || '');
    return DELIVERY_TERMS.some((term) => text.includes(term));
  });
}

export function isDeliveryPriceQuestion(value = '') {
  const text = normalize(value);
  const mentionsDelivery = /frete|tele|coleta.{0,20}entrega|entrega.{0,20}coleta/.test(text);
  const asksPrice = /quanto|valor|preco|custa|custo|taxa|adicional|orcamento|ficaria|fica/.test(text);
  return mentionsDelivery && asksPrice;
}

const formatBrl = (value) => `R$ ${Number(value).toFixed(2).replace('.', ',')}`;

export function resolveKnownDeliveryTotal({ pendingQuotes = [], state = {}, history = [] }) {
  const pending = pendingQuotes[0];
  if (pending) return Number(pending.subtotal ?? pending.total ?? 0) - Number(pending.discount || 0);

  for (const message of [...history].reverse()) {
    if (message.direction !== 'OUT') continue;
    const text = message.text || '';
    if (!/total|totalizando|or[cç]amento.{0,30}(?:ficou|fica|de)/i.test(text)) continue;
    const values = [...text.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/gi)];
    if (!values.length) continue;
    const raw = values[values.length - 1][1].replace(/\./g, '').replace(',', '.');
    const total = Number(raw);
    if (Number.isFinite(total) && total > 0) return total;
  }

  const draftTotal = (state.temp_items || []).reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.qty || 1), 0);
  return draftTotal > 0 ? draftTotal : null;
}

export function buildDeliveryPriceResponse(total) {
  if (!Number.isFinite(total) || total <= 0) {
    return 'A coleta e a entrega são gratuitas para serviços acima de R$ 150,00. Para valores de até R$ 150,00, a taxa fixa é de R$ 15,00.';
  }
  if (total > 150) {
    return `Como o orçamento das peças é de ${formatBrl(total)}, a coleta e a entrega são gratuitas. O total permanece ${formatBrl(total)}.`;
  }
  const totalWithDelivery = total + 15;
  return `Como o orçamento das peças é de ${formatBrl(total)}, há uma taxa fixa de R$ 15,00 para coleta e entrega. O total com o frete fica em ${formatBrl(totalWithDelivery)}.`;
}

// Garante DETERMINISTICAMENTE que a taxa fixa de R$ 15,00 apareça quando o cliente pediu
// coleta/entrega e a mensagem informa um total de peças de até R$ 150,00.
export function enforceDeliveryFeeNotice({ draftResponse, deliveryRequested }) {
  if (!draftResponse || !deliveryRequested) return { response: draftResponse, corrected: false };
  if (/r\$\s*15(?:,00)?\b/i.test(draftResponse)) return { response: draftResponse, corrected: false };
  if (!/total|ficar[áa]|fica em|or[cç]amento/i.test(draftResponse)) return { response: draftResponse, corrected: false };

  const values = [...draftResponse.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/gi)]
    .map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!values.length) return { response: draftResponse, corrected: false };

  const highest = Math.max(...values);
  if (highest > 150) return { response: draftResponse, corrected: false };

  return {
    corrected: true,
    response: `${draftResponse}\n\n🚚 Como o total das peças é de até R$ 150,00, há a taxa fixa de *R$ 15,00* pela coleta + entrega (total com o frete: ${formatBrl(highest + 15)}). Se preferir levar na loja, essa taxa não é cobrada 😊`
  };
}

export function enforceVariableQuoteSafety({ draftResponse, latestCustomerText, products, hasAnalyzedImage, deliveryRequested }) {
  if (!draftResponse || hasAnalyzedImage) return { response: draftResponse, corrected: false };
  const text = normalize(latestCustomerText);
  const grouped = new Map();
  for (const product of products || []) {
    const family = product.family || product.name || '';
    const key = normalize(family);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(product);
  }
  const match = [...grouped.entries()].find(([family, items]) => {
    const terms = family.split(/[^a-z0-9]+/).filter((term) => term.length >= 4);
    const exactVariant = items.some((item) => {
      const fullName = normalize(item.name || '');
      const variant = fullName.split('-').slice(1).join('-').trim();
      return text.includes(fullName) || (variant.length >= 4 && text.includes(variant));
    });
    return items.length > 1 && !exactVariant && terms.some((term) => text.includes(term));
  });
  if (!match || !/(r\$|pix|valor|pre[cç]o|custa|pagamento)/i.test(draftResponse)) {
    return { response: draftResponse, corrected: false };
  }
  const [, items] = match;
  const lowest = [...items].sort((a, b) => Number(a.price) - Number(b.price))[0];
  const alreadyWarned = /inspecion|tratada? como especial|valor adicional/i.test(draftResponse);
  if (alreadyWarned) return { response: draftResponse, corrected: false };

  const deliveryNote = deliveryRequested
    ? ' A taxa de coleta/entrega segue as regras do orçamento.'
    : '';
  return {
    corrected: true,
    response: `${draftResponse}\n\nℹ️ Este orçamento considera o menor valor da categoria (${lowest.name}: R$ ${Number(lowest.price).toFixed(2).replace('.', ',')}). Nossa equipe irá inspecionar as peças e, se alguma precisar ser tratada como especial, poderá haver cobrança do valor adicional. Se quiser um orçamento mais preciso, você pode informar algumas características da peça, mas isso não é obrigatório.${deliveryNote}`
  };
}