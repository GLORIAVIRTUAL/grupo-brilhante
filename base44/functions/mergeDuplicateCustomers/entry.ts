import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Reduces a phone to its canonical Brazilian form (DDI 55 + DDD + 8-digit base, without extra 9).
const canonicalPhone = (raw) => {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
    if (d.startsWith('55') && d.length === 13 && d[4] === '9') {
        d = d.substring(0, 4) + d.substring(5);
    }
    return d;
};

const isPlaceholderName = (n) => {
    const name = (n || '').trim();
    return !name ||
        name === 'Cliente' ||
        name === 'Novo Cliente' ||
        name.toLowerCase().includes('@lid') ||
        name.toLowerCase().includes('@s.whatsapp.net') ||
        /^\+?\d{8,}$/.test(name.replace(/\s/g, ''));
};

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        await enforceExistingUserSecurity(base44, req, user, { source: 'mergeDuplicateCustomers' });
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const dryRun = body.dryRun === true;
        const batchSize = Number(body.batchSize) || 15; // process N duplicate groups per run
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        // Load all customers (paginate to be safe)
        let allCustomers = [];
        let skip = 0;
        const pageSize = 500;
        while (true) {
            const page = await base44.asServiceRole.entities.Customer.list('-created_date', pageSize, skip);
            allCustomers = allCustomers.concat(page);
            if (page.length < pageSize) break;
            skip += pageSize;
        }

        // Group by canonical phone
        const groups = {};
        for (const c of allCustomers) {
            const phones = (c.phones || []).filter(p => p && !String(p).includes('@'));
            const keys = [...new Set(phones.map(canonicalPhone).filter(Boolean))];
            for (const key of keys) {
                if (!groups[key]) groups[key] = [];
                if (!groups[key].includes(c)) groups[key].push(c);
            }
        }

        // Only the groups that actually have duplicates
        const dupGroups = Object.entries(groups).filter(([, customers]) => customers.length >= 2);
        const totalDupGroups = dupGroups.length;
        // Process only a batch per run (to respect rate limits). Remaining groups are reported.
        const batch = dryRun ? dupGroups : dupGroups.slice(0, batchSize);

        const merges = [];

        for (const [key, customers] of batch) {
            if (customers.length < 2) continue;

            // Pick the "master": prefer real name, then oldest record (most history/links).
            const sorted = [...customers].sort((a, b) => {
                const aReal = isPlaceholderName(a.full_name) ? 1 : 0;
                const bReal = isPlaceholderName(b.full_name) ? 1 : 0;
                if (aReal !== bReal) return aReal - bReal; // real name first
                return new Date(a.created_date) - new Date(b.created_date); // oldest first
            });
            const master = sorted[0];
            const duplicates = sorted.slice(1);

            const masterBestName = !isPlaceholderName(master.full_name)
                ? master.full_name
                : (duplicates.find(d => !isPlaceholderName(d.full_name))?.full_name || master.full_name);

            const mergeInfo = {
                canonical_phone: key,
                master_id: master.id,
                master_name: masterBestName,
                duplicate_ids: duplicates.map(d => d.id),
                moved_conversations: 0,
                moved_quotes: 0,
                moved_orders: 0,
                moved_payments: 0,
                moved_pickups: 0,
                moved_crmcards: 0,
            };

            if (!dryRun) {
                // Update master with best name + canonical phone
                const masterPhones = [...new Set([key, ...(master.phones || []).filter(p => p && !String(p).includes('@')).map(canonicalPhone)])].filter(Boolean);
                await base44.asServiceRole.entities.Customer.update(master.id, {
                    full_name: masterBestName,
                    phones: masterPhones,
                });

                for (const dup of duplicates) {
                    // Re-point all linked records from duplicate -> master
                    const [convs, quotes, orders, payments, pickups, cards] = await Promise.all([
                        base44.asServiceRole.entities.Conversation.filter({ customer_id: dup.id }),
                        base44.asServiceRole.entities.Quote.filter({ customer_id: dup.id }),
                        base44.asServiceRole.entities.Order.filter({ customer_id: dup.id }),
                        base44.asServiceRole.entities.Payment.filter({ customer_id: dup.id }),
                        base44.asServiceRole.entities.Pickup.filter({ customer_id: dup.id }),
                        base44.asServiceRole.entities.CrmCard.filter({ customer_id: dup.id }),
                    ]);

                    for (const r of convs) { await base44.asServiceRole.entities.Conversation.update(r.id, { customer_id: master.id }); mergeInfo.moved_conversations++; }
                    for (const r of quotes) { await base44.asServiceRole.entities.Quote.update(r.id, { customer_id: master.id }); mergeInfo.moved_quotes++; }
                    for (const r of orders) { await base44.asServiceRole.entities.Order.update(r.id, { customer_id: master.id }); mergeInfo.moved_orders++; }
                    for (const r of payments) { await base44.asServiceRole.entities.Payment.update(r.id, { customer_id: master.id }); mergeInfo.moved_payments++; }
                    for (const r of pickups) { await base44.asServiceRole.entities.Pickup.update(r.id, { customer_id: master.id }); mergeInfo.moved_pickups++; }
                    for (const r of cards) { await base44.asServiceRole.entities.CrmCard.update(r.id, { customer_id: master.id }); mergeInfo.moved_crmcards++; }

                    // Delete the duplicate customer
                    await base44.asServiceRole.entities.Customer.delete(dup.id);
                    await sleep(150);
                }
                await sleep(300);
            }

            merges.push(mergeInfo);
        }

        return Response.json({
            status: 'ok',
            dry_run: dryRun,
            total_customers: allCustomers.length,
            duplicate_groups_total: totalDupGroups,
            processed_this_run: merges.length,
            remaining: dryRun ? totalDupGroups : Math.max(0, totalDupGroups - merges.length),
            merges
        });
    } catch (error) {
        console.error('Error in mergeDuplicateCustomers:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});