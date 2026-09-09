export const ROLE_DEFINITIONS = {
  super_admin: { label: 'Super administrador', permissions: ['*'], mfaRequired: true },
  admin: { label: 'Administrador', permissions: ['*'], mfaRequired: true },
  manager: { label: 'Gerente', permissions: ['companies.view', 'cost_centers.manage', 'parties.view', 'parties.manage', 'contracts.view', 'contracts.manage', 'service_orders.view', 'service_orders.approve', 'purchases.view', 'purchases.manage', 'purchases.approve', 'inventory.view', 'audit.view', 'prices.manage', 'catalogs.manage', 'reports.view', 'crm.manage', 'loyalty.manage', 'fleet.manage', 'cash.approve', 'quotes.discount_override'], mfaRequired: true },
  attendant: { label: 'Atendimento', permissions: ['parties.view', 'contracts.view', 'service_orders.view', 'customers.manage', 'quotes.manage', 'orders.view', 'deliveries.complete', 'loyalty.view'], mfaRequired: false },
  cashier: { label: 'Caixa', permissions: ['payments.receive', 'cash.manage', 'orders.view', 'customer_credit.view', 'loyalty.redeem'], mfaRequired: false },
  production: { label: 'Produção', permissions: ['service_orders.view', 'service_orders.execute', 'hospital.view', 'hospital.weigh', 'linen.view', 'production.manage', 'quality.manage', 'orders.view', 'inventory.consume'], mfaRequired: false },
  driver: { label: 'Motorista', permissions: ['service_orders.view', 'linen.view', 'pickups.manage', 'delivery.manage', 'field_route.execute', 'orders.view'], mfaRequired: false },
  inventory: { label: 'Estoque', permissions: ['companies.view', 'purchases.view', 'purchases.manage', 'receipts.manage', 'linen.view', 'linen.manage', 'inventory.view', 'inventory.manage', 'inventory.transfer', 'inventory.recipes', 'documents.review', 'reports.stock'], mfaRequired: false },
  finance: { label: 'Financeiro', permissions: ['companies.view', 'cost_centers.manage', 'bank_accounts.manage', 'purchases.view', 'purchases.approve', 'contracts.view', 'finance.view', 'finance.manage', 'finance.approve', 'finance.pay', 'finance.close_period', 'banking.view', 'banking.manage', 'banking.reconcile', 'payments.confirm', 'billing.manage', 'billing.close', 'fiscal.view', 'fiscal.manage', 'reports.finance', 'migration.view', 'migration.execute'], mfaRequired: true },
  auditor: { label: 'Auditoria', permissions: ['audit.view', 'audit.export', 'reports.view_all', 'migration.view', 'purchases.view', 'inventory.view'], mfaRequired: true },
};

