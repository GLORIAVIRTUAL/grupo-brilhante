import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Check authentication
        const user = await base44.auth.me();
        if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { 
                status: 401,
                headers: { "Content-Type": "application/json" }
            });
        }

        const bags = [
            {
                name: "Minha Bag (até 18 peças)",
                description: "Perfeita para uma pessoa. R$ 5,00/peça.",
                family: "Bags",
                category: "Bags",
                price: 90.00
            },
            {
                name: "Bag (até 35 peças)",
                description: "Ideal para duas pessoas. R$ 4,57/peça.",
                family: "Bags",
                category: "Bags",
                price: 160.00
            },
            {
                name: "Bag Família (até 50 peças)",
                description: "Feita para toda a família. R$ 3,70/peça.",
                family: "Bags",
                category: "Bags",
                price: 185.00
            }
        ];

        const results = [];

        for (const item of bags) {
            // Check if exists
            const existing = await base44.entities.Product.filter({ name: item.name });
            if (existing.length === 0) {
                await base44.entities.Product.create(item);
                results.push({ status: "created", name: item.name });
            } else {
                // Update description and other fields
                await base44.entities.Product.update(existing[0].id, {
                    description: item.description,
                    family: item.family,
                    category: item.category,
                    price: item.price
                });
                results.push({ status: "updated", name: item.name });
            }
        }

        return new Response(JSON.stringify({ success: true, results }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
});