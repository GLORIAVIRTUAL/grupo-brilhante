#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTITIES = ROOT / "base44" / "entities"
FUNCTIONS = ROOT / "base44" / "functions"

NEW_ENTITIES = {
    "AIJob", "AccountsPayable", "AccountsReceivable", "BankTransaction", "CashMovement", "CashSession",
    "ConsumptionRecipe", "DocumentAsset", "FinancialDocument", "GarmentEvent", "GarmentItem", "HumanReview",
    "IntegrationConfiguration", "InventoryCount", "LaundryService", "Location", "PaymentAllocation", "PriceRule",
    "ProcessedEvent", "ProductionBatch", "PurchaseDocument", "PurchaseItem", "QualityInspection", "ReworkCase",
    "StockItem", "StockMovement", "Supplier", "ThirdPartyJob", "ThirdPartyPartner", "DeliveryReceipt",
    "PaymentReceipt", "CustomerCreditLedger", "BillingAgreement", "BillingStatement", "QuoteVersion",
    "FiscalProfile", "FiscalDocument", "FiscalEvent", "StockLot", "ProductionEvent", "LaborEntry",
    "OperationalAlert", "ProductionCostProfile", "AccessPolicy", "UserSessionEvent", "PriceRuleVersion",
    "CommercialApprovalPolicy", "OperationalCatalogEntry", "LoyaltyProgram", "LoyaltyLedger", "Voucher",
    "CustomerPackage", "CustomerPackageLedger", "FleetVehicle", "DeliveryRoute", "RouteStop", "RouteEvent",
}

NEW_FUNCTIONS = {
    "analyze_garment_images", "approve_financial_document", "approve_purchase_document", "approve_quote",
    "cancel_management_record", "extract_financial_document", "extract_purchase_document", "inspect_garment_quality",
    "integration_status", "manage_accounts_payable", "manage_cash_session", "manage_third_party_job",
    "reconcile_payment", "record_counter_payment", "resolve_human_review", "update_garment_status",
    "price_garment_services", "register_label_print", "move_garments", "manage_location", "complete_garment_delivery",
    "manage_payment_receipt", "confirm_payment_tender", "manage_customer_credit", "manage_billing_agreement",
    "close_billing_period", "manage_quote_lifecycle", "manage_fiscal_document", "checkExpiredQuotes",
    "manage_stock_operation", "manage_inventory_count", "manage_consumption_recipe", "post_production_consumption",
    "manage_machine", "manage_production_batch", "manage_labor_entry", "manage_production_cost_profile",
    "manage_operational_alerts", "manage_access_control", "query_audit_log", "manage_pricing_rules",
    "manage_operational_catalog", "manage_loyalty_crm", "generate_specialized_report", "manage_fleet",
    "manage_delivery_route", "manage_order_benefits",
}


def fail(message: str, failures: list[str]) -> None:
    failures.append(message)


def load_json(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"(^|\s)//.*", r"\1", text)
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return json.loads(text)


