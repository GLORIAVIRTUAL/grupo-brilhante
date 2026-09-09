import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertSameCompanyTransfer, assertWarehouseScope, computePurchaseTotals, purchaseOrderTransition, purchaseRequisitionTransition, receiptLineStatus, receiptStatus } from '../base44/shared/procurementInventoryCore.js';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const schema = (name) => JSON.parse(read(`base44/entities/${name}.jsonc`));
const requiredSchemas = ['PurchaseRequisition', 'PurchaseRequisitionItem', 'PurchaseOrder', 'PurchaseOrderItem', 'GoodsReceipt', 'GoodsReceiptItem', 'StockTransfer', 'StockTransferItem'];
for (const name of requiredSchemas) assert.equal(schema(name).name, name, `schema ${name} ausente`);
for (const name of ['StockItem', 'StockLot', 'StockMovement', 'InventoryCount', 'PurchaseDocument', 'PurchaseItem']) { const properties = schema(name).properties; assert.ok(properties.legal_entity_id, `${name} sem CNPJ`); assert.ok(properties.warehouse_id, `${name} sem depósito`); }

assert.deepEqual(computePurchaseTotals([{ ordered_quantity: 2, unit_price: 10 }, { ordered_quantity: 3, unit_price: 5 }], { discount: 2, freight: 4, taxes: 1 }), { subtotal: 35, discount: 2, freight: 4, taxes: 1, total: 38 });
assert.equal(purchaseRequisitionTransition('draft', 'submit'), 'submitted'); assert.equal(purchaseRequisitionTransition('submitted', 'approve'), 'approved'); assert.throws(() => purchaseRequisitionTransition('approved', 'approve'), /invalid_requisition_transition/);
assert.equal(purchaseOrderTransition('draft', 'submit'), 'submitted'); assert.equal(purchaseOrderTransition('submitted', 'approve'), 'approved'); assert.equal(purchaseOrderTransition('approved', 'send'), 'sent'); assert.equal(purchaseOrderTransition('sent', 'receive_partial'), 'partially_received'); assert.equal(purchaseOrderTransition('partially_received', 'receive_complete'), 'received');
assert.equal(receiptLineStatus({ received: 10, accepted: 10, rejected: 0 }), 'accepted'); assert.equal(receiptLineStatus({ received: 10, accepted: 0, rejected: 10 }), 'rejected'); assert.equal(receiptLineStatus({ received: 10, accepted: 7, rejected: 3 }), 'partially_accepted'); assert.throws(() => receiptLineStatus({ received: 10, accepted: 9, rejected: 2 }), /receipt_quantities_exceed_received/);
assert.equal(receiptStatus([{ received: 5, accepted: 5, rejected: 0 }, { received: 2, accepted: 2, rejected: 0 }]), 'accepted'); assert.equal(receiptStatus([{ received: 5, accepted: 5, rejected: 0 }, { received: 2, accepted: 1, rejected: 1 }]), 'partially_accepted');
const a = { id: 'a', legal_entity_id: 'company-1', unit_id: 'unit-1', status: 'active' }; const b = { id: 'b', legal_entity_id: 'company-1', unit_id: 'unit-2', status: 'active' }; const c = { id: 'c', legal_entity_id: 'company-2', status: 'active' };
assert.equal(assertWarehouseScope({ warehouse: a, legalEntityId: 'company-1', unitId: 'unit-1' }), true); assert.throws(() => assertWarehouseScope({ warehouse: a, legalEntityId: 'company-2' }), /warehouse_scope_mismatch/); assert.equal(assertSameCompanyTransfer(a, b), true); assert.throws(() => assertSameCompanyTransfer(a, c), /intercompany_stock_transfer_requires_separate_process/);

const procurement = read('base44/functions/manage_procurement_core/entry.ts');
for (const marker of ['authorizeUserOrInternal', 'enforceAuthenticatedUser', "'purchases.manage'", "'purchases.approve'", "'receipts.manage'", 'idempotency_key_required', 'receipt_requires_repair', 'receipt_partial_failure_requires_repair', 'RepairTask', 'legal_entity_id', 'warehouse_id']) assert.ok(procurement.includes(marker), `núcleo de compras sem ${marker}`);
assert.equal(/\bfetch\s*\(/.test(procurement), false, 'núcleo humano de compras não pode chamar provedor externo');
const transfers = read('base44/functions/manage_stock_transfers/entry.ts');
for (const marker of ['inventory.transfer', 'assertSameCompanyTransfer', 'intercompany_stock_transfer_requires_separate_process', 'stock_transfer_partial_failure_requires_repair', 'stock_transfer_receive_partial_failure_requires_repair', 'source_warehouse_id', 'destination_warehouse_id', 'ProcessedEvent']) assert.ok(transfers.includes(marker), `transferências sem ${marker}`);
const extraction = read('base44/functions/extract_purchase_document/entry.ts');
for (const marker of ['purchase_asset_scope_required', "permission: 'documents.review'", 'legal_entity_id: legalEntityId', 'warehouse_id: warehouseId', 'purchase_order_scope_mismatch', 'invoice_supplier_differs_from_purchase_order']) assert.ok(extraction.includes(marker), `OCR de compras sem ${marker}`);
const legacy = read('base44/functions/approve_purchase_document/entry.ts'); assert.ok(legacy.includes('use_goods_receipt_workflow'), 'aprovação legada ainda baixa compra corporativa diretamente');
const intake = read('src/components/management/DocumentIntakeModal.jsx'); assert.ok(intake.includes('Conclua o recebimento físico na central de compras')); assert.equal(intake.includes("invoke('approve_purchase_document'"), false, 'interface ainda chama aprovação legada');
const app = read('src/App.jsx'); const layout = read('src/Layout.jsx'); const page = read('src/pages/ProcurementOperations.jsx');
for (const marker of ['ProcurementOperations', '/procurement-operations', 'purchases.view', 'inventory.transfer']) assert.ok(app.includes(marker), `rota sem ${marker}`); assert.ok(layout.includes("label: 'Compras & Estoque'")); for (const action of ['create_requisition', 'approve_requisition', 'create_purchase_order', 'approve_purchase_order', 'receive_purchase_order']) assert.ok(page.includes(action), `UI sem ${action}`);
const backendRoles = read('base44/shared/accessGovernance.js'); const frontendRoles = read('src/lib/roleDefinitions.js'); for (const permission of ['purchases.view', 'purchases.manage', 'purchases.approve', 'receipts.manage', 'inventory.view', 'inventory.transfer']) { assert.ok(backendRoles.includes(permission)); assert.ok(app.includes(permission) || frontendRoles.includes(permission)); }
console.log('Grupo Brilhante procurement: todos os testes passaram.');
