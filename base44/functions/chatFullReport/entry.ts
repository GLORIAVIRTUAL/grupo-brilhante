import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    if (!body.__internal) {
      const user = await base44.auth.me();
      await enforceExistingUserSecurity(base44, req, user, { source: 'chatFullReport' });
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Helper: fetch ALL records (paginated)
    const fetchAll = async (entityName, sortField = 'created_date') => {
      const all = [];
      const pageSize = 500;
      let skip = 0;
      while (true) {
        const batch = await base44.asServiceRole.entities[entityName].list(sortField, pageSize, skip);
        if (!batch || batch.length === 0) break;
        all.push(...batch);
        if (batch.length < pageSize) break;
        skip += pageSize;
        if (skip > 200000) break;
      }
      return all;
    };

    const [messages, conversations, quotes, pickups] = await Promise.all([
      fetchAll('Message', 'created_date'),
      fetchAll('Conversation', 'created_date'),
      fetchAll('Quote', 'created_date'),
      fetchAll('Pickup', 'created_date')
    ]);

    // Map conversation -> customer
    const convToCustomer = {};
    for (const c of conversations) convToCustomer[c.id] = c.customer_id;

    // ---- Time helpers (America/Sao_Paulo, UTC-3) ----
    const toLocal = (iso) => {
      const d = new Date(iso);
      // shift to UTC-3
      return new Date(d.getTime() - 3 * 60 * 60 * 1000);
    };

    // Period boundaries
    let firstDate = null, lastDate = null;

    // 1. Unique customers who talked (had at least 1 inbound message)
    const customersWhoTalked = new Set();
    // After-hours weekday: weekday (Mon-Fri) after 18h or before 8h
    const afterHoursWeekday = new Set();
    // Weekend window: Saturday after 12:00 until Monday 08:00
    const weekendWindow = new Set();
    // Customers who sent PIX receipt (DOC files)
    const customersSentDoc = new Set();
    // Customers who sent images (clothes photos)
    const customersSentImage = new Set();

    for (const m of messages) {
      const custId = convToCustomer[m.conversation_id];
      const created = m.created_date;
      if (created) {
        const d = new Date(created);
        if (!firstDate || d < firstDate) firstDate = d;
        if (!lastDate || d > lastDate) lastDate = d;
      }
      if (m.direction !== 'IN') continue;
      if (!custId) continue;
      customersWhoTalked.add(custId);

      const local = toLocal(created);
      const dow = local.getUTCDay(); // 0=Sun..6=Sat
      const hour = local.getUTCHours();

      // Weekday after-hours: Mon(1)-Fri(5), hour>=18 or hour<8
      if (dow >= 1 && dow <= 5 && (hour >= 18 || hour < 8)) {
        afterHoursWeekday.add(custId);
      }

      // Weekend window: Sat >=12:00  OR  Sun (all)  OR  Mon < 08:00
      if ((dow === 6 && hour >= 12) || dow === 0 || (dow === 1 && hour < 8)) {
        weekendWindow.add(custId);
      }

      // Files / receipts (DOC) and clothes images (IMAGE)
      if (m.type === 'DOC') customersSentDoc.add(custId);
      if (m.type === 'IMAGE') customersSentImage.add(custId);
    }

    // 2. 100% AI vs human intervention (based on conversation.handoff_required)
    const customersWithHandoff = new Set();
    const allChatCustomers = new Set();
    for (const c of conversations) {
      if (!c.customer_id) continue;
      allChatCustomers.add(c.customer_id);
      if (c.handoff_required) customersWithHandoff.add(c.customer_id);
    }
    const customers100AI = [...allChatCustomers].filter(id => !customersWithHandoff.has(id));

    // 3. Quotes by AI & pickups by AI
    const customersWithQuote = new Set(quotes.map(q => q.customer_id).filter(Boolean));
    const customersWithAIPickup = new Set(
      pickups.filter(p => p.source === 'ai').map(p => p.customer_id).filter(Boolean)
    );

    // 4. Average response time: for each conversation, look at inbound msg -> next outbound msg
    // Group messages by conversation, sorted by time
    const msgsByConv = {};
    for (const m of messages) {
      if (!msgsByConv[m.conversation_id]) msgsByConv[m.conversation_id] = [];
      msgsByConv[m.conversation_id].push(m);
    }
    let totalResponseMs = 0;
    let responseCount = 0;
    for (const convId of Object.keys(msgsByConv)) {
      const arr = msgsByConv[convId].slice().sort(
        (a, b) => new Date(a.created_date) - new Date(b.created_date)
      );
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].direction === 'IN') {
          // find next OUT
          for (let j = i + 1; j < arr.length; j++) {
            if (arr[j].direction === 'OUT') {
              const diff = new Date(arr[j].created_date) - new Date(arr[i].created_date);
              // ignore absurd gaps (>1h) to avoid skew from abandoned chats
              if (diff >= 0 && diff <= 60 * 60 * 1000) {
                totalResponseMs += diff;
                responseCount++;
              }
              break;
            }
            if (arr[j].direction === 'IN') break; // consecutive inbound, wait for the relevant one
          }
        }
      }
    }
    const avgResponseSeconds = responseCount > 0 ? Math.round(totalResponseMs / responseCount / 1000) : null;

    return Response.json({
      period: {
        start: firstDate ? firstDate.toISOString() : null,
        end: lastDate ? lastDate.toISOString() : null
      },
      totals: {
        total_messages: messages.length,
        total_conversations: conversations.length,
        unique_customers_who_talked: customersWhoTalked.size
      },
      schedule: {
        after_hours_weekday: afterHoursWeekday.size,
        weekend_window_sat12_to_mon8: weekendWindow.size
      },
      automation: {
        customers_100_percent_ai: customers100AI.length,
        customers_with_human_intervention: customersWithHandoff.size,
        customers_with_quote_by_ai: customersWithQuote.size,
        customers_with_pickup_by_ai: customersWithAIPickup.size
      },
      media: {
        customers_sent_doc_pix_receipt: customersSentDoc.size,
        customers_sent_images_clothes: customersSentImage.size
      },
      response_time: {
        avg_response_seconds: avgResponseSeconds,
        sample_size: responseCount
      }
    });
  } catch (error) {
    console.error('chatFullReport error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});