def main() -> int:
    failures: list[str] = []
    entity_names: dict[str, Path] = {}

    for path in sorted(ENTITIES.glob("*.jsonc")):
        try:
            schema = load_json(path)
        except Exception as error:
            fail(f"Schema inválido {path.relative_to(ROOT)}: {error}", failures)
            continue

        name = schema.get("name")
        properties = schema.get("properties", {})
        if not name or schema.get("type") != "object" or not isinstance(properties, dict):
            fail(f"Schema incompleto {path.relative_to(ROOT)}", failures)
            continue
        if name in entity_names:
            fail(f"Entidade duplicada {name}: {entity_names[name]} e {path}", failures)
        entity_names[name] = path
        for required in schema.get("required", []):
            if required not in properties:
                fail(f"Campo obrigatório inexistente em {name}: {required}", failures)

    missing_entities = sorted(NEW_ENTITIES - set(entity_names))
    if missing_entities:
        fail(f"Entidades ausentes: {', '.join(missing_entities)}", failures)

    for function_name in sorted(NEW_FUNCTIONS):
        entry = FUNCTIONS / function_name / "entry.ts"
        if not entry.exists() or not entry.read_text(encoding="utf-8").strip():
            fail(f"Função ausente: {function_name}", failures)
            continue
        source = entry.read_text(encoding="utf-8")
        if "base44.auth.me()" not in source and "authorizeUserOrInternal" not in source:
            fail(f"Função sem autenticação explícita: {function_name}", failures)
        if "requestId" not in source:
            fail(f"Função sem request_id: {function_name}", failures)

    env_example = ROOT / ".env.example"
    if not env_example.exists():
        fail(".env.example ausente", failures)
    else:
        for line_number, raw_line in enumerate(env_example.read_text(encoding="utf-8").splitlines(), 1):
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if value and value not in {"false", "true"}:
                fail(f"Valor potencialmente sensível em .env.example:{line_number} ({key})", failures)
        env_text = env_example.read_text(encoding="utf-8")
        for key in [
            "INTERNAL_FUNCTION_TOKEN", "ZAPI_SECURITY_TOKEN", "ZAPI_MOINHOS_SECURITY_TOKEN",
            "WHATSAPP_MOINHOS_APP_SECRET", "WHATSAPP_MOINHOS_VERIFY_TOKEN", "MEDIA_DOWNLOAD_HOST_ALLOWLIST",
        ]:
            if f"{key}=" not in env_text:
                fail(f"Variável de segurança ausente em .env.example: {key}", failures)

    for function_name, marker in {
        "aiReplyTrigger": "requireInternalRequest",
        "orchestrator": "requireInternalRequest",
        "scheduled_automations": "requireInternalRequest",
        "checkInactiveNewCustomers": "requireInternalRequest",
        "zapi_webhook_receiver": "requireProviderToken",
        "zapi_moinhos_webhook": "requireProviderToken",
        "whatsapp_moinhos_webhook": "requireMetaSignature",
        "zapi_media_downloader": "requireInternalRequest",
        "openai_vision": "authorizeUserOrInternal",
    }.items():
        source = (FUNCTIONS / function_name / "entry.ts").read_text(encoding="utf-8")
        if marker not in source:
            fail(f"Hardening ausente em {function_name}: {marker}", failures)

    for function_name in ["manage_unit", "check_access_session"]:
        entry = FUNCTIONS / function_name / "entry.ts"
        if not entry.exists() or "authorizeUserOrInternal" not in entry.read_text(encoding="utf-8"):
            fail(f"Função de governança ausente ou sem guard: {function_name}", failures)

    function_security = (ROOT / "base44" / "shared" / "functionSecurity.js").read_text(encoding="utf-8")
    for marker in ["constantTimeEqual", "requireInternalRequest", "requireProviderToken", "requireMetaSignature", "session_revoked_after"]:
        if marker not in function_security:
            fail(f"Guard central sem garantia obrigatória: {marker}", failures)

    orchestrator = (FUNCTIONS / "orchestrator" / "entry.ts").read_text(encoding="utf-8")
    if "receipt_processed_auto" in orchestrator:
        fail("Orquestrador ainda confirma comprovante automaticamente", failures)
    if re.search(r"status:\s*['\"]succeeded['\"]", orchestrator):
        fail("Orquestrador ainda cria pagamento succeeded por imagem", failures)
    for marker in ["requireInternalRequest", "_internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN')"]:
        if marker not in orchestrator:
            fail(f"Orquestrador sem proteção interna obrigatória: {marker}", failures)

    vision = (FUNCTIONS / "openai_vision" / "entry.ts").read_text(encoding="utf-8")
    if "mock: true" in vision:
        fail("Visão ainda retorna sucesso simulado sem token", failures)
    if "estimated_price" in vision and "matchedProduct" not in vision:
        fail("Preço da visão não está vinculado ao catálogo", failures)

    recurring = (FUNCTIONS / "generateRecurringExpenses" / "entry.ts").read_text(encoding="utf-8")
    if "FinanceEntry.create" in recurring or "status: 'paid'" in recurring:
        fail("Despesa recorrente ainda nasce como paga", failures)

    manual_quote = (ROOT / "src" / "components" / "crm" / "AdvancedQuoteModal.jsx").read_text(encoding="utf-8")
    if "entities.Payment.create" in manual_quote:
        fail("Orçamento manual ainda cria pagamento diretamente no navegador", failures)
    if "record_counter_payment" not in manual_quote:
        fail("Orçamento manual não usa a função segura de pagamento", failures)
    for marker in ["garmentItems.map", "condition_checked", "customer_authorized_risks", "qty: 1", "price_garment_services", "services={laundryServices}"]:
        if marker not in manual_quote:
            fail(f"Orçamento manual sem persistência individual obrigatória: {marker}", failures)

    approve_quote = (FUNCTIONS / "approve_quote" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["priceGarmentItems", "condition_checked: item.condition_checked === true", "customer_authorized_risks: item.customer_authorized_risks === true", "services: item.services || []"]:
        if marker not in approve_quote:
            fail(f"Aprovação não preserva a conferência manual: {marker}", failures)

    pricing = (ROOT / "base44" / "shared" / "laundryPricing.js").read_text(encoding="utf-8")
    for marker in ["service_not_compatible", "legacy_product_price", "price_rule_id", "customerGroup"]:
        if marker not in pricing:
            fail(f"Precificação de serviços sem marcador obrigatório: {marker}", failures)

    command_center = (ROOT / "src" / "components" / "management" / "ManagementCommandCenter.jsx").read_text(encoding="utf-8")
    for marker in ["GarmentLocationPanel", "GarmentLabelPrintDialog", "GarmentDeliveryDialog", "command-locations", "command-orders"]:
        if marker not in command_center:
            fail(f"Centro de comando sem jornada operacional: {marker}", failures)

    move_garments = (FUNCTIONS / "move_garments" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["location_capacity_exceeded", "ProcessedEvent", "location_changed", "refreshOccupancy"]:
        if marker not in move_garments:
            fail(f"Movimentação sem garantia obrigatória: {marker}", failures)

    delivery = (FUNCTIONS / "complete_garment_delivery" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["outstanding_balance", "single_customer_and_unit_required", "delivery_scope", "DeliveryReceipt", "partially_delivered"]:
        if marker not in delivery:
            fail(f"Entrega parcial sem garantia obrigatória: {marker}", failures)

    label_print = (FUNCTIONS / "register_label_print" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["reprint_reason_required", "label_print_count", "AuditLog"]:
        if marker not in label_print:
            fail(f"Impressão de etiqueta sem garantia obrigatória: {marker}", failures)

    secure_files = (ROOT / "src" / "lib" / "secureFiles.js").read_text(encoding="utf-8")
    for marker in ["sha256Hex", "validateFile", "DUPLICATE_DOCUMENT"]:
        if marker not in secure_files:
            fail(f"Upload seguro sem marcador obrigatório: {marker}", failures)

    order_benefits = (FUNCTIONS / "manage_order_benefits" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["apply_voucher", "apply_package", "restore", "ProcessedEvent", "voucherValue", "consumePackageBalance", "benefit_requires_unpaid_order"]:
        if marker not in order_benefits:
            fail(f"Benefícios comerciais sem integração obrigatória: {marker}", failures)

    payment_receipt = (FUNCTIONS / "manage_payment_receipt" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["calculateReceiptPlan", "PaymentReceipt", "CustomerCreditLedger", "cash_session_required", "async function reverse", "postPaymentLoyaltyEarn", "reversePaymentLoyalty"]:
        if marker not in payment_receipt:
            fail(f"Recebimento misto sem garantia obrigatória: {marker}", failures)

    billing = (FUNCTIONS / "manage_billing_agreement" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["credit_limit_exceeded", "cost_center_required", "purchase_order_required", "calculateExposure"]:
        if marker not in billing:
            fail(f"Convênio sem garantia obrigatória: {marker}", failures)

    billing_close = (FUNCTIONS / "close_billing_period" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["no_eligible_orders", "BillingStatement", "AccountsReceivable", "ProcessedEvent"]:
        if marker not in billing_close:
            fail(f"Fechamento de faturados sem garantia obrigatória: {marker}", failures)

    quote_lifecycle = (FUNCTIONS / "manage_quote_lifecycle" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["loadLaundryPricingCatalog", "QuoteVersion", "adjustment_reason_required", "quote_with_active_order_cannot_be_cancelled", "CommercialApprovalPolicy", "selectCommercialApprovalPolicy", "evaluateCommercialAdjustment", "approval_policy_id"]:
        if marker not in quote_lifecycle:
            fail(f"Ciclo do orçamento sem garantia obrigatória: {marker}", failures)

    cash = (FUNCTIONS / "manage_cash_session" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["closure_snapshot", "pending_approval", "action === 'position'", "action === 'reopen'"]:
        if marker not in cash:
            fail(f"Fechamento de caixa sem garantia obrigatória: {marker}", failures)

    fiscal = (FUNCTIONS / "manage_fiscal_document" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["fiscal_transmission_not_implemented", "national_nfse", "FiscalEvent", "fiscal_document_ids"]:
        if marker not in fiscal:
            fail(f"Estrutura fiscal sem garantia obrigatória: {marker}", failures)

    fiscal_event_schema = load_json(ENTITIES / "FiscalEvent.jsonc")
    for field in ["message", "payload_hash", "actor_user_id", "actor_name"]:
        if field not in fiscal_event_schema.get("properties", {}):
            fail(f"Evento fiscal sem campo usado pelo backend: {field}", failures)

    order_schema = load_json(ENTITIES / "Order.jsonc")
    for field in ["fiscal_document_ids", "fiscal_status", "payment_receipt_ids", "billing_statement_id"]:
        if field not in order_schema.get("properties", {}):
            fail(f"Pedido sem vínculo da Onda 2: {field}", failures)

    for marker in ["BillingAgreementsPanel", "QuoteLifecyclePanel", "FiscalReadinessPanel", "command-payments"]:
        if marker not in command_center:
            fail(f"Centro de comando sem módulo da Onda 2: {marker}", failures)

    payment_dialog = (ROOT / "src" / "components" / "management" / "PaymentReceiptDialog.jsx").read_text(encoding="utf-8")
    for marker in ["manage_order_benefits", "apply_voucher", "apply_package", "voucherCode", "packageChoice"]:
        if marker not in payment_dialog:
            fail(f"Recebimento sem etapa prévia de benefícios: {marker}", failures)

    financial_panel = (ROOT / "src" / "components" / "management" / "FinancialOperationsPanel.jsx").read_text(encoding="utf-8")
    for marker in ["PaymentReceiptDialog", "CustomerCreditDialog", "confirm_payment_tender", "pendingPayments"]:
        if marker not in financial_panel:
            fail(f"Central financeira sem jornada da Onda 2: {marker}", failures)

    stock_operation = (FUNCTIONS / "manage_stock_operation" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["inventory_count_freezes_movements", "inventory.override_negative", "StockLot", "transfer_in", "production_batch_id"]:
        if marker not in stock_operation:
            fail(f"Operação de estoque sem garantia da Onda 3: {marker}", failures)

    inventory_count = (FUNCTIONS / "manage_inventory_count" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["blind_count", "inventory_items_not_counted", "inventory_difference", "action === 'review_item'", "ProcessedEvent"]:
        if marker not in inventory_count:
            fail(f"Inventário sem garantia da Onda 3: {marker}", failures)

    consumption = (FUNCTIONS / "post_production_consumption" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["allocateLots", "consumption_reversal", "waste_tolerance_percent", "insufficient_stock:", "actual_material_cost"]:
        if marker not in consumption:
            fail(f"Consumo automático sem garantia da Onda 3: {marker}", failures)

    production_batch = (FUNCTIONS / "manage_production_batch" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["calculateCapacity", "machine_capacity_exceeded", "production_consumption_required", "ProductionEvent", "findMissingMaterials"]:
        if marker not in production_batch:
            fail(f"Lote de produção sem garantia da Onda 3: {marker}", failures)

    labor = (FUNCTIONS / "manage_labor_entry" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["operator_entry_already_active", "hourly_cost", "accumulated_minutes", "labor_cost"]:
        if marker not in labor:
            fail(f"Apontamento de mão de obra sem garantia da Onda 3: {marker}", failures)

    alerts = (FUNCTIONS / "manage_operational_alerts" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["resolveMissing", "low_stock", "batch_delayed", "cost_variance", "action === 'acknowledge'"]:
        if marker not in alerts:
            fail(f"Alertas operacionais sem garantia da Onda 3: {marker}", failures)

    for marker in ["ProductionOperationsPanel", "OperationsInsightsPanel", "command-stock-lots", "command-production-batches", "command-operational-alerts"]:
        if marker not in command_center:
            fail(f"Centro de comando sem módulo da Onda 3: {marker}", failures)

    inventory_panel = (ROOT / "src" / "components" / "management" / "InventoryPanel.jsx").read_text(encoding="utf-8")
    for marker in ["StockOperationDialog", "InventoryCountPanel", "ConsumptionRecipesPanel", "stockLots", "stockMovements"]:
        if marker not in inventory_panel:
            fail(f"Central de estoque sem jornada da Onda 3: {marker}", failures)

    production_panel = (ROOT / "src" / "components" / "management" / "ProductionOperationsPanel.jsx").read_text(encoding="utf-8")
    for marker in ["ProductionBatchDialog", "BatchExecutionDialog", "MachineManagementDialog", "ProductionCostProfileDialog"]:
        if marker not in production_panel:
            fail(f"Central de produção sem jornada da Onda 3: {marker}", failures)

    access = (FUNCTIONS / "manage_access_control" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["AccessPolicy", "UserSessionEvent", "access_revision", "session_revoked_after", "mfa_status", "self_role_change_forbidden"]:
        if marker not in access:
            fail(f"Governança sem garantia da Onda 4: {marker}", failures)

    audit_query = (FUNCTIONS / "query_audit_log" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["audit_export_forbidden", "export_reason_required", "forbidden_unit", "exports"]:
        if marker not in audit_query:
            fail(f"Auditoria avançada sem garantia da Onda 4: {marker}", failures)

    pricing_rules = (FUNCTIONS / "manage_pricing_rules" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["PriceRuleVersion", "CommercialApprovalPolicy", "simulate", "conflicts", "negative_price_forbidden"]:
        if marker not in pricing_rules:
            fail(f"Administração de preços sem garantia da Onda 4: {marker}", failures)

    catalogs = (FUNCTIONS / "manage_operational_catalog" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["duplicate_catalog_entry", "synonyms", "forbidden_unit"]:
        if marker not in catalogs:
            fail(f"Catálogo operacional sem garantia da Onda 4: {marker}", failures)

    loyalty = (FUNCTIONS / "manage_loyalty_crm" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["LoyaltyLedger", "CustomerPackageLedger", "Voucher", "idempotency_key", "forbidden_unit"]:
        if marker not in loyalty:
            fail(f"CRM e fidelidade sem garantia da Onda 4: {marker}", failures)
    loyalty_settlement = (ROOT / "base44" / "shared" / "loyaltySettlement.js").read_text(encoding="utf-8")
    for marker in ["loyalty-earn", "loyalty-reverse", "payment_settlement", "payment_reversal"]:
        if marker not in loyalty_settlement:
            fail(f"Fidelidade não integrada ao assentamento: {marker}", failures)
    for function_name in ["confirm_payment_tender", "record_counter_payment", "reconcile_payment", "stripe_webhook"]:
        if "postPaymentLoyaltyEarn" not in (FUNCTIONS / function_name / "entry.ts").read_text(encoding="utf-8"):
            fail(f"Fluxo de pagamento sem fidelidade confirmada: {function_name}", failures)

    specialized_reports = (FUNCTIONS / "generate_specialized_report" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["REPORT_TYPES", "reportEnvelope", "forbidden_unit", "unit_profitability", "employee_productivity"]:
        if marker not in specialized_reports:
            fail(f"Relatórios especializados sem garantia da Onda 4: {marker}", failures)

    fleet = (FUNCTIONS / "manage_fleet" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["FleetVehicle", "vehicle_plate_exists", "vehicle_in_active_route", "forbidden_unit"]:
        if marker not in fleet:
            fail(f"Frota sem garantia da Onda 4: {marker}", failures)

    routes = (FUNCTIONS / "manage_delivery_route" / "entry.ts").read_text(encoding="utf-8")
    for marker in ["RouteEvent", "idempotency_key", "route_execution_forbidden", "route_has_pending_stops", "invalid_odometer"]:
        if marker not in routes:
            fail(f"Jornada logística sem garantia da Onda 4: {marker}", failures)

    layout = (ROOT / "src" / "Layout.jsx").read_text(encoding="utf-8")
    for marker in ["/reports", "reports.view", "field_route.execute", "fleet.manage"]:
        if marker not in layout:
            fail(f"Navegação sem módulo da Onda 4: {marker}", failures)

    settings = (ROOT / "src" / "pages" / "Settings.jsx").read_text(encoding="utf-8")
    for marker in ["PricingRulesManager", "OperationalCatalogManager", "LoyaltyProgramManager", "Governança & Acessos"]:
        if marker not in settings:
            fail(f"Configurações sem módulo da Onda 4: {marker}", failures)

    legacy_report = (FUNCTIONS / "generateReport" / "entry.ts").read_text(encoding="utf-8")
    if "legacy_report_retired" not in legacy_report or "status: 410" not in legacy_report:
        fail("Relatório DOCX estático não foi aposentado de forma explícita", failures)
    for forbidden in ["Cristiano", "Marla", "17/04/2026"]:
        if forbidden in legacy_report:
            fail(f"Relatório legado ainda contém dado histórico fixo: {forbidden}", failures)

    app = (ROOT / "src" / "App.jsx").read_text(encoding="utf-8")
    auth_context = (ROOT / "src" / "lib" / "AuthContext.jsx").read_text(encoding="utf-8")
    if "PageAccessGuard" not in app or "check_access_session" not in auth_context or "logout(true)" not in layout:
        fail("Enforcement global de rota, sessão ou logout está incompleto", failures)

    quote_schema = load_json(ENTITIES / "Quote.jsonc")
    adjustment_fields = quote_schema.get("properties", {}).get("price_adjustments", {}).get("items", {}).get("properties", {})
    for field in ["approval_policy_id", "approval_policy_version"]:
        if field not in adjustment_fields:
            fail(f"Ajuste de preço sem referência de alçada: {field}", failures)

    customers_page = (ROOT / "src" / "pages" / "Customers.jsx").read_text(encoding="utf-8")
    if "Customer360Dialog" not in customers_page:
        fail("Clientes sem visão CRM 360", failures)

    pickups_page = (ROOT / "src" / "pages" / "Pickups.jsx").read_text(encoding="utf-8")
    if "LogisticsOperationsPanel" not in pickups_page:
        fail("Coletas sem jornada logística da Onda 4", failures)

    if failures:
        print("VALIDAÇÃO FALHOU")
        for item in failures:
            print(f"- {item}")
        return 1

    print(f"VALIDAÇÃO OK: {len(entity_names)} schemas, {len(NEW_FUNCTIONS)} novas funções e invariantes críticos verificados.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
