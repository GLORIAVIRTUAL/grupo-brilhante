import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));
const fail = (message) => { throw new Error(message); };

const suites = [
  'validate-all-schemas.mjs',
  'test-grupo-brilhante-foundation.mjs',
  'test-grupo-brilhante-b2b.mjs',
  'test-grupo-brilhante-finance.mjs',
  'test-grupo-brilhante-banking.mjs',
  'test-grupo-brilhante-fiscal.mjs',
  'test-grupo-brilhante-procurement.mjs',
  'test-grupo-brilhante-hospital-linen.mjs',
  'test-grupo-brilhante-cleaning.mjs',
  'test-grupo-brilhante-service-bi.mjs',
  'test-audit-security.mjs',
];
for (const suite of suites) execFileSync(process.execPath, [path.join(ROOT, 'scripts', suite)], { stdio: 'inherit' });

const mandatoryEntities = [
  'BusinessGroup','LegalEntity','CostCenter','BankAccount','Warehouse','CompanyAccessGrant','DocumentAsset','IntegrationJob','RepairTask','DomainEvent','BusinessParty','PartyRole','PartyContact','PartyAddress','PartyDocument','SalesOpportunity','BusinessActivity','BusinessContract','ContractVersion','ContractPriceItem','ServiceOrder','FinancialPeriod','IntercompanyEntry','FinancialProjection','ReconciliationBatch','MigrationBatch','MigrationRecord','BankCharge','BankWebhookEvent','BankReconciliationMatch','BankFileLayoutProfile','FiscalWebhookEvent','FiscalSequenceReservation','PurchaseRequisition','PurchaseRequisitionItem','PurchaseOrder','PurchaseOrderItem','GoodsReceipt','GoodsReceiptItem','StockTransfer','StockTransferItem','HospitalPickup','WeighingRecord','HospitalProcessingLot','HospitalDeliveryConference','HospitalBillingMeasurement','LinenCatalogItem','LinenAsset','LinenMovement','LinenInventorySession','LinenInventoryLine','LinenLiabilityTerm','LinenLossCharge','CleaningSite','WorkPost','WorkSchedule','CleaningChecklistTemplate','CleaningInspection','ServiceMeasurement','CleaningOccurrence','PayrollSyncJob','CommunicationConsent','MessageTemplate','KnowledgeArticle','ReportDefinition','ReportSchedule','ExecutiveSummarySnapshot','PublicLeadSubmission','PublicConversationSession',
];
const mandatoryFunctions = [
  'manage_enterprise_core','manage_document_assets','manage_business_parties','manage_business_contracts','manage_service_orders','manage_financial_core','manage_conta_azul_migration','manage_bank_charges','bb_banking_gateway','bb_webhook_receiver','manage_bank_reconciliation','manage_fiscal_document','focus_nfe_gateway','focus_nfe_webhook','manage_procurement_core','manage_stock_transfers','manage_hospital_laundry','manage_linen_assets','manage_cleaning_operations','payroll_sync_gateway','manage_communication_governance','manage_enterprise_reports','scheduled_enterprise_reports','public_b2b_lead',
];
const mandatoryPages = [
  'EnterpriseStructure','DocumentRepository','BusinessRegistry','CommercialOperations','EnterpriseFinance','ContaAzulMigration','BankingOperations','EnterpriseFiscal','ProcurementOperations','HospitalLaundry','LinenOperations','CleaningOperations','CommunicationGovernance','EnterpriseIntelligence',
];
for (const name of mandatoryEntities) if (!exists(`base44/entities/${name}.jsonc`)) fail(`Entidade obrigatória ausente: ${name}`);
for (const name of mandatoryFunctions) if (!exists(`base44/functions/${name}/entry.ts`)) fail(`Função obrigatória ausente: ${name}`);
for (const name of mandatoryPages) if (!exists(`src/pages/${name}.jsx`)) fail(`Página obrigatória ausente: ${name}`);

const envLines = read('.env.example').split(/\r?\n/).filter((line) => line && !line.trim().startsWith('#') && line.includes('='));
const env = Object.fromEntries(envLines.map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
for (const flag of ['CONTA_AZUL_MIGRATION_ENABLED','BB_EXTERNAL_REQUESTS_ENABLED','BB_PRODUCTION_ENABLED','FOCUSNFE_EXTERNAL_REQUESTS_ENABLED','FOCUSNFE_PRODUCTION_ENABLED','PAYROLL_SYNC_ENABLED','PAYROLL_SYNC_PRODUCTION_ENABLED','REPORT_EXTERNAL_DELIVERY_ENABLED']) if (env[flag] !== 'false') fail(`Gate deve permanecer false por padrão: ${flag}`);
for (const key of ['INTERNAL_FUNCTION_TOKEN','BB_CLIENT_ID','BB_CLIENT_SECRET','BB_WEBHOOK_TOKEN','BB_WEBHOOK_HMAC_SECRET','FOCUSNFE_TOKEN','FOCUSNFE_WEBHOOK_TOKEN','PAYROLL_API_TOKEN']) if ((env[key] || '').trim()) fail(`Secret deve permanecer vazio no exemplo: ${key}`);

const trackedSource = [read('src/App.jsx'), read('src/Layout.jsx'), ...mandatoryFunctions.map((name) => read(`base44/functions/${name}/entry.ts`))].join('\n');
for (const forbidden of ['6a99e42ee48200f5d8ddd176','lavanderia-5asec-connect-copy-d8ddd176.base44.app']) if (trackedSource.includes(forbidden)) fail(`Identificador herdado proibido: ${forbidden}`);
for (const route of ['/enterprise-structure','/documents','/business-registry','/commercial-operations','/enterprise-finance','/conta-azul-migration','/banking-operations','/enterprise-fiscal','/procurement-operations','/hospital-laundry','/linen-operations','/cleaning-operations','/communication-governance','/enterprise-intelligence']) if (!read('src/App.jsx').includes(route)) fail(`Rota protegida ausente: ${route}`);
const integrationStatus = read('base44/functions/integration_status/entry.ts');
for (const marker of ["id: 'bb'", "id: 'focus_nfe'", "id: 'conta_azul_migration'", "id: 'payroll_sync'", "id: 'scheduled_reports'", 'missing_secret_names', 'gate_names', 'production_gate_names']) if (!integrationStatus.includes(marker)) fail(`Status de integrações incompleto: ${marker}`);
if (/Deno\.env\.toObject|secret_values|environment_values|credential_values/.test(integrationStatus)) fail('Status de integrações não pode devolver valores de environment.');
for (const safeField of ['required_secret_names', 'missing_secret_names', 'gate_names', 'production_gate_names']) if (!integrationStatus.includes(safeField)) fail(`Status de integrações deve expor somente nomes e estados: ${safeField}`);

console.log(`ERP GRUPO BRILHANTE OK: ${mandatoryEntities.length} entidades, ${mandatoryFunctions.length} funções, ${mandatoryPages.length} páginas e ${suites.length} baterias verificadas.`);
