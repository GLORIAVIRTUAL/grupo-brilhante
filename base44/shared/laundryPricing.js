function asMoney(value) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

function activeAt(rule, now) {
  if (rule.active === false) return false;
  if (rule.valid_from && new Date(rule.valid_from) > now) return false;
  if (rule.valid_until && new Date(rule.valid_until) < now) return false;
  return true;
}

function ruleSpecificity(rule, context) {
  let score = 0;
  if (rule.unit_id) {
    if (rule.unit_id !== context.unitId) return -1;
    score += 16;
  }
  if (rule.product_id) {
    if (rule.product_id !== context.productId) return -1;
    score += 8;
  }
  if (rule.service_id) {
    if (rule.service_id !== context.serviceId) return -1;
    score += 4;
  }
  if (rule.customer_group) {
    if (rule.customer_group !== context.customerGroup) return -1;
    score += 2;
  }
  if (rule.priority) {
    if (rule.priority !== context.priority) return -1;
    score += 1;
  }
  return score;
}

function calculateRulePrice(basePrice, rule) {
  if (!rule) return asMoney(basePrice);
  const explicitBase = Number.isFinite(Number(rule.base_price)) ? Number(rule.base_price) : Number(basePrice || 0);
  const withPercent = explicitBase * (1 + Math.max(0, Number(rule.additional_percent || 0)) / 100);
  const withAddition = withPercent + Number(rule.additional_amount || 0);
  return asMoney(Math.max(Number(rule.minimum_price || 0), withAddition));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export async function loadLaundryPricingCatalog(base44, { unitId, customerId } = {}) {
  const [products, services, rules, customer] = await Promise.all([
    base44.asServiceRole.entities.Product.list('name', 2000),
    base44.asServiceRole.entities.LaundryService.list('name', 2000),
    base44.asServiceRole.entities.PriceRule.filter({ active: true }, '-valid_from', 5000),
    customerId ? base44.asServiceRole.entities.Customer.get(customerId).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    products: products.filter((product) => product.active !== false),
    services: services.filter((service) => service.active !== false && (!service.unit_id || service.unit_id === unitId)),
    rules,
    customerGroup: customer?.customer_group || customer?.billing_agreement_id || customer?.agreement_id || customer?.metadata?.customer_group || null,
  };
}

export function priceGarmentItems({ items, catalog, unitId, priority = 'normal' }) {
  const productsById = new Map(catalog.products.map((product) => [product.id, product]));
  const servicesById = new Map(catalog.services.map((service) => [service.id, service]));
  const now = new Date();
  const activeRules = catalog.rules.filter((rule) => activeAt(rule, now));

  const pricedItems = (items || []).map((requested, index) => {
    const product = productsById.get(requested.product_id);
    if (!product) {
      const error = new Error('product_not_found');
      error.details = { index, product_id: requested.product_id };
      throw error;
    }

    const requestedServices = Array.isArray(requested.services) ? requested.services : [];
    const serviceRequests = requestedServices.length > 0
      ? requestedServices
      : (product.default_service_ids || []).map((serviceId) => ({ service_id: serviceId, quantity: 1 }));

    const normalizedServices = serviceRequests.map((requestedService) => {
      const service = servicesById.get(requestedService.service_id);
      if (!service) {
        const error = new Error('service_not_found');
        error.details = { index, service_id: requestedService.service_id };
        throw error;
      }
      if ((service.compatible_product_ids || []).length > 0 && !service.compatible_product_ids.includes(product.id)) {
        const error = new Error('service_not_compatible');
        error.details = { index, product_id: product.id, service_id: service.id };
        throw error;
      }

      const candidates = activeRules
        .map((rule) => ({ rule, score: ruleSpecificity(rule, {
          unitId,
          productId: product.id,
          serviceId: service.id,
          customerGroup: catalog.customerGroup,
          priority,
        }) }))
        .filter((candidate) => candidate.score >= 0)
        .sort((left, right) => right.score - left.score || String(right.rule.valid_from || '').localeCompare(String(left.rule.valid_from || '')));
      const selectedRule = candidates[0]?.rule;
      const quantity = Math.max(1, Math.floor(Number(requestedService.quantity || 1)));
      const unitPrice = calculateRulePrice(service.base_price, selectedRule);

      return {
        service_id: service.id,
        name: service.name,
        code: service.code,
        category: service.category,
        quantity,
        unit_price: unitPrice,
        total_amount: asMoney(unitPrice * quantity),
        estimated_minutes: Math.max(0, Number(service.estimated_minutes || 0)) * quantity,
        production_steps: service.production_steps || [],
        requires_third_party: service.requires_third_party === true,
        requires_customer_acceptance: service.requires_customer_acceptance === true,
        price_rule_id: selectedRule?.id || null,
        price_source: selectedRule ? 'price_rule' : 'service_catalog',
      };
    });

    const hasServices = normalizedServices.length > 0;
    const unitPrice = hasServices
      ? asMoney(normalizedServices.reduce((sum, service) => sum + service.total_amount, 0))
      : asMoney(product.price);
    const quantity = Math.max(1, Math.floor(Number(requested.qty || 1)));
    const subtotal = asMoney(unitPrice * quantity);

    return {
      ...requested,
      product_id: product.id,
      garment_type: product.name,
      qty: quantity,
      unit_price: unitPrice,
      subtotal,
      total_amount: subtotal,
      services: normalizedServices,
      pricing: {
        source: hasServices ? 'service_composition' : 'legacy_product_price',
        catalog_version: product.catalog_version || '1',
        priced_at: now.toISOString(),
      },
      estimated_minutes: normalizedServices.reduce((sum, service) => sum + service.estimated_minutes, 0),
      production_steps: unique(normalizedServices.flatMap((service) => service.production_steps)),
      requires_customer_acceptance: normalizedServices.some((service) => service.requires_customer_acceptance),
      requires_third_party: normalizedServices.some((service) => service.requires_third_party),
    };
  });

  return {
    items: pricedItems,
    subtotal: asMoney(pricedItems.reduce((sum, item) => sum + item.total_amount, 0)),
    currency: 'BRL',
    priced_at: now.toISOString(),
  };
}
