export const CUSTOMER_SOURCES = {
  SITE_QUOTE: 'SITE_QUOTE',
  COUNTER_MANUAL: 'COUNTER_MANUAL',
  WHATSAPP_HUMAN: 'WHATSAPP_HUMAN',
  WHATSAPP_GLORIA: 'WHATSAPP_GLORIA',
};

export async function ensureCustomerSourceCard(base44, customer, unitId, source) {
  try {
    const cards = await base44.asServiceRole.entities.CrmCard.filter({
      pipeline_type: 'NEW_CUSTOMER',
      customer_id: customer.id,
    });
    const existing = cards[0];
    if (existing) {
      if (!existing.customer_source) {
        await base44.asServiceRole.entities.CrmCard.update(existing.id, { customer_source: source });
      }
      return existing;
    }
    return await base44.asServiceRole.entities.CrmCard.create({
      pipeline_type: 'NEW_CUSTOMER',
      stage: 'Novo cliente',
      priority: 'MEDIUM',
      customer_id: customer.id,
      unit_id: unitId || customer.unit_id || undefined,
      customer_source: source,
    });
  } catch (error) {
    console.error('Customer source CRM card failed', error);
    return null;
  }
}