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

        const specialServices = [
            {
                name: "Branco+",
                description: "Brancura extrema e alvejamento seguro para coloridas sem danificar a fibra.",
                family: "Tratamentos",
                category: "Especial",
                price: 0.00
            },
            {
                name: "Revitalizante",
                description: "Recupera o brilho e a intensidade das cores e a maciez do toque.",
                family: "Tratamentos",
                category: "Especial",
                price: 0.00
            },
            {
                name: "Bactericida",
                description: "Higienização profunda (99,9%) e eliminação de odores e alérgenos.",
                family: "Tratamentos",
                category: "Especial",
                price: 0.00
            },
            {
                name: "Engomagem",
                description: "Acabamento profissional, vincos perfeitos e economia de tempo.",
                family: "Tratamentos",
                category: "Especial",
                price: 0.00
            },
            {
                name: "Impermeabilização",
                description: "Proteção invisível contra líquidos e manchas em roupas e estofados.",
                family: "Tratamentos",
                category: "Especial",
                price: 0.00
            }
        ];

        const results = [];

        for (const service of specialServices) {
            // Check if exists
            const existing = await base44.entities.Product.filter({ name: service.name });
            if (existing.length === 0) {
                await base44.entities.Product.create(service);
                results.push({ status: "created", name: service.name });
            } else {
                // Update description if it changed
                await base44.entities.Product.update(existing[0].id, {
                    description: service.description,
                    family: service.family,
                    category: service.category
                });
                results.push({ status: "updated", name: service.name });
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