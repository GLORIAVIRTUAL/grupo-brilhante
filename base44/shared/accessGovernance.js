export const ROLE_DEFINITIONS = {
  super_admin: { label: 'Super administrador', permissions: ['*'], mfaRequired: true },
  admin: { label: 'Administrador', permissions: ['*'], mfaRequired: true },
  manager: { label: 'Gerente', permissions: ['audit.view', 'prices.manage', 'catalogs.manage', 'reports.view', 'crm.manage', 'loyalty.manage', 'fleet.manage', 'cash.approve', 'quotes.discount_override'], mfaRequired: true },
  attendant: { label: 'Atendimento', permissions: ['customers.manage', 'quotes.manage', 'orders.view', 'deliveries.complete', 'loyalty.view'], mfaRequired: false },
  cashier: { label: 'Caixa', permissions: ['payments.receive', 'cash.manage', 'orders.view', 'customer_credit.view', 'loyalty.redeem'], mfaRequired: false },
  production: { label: 'Produção', permissions: ['production.manage', 'quality.manage', 'orders.view', 'inventory.consume'], mfaRequired: false },
  driver: { label: 'Motorista', permissions: ['pickups.manage', 'delivery.manage', 'field_route.execute', 'orders.view'], mfaRequired: false },
  inventory: { label: 'Estoque', permissions: ['inventory.manage', 'inventory.recipes', 'documents.review', 'reports.stock'], mfaRequired: false },
  finance: { label: 'Financeiro', permissions: ['finance.approve', 'finance.pay', 'payments.confirm', 'billing.manage', 'billing.close', 'fiscal.manage', 'reports.finance'], mfaRequired: true },
  auditor: { label: 'Auditoria', permissions: ['audit.view', 'audit.export', 'reports.view_all'], mfaRequired: true },
};

export const PERMISSION_CATALOG = [
  ['users.manage', 'Administrar usuários e acessos', 'governance', true],
  ['users.manage_limited', 'Administrar usuários da própria unidade', 'governance', true],
  ['audit.view', 'Consultar auditoria', 'governance', true],
  ['audit.export', 'Exportar auditoria', 'governance', true],
  ['prices.manage', 'Administrar regras de preço', 'commercial', true],
  ['prices.activate', 'Ativar versões de preço', 'commercial', true],
  ['catalogs.manage', 'Administrar catálogos operacionais', 'commercial', false],
  ['reports.view', 'Consultar relatórios da unidade', 'analytics', false],
  ['reports.view_all', 'Consultar relatórios consolidados', 'analytics', true],
  ['reports.export', 'Exportar relatórios', 'analytics', true],
  ['crm.manage', 'Administrar CRM 360', 'crm', false],
  ['loyalty.view', 'Consultar fidelidade', 'crm', false],
  ['loyalty.manage', 'Administrar programas e ajustes', 'crm', true],
  ['loyalty.redeem', 'Resgatar pontos, vouchers e pacotes', 'crm', false],
  ['fleet.manage', 'Administrar frota e rotas', 'logistics', true],
  ['field_route.execute', 'Executar rota de campo', 'logistics', false],
  ['customers.manage', 'Administrar clientes', 'operations', false],
  ['quotes.manage', 'Administrar orçamentos', 'operations', false],
  ['quotes.discount_override', 'Autorizar desconto acima da alçada', 'operations', true],
  ['orders.view', 'Consultar pedidos', 'operations', false],
  ['deliveries.complete', 'Concluir entregas', 'operations', false],
  ['delivery.manage', 'Gerenciar entregas', 'logistics', false],
  ['pickups.manage', 'Gerenciar coletas', 'logistics', false],
  ['payments.receive', 'Receber pagamentos', 'finance', false],
  ['payments.confirm', 'Confirmar pagamento pendente', 'finance', true],
  ['cash.manage', 'Operar caixa', 'finance', false],
  ['cash.approve', 'Aprovar divergência de caixa', 'finance', true],
  ['customer_credit.view', 'Consultar crédito do cliente', 'finance', false],
  ['finance.approve', 'Aprovar documentos financeiros', 'finance', true],
  ['finance.pay', 'Liquidar contas a pagar', 'finance', true],
  ['billing.manage', 'Administrar convênios', 'finance', true],
  ['billing.close', 'Fechar faturamento', 'finance', true],
  ['fiscal.manage', 'Preparar documentos fiscais', 'finance', true],
  ['production.manage', 'Operar produção', 'production', false],
  ['quality.manage', 'Administrar qualidade e retrabalho', 'production', false],
  ['inventory.manage', 'Administrar estoque', 'inventory', false],
  ['inventory.consume', 'Registrar consumo', 'inventory', false],
  ['inventory.recipes', 'Administrar fichas técnicas', 'inventory', true],
  ['documents.review', 'Revisar documentos extraídos', 'documents', true],
  ['settings.manage', 'Administrar configurações', 'governance', true],
].map(([code, label, domain, critical]) => ({ code, label, domain, critical }));

export const VALID_ROLES = new Set(Object.keys(ROLE_DEFINITIONS));
export const VALID_PERMISSIONS = new Set(PERMISSION_CATALOG.map((permission) => permission.code));

export function normalizeLegacyRole(role) {
  if (role === 'user') return 'attendant';
  if (role === 'entregador' || role === 'coletas') return 'driver';
  return VALID_ROLES.has(role) ? role : 'attendant';
}

export function effectivePermissions(user, policies = []) {
  const role = normalizeLegacyRole(user?.role);
  const base = new Set(ROLE_DEFINITIONS[role]?.permissions || []);
  for (const permission of user?.permissions || []) base.add(permission);
  const applicable = policies.filter((policy) => policy.status === 'active' && policy.role === role && (!policy.unit_id || [user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].includes(policy.unit_id)));
  for (const policy of applicable) {
    for (const permission of policy.permissions || []) base.add(permission);
    for (const permission of policy.denied_permissions || []) base.delete(permission);
  }
  return [...base];
}