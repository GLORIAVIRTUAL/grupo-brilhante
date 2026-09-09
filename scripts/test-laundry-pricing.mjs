import assert from 'node:assert/strict';
import { priceGarmentItems } from '../base44/shared/laundryPricing.js';

const catalog = {
  customerGroup: 'VIP',
  products: [
    { id: 'P1', name: 'Calça', price: 20, catalog_version: '3', default_service_ids: [] },
    { id: 'P2', name: 'Tapete', price: 50, catalog_version: '1', default_service_ids: [] },
  ],
  services: [
    { id: 'S1', name: 'Lavagem', code: 'LAV', category: 'cleaning', base_price: 10, estimated_minutes: 30, production_steps: ['washing'], compatible_product_ids: ['P1'] },
    { id: 'S2', name: 'Passadoria', code: 'PAS', category: 'ironing', base_price: 5, estimated_minutes: 15, production_steps: ['ironing'], compatible_product_ids: ['P1'] },
  ],
  rules: [
    { id: 'R-GLOBAL', active: true, service_id: 'S2', base_price: 6 },
    { id: 'R-SPECIFIC', active: true, unit_id: 'U1', product_id: 'P1', service_id: 'S2', customer_group: 'VIP', priority: 'urgent', base_price: 7, additional_percent: 10 },
  ],
};

const composed = priceGarmentItems({
  unitId: 'U1', priority: 'urgent', catalog,
  items: [{ product_id: 'P1', qty: 1, unit_price: 0.01, services: [{ service_id: 'S1' }, { service_id: 'S2' }] }],
});
assert.equal(composed.items[0].services.length, 2);
assert.equal(composed.items[0].services[0].unit_price, 10);
assert.equal(composed.items[0].services[1].unit_price, 7.7);
assert.equal(composed.items[0].unit_price, 17.7);
assert.equal(composed.subtotal, 17.7);
assert.deepEqual(composed.items[0].production_steps, ['washing', 'ironing']);
assert.equal(composed.items[0].pricing.source, 'service_composition');

const legacy = priceGarmentItems({ unitId: 'U1', catalog, items: [{ product_id: 'P1', qty: 2, unit_price: 0.01, services: [] }] });
assert.equal(legacy.items[0].unit_price, 20);
assert.equal(legacy.items[0].subtotal, 40);
assert.equal(legacy.items[0].pricing.source, 'legacy_product_price');

assert.throws(() => priceGarmentItems({
  unitId: 'U1', catalog,
  items: [{ product_id: 'P2', qty: 1, services: [{ service_id: 'S1' }] }],
}), (error) => error.message === 'service_not_compatible');

console.log('PRECIFICAÇÃO OK: composição, regras específicas, fallback e compatibilidade verificados.');
