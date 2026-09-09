import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { variancePercent } from '../../shared/productionMath.js';

const ROLES = new Set(['super_admin', 'admin', 'manager', 'production', 'inventory', 'finance']);
const MANAGER_ROLES = new Set(['super_admin', 'admin', 'manager']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

async function upsert(base44: any, input: any) {
  const existing = await base44.asServiceRole.entities.OperationalAlert.filter({ alert_key: input.alert_key });
  const current = existing.find((row: any) => ['open', 'acknowledged'].includes(row.status));
  const now = new Date().toISOString();
  if (current) return base44.asServiceRole.entities.OperationalAlert.update(current.id, { ...input, status: current.status, last_detected_at: now });
  return base44.asServiceRole.entities.OperationalAlert.create({ ...input, status: 'open', first_detected_at: now, last_detected_at: now });
}

async function resolveMissing(base44: any, unitId: string, detectedKeys: Set<string>) {
  const alerts = await base44.asServiceRole.entities.OperationalAlert.filter({ unit_id: unitId });
  const now = new Date().toISOString();
  for (const alert of alerts.filter((row: any) => ['open', 'acknowledged'].includes(row.status) && !detectedKeys.has(row.alert_key))) {
    await base44.asServiceRole.entities.OperationalAlert.update(alert.id, { status: 'resolved', resolved_at: now, resolution_note: 'Condição normalizada na atualização dos indicadores.' });
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_operational_alerts' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ROLES.has(user.role || '') && !(user.permissions || []).includes('operations.alerts')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const input = await req.json();
    const action = String(input.action || 'refresh');
    const now = new Date().toISOString();

    if (action === 'refresh') {
      const unitId = String(input.unit_id || '');
      if (!unitId || !canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      const [stockItems, lots, machines, batches] = await Promise.all([
        base44.asServiceRole.entities.StockItem.filter({ unit_id: unitId, active: true }),
        base44.asServiceRole.entities.StockLot.filter({ unit_id: unitId }),
        base44.asServiceRole.entities.MachineState.filter({ unit_id: unitId, active: true }),
        base44.asServiceRole.entities.ProductionBatch.filter({ unit_id: unitId }),
      ]);
      const detected = new Set<string>();
      const alerts = [];
      const detect = async (payload: any) => { detected.add(payload.alert_key); alerts.push(await upsert(base44, payload)); };

      for (const item of stockItems) {
        const current = Number(item.current_quantity || 0);
        const minimum = Number(item.minimum_quantity || 0);
        if (current <= minimum) await detect({ unit_id: unitId, alert_key: `stock:${item.id}:${current <= 0 ? 'stockout' : 'low'}`, category: current <= 0 ? 'stockout' : 'low_stock', severity: current <= 0 ? 'critical' : 'warning', title: current <= 0 ? `${item.name} sem estoque` : `${item.name} abaixo do mínimo`, description: `Saldo ${current} ${item.base_unit}; mínimo ${minimum}.`, entity_type: 'stock_item', entity_id: item.id, metric_value: current, threshold_value: minimum });
      }
      const thirtyDays = Date.now() + 30 * 86400000;
      for (const lot of lots.filter((row: any) => row.status === 'available' && row.expiry_date)) {
        const expiry = Date.parse(lot.expiry_date);
        if (expiry < Date.now()) await detect({ unit_id: unitId, alert_key: `lot:${lot.id}:expired`, category: 'expired_lot', severity: 'critical', title: `Lote vencido: ${lot.lot_number}`, description: `Bloqueie o lote e registre a destinação.`, entity_type: 'stock_lot', entity_id: lot.id, metric_value: expiry, threshold_value: Date.now() });
        else if (expiry < thirtyDays) await detect({ unit_id: unitId, alert_key: `lot:${lot.id}:expiring`, category: 'expiring_lot', severity: 'warning', title: `Lote próximo do vencimento: ${lot.lot_number}`, description: `Validade em ${new Date(expiry).toLocaleDateString('pt-BR')}. Priorize por FEFO.`, entity_type: 'stock_lot', entity_id: lot.id, metric_value: Math.ceil((expiry - Date.now()) / 86400000), threshold_value: 30 });
      }
      for (const machine of machines) {
        if (machine.next_maintenance_at && Date.parse(machine.next_maintenance_at) < Date.now()) await detect({ unit_id: unitId, alert_key: `machine:${machine.id}:maintenance`, category: 'machine_stopped', severity: 'warning', title: `Manutenção vencida: ${machine.name || machine.machine_id}`, description: `A manutenção prevista está atrasada.`, entity_type: 'machine_state', entity_id: machine.id, metric_value: Date.now() - Date.parse(machine.next_maintenance_at), threshold_value: 0 });
        if (machine.operational_status === 'out_of_service') await detect({ unit_id: unitId, alert_key: `machine:${machine.id}:out`, category: 'machine_stopped', severity: 'critical', title: `Máquina indisponível: ${machine.name || machine.machine_id}`, description: machine.maintenance_notes || 'Equipamento fora de serviço.', entity_type: 'machine_state', entity_id: machine.id });
      }
      for (const batch of batches.filter((row: any) => !['completed', 'cancelled'].includes(row.status))) {
        if (batch.scheduled_at && Date.parse(batch.scheduled_at) < Date.now() && batch.status !== 'processing') await detect({ unit_id: unitId, alert_key: `batch:${batch.id}:delayed`, category: 'batch_delayed', severity: batch.priority === 'urgent' ? 'critical' : 'warning', title: `Lote atrasado: ${batch.code}`, description: `${batch.stage} deveria iniciar em ${new Date(batch.scheduled_at).toLocaleString('pt-BR')}.`, entity_type: 'production_batch', entity_id: batch.id, metric_value: (Date.now() - Date.parse(batch.scheduled_at)) / 60000, threshold_value: 0 });
        if (Number(batch.capacity_percent || 0) > 100) await detect({ unit_id: unitId, alert_key: `batch:${batch.id}:overload`, category: 'machine_overload', severity: 'critical', title: `Sobrecarga: ${batch.code}`, description: `Carga em ${Number(batch.capacity_percent).toFixed(1)}% da capacidade.`, entity_type: 'production_batch', entity_id: batch.id, metric_value: Number(batch.capacity_percent), threshold_value: 100 });
        if (batch.status === 'waiting_materials') await detect({ unit_id: unitId, alert_key: `batch:${batch.id}:materials`, category: 'capacity_bottleneck', severity: 'warning', title: `Lote bloqueado por insumo: ${batch.code}`, description: 'Reponha ou substitua os materiais da ficha técnica.', entity_type: 'production_batch', entity_id: batch.id });
      }
      for (const batch of batches.filter((row: any) => row.status === 'completed' && Number(row.total_actual_cost || 0) > 0)) {
        const planned = Number(row.estimated_material_cost || 0) + Number(row.estimated_labor_cost || 0);
        const variance = variancePercent(row.total_actual_cost, planned);
        if (planned > 0 && variance > 15) await detect({ unit_id: unitId, alert_key: `batch:${batch.id}:cost`, category: 'cost_variance', severity: variance > 30 ? 'critical' : 'warning', title: `Custo acima do previsto: ${batch.code}`, description: `Desvio de ${variance.toFixed(1)}% no custo total.`, entity_type: 'production_batch', entity_id: batch.id, metric_value: variance, threshold_value: 15 });
      }
      await resolveMissing(base44, unitId, detected);
      await base44.asServiceRole.entities.AuditLog.create({ action: 'refresh', entity_type: 'operational_alerts', entity_id: unitId, item_label: 'Alertas operacionais', reason: 'operational_alerts_refreshed', user_email: user.email, user_name: user.full_name, user_role: user.role, unit_id: unitId, request_id: requestId, after_data: { detected: detected.size }, success: true });
      return Response.json({ alerts, detected_count: detected.size, refreshed_at: now, request_id: requestId });
    }

    const alert = input.alert_id ? await base44.asServiceRole.entities.OperationalAlert.get(input.alert_id) : null;
    if (!alert) return Response.json({ error: 'alert_not_found', request_id: requestId }, { status: 404 });
    if (!canAccessUnit(user, alert.unit_id)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
    if (action === 'acknowledge') {
      const updated = await base44.asServiceRole.entities.OperationalAlert.update(alert.id, { status: 'acknowledged', acknowledged_at: now, acknowledged_by_user_id: user.id });
      return Response.json({ alert: updated, request_id: requestId });
    }
    if (action === 'resolve' || action === 'dismiss') {
      if (!MANAGER_ROLES.has(user.role || '') && !(user.permissions || []).includes('operations.alerts.resolve')) return Response.json({ error: 'manager_permission_required', request_id: requestId }, { status: 403 });
      if (!String(input.note || '').trim()) return Response.json({ error: 'resolution_note_required', request_id: requestId }, { status: 422 });
      const updated = await base44.asServiceRole.entities.OperationalAlert.update(alert.id, { status: action === 'resolve' ? 'resolved' : 'dismissed', resolved_at: now, resolved_by_user_id: user.id, resolution_note: String(input.note) });
      return Response.json({ alert: updated, request_id: requestId });
    }
    return Response.json({ error: 'unsupported_action', request_id: requestId }, { status: 400 });
  } catch (error) {
    console.error(`[manage_operational_alerts:${requestId}]`, error);
    return Response.json({ error: (error as Error)?.message || 'operational_alerts_failed', request_id: requestId }, { status: Number((error as any)?.status || 500) });
  }
});
