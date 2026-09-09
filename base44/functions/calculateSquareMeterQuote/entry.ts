import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

// Regras de cálculo por metro quadrado (fonte única de verdade — usada pelo painel e pelo chatbot Glória).
// product_type: 'cortina' | 'tapete_quad' | 'tapete_circular'
// cortina_tipo: 'I' | 'II' | 'III' (apenas para cortina)
const PI = 3.14;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function compute({ product_type, width, length, diameter, cortina_tipo }, prices) {
    const CORTINA_PRICES = { I: prices.cortina_tipo_I, II: prices.cortina_tipo_II, III: prices.cortina_tipo_III };
    const TAPETE_PRICE = prices.tapete;
    const w = Number(width);
    const l = Number(length);
    const d = Number(diameter);

    if (product_type === 'cortina') {
        const tipo = (cortina_tipo || 'I').toUpperCase();
        const unitPrice = CORTINA_PRICES[tipo];
        if (!unitPrice) throw new Error('Tipo de cortina inválido. Use I, II ou III.');
        if (!(w > 0) || !(l > 0)) throw new Error('Informe altura e comprimento maiores que zero.');
        const area = round2(w * l);
        return {
            product_label: `Cortina Tipo ${tipo}`,
            area,
            unit_price: unitPrice,
            total: round2(area * unitPrice),
            delivery_estimate: '3 a 5 dias úteis'
        };
    }

    if (product_type === 'tapete_quad') {
        if (!(w > 0) || !(l > 0)) throw new Error('Informe altura e comprimento maiores que zero.');
        const area = round2(w * l);
        return {
            product_label: 'Tapete quadrangular/retangular',
            area,
            unit_price: TAPETE_PRICE,
            total: round2(area * TAPETE_PRICE),
            delivery_estimate: '10 a 15 dias'
        };
    }

    if (product_type === 'tapete_circular') {
        if (!(d > 0)) throw new Error('Informe o diâmetro maior que zero.');
        const area = round2((PI * d * d) / 4);
        return {
            product_label: 'Tapete circular',
            area,
            unit_price: TAPETE_PRICE,
            total: round2(area * TAPETE_PRICE),
            delivery_estimate: '10 a 15 dias'
        };
    }

    throw new Error('Tipo de produto inválido.');
}

Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        await authorizeUserOrInternal(base44, req, body, { source: 'calculateSquareMeterQuote' });

        // Lê os preços por m² do banco (fonte única — editável nas Configurações).
        const records = await base44.asServiceRole.entities.SquareMeterPricing.list('', 1);
        const prices = records[0] || { cortina_tipo_I: 30, cortina_tipo_II: 45, cortina_tipo_III: 65, tapete: 80 };

        const result = compute(body, prices);
        return Response.json({ success: true, ...result });
    } catch (error) {
        if (error?.name === 'SecurityError') return securityErrorResponse(error);
        return Response.json({ success: false, error: error.message }, { status: 400 });
    }
});