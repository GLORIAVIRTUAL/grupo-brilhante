import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Updates customers whose name is "Novo Cliente" / "Cliente" / empty by querying
// the Z-API contacts endpoint for the real WhatsApp profile name.
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        await enforceExistingUserSecurity(base44, req, user, { source: 'refreshCustomerNames' });
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const { customer_ids } = await req.json().catch(() => ({ customer_ids: [] }));
        if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
            return Response.json({ updated: [] });
        }

        const instanceId = Deno.env.get("ZAPI_INSTANCE_ID");
        const zapiToken = Deno.env.get("ZAPI_TOKEN");
        const clientToken = Deno.env.get("ZAPI_SECURITY_TOKEN");
        if (!instanceId || !zapiToken) {
            return Response.json({ error: "Z-API credentials missing" }, { status: 500 });
        }

        const isInvalidName = (n) => !n ||
            n.toLowerCase().includes('@lid') ||
            n.toLowerCase().includes('@s.whatsapp.net') ||
            /^\+?\d{8,}$/.test(n.replace(/\s/g, ''));

        const updated = [];
        // Process sequentially with a cap per call to avoid Z-API rate limits.
        const ids = customer_ids.slice(0, 500);

        for (const id of ids) {
            try {
                const customer = await base44.asServiceRole.entities.Customer.get(id);
                if (!customer) continue;
                const currentName = (customer.full_name || '').trim().toLowerCase();
                const needsUpdate = !currentName || currentName === 'cliente' || currentName === 'novo cliente';
                if (!needsUpdate) continue;

                const phone = customer.phones?.find(p => p && !p.includes('@') && p.replace(/\D/g, '').length >= 10);
                if (!phone) continue;

                const res = await fetch(
                    `https://api.z-api.io/instances/${instanceId}/token/${zapiToken}/contacts/${phone}`,
                    { headers: { "client-token": clientToken || "" } }
                );
                if (!res.ok) continue;
                const data = await res.json();
                const fetchedName = (data?.name || data?.short || data?.notify || data?.pushname || '').toString().trim();

                if (fetchedName && !isInvalidName(fetchedName)) {
                    await base44.asServiceRole.entities.Customer.update(id, { full_name: fetchedName });
                    updated.push({ id, full_name: fetchedName });
                }
            } catch (err) {
                console.warn(`Skipping customer ${id}:`, err.message);
            }
        }

        return Response.json({ updated, checked: ids.length });
    } catch (error) {
        console.error("refreshCustomerNames error:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});