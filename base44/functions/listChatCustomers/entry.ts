import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'listChatCustomers' });
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const fetchAll = async (entityName, sortField = '-created_date') => {
      const all = [];
      const pageSize = 500;
      let skip = 0;
      while (true) {
        const batch = await base44.asServiceRole.entities[entityName].list(sortField, pageSize, skip);
        if (!batch || batch.length === 0) break;
        all.push(...batch);
        if (batch.length < pageSize) break;
        skip += pageSize;
        if (skip > 50000) break;
      }
      return all;
    };

    const [conversations, allCustomers] = await Promise.all([
      fetchAll('Conversation'),
      fetchAll('Customer', 'full_name')
    ]);
    const customerIds = new Set(conversations.map(c => c.customer_id).filter(Boolean));
    const customers = allCustomers.filter(c => customerIds.has(c.id));

    const list = customers
      .map(c => ({
        name: c.full_name || 'Sem nome',
        phone: c.phones?.[0] || '',
        unit: c.preferred_unit_name || ''
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return Response.json({ total: list.length, customers: list });
  } catch (error) {
    console.error('listChatCustomers error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});