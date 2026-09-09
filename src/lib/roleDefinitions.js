// Papéis e permissões usados pelo front-end.
// Espelha base44/shared/accessGovernance.js, que só o backend pode importar.
export const ROLE_DEFINITIONS = {
  super_admin: { label: 'Super administrador', permissions: ['*'] },
  admin: { label: 'Administrador', permissions: ['*'] },
  manager: { label: 'Gerente', permissions: ['audit.view', 'prices.manage', 'catalogs.manage', 'reports.view', 'crm.manage', 'loyalty.manage', 'fleet.manage', 'cash.approve', 'quotes.discount_override'] },
  attendant: { label: 'Atendimento', permissions: ['customers.manage', 'quotes.manage', 'orders.view', 'deliveries.complete', 'loyalty.view'] },
  cashier: { label: 'Caixa', permissions: ['payments.receive', 'cash.manage', 'orders.view', 'customer_credit.view', 'loyalty.redeem'] },
  production: { label: 'Produção', permissions: ['production.manage', 'quality.manage', 'orders.view', 'inventory.consume'] },
  driver: { label: 'Motorista', permissions: ['pickups.manage', 'delivery.manage', 'field_route.execute', 'orders.view'] },
  inventory: { label: 'Estoque', permissions: ['inventory.manage', 'inventory.recipes', 'documents.review', 'reports.stock'] },
  finance: { label: 'Financeiro', permissions: ['finance.approve', 'finance.pay', 'payments.confirm', 'billing.manage', 'billing.close', 'fiscal.manage', 'reports.finance'] },
  auditor: { label: 'Auditoria', permissions: ['audit.view', 'audit.export', 'reports.view_all'] },
};

const VALID_ROLES = new Set(Object.keys(ROLE_DEFINITIONS));

export function normalizeLegacyRole(role) {
  if (role === 'user') return 'attendant';
  if (role === 'entregador' || role === 'coletas') return 'driver';
  return VALID_ROLES.has(role) ? role : 'attendant';
}