export const PERMISSION_CATALOG = [
  ['users.manage', 'Administrar usuários e acessos', 'governance', true],
  ['users.manage_limited', 'Administrar usuários da própria unidade', 'governance', true],
  ['companies.view', 'Consultar empresas do próprio escopo', 'governance', false],
  ['companies.view_all', 'Consultar todas as empresas do grupo', 'governance', true],
  ['companies.manage', 'Administrar empresas e unidades', 'governance', true],
  ['cost_centers.manage', 'Administrar centros de custo', 'finance', true],
  ['bank_accounts.manage', 'Administrar cadastros de contas bancárias', 'banking', true],
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
  ['inventory.view', 'Consultar estoque do próprio escopo', 'inventory', false],
  ['inventory.manage', 'Administrar estoque', 'inventory', false],
  ['inventory.transfer', 'Expedir e receber transferências de estoque', 'inventory', true],
  ['inventory.consume', 'Registrar consumo', 'inventory', false],
  ['inventory.recipes', 'Administrar fichas técnicas', 'inventory', true],
  ['documents.review', 'Revisar documentos extraídos', 'documents', true],
  ['parties.view', 'Consultar cadastro unificado', 'commercial', false],
  ['parties.manage', 'Administrar cadastro unificado', 'commercial', false],
  ['party_documents.manage', 'Administrar documentos cadastrais', 'documents', true],
  ['contracts.view', 'Consultar contratos', 'commercial', false],
  ['contracts.manage', 'Administrar contratos', 'commercial', true],
  ['contracts.approve', 'Aprovar contratos e aditivos', 'commercial', true],
  ['service_orders.view', 'Consultar ordens de serviço', 'operations', false],
  ['service_orders.execute', 'Executar ordens de serviço', 'operations', false],
  ['service_orders.approve', 'Aprovar conclusão e medição de ordens', 'operations', true],
  ['finance.view', 'Consultar financeiro empresarial', 'finance', false],
  ['finance.manage', 'Administrar lançamentos financeiros', 'finance', true],
  ['finance.close_period', 'Fechar período financeiro', 'finance', true],
  ['banking.view', 'Consultar cobranças e conciliação bancária', 'banking', false],
  ['banking.manage', 'Administrar integrações e cobranças bancárias', 'banking', true],
  ['banking.reconcile', 'Conciliar eventos bancários', 'banking', true],
  ['fiscal.view', 'Consultar documentos fiscais', 'fiscal', false],
  ['fiscal.transmit', 'Transmitir e cancelar documento fiscal', 'fiscal', true],
  ['purchases.view', 'Consultar compras', 'purchases', false],
  ['purchases.manage', 'Administrar solicitações e pedidos de compra', 'purchases', true],
  ['purchases.approve', 'Aprovar compras', 'purchases', true],
  ['receipts.manage', 'Registrar recebimentos de mercadoria', 'purchases', false],
  ['hospital.view', 'Consultar operação hospitalar', 'hospital', false],
  ['hospital.weigh', 'Registrar pesagem hospitalar', 'hospital', false],
  ['hospital.quality', 'Aprovar qualidade hospitalar', 'hospital', true],
  ['hospital.bill', 'Fechar medição hospitalar', 'hospital', true],
  ['linen.view', 'Consultar enxovais', 'linen', false],
  ['linen.manage', 'Administrar enxovais', 'linen', false],
  ['linen.inventory', 'Executar inventário de enxovais', 'linen', false],
  ['linen.charge_loss', 'Aprovar cobrança por perda de enxoval', 'linen', true],
  ['cleaning.view', 'Consultar operação de limpeza', 'cleaning', false],
  ['cleaning.manage', 'Administrar locais, postos e escalas', 'cleaning', true],
  ['cleaning.inspect', 'Executar inspeções de limpeza', 'cleaning', false],
  ['cleaning.measure', 'Fechar medição de limpeza', 'cleaning', true],
  ['migration.view', 'Consultar migrações', 'migration', true],
  ['migration.execute', 'Executar migração em staging ou dry-run', 'migration', true],
  ['migration.approve', 'Aprovar importação definitiva', 'migration', true],
  ['integrations.view', 'Consultar saúde das integrações', 'integration', true],
  ['integrations.manage', 'Administrar configurações de integração', 'integration', true],
  ['repairs.manage', 'Resolver falhas parciais e tarefas de reparo', 'system', true],
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
  const unitIds = [user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean);
  const legalEntityIds = [user?.primary_legal_entity_id, ...(user?.allowed_legal_entity_ids || [])].filter(Boolean);
  const applicable = policies.filter((policy) => policy.status === 'active'
    && policy.role === role
    && (!policy.legal_entity_id || legalEntityIds.includes(policy.legal_entity_id))
    && (!policy.unit_id || unitIds.includes(policy.unit_id)));
  for (const policy of applicable) {
    for (const permission of policy.permissions || []) base.add(permission);
    for (const permission of policy.denied_permissions || []) base.delete(permission);
  }
  return [...base];
}