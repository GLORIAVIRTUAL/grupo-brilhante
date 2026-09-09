import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { money, number, dateValue, inPeriod, inUnits, groupSum, groupCount, dailySeries, average, percent, openStatus, reportEnvelope } from '../../shared/reportAnalytics.js';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

const REPORT_TYPES = new Set(['production', 'delays', 'rework', 'third_parties', 'stock', 'consumption', 'service_margin', 'employee_productivity', 'cash', 'billing', 'fiscal', 'logistics', 'unit_profitability']);
const ALL_UNITS_ROLES = new Set(['super_admin', 'admin', 'auditor']);
const REPORT_ROLES = new Set(['super_admin', 'admin', 'manager', 'finance', 'auditor']);

function scopeUnits(user: any, requested: string[]) {
  const allowed = [...new Set([user.primary_unit_id, ...(user.allowed_unit_ids || [])].filter(Boolean))];
  if (ALL_UNITS_ROLES.has(user.role) || (user.permissions || []).includes('reports.view_all')) return requested;
  if (requested.some((id) => !allowed.includes(id))) throw new Error('forbidden_unit');
  const scoped = requested.length ? requested : allowed;
  if (!scoped.length) throw new Error('unit_scope_required');
  return scoped;
}
function rowDate(row: any, fields: string[]) { const timestamp = dateValue(row, fields); return timestamp ? new Date(timestamp).toISOString() : null; }
function boundedRows(rows: any[], limit: number) { return rows.slice(0, Math.max(1, Math.min(2000, limit))); }
function daysLate(due: any, reference = Date.now()) { const timestamp = due ? new Date(due).getTime() : 0; return timestamp ? Math.max(0, Math.floor((reference - timestamp) / 86400000)) : 0; }

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const principal = await authorizeUserOrInternal(base44, req, body, {
      allowInternal: false,
      source: 'generate_specialized_report',
    });
    const user = principal.user;
    if (!REPORT_ROLES.has(user.role) && !(user.permissions || []).includes('reports.view') && !(user.permissions || []).includes('reports.view_all')) return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    const type = String(body.report_type || '');
    if (!REPORT_TYPES.has(type)) return Response.json({ error: 'invalid_report_type', request_id: requestId }, { status: 422 });
    const start = body.start_date ? new Date(body.start_date).getTime() : Date.now() - 30 * 86400000;
    const end = body.end_date ? new Date(body.end_date).getTime() + 86400000 : Date.now() + 86400000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return Response.json({ error: 'invalid_period', request_id: requestId }, { status: 422 });
    const unitIds = scopeUnits(user, Array.isArray(body.unit_ids) ? body.unit_ids.filter(Boolean) : body.unit_id ? [body.unit_id] : []);
    const limit = Number(body.limit || 500);
    const list = async (name: string, sort = '-created_date', max = 10000) => base44.asServiceRole.entities[name].list(sort, max);
    const units = await list('Unit', 'name', 1000);
    const unitMap = new Map(units.map((unit: any) => [unit.id, unit.name]));
    const quality: any = { period_start: new Date(start).toISOString(), period_end: new Date(end).toISOString(), unit_count: unitIds.length || units.length, limitations: [] };
    let report: any;

    if (type === 'production') {
      const [allBatches, machines] = await Promise.all([list('ProductionBatch', '-completed_at'), list('MachineState', 'name', 2000)]);
      const batches = allBatches.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['completed_at', 'started_at', 'scheduled_at', 'created_date']));
      const completed = batches.filter((row: any) => row.status === 'completed');
      const pieces = batches.reduce((sum: number, row: any) => sum + number(row.piece_count || row.garment_item_ids?.length), 0);
      const weight = batches.reduce((sum: number, row: any) => sum + number(row.total_weight_kg), 0);
      const cost = completed.reduce((sum: number, row: any) => sum + number(row.total_actual_cost), 0);
      const machineMap = new Map(machines.map((row: any) => [row.id, row.name || row.machine_name || row.id]));
      const rows = completed.map((row: any) => ({ id: row.id, code: row.code, unit: unitMap.get(row.unit_id) || row.unit_id, stage: row.stage, machine: machineMap.get(row.machine_id) || row.machine_id || 'Sem máquina', operator: row.operator_name || row.operator_user_id, pieces: number(row.piece_count), weight_kg: number(row.total_weight_kg), capacity_percent: number(row.capacity_percent), actual_minutes: number(row.actual_minutes), planned_minutes: number(row.estimated_minutes), total_cost: money(row.total_actual_cost), cost_variance: money(row.cost_variance), completed_at: row.completed_at }));
      report = reportEnvelope(type, { batches: batches.length, completed_batches: completed.length, pieces, weight_kg: money(weight), actual_cost: money(cost), average_cycle_minutes: average(completed.map((row: any) => row.actual_minutes)), average_capacity_percent: average(batches.map((row: any) => row.capacity_percent)), completion_rate_percent: percent(completed.length, batches.length) }, dailySeries(completed, (row: any) => row.piece_count, ['completed_at']), [{ key: 'stage', label: 'Lotes por etapa', items: groupCount(batches, (row: any) => row.stage) }, { key: 'machine', label: 'Peças por máquina', items: groupSum(batches, (row: any) => machineMap.get(row.machine_id) || row.machine_id || 'Sem máquina', (row: any) => row.piece_count) }], boundedRows(rows, limit), ['Volume usa `piece_count` do lote.', 'Custo real soma material, mão de obra, água, energia e outros já consolidados em `total_actual_cost`.'], quality);
    }

    if (type === 'delays') {
      const [garments, batches, reworks, thirdParty, pickups] = await Promise.all([list('GarmentItem', '-due_at'), list('ProductionBatch', '-scheduled_at'), list('ReworkCase', '-due_at'), list('ThirdPartyJob', '-expected_return_at'), list('Pickup', '-scheduled_at')]);
      const reference = Math.min(Date.now(), end);
      const candidates = [
        ...garments.filter((row: any) => inUnits(row, unitIds) && openStatus(row.status) && row.due_at && new Date(row.due_at).getTime() < reference).map((row: any) => ({ kind: 'Peça', id: row.id, unit_id: row.unit_id, label: row.garment_code || row.ticket_number, status: row.status, due_at: row.due_at, responsible: row.location_label || row.current_production_stage })),
        ...batches.filter((row: any) => inUnits(row, unitIds) && openStatus(row.status) && row.scheduled_at && new Date(row.scheduled_at).getTime() < reference).map((row: any) => ({ kind: 'Lote', id: row.id, unit_id: row.unit_id, label: row.code, status: row.status, due_at: row.scheduled_at, responsible: row.operator_name || row.machine_id })),
        ...reworks.filter((row: any) => inUnits(row, unitIds) && openStatus(row.status) && row.due_at && new Date(row.due_at).getTime() < reference).map((row: any) => ({ kind: 'Retrabalho', id: row.id, unit_id: row.unit_id, label: row.reason_code, status: row.status, due_at: row.due_at, responsible: row.responsible_team || row.responsible_user_id })),
        ...thirdParty.filter((row: any) => inUnits(row, unitIds) && openStatus(row.status) && row.expected_return_at && new Date(row.expected_return_at).getTime() < reference).map((row: any) => ({ kind: 'Terceiro', id: row.id, unit_id: row.unit_id, label: row.code, status: row.status, due_at: row.expected_return_at, responsible: row.partner_id })),
        ...pickups.filter((row: any) => (!unitIds.length || unitIds.includes(row.unit_id)) && row.status === 'scheduled' && row.scheduled_at && new Date(row.scheduled_at).getTime() < reference).map((row: any) => ({ kind: 'Coleta', id: row.id, unit_id: row.unit_id, label: row.address, status: row.status, due_at: row.scheduled_at, responsible: row.driver_name || row.driver_user_id })),
      ].map((row: any) => ({ ...row, unit: unitMap.get(row.unit_id) || row.unit_id || 'Não informada', days_late: daysLate(row.due_at, reference) })).sort((a, b) => b.days_late - a.days_late);
      report = reportEnvelope(type, { overdue_items: candidates.length, critical_over_7_days: candidates.filter((row) => row.days_late > 7).length, average_days_late: average(candidates.map((row) => row.days_late)), maximum_days_late: Math.max(0, ...candidates.map((row) => row.days_late)) }, [], [{ key: 'kind', label: 'Atrasos por origem', items: groupCount(candidates, (row) => row.kind) }, { key: 'unit', label: 'Atrasos por unidade', items: groupCount(candidates, (row) => row.unit) }], boundedRows(candidates, limit), ['Atraso considera registros ainda abertos cuja data limite é anterior ao fim do período.', 'Coletas antigas sem `unit_id` são classificadas como unidade não informada.'], { ...quality, limitations: ['Prazos dependem do preenchimento de `due_at`, `scheduled_at` ou `expected_return_at`.'] });
    }

    if (type === 'rework') {
      const [allCases, garments] = await Promise.all([list('ReworkCase', '-opened_at'), list('GarmentItem', '-completed_at')]);
      const cases = allCases.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['opened_at', 'completed_at', 'created_date']));
      const completedGarments = garments.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['delivered_at', 'ready_at', 'created_date']) && ['ready', 'delivered'].includes(row.status));
      const completed = cases.filter((row: any) => row.status === 'completed');
      const rows = cases.map((row: any) => ({ id: row.id, unit: unitMap.get(row.unit_id) || row.unit_id, reason: row.reason_code, root_cause: row.root_cause, team: row.responsible_team, responsible_user_id: row.responsible_user_id, priority: row.priority, status: row.status, customer_impact: row.customer_impact, actual_cost: money(row.actual_cost), opened_at: row.opened_at, completed_at: row.completed_at, cycle_hours: row.completed_at && row.opened_at ? money((new Date(row.completed_at).getTime() - new Date(row.opened_at).getTime()) / 3600000) : null }));
      report = reportEnvelope(type, { cases: cases.length, completed: completed.length, open: cases.filter((row: any) => openStatus(row.status)).length, actual_cost: money(cases.reduce((sum: number, row: any) => sum + number(row.actual_cost), 0)), rework_rate_percent: percent(cases.length, completedGarments.length), average_resolution_hours: average(rows.filter((row) => row.cycle_hours != null).map((row) => row.cycle_hours)) }, dailySeries(cases, () => 1, ['opened_at']), [{ key: 'reason', label: 'Causas de retrabalho', items: groupCount(cases, (row: any) => row.reason_code) }, { key: 'team', label: 'Equipe responsável', items: groupCount(cases, (row: any) => row.responsible_team) }, { key: 'impact', label: 'Impacto no cliente', items: groupCount(cases, (row: any) => row.customer_impact) }], boundedRows(rows, limit), ['Taxa de retrabalho = casos abertos / peças concluídas no período.', 'Custo usa o valor efetivo registrado no caso.'], quality);
    }

    if (type === 'third_parties') {
      const [jobs, partners] = await Promise.all([list('ThirdPartyJob', '-sent_at'), list('ThirdPartyPartner', 'name', 2000)]);
      const partnerMap = new Map(partners.map((row: any) => [row.id, row.name || row.legal_name || row.id]));
      const filtered = jobs.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['sent_at', 'returned_at', 'completed_at', 'created_date']));
      const now = Math.min(Date.now(), end);
      const rows = filtered.map((row: any) => ({ id: row.id, code: row.code, unit: unitMap.get(row.unit_id) || row.unit_id, partner: partnerMap.get(row.partner_id) || row.partner_id, service: row.service_description, pieces: row.garment_item_ids?.length || 0, status: row.status, estimated_cost: money(row.estimated_cost), actual_cost: money(row.actual_cost), variance: money(number(row.actual_cost) - number(row.estimated_cost)), sent_at: row.sent_at, expected_return_at: row.expected_return_at, returned_at: row.returned_at, delayed: openStatus(row.status) && row.expected_return_at && new Date(row.expected_return_at).getTime() < now }));
      report = reportEnvelope(type, { jobs: filtered.length, pieces: rows.reduce((sum, row) => sum + row.pieces, 0), actual_cost: money(rows.reduce((sum, row) => sum + row.actual_cost, 0)), cost_variance: money(rows.reduce((sum, row) => sum + row.variance, 0)), delayed_jobs: rows.filter((row) => row.delayed).length, completion_rate_percent: percent(filtered.filter((row: any) => row.status === 'completed').length, filtered.length) }, dailySeries(filtered, (row: any) => row.actual_cost, ['returned_at', 'completed_at', 'sent_at']), [{ key: 'partner', label: 'Custo por parceiro', items: groupSum(rows, (row) => row.partner, (row) => row.actual_cost) }, { key: 'status', label: 'Ordens por estado', items: groupCount(rows, (row) => row.status) }], boundedRows(rows, limit), ['Atraso considera retorno esperado vencido e ordem ainda aberta.'], quality);
    }

    if (type === 'stock') {
      const [items, lots, movements] = await Promise.all([list('StockItem', 'name', 10000), list('StockLot', 'expiry_date', 20000), list('StockMovement', '-occurred_at', 30000)]);
      const scopedItems = items.filter((row: any) => inUnits(row, unitIds) && row.active !== false);
      const scopedLots = lots.filter((row: any) => inUnits(row, unitIds) && row.status !== 'cancelled');
      const periodMovements = movements.filter((row: any) => inUnits(row, unitIds) && row.status !== 'cancelled' && inPeriod(row, start, end, ['occurred_at']));
      const itemRows = scopedItems.map((item: any) => { const itemLots = scopedLots.filter((lot: any) => lot.stock_item_id === item.id); const expiring = itemLots.filter((lot: any) => lot.expiry_date && new Date(lot.expiry_date).getTime() <= Date.now() + 30 * 86400000 && number(lot.current_quantity) > 0).length; return { id: item.id, unit: unitMap.get(item.unit_id) || item.unit_id, sku: item.sku, name: item.name, category: item.category, current_quantity: number(item.current_quantity), reserved_quantity: number(item.reserved_quantity), available_quantity: number(item.available_quantity), minimum_quantity: number(item.minimum_quantity), average_cost: money(item.average_cost), inventory_value: money(number(item.current_quantity) * number(item.average_cost)), low_stock: number(item.available_quantity) <= number(item.minimum_quantity), expiring_lots_30d: expiring, stockout_at: item.estimated_stockout_at, storage_location: item.storage_location } });
      report = reportEnvelope(type, { active_items: itemRows.length, inventory_value: money(itemRows.reduce((sum, row) => sum + row.inventory_value, 0)), low_stock_items: itemRows.filter((row) => row.low_stock).length, expiring_lots_30d: itemRows.reduce((sum, row) => sum + row.expiring_lots_30d, 0), losses_in_period: money(periodMovements.filter((row: any) => row.movement_type === 'loss').reduce((sum: number, row: any) => sum + number(row.total_cost), 0)), adjustments_in_period: periodMovements.filter((row: any) => ['adjustment_in', 'adjustment_out', 'inventory_difference'].includes(row.movement_type)).length }, [], [{ key: 'category', label: 'Valor por categoria', items: groupSum(itemRows, (row) => row.category, (row) => row.inventory_value) }, { key: 'unit', label: 'Valor por unidade', items: groupSum(itemRows, (row) => row.unit, (row) => row.inventory_value) }], boundedRows(itemRows.sort((a, b) => b.inventory_value - a.inventory_value), limit), ['Valor de estoque = quantidade atual × custo médio.', 'Lotes a vencer consideram os próximos 30 dias.'], quality);
    }

    if (type === 'consumption') {
      const [movements, items, batches] = await Promise.all([list('StockMovement', '-occurred_at', 30000), list('StockItem', 'name', 10000), list('ProductionBatch', '-completed_at', 10000)]);
      const itemMap = new Map(items.map((row: any) => [row.id, row]));
      const filtered = movements.filter((row: any) => inUnits(row, unitIds) && row.status === 'posted' && ['consumption', 'consumption_reversal', 'loss'].includes(row.movement_type) && inPeriod(row, start, end, ['occurred_at']));
      const rows = filtered.map((row: any) => ({ id: row.id, unit: unitMap.get(row.unit_id) || row.unit_id, item: itemMap.get(row.stock_item_id)?.name || row.stock_item_id, sku: itemMap.get(row.stock_item_id)?.sku, movement_type: row.movement_type, quantity: number(row.quantity), unit_cost: money(row.unit_cost), total_cost: money(row.total_cost), batch: batches.find((batch: any) => batch.id === row.production_batch_id)?.code || row.production_batch_id, machine_id: row.machine_id, occurred_at: row.occurred_at }));
      const consumption = rows.filter((row) => row.movement_type === 'consumption');
      const losses = rows.filter((row) => row.movement_type === 'loss');
      report = reportEnvelope(type, { movements: rows.length, consumed_quantity: money(consumption.reduce((sum, row) => sum + Math.abs(row.quantity), 0)), consumption_cost: money(consumption.reduce((sum, row) => sum + Math.abs(row.total_cost), 0)), loss_quantity: money(losses.reduce((sum, row) => sum + Math.abs(row.quantity), 0)), loss_cost: money(losses.reduce((sum, row) => sum + Math.abs(row.total_cost), 0)), loss_percent_of_cost: percent(losses.reduce((sum, row) => sum + Math.abs(row.total_cost), 0), rows.reduce((sum, row) => sum + Math.abs(row.total_cost), 0)) }, dailySeries(rows, (row) => Math.abs(row.total_cost), ['occurred_at']), [{ key: 'item', label: 'Custo por insumo', items: groupSum(rows, (row) => row.item, (row) => Math.abs(row.total_cost)) }, { key: 'type', label: 'Custo por tipo', items: groupSum(rows, (row) => row.movement_type, (row) => Math.abs(row.total_cost)) }], boundedRows(rows, limit), ['Consumo e perda usam movimentos postados; reversões aparecem separadas.'], quality);
    }

    if (type === 'service_margin') {
      const garments = (await list('GarmentItem', '-delivered_at', 20000)).filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['delivered_at', 'ready_at', 'received_at', 'created_date']) && row.status !== 'cancelled');
      const map = new Map();
      for (const garment of garments) {
        const services = garment.services?.length ? garment.services : [{ service_id: garment.product_id, name: garment.product_name || 'Produto legado', total_amount: garment.total_amount }];
        const garmentRevenue = number(garment.total_amount);
        const garmentCost = number(garment.total_production_cost);
        const declaredRevenue = services.reduce((sum: number, service: any) => sum + number(service.total_amount || number(service.unit_price) * number(service.quantity || 1)), 0) || garmentRevenue;
        for (const service of services) {
          const key = service.service_id || service.name || 'unknown';
          const revenue = declaredRevenue ? garmentRevenue * (number(service.total_amount || number(service.unit_price) * number(service.quantity || 1)) / declaredRevenue) : garmentRevenue / services.length;
          const material = number(service.actual_material_cost);
          const allocatedCost = material + Math.max(0, garmentCost - services.reduce((sum: number, item: any) => sum + number(item.actual_material_cost), 0)) * (revenue / Math.max(garmentRevenue, 0.01));
          const current = map.get(key) || { service_id: key, service: service.name || key, quantity: 0, revenue: 0, cost: 0 };
          current.quantity += number(service.quantity || 1); current.revenue += revenue; current.cost += allocatedCost; map.set(key, current);
        }
      }
      const rows = [...map.values()].map((row: any) => ({ ...row, revenue: money(row.revenue), cost: money(row.cost), margin: money(row.revenue - row.cost), margin_percent: percent(row.revenue - row.cost, row.revenue), average_price: row.quantity ? money(row.revenue / row.quantity) : 0 })).sort((a, b) => b.margin - a.margin);
      const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0); const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
      report = reportEnvelope(type, { services: rows.length, pieces: garments.length, revenue: money(totalRevenue), direct_cost: money(totalCost), contribution_margin: money(totalRevenue - totalCost), contribution_margin_percent: percent(totalRevenue - totalCost, totalRevenue), negative_margin_services: rows.filter((row) => row.margin < 0).length }, [], [{ key: 'margin', label: 'Margem por serviço', items: rows.map((row) => ({ label: row.service, value: row.margin })) }, { key: 'revenue', label: 'Receita por serviço', items: rows.map((row) => ({ label: row.service, value: row.revenue })) }], boundedRows(rows, limit), ['Margem considera receita da peça e custos de produção registrados; custos comuns da peça são rateados pela participação da receita do serviço.', 'Não inclui despesas administrativas não atribuídas ao serviço.'], { ...quality, limitations: garments.some((row: any) => !row.total_production_cost) ? ['Há peças sem custo de produção registrado; a margem pode estar superestimada.'] : [] });
    }

    if (type === 'employee_productivity') {
      const [labor, users, batches] = await Promise.all([list('LaborEntry', '-completed_at', 30000), list('User', 'display_name', 5000), list('ProductionBatch', '-completed_at', 10000)]);
      const userMap = new Map(users.map((row: any) => [row.id, row.display_name || row.full_name || row.email || row.id]));
      const batchMap = new Map(batches.map((row: any) => [row.id, row]));
      const entries = labor.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['completed_at', 'started_at', 'created_date']));
      const grouped = new Map(); for (const entry of entries) { const key = entry.operator_user_id; const current = grouped.get(key) || { user_id: key, employee: userMap.get(key) || key, entries: 0, minutes: 0, labor_cost: 0, rework_minutes: 0, pieces: 0, completed_entries: 0 }; current.entries++; current.minutes += number(entry.duration_minutes || entry.accumulated_minutes); current.labor_cost += number(entry.labor_cost); current.rework_minutes += entry.is_rework ? number(entry.duration_minutes || entry.accumulated_minutes) : 0; current.pieces += number(batchMap.get(entry.production_batch_id)?.piece_count); current.completed_entries += entry.status === 'completed' ? 1 : 0; grouped.set(key, current); }
      const rows = [...grouped.values()].map((row: any) => ({ ...row, hours: money(row.minutes / 60), labor_cost: money(row.labor_cost), pieces_per_hour: row.minutes ? money(row.pieces / (row.minutes / 60)) : 0, rework_percent: percent(row.rework_minutes, row.minutes), completion_rate_percent: percent(row.completed_entries, row.entries) })).sort((a, b) => b.pieces_per_hour - a.pieces_per_hour);
      report = reportEnvelope(type, { employees: rows.length, labor_hours: money(rows.reduce((sum, row) => sum + row.hours, 0)), labor_cost: money(rows.reduce((sum, row) => sum + row.labor_cost, 0)), pieces: money(rows.reduce((sum, row) => sum + row.pieces, 0)), average_pieces_per_hour: average(rows.map((row) => row.pieces_per_hour)), rework_hours: money(rows.reduce((sum, row) => sum + row.rework_minutes, 0) / 60) }, [], [{ key: 'productivity', label: 'Peças por hora', items: rows.map((row) => ({ label: row.employee, value: row.pieces_per_hour })) }, { key: 'labor_cost', label: 'Custo de mão de obra', items: rows.map((row) => ({ label: row.employee, value: row.labor_cost })) }], boundedRows(rows, limit), ['Peças são atribuídas a cada apontamento do lote; quando vários operadores atuam no mesmo lote, o volume não deve ser somado para medir produção total.', 'Use peças/hora para comparação individual e o relatório de produção para volume total.'], quality);
    }

    if (type === 'cash') {
      const [sessions, movements] = await Promise.all([list('CashSession', '-opened_at', 10000), list('CashMovement', '-occurred_at', 30000)]);
      const scopedSessions = sessions.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['closed_at', 'opened_at']));
      const scopedMovements = movements.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['occurred_at']));
      const rows = scopedSessions.map((row: any) => ({ id: row.id, session_number: row.session_number, unit: unitMap.get(row.unit_id) || row.unit_id, operator: row.operator_name || row.operator_user_id, status: row.status, opened_at: row.opened_at, closed_at: row.closed_at, opening_amount: money(row.opening_amount), income_amount: money(row.income_amount), supply_amount: money(row.supply_amount), withdrawal_amount: money(row.withdrawal_amount), refund_amount: money(row.refund_amount), expected_cash_amount: money(row.expected_cash_amount), counted_cash_amount: money(row.counted_cash_amount), difference_amount: money(row.difference_amount), pending_reconciliation_amount: money(row.pending_reconciliation_amount), payment_summary: row.payment_summary || {} }));
      report = reportEnvelope(type, { sessions: rows.length, closed_sessions: rows.filter((row) => row.status === 'closed').length, income: money(rows.reduce((sum, row) => sum + row.income_amount, 0)), supplies: money(rows.reduce((sum, row) => sum + row.supply_amount, 0)), withdrawals: money(rows.reduce((sum, row) => sum + row.withdrawal_amount, 0)), refunds: money(rows.reduce((sum, row) => sum + row.refund_amount, 0)), difference: money(rows.reduce((sum, row) => sum + row.difference_amount, 0)), pending_reconciliation: money(rows.reduce((sum, row) => sum + row.pending_reconciliation_amount, 0)), movement_count: scopedMovements.length }, dailySeries(scopedMovements, (row: any) => row.amount, ['occurred_at']), [{ key: 'movement_type', label: 'Movimentos por tipo', items: groupSum(scopedMovements, (row: any) => row.movement_type, (row: any) => row.amount) }, { key: 'unit', label: 'Diferença por unidade', items: groupSum(rows, (row) => row.unit, (row) => row.difference_amount) }], boundedRows(rows, limit), ['Diferença usa o valor fechado e aprovado na sessão de caixa.'], quality);
    }

    if (type === 'billing') {
      const [statements, receivables, agreements] = await Promise.all([list('BillingStatement', '-period_end', 10000), list('AccountsReceivable', '-due_date', 30000), list('BillingAgreement', 'name', 5000)]);
      const agreementMap = new Map(agreements.map((row: any) => [row.id, row.name || row.code || row.id]));
      const scoped = statements.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['issued_at', 'period_end', 'created_date']));
      const periodReceivables = receivables.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['due_date', 'created_date']));
      const now = Math.min(Date.now(), end);
      const rows = scoped.map((row: any) => ({ id: row.id, statement_number: row.statement_number, unit: unitMap.get(row.unit_id) || row.unit_id, agreement: agreementMap.get(row.billing_agreement_id) || row.billing_agreement_id, status: row.status, period_start: row.period_start, period_end: row.period_end, due_date: row.due_date, orders: row.order_ids?.length || 0, total_amount: money(row.total_amount), paid_amount: money(row.paid_amount), open_amount: money(row.open_amount), overdue: number(row.open_amount) > 0 && row.due_date && new Date(row.due_date).getTime() < now }));
      report = reportEnvelope(type, { statements: rows.length, issued_amount: money(rows.reduce((sum, row) => sum + row.total_amount, 0)), paid_amount: money(rows.reduce((sum, row) => sum + row.paid_amount, 0)), open_amount: money(rows.reduce((sum, row) => sum + row.open_amount, 0)), overdue_amount: money(rows.filter((row) => row.overdue).reduce((sum, row) => sum + row.open_amount, 0)), overdue_statements: rows.filter((row) => row.overdue).length, collection_rate_percent: percent(rows.reduce((sum, row) => sum + row.paid_amount, 0), rows.reduce((sum, row) => sum + row.total_amount, 0)), receivables_in_period: periodReceivables.length }, dailySeries(scoped, (row: any) => row.total_amount, ['issued_at', 'period_end']), [{ key: 'agreement', label: 'Faturamento por convênio', items: groupSum(rows, (row) => row.agreement, (row) => row.total_amount) }, { key: 'status', label: 'Demonstrativos por estado', items: groupCount(rows, (row) => row.status) }], boundedRows(rows, limit), ['Inadimplência considera saldo aberto após a data de vencimento.'], quality);
    }

    if (type === 'fiscal') {
      const documents = (await list('FiscalDocument', '-issue_date', 20000)).filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['authorized_at', 'issue_date', 'competence_date', 'created_date']));
      const rows = documents.map((row: any) => ({ id: row.id, unit: unitMap.get(row.unit_id) || row.unit_id, type: row.document_type, status: row.status, provider: row.provider, environment: row.environment, rps_number: row.rps_number, nfse_number: row.nfse_number, competence_date: row.competence_date, total_amount: money(row.total_amount), taxable_amount: money(row.taxable_amount), iss_amount: money(row.iss_amount), attempt_count: number(row.attempt_count), error: row.last_error_message, authorized_at: row.authorized_at, cancelled_at: row.cancelled_at }));
      report = reportEnvelope(type, { documents: rows.length, total_amount: money(rows.reduce((sum, row) => sum + row.total_amount, 0)), authorized: rows.filter((row) => row.status === 'authorized').length, ready_or_draft: rows.filter((row) => ['draft', 'ready'].includes(row.status)).length, rejected_or_error: rows.filter((row) => ['rejected', 'error'].includes(row.status)).length, cancelled: rows.filter((row) => row.status === 'cancelled').length, iss_amount: money(rows.reduce((sum, row) => sum + row.iss_amount, 0)) }, dailySeries(documents, (row: any) => row.total_amount, ['authorized_at', 'issue_date', 'competence_date']), [{ key: 'status', label: 'Documentos por estado', items: groupCount(rows, (row) => row.status) }, { key: 'unit', label: 'Valor por unidade', items: groupSum(rows, (row) => row.unit, (row) => row.total_amount) }], boundedRows(rows, limit), ['Enquanto a transmissão estiver desativada, o relatório refletirá principalmente RPS preparados e validados.'], quality);
    }

    if (type === 'logistics') {
      const [pickups, deliveries] = await Promise.all([list('Pickup', '-scheduled_at', 20000), list('DeliveryReceipt', '-delivered_at', 20000)]);
      const scopedPickups = pickups.filter((row: any) => (!unitIds.length || !row.unit_id || unitIds.includes(row.unit_id)) && inPeriod(row, start, end, ['completed_at', 'scheduled_at', 'created_date']));
      const scopedDeliveries = deliveries.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['delivered_at']));
      const pickupRows = scopedPickups.map((row: any) => ({ kind: 'Coleta', id: row.id, unit: unitMap.get(row.unit_id) || row.unit_id || 'Não informada', status: row.status, neighborhood: row.neighborhood, address: row.address, scheduled_at: row.scheduled_at, completed_at: row.completed_at, fee: money(row.fee), priority: row.priority, driver: row.driver_name || row.driver_user_id, vehicle: row.vehicle_id }));
      const deliveryRows = scopedDeliveries.map((row: any) => ({ kind: 'Entrega', id: row.id, unit: unitMap.get(row.unit_id) || row.unit_id, status: row.status, delivery_type: row.delivery_type, scope: row.delivery_scope, pieces: number(row.piece_count), value: money(row.delivered_value), delivered_at: row.delivered_at, operator: row.operator_user_id }));
      const rows = [...pickupRows, ...deliveryRows];
      report = reportEnvelope(type, { pickups: pickupRows.length, completed_pickups: pickupRows.filter((row) => row.status === 'completed').length, missed_pickups: pickupRows.filter((row) => row.status === 'missed').length, pickup_completion_rate_percent: percent(pickupRows.filter((row) => row.status === 'completed').length, pickupRows.length), deliveries: deliveryRows.length, delivered_pieces: deliveryRows.reduce((sum, row) => sum + row.pieces, 0), delivery_value: money(deliveryRows.reduce((sum, row) => sum + row.value, 0)), partial_deliveries: deliveryRows.filter((row) => row.scope === 'partial').length }, dailySeries(rows, () => 1, ['delivered_at', 'completed_at', 'scheduled_at']), [{ key: 'pickup_status', label: 'Coletas por estado', items: groupCount(pickupRows, (row) => row.status) }, { key: 'neighborhood', label: 'Coletas por bairro', items: groupCount(pickupRows, (row) => row.neighborhood) }, { key: 'delivery_type', label: 'Entregas por tipo', items: groupCount(deliveryRows, (row) => row.delivery_type) }], boundedRows(rows, limit), ['Distância, duração e tentativas detalhadas serão enriquecidas pela jornada de campo da Onda 4.'], quality);
    }

    if (type === 'unit_profitability') {
      const [orders, garments, batches, financeEntries, thirdParty, payments] = await Promise.all([list('Order', '-created_date', 30000), list('GarmentItem', '-delivered_at', 30000), list('ProductionBatch', '-completed_at', 20000), list('FinanceEntry', '-date', 30000), list('ThirdPartyJob', '-completed_at', 10000), list('Payment', '-confirmed_at', 30000)]);
      const scopedOrders = orders.filter((row: any) => inUnits(row, unitIds) && row.status !== 'cancelled' && inPeriod(row, start, end, ['completed_at', 'created_date']));
      const scopedGarments = garments.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['delivered_at', 'ready_at', 'received_at', 'created_date']));
      const scopedBatches = batches.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['completed_at', 'started_at', 'created_date']));
      const scopedFinance = financeEntries.filter((row: any) => inUnits(row, unitIds) && row.status !== 'cancelled' && inPeriod(row, start, end, ['date', 'occurred_at', 'created_date']));
      const scopedThird = thirdParty.filter((row: any) => inUnits(row, unitIds) && inPeriod(row, start, end, ['completed_at', 'returned_at', 'sent_at', 'created_date']));
      const scopedPayments = payments.filter((row: any) => inUnits(row, unitIds) && ['confirmed', 'paid', 'succeeded'].includes(row.status) && inPeriod(row, start, end, ['confirmed_at', 'paid_at', 'created_date']));
      const relevantUnits = unitIds.length ? units.filter((unit: any) => unitIds.includes(unit.id)) : units;
      const rows = relevantUnits.map((unit: any) => { const unitOrders = scopedOrders.filter((row: any) => row.unit_id === unit.id); const orderRevenue = unitOrders.reduce((sum: number, row: any) => sum + number(row.total_amount), 0); const paymentRevenue = scopedPayments.filter((row: any) => row.unit_id === unit.id).reduce((sum: number, row: any) => sum + number(row.amount), 0); const revenue = paymentRevenue || orderRevenue; const productionCost = scopedBatches.filter((row: any) => row.unit_id === unit.id).reduce((sum: number, row: any) => sum + number(row.total_actual_cost), 0); const thirdPartyCost = scopedThird.filter((row: any) => row.unit_id === unit.id).reduce((sum: number, row: any) => sum + number(row.actual_cost), 0); const entries = scopedFinance.filter((row: any) => row.unit_id === unit.id); const operatingIncome = entries.filter((row: any) => row.type === 'income').reduce((sum: number, row: any) => sum + number(row.amount), 0); const operatingExpense = entries.filter((row: any) => row.type === 'expense').reduce((sum: number, row: any) => sum + number(row.amount), 0); const expenses = productionCost + thirdPartyCost + operatingExpense; const garmentsCount = scopedGarments.filter((row: any) => row.unit_id === unit.id).length; return { unit_id: unit.id, unit: unit.name, orders: unitOrders.length, garments: garmentsCount, revenue: money(revenue + operatingIncome), production_cost: money(productionCost), third_party_cost: money(thirdPartyCost), operating_expense: money(operatingExpense), total_cost: money(expenses), profit: money(revenue + operatingIncome - expenses), margin_percent: percent(revenue + operatingIncome - expenses, revenue + operatingIncome), revenue_per_garment: garmentsCount ? money((revenue + operatingIncome) / garmentsCount) : 0 }; });
      const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0); const totalCost = rows.reduce((sum, row) => sum + row.total_cost, 0);
      report = reportEnvelope(type, { units: rows.length, revenue: money(totalRevenue), total_cost: money(totalCost), profit: money(totalRevenue - totalCost), margin_percent: percent(totalRevenue - totalCost, totalRevenue), profitable_units: rows.filter((row) => row.profit >= 0).length, negative_units: rows.filter((row) => row.profit < 0).length }, [], [{ key: 'profit', label: 'Resultado por unidade', items: rows.map((row) => ({ label: row.unit, value: row.profit })) }, { key: 'margin', label: 'Margem por unidade', items: rows.map((row) => ({ label: row.unit, value: row.margin_percent })) }], boundedRows(rows.sort((a, b) => b.profit - a.profit), limit), ['Receita prioriza pagamentos confirmados; quando inexistentes no período, usa pedidos não cancelados.', 'Custos incluem produção, terceiros e saídas financeiras; transferências internas precisam ser categorizadas corretamente para não duplicar despesas.'], { ...quality, limitations: ['Rentabilidade depende da conciliação financeira e do custo de produção completo.'] });
    }

    if (!report) return Response.json({ error: 'report_builder_not_available', request_id: requestId }, { status: 422 });
    await base44.asServiceRole.entities.AuditLog.create({ action: 'view', entity_type: 'specialized_report', entity_id: requestId, item_label: type, reason: 'specialized_report_generated', user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role, unit_id: unitIds.length === 1 ? unitIds[0] : user.primary_unit_id, request_id: requestId, domain: 'analytics', severity: 'info', result: 'success', occurred_at: new Date().toISOString(), metadata: { report_type: type, start_date: new Date(start).toISOString(), end_date: new Date(end).toISOString(), unit_ids: unitIds, row_count: report.rows.length }, success: true });
    return Response.json({ report, request_id: requestId });
  } catch (error: any) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    const status = ['forbidden_unit', 'invalid_period', 'unit_scope_required'].includes(error?.message) ? 422 : 500;
    return Response.json({ error: error?.message || 'specialized_report_failed', request_id: requestId }, { status });
  }
});
