import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'inventory', 'finance']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'approve_purchase_document' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'inventory') && !(user.permissions || []).includes('inventory.manage')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const { purchase_document_id: purchaseDocumentId, received_quantities: receivedQuantities = {} } = await req.json();
    if (!purchaseDocumentId) return Response.json({ error: 'purchase_document_id_required', request_id: requestId }, { status: 400 });

    const document = await base44.asServiceRole.entities.PurchaseDocument.get(purchaseDocumentId);
    if (!document) return Response.json({ error: 'purchase_document_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, document.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    const openCounts = await base44.asServiceRole.entities.InventoryCount.filter({ unit_id: document.unit_id });
    if (openCounts.some((count: any) => count.status === 'counting' && count.freeze_movements === true)) {
      return Response.json({ error: 'inventory_count_freezes_movements', request_id: requestId }, { status: 423 });
    }
    if (['rejected', 'cancelled'].includes(document.status)) {
      return Response.json({ error: 'purchase_document_not_approvable', request_id: requestId }, { status: 409 });
    }

    const documentKey = `approve_purchase:${document.id}`;
    const completedDocuments = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: documentKey });
    const completedDocument = completedDocuments.find((event: any) => event.status === 'completed');
    if (completedDocument) {
      return Response.json({ duplicate: true, purchase_document: document, request_id: requestId });
    }

    const items = await base44.asServiceRole.entities.PurchaseItem.filter({ purchase_document_id: document.id });
    if (items.length === 0) return Response.json({ error: 'purchase_items_required', request_id: requestId }, { status: 422 });

    const unresolved = items.filter((item: any) => !item.stock_item_id || item.match_status === 'suggested');
    if (unresolved.length > 0) {
      return Response.json({ error: 'purchase_items_require_review', unresolved_items: unresolved.length, request_id: requestId }, { status: 409 });
    }

    const overallEvent = completedDocuments[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
      event_key: documentKey,
      event_type: 'approve_purchase_document',
      source: 'user_command',
      status: 'processing',
      payload_hash: document.file_hash,
      attempts: 1,
      started_at: new Date().toISOString(),
      unit_id: document.unit_id,
    });

    const movements = [];
    for (const item of items) {
      const lineKey = `${documentKey}:${item.id}`;
      const lineEvents = await base44.asServiceRole.entities.ProcessedEvent.filter({ event_key: lineKey });
      if (lineEvents.some((event: any) => event.status === 'completed')) continue;

      const lineEvent = lineEvents[0] || await base44.asServiceRole.entities.ProcessedEvent.create({
        event_key: lineKey,
        event_type: 'purchase_stock_entry',
        source: 'user_command',
        status: 'processing',
        payload_hash: `${document.file_hash}:${item.id}`,
        attempts: 1,
        started_at: new Date().toISOString(),
        unit_id: document.unit_id,
      });

      const stockItem = await base44.asServiceRole.entities.StockItem.get(item.stock_item_id);
      if (!stockItem || stockItem.unit_id !== document.unit_id) {
        throw new Error(`invalid_stock_item:${item.id}`);
      }

      const invoiced = Number(item.invoiced_quantity || 0);
      const received = Math.max(0, Number(receivedQuantities[item.id] ?? invoiced));
      const conversionFactor = Math.max(0, Number(item.conversion_factor || stockItem.purchase_to_base_factor || 1));
      const baseQuantity = received * conversionFactor;
      if (baseQuantity <= 0) throw new Error(`invalid_received_quantity:${item.id}`);

      const balanceBefore = Number(stockItem.current_quantity || 0);
      const balanceAfter = balanceBefore + baseQuantity;
      const unitCostBase = Number(item.unit_price || 0) / Math.max(conversionFactor, 1);
      const previousValue = balanceBefore * Number(stockItem.average_cost || 0);
      const incomingValue = baseQuantity * unitCostBase;
      const averageCost = balanceAfter > 0 ? (previousValue + incomingValue) / balanceAfter : unitCostBase;
      const now = new Date().toISOString();
      let stockLot = null;
      if (stockItem.batch_control || stockItem.expiry_control || item.batch_number || item.expiry_date) {
        const lotNumber = String(item.batch_number || `DOC-${document.document_number || document.id.slice(0, 8)}-${item.id.slice(0, 6)}`);
        const existingLots = await base44.asServiceRole.entities.StockLot.filter({ unit_id: document.unit_id, stock_item_id: stockItem.id, lot_number: lotNumber });
        const existingLot = existingLots.find((lot: any) => lot.status !== 'cancelled');
        if (existingLot) {
          const lotBefore = Number(existingLot.current_quantity || 0);
          const lotAfter = lotBefore + baseQuantity;
          const lotAverageCost = lotAfter > 0 ? ((lotBefore * Number(existingLot.unit_cost || 0)) + incomingValue) / lotAfter : unitCostBase;
          stockLot = await base44.asServiceRole.entities.StockLot.update(existingLot.id, {
            current_quantity: lotAfter,
            initial_quantity: Number(existingLot.initial_quantity || 0) + baseQuantity,
            unit_cost: lotAverageCost,
            total_cost: lotAfter * lotAverageCost,
            expiry_date: item.expiry_date || existingLot.expiry_date,
            last_movement_at: now,
            status: 'available',
          });
        } else {
          stockLot = await base44.asServiceRole.entities.StockLot.create({
            unit_id: document.unit_id,
            stock_item_id: stockItem.id,
            lot_number: lotNumber,
            supplier_id: document.supplier_id,
            purchase_document_id: document.id,
            purchase_item_id: item.id,
            received_at: now,
            expiry_date: item.expiry_date,
            initial_quantity: baseQuantity,
            current_quantity: baseQuantity,
            reserved_quantity: 0,
            unit_cost: unitCostBase,
            total_cost: incomingValue,
            storage_location: stockItem.storage_location,
            status: 'available',
            quality_status: 'not_required',
            last_movement_at: now,
          });
        }
      }

      const movement = await base44.asServiceRole.entities.StockMovement.create({
        unit_id: document.unit_id,
        stock_item_id: stockItem.id,
        stock_lot_id: stockLot?.id,
        movement_type: 'purchase_entry',
        quantity: baseQuantity,
        unit_cost: unitCostBase,
        total_cost: incomingValue,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        purchase_document_id: document.id,
        purchase_item_id: item.id,
        batch_number: stockLot?.lot_number || item.batch_number,
        expiry_date: stockLot?.expiry_date || item.expiry_date,
        operator_user_id: user.id,
        reason: 'purchase_document_approved',
        occurred_at: now,
        request_id: requestId,
      });

      await base44.asServiceRole.entities.StockItem.update(stockItem.id, {
        current_quantity: balanceAfter,
        available_quantity: balanceAfter - Number(stockItem.reserved_quantity || 0),
        average_cost: averageCost,
        last_cost: unitCostBase,
        last_movement_at: now,
      });
      await base44.asServiceRole.entities.PurchaseItem.update(item.id, {
        received_quantity: received,
        accepted_quantity: received,
        base_quantity: baseQuantity,
        match_status: 'matched',
      });
      await base44.asServiceRole.entities.ProcessedEvent.update(lineEvent.id, {
        status: 'completed',
        entity_type: 'stock_movement',
        entity_id: movement.id,
        result: { stock_item_id: stockItem.id, quantity: baseQuantity, balance_after: balanceAfter },
        completed_at: now,
      });
      movements.push(movement);
    }

    let accountsPayable = null;
    const existingPayables = await base44.asServiceRole.entities.AccountsPayable.filter({ purchase_document_id: document.id });
    accountsPayable = existingPayables[0] || null;
    if (!accountsPayable) {
      const dueDate = document.due_date || new Date().toISOString();
      accountsPayable = await base44.asServiceRole.entities.AccountsPayable.create({
        unit_id: document.unit_id,
        supplier_id: document.supplier_id,
        supplier_name: document.supplier_name,
        purchase_document_id: document.id,
        description: `Compra ${document.document_number || document.id.slice(0, 8)} · ${document.supplier_name || 'Fornecedor'}`,
        category: 'Insumos',
        cost_center: 'Operação',
        competence_date: document.issue_date || new Date().toISOString(),
        issue_date: document.issue_date,
        due_date: dueDate,
        original_amount: Number(document.total || 0),
        open_amount: Number(document.total || 0),
        paid_amount: 0,
        status: 'pending_approval',
        approval_status: 'pending',
        document_asset_ids: [document.document_asset_id],
        metadata: { request_id: requestId },
      });
    }

    const now = new Date().toISOString();
    const updatedDocument = await base44.asServiceRole.entities.PurchaseDocument.update(document.id, {
      status: 'received_complete',
      accounts_payable_id: accountsPayable.id,
      approved_by_user_id: user.id,
      approved_at: now,
    });

    if (document.human_review_id) {
      try {
        await base44.asServiceRole.entities.HumanReview.update(document.human_review_id, {
          status: 'approved',
          reviewed_by_user_id: user.id,
          reviewed_at: now,
          decision_reason: 'purchase_document_approved',
        });
      } catch (_) {
        // A ausência de revisão não impede a aprovação já validada.
      }
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'approve',
      entity_type: 'purchase_document',
      entity_id: document.id,
      item_label: document.document_number || document.id.slice(0, 8),
      amount: Number(document.total || 0),
      reason: 'purchase_document_stock_and_payable_created',
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      unit_id: document.unit_id,
      request_id: requestId,
      after_data: { movements: movements.length, accounts_payable_id: accountsPayable.id },
      success: true,
    });

    await base44.asServiceRole.entities.ProcessedEvent.update(overallEvent.id, {
      status: 'completed',
      entity_type: 'purchase_document',
      entity_id: document.id,
      result: { movement_count: movements.length, accounts_payable_id: accountsPayable.id },
      completed_at: now,
    });

    return Response.json({ purchase_document: updatedDocument, movements, accounts_payable: accountsPayable, request_id: requestId });
  } catch (error) {
    console.error(`[approve_purchase_document:${requestId}]`, error);
    return Response.json({ error: 'purchase_approval_failed', request_id: requestId }, { status: 500 });
  }
});
