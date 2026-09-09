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

        const promoPackages = [
            {
                name: "Plano 1 - R$150 + Bônus",
                description: "Pague R$ 150,00 e ganhe R$ 15,00 de bônus. Crédito total: R$ 165,00.",
                family: "Planos",
                category: "Planos",
                price: 150.00
            },
            {
                name: "Plano 2 - R$300 + Bônus",
                description: "Pague R$ 300,00 e ganhe R$ 35,00 de bônus. Crédito total: R$ 335,00.",
                family: "Planos",
                category: "Planos",
                price: 300.00
            },
            {
                name: "Plano 3 - R$500 + Bônus",
                description: "Pague R$ 500,00 e ganhe R$ 75,00 de bônus. Crédito total: R$ 575,00.",
                family: "Planos",
                category: "Planos",
                price: 500.00
            }
        ];

        const results = [];

        for (const pkg of promoPackages) {
            // Check if exists
            const existing = await base44.entities.Product.filter({ name: pkg.name });
            if (existing.length === 0) {
                await base44.entities.Product.create(pkg);
                results.push({ status: "created", name: pkg.name });
            } else {
                // Update description and other fields
                await base44.entities.Product.update(existing[0].id, {
                    description: pkg.description,
                    family: pkg.family,
                    category: pkg.category,
                    price: pkg.price
                });
                results.push({ status: "updated", name: pkg.name });
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