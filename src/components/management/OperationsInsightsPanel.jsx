import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Gauge, Loader2, PackageMinus, RefreshCw, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const CATEGORY = { low_stock: 'Estoque baixo', stockout: 'Sem estoque', expiring_lot: 'Lote a vencer', expired_lot: 'Lote vencido', inventory_variance: 'Divergência', machine_overload: 'Sobrecarga', machine_idle: 'Ociosidade', machine_stopped: 'Máquina parada', batch_delayed: 'Lote atrasado', capacity_bottleneck: 'Gargalo', consumption_variance: 'Desvio de consumo', cost_variance: 'Desvio de custo', loss: 'Perda', quality: 'Qualidade', other: 'Outro' };

export default function OperationsInsightsPanel({ alerts = [], batches = [], stockMovements = [], machines = [], selectedUnitId, defaultUnitId, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const unitId = selectedUnitId === 'all' ? defaultUnitId : selectedUnitId;
  const scopedAlerts = alerts.filter((alert) => selectedUnitId === 'all' || alert.unit_id === selectedUnitId);
  const openAlerts = scopedAlerts.filter((alert) => ['open', 'acknowledged'].includes(alert.status));
  const scopedBatches = batches.filter((batch) => selectedUnitId === 'all' || batch.unit_id === selectedUnitId);
  const scopedMachines = machines.filter((machine) => !machine.unit_id || selectedUnitId === 'all' || machine.unit_id === selectedUnitId);
  const scopedMovements = stockMovements.filter((movement) => selectedUnitId === 'all' || movement.unit_id === selectedUnitId);
  const metrics = useMemo(() => {
    const sevenDays = Date.now() - 7 * 86400000;
    const completed = scopedBatches.filter((batch) => batch.status === 'completed' && Date.parse(batch.completed_at || 0) >= sevenDays);
    const late = scopedBatches.filter((batch) => !['completed', 'cancelled'].includes(batch.status) && batch.scheduled_at && Date.parse(batch.scheduled_at) < Date.now()).length;
    const runningMachines = scopedMachines.filter((machine) => ['running', 'paused', 'finished'].includes(machine.operational_status)).length;
    const utilization = scopedMachines.length ? (runningMachines / scopedMachines.length) * 100 : 0;
    const lossValue = scopedMovements.filter((movement) => movement.movement_type === 'loss' && Date.parse(movement.occurred_at || 0) >= sevenDays).reduce((sum, movement) => sum + Number(movement.total_cost || 0), 0);
    const totalCost = completed.reduce((sum, batch) => sum + Number(batch.total_actual_cost || 0), 0);
    const pieces = completed.reduce((sum, batch) => sum + Number(batch.piece_count || 0), 0);
    const planned = completed.reduce((sum, batch) => sum + Number(batch.estimated_material_cost || 0) + Number(batch.estimated_labor_cost || 0), 0);
    const costVariance = planned > 0 ? ((totalCost - planned) / planned) * 100 : 0;
    return { completed: completed.length, pieces, late, utilization, lossValue, totalCost, costVariance };
  }, [scopedBatches, scopedMachines, scopedMovements]);

  const refresh = async () => {
    if (!unitId) return toast.error('Selecione uma unidade específica.');
    setBusy(true); try { await base44.functions.invoke('manage_operational_alerts', { action: 'refresh', unit_id: unitId }); toast.success('Indicadores e alertas atualizados.'); onRefresh?.(); } catch (error) { console.error(error); toast.error('Não foi possível atualizar os alertas.'); } finally { setBusy(false); }
  };
  const acknowledge = async (alert) => { setBusy(true); try { await base44.functions.invoke('manage_operational_alerts', { action: 'acknowledge', alert_id: alert.id }); onRefresh?.(); } catch (error) { console.error(error); toast.error('Não foi possível reconhecer o alerta.'); } finally { setBusy(false); } };
  const resolve = async (alert) => { const note = window.prompt('Como o alerta foi resolvido?'); if (!note?.trim()) return; setBusy(true); try { await base44.functions.invoke('manage_operational_alerts', { action: 'resolve', alert_id: alert.id, note }); toast.success('Alerta resolvido.'); onRefresh?.(); } catch (error) { console.error(error); toast.error('Não foi possível resolver o alerta.'); } finally { setBusy(false); } };

  const cards = [
    ['Peças concluídas (7d)', metrics.pieces, CheckCircle2, 'text-emerald-300'], ['Lotes atrasados', metrics.late, Clock3, 'text-red-300'], ['Utilização agora', `${metrics.utilization.toFixed(0)}%`, Gauge, 'text-sky-300'], ['Perdas (7d)', money(metrics.lossValue), PackageMinus, 'text-amber-300'], ['Custo realizado (7d)', money(metrics.totalCost), WalletCards, 'text-cyan-300'], ['Desvio de custo', `${metrics.costVariance.toFixed(1)}%`, Activity, metrics.costVariance > 15 ? 'text-red-300' : 'text-violet-300'],
  ];

  return <section className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold text-white">Indicadores e exceções</h2><p className="text-sm text-white/45">Priorize o que exige decisão: atrasos, falta, validade, perdas e custo.</p></div><Button onClick={refresh} disabled={busy} variant="outline" className="border-white/10 bg-white/5">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Atualizar análise</Button></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">{cards.map(([label, value, Icon, tone]) => <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center justify-between"><span className="text-xs text-white/40">{label}</span><Icon className={`h-4 w-4 ${tone}`} /></div><p className="mt-3 text-xl font-bold text-white">{value}</p></div>)}</div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]"><div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-white">Alertas abertos</h3><p className="text-xs text-white/40">Reconhecer não resolve; a causa permanece monitorada.</p></div><Badge className={openAlerts.some((alert) => alert.severity === 'critical') ? 'bg-red-500/20 text-red-200' : 'bg-amber-500/20 text-amber-200'}>{openAlerts.length}</Badge></div><div className="mt-4 max-h-[520px] space-y-3 overflow-auto">{openAlerts.sort((a, b) => (a.severity === 'critical' ? -1 : 0) - (b.severity === 'critical' ? -1 : 0)).map((alert) => <article key={alert.id} className={`rounded-2xl border p-4 ${alert.severity === 'critical' ? 'border-red-500/20 bg-red-500/5' : 'border-amber-500/15 bg-amber-500/[0.04]'}`}><div className="flex items-start gap-3"><AlertTriangle className={`mt-0.5 h-4 w-4 ${alert.severity === 'critical' ? 'text-red-300' : 'text-amber-300'}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-white">{alert.title}</p><Badge variant="outline" className="border-white/10 text-white/45">{CATEGORY[alert.category] || alert.category}</Badge></div><p className="mt-1 text-sm text-white/45">{alert.description}</p><p className="mt-2 text-xs text-white/30">Detectado em {new Date(alert.last_detected_at || alert.first_detected_at).toLocaleString('pt-BR')}</p></div></div><div className="mt-3 flex justify-end gap-2">{alert.status === 'open' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => acknowledge(alert)} className="text-white/50">Reconhecer</Button>}<Button size="sm" variant="outline" disabled={busy} onClick={() => resolve(alert)} className="border-white/10">Resolver</Button></div></article>)}{openAlerts.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-white/35">Nenhuma exceção aberta.</div>}</div></div>
      <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><h3 className="font-semibold text-white">Capacidade das máquinas</h3><div className="mt-4 space-y-4">{scopedMachines.map((machine) => { const batch = scopedBatches.find((row) => row.id === machine.production_batch_id); const percent = Number(batch?.capacity_percent || 0); return <div key={machine.machine_id}><div className="flex items-center justify-between text-sm"><span className="text-white/65">{machine.name || machine.machine_id}</span><span className="text-white/40">{batch ? `${percent.toFixed(0)}%` : 'Livre'}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className={`${percent > 100 ? 'bg-red-500' : percent > 85 ? 'bg-amber-500' : 'bg-gradient-to-r from-violet-500 to-cyan-400'} h-full`} style={{ width: `${Math.min(100, percent)}%` }} /></div></div>; })}{scopedMachines.length === 0 && <p className="py-8 text-center text-sm text-white/35">Configure as máquinas para medir capacidade.</p>}</div></div></div>
  </section>;
}
