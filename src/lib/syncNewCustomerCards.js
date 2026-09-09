import { base44 } from '@/api/base44Client';

// Garante que todo cliente (vindo do chat ou cadastrado manualmente)
// tenha um card no pipeline "Novos Clientes".
export default async function syncNewCustomerCards(customers, fallbackUnitId) {
  const allCards = await base44.entities.CrmCard.list('-created_date', 500);
  const existing = allCards.filter((card) => card.pipeline_type === 'NEW_CUSTOMER');
  const withCard = new Set(existing.map((card) => card.customer_id));
  const sourceByCustomer = new Map(allCards.filter((card) => card.customer_source).map((card) => [card.customer_id, card.customer_source]));

  const missing = customers.filter((customer) => customer.id && !withCard.has(customer.id));
  if (missing.length === 0) return existing;

  const created = [];
  for (let index = 0; index < missing.length; index += 100) {
    const chunk = missing.slice(index, index + 100).map((customer) => ({
      pipeline_type: 'NEW_CUSTOMER',
      stage: Number(customer.orders_count || 0) > 0 ? 'Convertido' : 'Novo cliente',
      customer_id: customer.id,
      unit_id: customer.unit_id || fallbackUnitId || undefined,
      customer_source: sourceByCustomer.get(customer.id) || undefined,
    }));
    const batch = await base44.entities.CrmCard.bulkCreate(chunk);
    created.push(...(Array.isArray(batch) ? batch : []));
  }

  return [...existing, ...created];
}