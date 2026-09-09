const normalize = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const money = (value) => Number(value || 0).toFixed(2).replace('.', ',');
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const getActivePromotions = (promotions = [], today = new Date().toISOString().slice(0, 10)) =>
  promotions.filter((promotion) => promotion.active === true && (!promotion.valid_until || promotion.valid_until >= today));

export const buildPromotionsOfferMessage = (promotions = []) => {
  const active = getActivePromotions(promotions);
  if (!active.length) {
    return 'Que bom! Seu consentimento foi registrado 😊 No momento não temos promoções ativas, mas posso montar um orçamento normal para você. Quais peças deseja lavar?';
  }
  const lines = active.map((promotion, index) => `${index + 1}. *${promotion.title.trim()}*\n${promotion.description.trim()}`);
  return `Que bom! Hoje temos estas ${active.length} promoções ativas para você 😊\n\n${lines.join('\n\n')}\n\nVocê gostou de alguma delas ou prefere fazer um orçamento fora dessas promoções?`;
};

const itemInfo = (items = []) => items
  .map((item) => ({
    ...item,
    garment_type: String(item.garment_type || '').trim(),
    qty: Math.max(0, Number(item.qty || 0)),
    unit_price: Math.max(0, Number(item.unit_price || 0)),
    normalizedName: normalize(item.garment_type)
  }))
  .filter((item) => item.garment_type && item.qty > 0);

const sumMatching = (items, predicate) => items
  .filter(predicate)
  .reduce((sum, item) => sum + item.qty * item.unit_price, 0);

const qtyMatching = (items, predicate) => items
  .filter(predicate)
  .reduce((sum, item) => sum + item.qty, 0);

const consumeValue = (items, predicate, quantity) => {
  let remaining = quantity;
  let value = 0;
  for (const item of items.filter(predicate)) {
    const used = Math.min(remaining, item.qty);
    value += used * item.unit_price;
    remaining -= used;
    if (remaining <= 0) break;
  }
  return remaining > 0 ? null : value;
};

export const calculatePromotionalQuote = (promotion, rawItems = []) => {
  if (!promotion) return { valid: false, error: 'Promoção ativa não encontrada.' };
  const items = itemInfo(rawItems);
  if (!items.length) return { valid: false, error: 'Informe os itens e as quantidades do orçamento.' };

  const title = normalize(promotion.title);
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.qty * item.unit_price, 0));
  let discount = 0;
  let qualification = '';

  if (title.includes('15%') && (title.includes('edredom') || title.includes('cobertor') || title.includes('colcha'))) {
    const eligible = (item) => /edredom|cobertor|colcha/.test(item.normalizedName);
    const quantity = qtyMatching(items, eligible);
    if (quantity < 2) return { valid: false, error: 'Esta promoção exige pelo menos 2 itens entre edredom, cobertor ou colcha.' };
    discount = roundMoney(sumMatching(items, eligible) * 0.15);
    qualification = `${quantity} itens elegíveis com 15% de desconto`;
  } else if (title.includes('15%') && title.includes('terno')) {
    const eligible = (item) => /terno/.test(item.normalizedName);
    const quantity = qtyMatching(items, eligible);
    if (quantity < 2) return { valid: false, error: 'Esta promoção exige pelo menos 2 ternos no mesmo orçamento.' };
    discount = roundMoney(sumMatching(items, eligible) * 0.15);
    qualification = `${quantity} ternos com 15% de desconto`;
  } else if (title.includes('combo cama')) {
    const isSheet = (item) => /lencol/.test(item.normalizedName);
    const isPillowcase = (item) => /fronha/.test(item.normalizedName);
    const combos = Math.min(Math.floor(qtyMatching(items, isSheet) / 2), Math.floor(qtyMatching(items, isPillowcase) / 2));
    if (combos < 1) return { valid: false, error: 'O Combo Cama exige 2 lençóis e 2 fronhas.' };
    const allocated = consumeValue(items, isSheet, combos * 2) + consumeValue(items, isPillowcase, combos * 2);
    discount = roundMoney(Math.max(0, allocated - 67 * combos));
    qualification = `${combos} Combo Cama por R$ ${money(67 * combos)}`;
  } else if (title.includes('combo banho')) {
    const eligible = (item) => /toalha de rosto|toalha de banho|toalha.*piso|roupao|robe/.test(item.normalizedName);
    const quantity = qtyMatching(items, eligible);
    const combos = Math.floor(quantity / 6);
    if (combos < 1) return { valid: false, error: 'O Combo Banho exige 6 itens entre toalhas de rosto, banho, piso ou roupão.' };
    const allocated = consumeValue(items, eligible, combos * 6);
    discount = roundMoney(Math.max(0, allocated - 85 * combos));
    qualification = `${combos} Combo Banho por R$ ${money(85 * combos)}`;
  } else {
    return { valid: false, error: 'A regra desta promoção não está configurada para cálculo automático.' };
  }

  return {
    valid: true,
    items: items.map(({ normalizedName, ...item }) => item),
    subtotal,
    discount,
    total: roundMoney(subtotal - discount),
    promotion_title: promotion.title.trim(),
    qualification
  };
};