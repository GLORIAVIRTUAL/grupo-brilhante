import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'chatStats' });
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Helper to fetch ALL records (paginated) of an entity
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
        if (skip > 50000) break; // safety cap
      }
      return all;
    };

    const [conversations, quotes, pickups, paymentCards, payments] = await Promise.all([
      fetchAll('Conversation'),
      fetchAll('Quote'),
      fetchAll('Pickup'),
      base44.asServiceRole.entities.CrmCard.filter({ pipeline_type: 'PAYMENT' }, '-created_date', 5000),
      fetchAll('Payment')
    ]);

    // 1. Total conversations
    const totalConversations = conversations.length;

    // Map each conversation -> customer
    const convByCustomer = {};
    for (const c of conversations) {
      if (!c.customer_id) continue;
      if (!convByCustomer[c.customer_id]) convByCustomer[c.customer_id] = [];
      convByCustomer[c.customer_id].push(c);
    }

    // 2. Customers attended 100% by AI = conversations that NEVER had handoff_required = true
    const customersAllAI = new Set();
    const customersWithHandoff = new Set();
    for (const c of conversations) {
      if (!c.customer_id) continue;
      if (c.handoff_required) customersWithHandoff.add(c.customer_id);
    }
    for (const customerId of Object.keys(convByCustomer)) {
      if (!customersWithHandoff.has(customerId)) customersAllAI.add(customerId);
    }

    // 3. Customers with quote made by AI (any Quote -> implies AI built it via the orchestrator)
    const customersWithQuote = new Set(quotes.map(q => q.customer_id).filter(Boolean));

    // 4. Customers with pickup scheduled by AI (source === 'ai')
    const customersWithAIPickup = new Set(
      pickups.filter(p => p.source === 'ai').map(p => p.customer_id).filter(Boolean)
    );

    // 5. Customers who sent PIX receipt — refined:
    //    a) PAYMENT card marked "Pago" or with receipt_url filled
    //    b) Payment record with status 'succeeded'
    //    c) Conversations that entered the WAITING_RECEIPT flow AND the customer sent
    //       at least one IMAGE/DOC message after that flow started (proxy for receipt sent).
    const customersWithReceipt = new Set();
    paymentCards
      .filter(pc => pc.stage === 'Pago' || !!pc.receipt_url)
      .forEach(pc => pc.customer_id && customersWithReceipt.add(pc.customer_id));
    payments
      .filter(p => p.status === 'succeeded')
      .forEach(p => p.customer_id && customersWithReceipt.add(p.customer_id));

    // c) scan conversations that reached WAITING_RECEIPT and look for inbound media after
    const waitingReceiptConvs = conversations.filter(
      c => c.metadata?.flow === 'WAITING_RECEIPT' || c.metadata?.delivery_requested === true
    );
    if (waitingReceiptConvs.length > 0) {
      const convIds = waitingReceiptConvs.map(c => c.id);
      // Fetch inbound IMAGE/DOC messages for those conversations
      const mediaMsgs = await base44.asServiceRole.entities.Message.filter({
        conversation_id: { $in: convIds },
        direction: 'IN',
        type: { $in: ['IMAGE', 'DOC'] }
      }, '-created_date', 5000);
      const convsWithMedia = new Set(mediaMsgs.map(m => m.conversation_id));
      waitingReceiptConvs
        .filter(c => convsWithMedia.has(c.id))
        .forEach(c => c.customer_id && customersWithReceipt.add(c.customer_id));
    }

    return Response.json({
      total_conversations: totalConversations,
      unique_customers_in_chat: Object.keys(convByCustomer).length,
      customers_100_percent_ai: customersAllAI.size,
      customers_with_quote_by_ai: customersWithQuote.size,
      customers_with_pickup_by_ai: customersWithAIPickup.size,
      customers_who_sent_pix_receipt: customersWithReceipt.size
    });
  } catch (error) {
    console.error('chatStats error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});