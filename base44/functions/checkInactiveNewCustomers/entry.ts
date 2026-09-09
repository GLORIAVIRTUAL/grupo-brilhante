import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireInternalRequest, securityErrorResponse } from '../../shared/functionSecurity.js';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        let payload = {};
        try { payload = await req.json(); } catch { payload = {}; }
        requireInternalRequest(req, payload);

        // Get all NEW_CUSTOMER cards
        const cards = await base44.asServiceRole.entities.CrmCard.filter({ 
            pipeline_type: 'NEW_CUSTOMER' 
        });
        
        // Filter those not yet Inativo
        const activeCards = cards.filter(c => c.stage !== 'Inativo');
        
        const now = new Date();
        const inactiveThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
        const updates = [];

        for (const card of activeCards) {
            const customer = await base44.asServiceRole.entities.Customer.get(card.customer_id);
            if (!customer) continue;

            // Use last_inbound_at, default to created_date if never spoke
            let lastInteraction = customer.last_inbound_at 
                ? new Date(customer.last_inbound_at) 
                : new Date(customer.created_date);
            
            if (isNaN(lastInteraction.getTime())) {
                 lastInteraction = new Date(customer.created_date);
            }

            const diff = now.getTime() - lastInteraction.getTime();

            if (diff > inactiveThreshold) {
                await base44.asServiceRole.entities.CrmCard.update(card.id, { stage: 'Inativo' });
                updates.push(card.id);
            }
        }

        return Response.json({ 
            success: true, 
            moved_to_inactive_count: updates.length, 
            ids: updates 
        });

    } catch (error) {
        console.error('Error in checkInactiveNewCustomers:', error?.code || error?.message || error);
        return securityErrorResponse(error);
    }
});