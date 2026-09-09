// Papéis e permissões usados pelo front-end.
// Espelha base44/shared/accessGovernance.js, que só o backend pode importar.
export const ROLE_DEFINITIONS = {
  super_admin: { label: 'Super administrador', permissions: ['*'] },
  admin: { label: 'Administrador', permissions: ['*'] },
  manager: { label: 'Gerente', permissions: ['companies.view', 'cost_centers.manage', 'parties.view', 'parties.manage', 'contracts.view', 'contracts.manage', 'service_orders.view', 'service_orders.approve', 'purchases.view', 'purchases.manage', 'purchases.approve', 'inventory.view', 'audit.view', 'prices.manage', 'catalogs.manage', 'reports.view', 'crm.manage', 'loyalty.manage', 'fleet.manage', 'cash.approve', 'quotes.discount_override'] },
  attendant: { label: 'Atendimento', permissions: ['parties.view', 'contracts.view', 'service_orders.view', 'customers.manage', 'quotes.manage', 'orders.view', 'deliveries.complete', 'loyalty.view'] },
  cashier: { label: 'Caixa', permissions: ['payments.receive', 'cash.manage', 'orders.view', 'customer_credit.view', 'loyalty.redeem'] },
  production: { label: 'Produção', permissions: ['service_orders.view', 'service_orders.execute', 'hospital.view', 'hospital.weigh', 'linen.view', 'production.manage', 'quality.manage', 'orders.view', 'inventory.consume'] },
  driver: { label: 'Motorista', permissions: ['service_orders.view', 'linen.view', 'pickups.manage', 'delivery.manage', 'field_route.execute', 'orders.view'] },
  inventory: { label: 'Estoque', permissions: ['companies.view', 'purchases.view', 'purchases.manage', 'receipts.manage', 'linen.view', 'linen.manage', 'inventory.view', 'inventory.manage', 'inventory.transfer', 'inventory.recipes', 'documents.review', 'reports.stock'] },
  finance: { label: 'Financeiro', permissions: ['companies.view', 'cost_centers.manage', 'bank_accounts.manage', 'purchases.view', 'purchases.approve', 'contracts.view', 'finance.view', 'finance.manage', 'finance.approve', 'finance.pay', 'finance.close_period', 'banking.view', 'banking.manage', 'banking.reconcile', 'payments.confirm', 'billing.manage', 'billing.close', 'fiscal.view', 'fiscal.manage', 'reports.finance', 'migration.view', 'migration.execute'] },
  auditor: { label: 'Auditoria', permissions: ['audit.view', 'audit.export', 'reports.view_all', 'migration.view', 'purchases.view', 'inventory.view'] },
};

const VALID_ROLES = new Set(Object.keys(ROLE_DEFINITIONS));

export function normalizeLegacyRole(role) {
  if (role === 'user') return 'attendant';
  if (role === 'entregador' || role === 'coletas') return 'driver';
  return VALID_ROLES.has(role) ? role : 'attendant';
}