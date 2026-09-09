import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FlaskConical, Loader2, Pause, Play, RotateCcw, ShieldAlert, Square } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const STATUS = { draft: 'Rascunho', scheduled: 'Agendado', waiting_materials: 'Aguardando insumos', queued: 'Na fila', processing: 'Em execução', paused: 'Pausado', completed: 'Concluído', cancelled: 'Cancelado', failed: 'Falhou' };
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

export default function BatchExecutionDialog({ open, onOpenChange, batch, laborEntries = [], stockItems = [], onCompleted }) {
  const [busy, setBusy] = useState(false);
  const [actual, setActual] = useState({});
  const [costs, setCosts] = useState({ energy_cost: '', water_cost: '', other_cost: '', completion_note: '' });
  useEffect(() => { if (batch) setActual(Object.fromEntries((batch.planned_consumption || []).map((line) => [line.stock_item_id, line.quantity]))); }, [batch]);
  const activeLabor = useMemo(() => laborEntries.filter((entry) => entry.production_batch_id === batch?.id && ['running', 'paused'].includes(entry.status)), [laborEntries, batch]);
  if (!batch) return null;

  const refresh = () => onCompleted?.();
  const invoke = async (name, payload, success) => {
    setBusy(true);
    try { const result = await base44.functions.invoke(name, payload); toast.success(success); refresh(); return result.data || result; }
    catch (error) { console.error(error); toast.error('Não foi possível concluir. Verifique estado, estoque e permissões.'); throw error; }
    finally { setBusy(false); }
  };

  const queue = () => invoke('manage_production_batch', { action: 'queue', production_batch_id: batch.id, idempotency_key: crypto.randomUUID() }, 'Lote enviado à fila.');
  const start = async () => {
    setBusy(true);
    try {
      await base44.functions.invoke('manage_production_batch', { action: 'start', production_batch_id: batch.id, idempotency_key: crypto.randomUUID() });
      await base44.functions.invoke('manage_labor_entry', { action: 'start', production_batch_id: batch.id, activity: batch.stage, is_rework: false });
      toast.success('Lote e apontamento iniciados.'); refresh();
    } catch (error) { console.error(error); toast.error('Não foi possível iniciar. Verifique máquina, capacidade e insumos.'); }
    finally { setBusy(false); }
  };
  const pause = async () => {
    const reason = window.prompt('Motivo da pausa:'); if (!reason?.trim()) return;
    setBusy(true);
    try { for (const entry of activeLabor.filter((row) => row.status === 'running')) await base44.functions.invoke('manage_labor_entry', { action: 'pause', labor_entry_id: entry.id, reason }); await base44.functions.invoke('manage_production_batch', { action: 'pause', production_batch_id: batch.id, reason, idempotency_key: crypto.randomUUID() }); toast.success('Lote pausado.'); refresh(); }
    catch (error) { console.error(error); toast.error('Não foi possível pausar.'); } finally { setBusy(false); }
  };
  const resume = async () => {
    setBusy(true);
    try { await base44.functions.invoke('manage_production_batch', { action: 'resume', production_batch_id: batch.id, idempotency_key: crypto.randomUUID() }); for (const entry of activeLabor.filter((row) => row.status === 'paused')) await base44.functions.invoke('manage_labor_entry', { action: 'resume', labor_entry_id: entry.id }); toast.success('Lote retomado.'); refresh(); }
    catch (error) { console.error(error); toast.error('Não foi possível retomar.'); } finally { setBusy(false); }
  };
  const startLabor = () => invoke('manage_labor_entry', { action: 'start', production_batch_id: batch.id, activity: batch.stage, is_rework: false }, 'Apontamento de mão de obra iniciado.');
  const postConsumption = () => invoke('post_production_consumption', { action: 'post', production_batch_id: batch.id, actual_consumption: (batch.planned_consumption || []).map((line) => ({ stock_item_id: line.stock_item_id, quantity: Number(actual[line.stock_item_id] ?? line.quantity), unit: line.unit })), idempotency_key: `consumption-${batch.id}` }, 'Consumo registrado no estoque.');
  const complete = async () => {
    setBusy(true);
    try {
      if (batch.recipe_id && !(batch.actual_consumption || []).some((line) => !line.loss)) await base44.functions.invoke('post_production_consumption', { action: 'post', production_batch_id: batch.id, actual_consumption: (batch.planned_consumption || []).map((line) => ({ stock_item_id: line.stock_item_id, quantity: Number(actual[line.stock_item_id] ?? line.quantity), unit: line.unit })), idempotency_key: `consumption-${batch.id}` });
      for (const entry of activeLabor) { if (entry.status === 'paused') await base44.functions.invoke('manage_labor_entry', { action: 'resume', labor_entry_id: entry.id }); await base44.functions.invoke('manage_labor_entry', { action: 'complete', labor_entry_id: entry.id }); }
      await base44.functions.invoke('manage_production_batch', { action: 'complete', production_batch_id: batch.id, energy_cost: costs.energy_cost === '' ? undefined : Number(costs.energy_cost), water_cost: costs.water_cost === '' ? undefined : Number(costs.water_cost), other_cost: costs.other_cost === '' ? undefined : Number(costs.other_cost), completion_note: costs.completion_note, idempotency_key: crypto.randomUUID() });
      toast.success('Lote concluído; peças, custos e máquina atualizados.'); onOpenChange(false); refresh();
    } catch (error) { console.error(error); toast.error('A conclusão foi bloqueada. Confirme consumo e apontamentos.'); }
    finally { setBusy(false); }
  };
  const cancel = async () => { const reason = window.prompt('Motivo do cancelamento:'); if (!reason?.trim()) return; await invoke('manage_production_batch', { action: 'cancel', production_batch_id: batch.id, reason, idempotency_key: crypto.randomUUID() }, 'Lote cancelado.'); onOpenChange(false); };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-4xl border-white/10 bg-[#160d29] text-white"><DialogHeader><DialogTitle>{batch.code}</DialogTitle><DialogDescription className="text-white/45">Execução rastreada · {batch.piece_count || batch.garment_item_ids?.length || 0} peças · {batch.machine_id || 'etapa manual'}</DialogDescription></DialogHeader>
    <div className="grid gap-4 md:grid-cols-4"><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-white/40">Estado</p><Badge className="mt-2 bg-violet-500/20 text-violet-200">{STATUS[batch.status] || batch.status}</Badge></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-white/40">Capacidade</p><p className="mt-2 text-xl font-bold text-white">{Number(batch.capacity_percent || 0).toFixed(1)}%</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-white/40">Previsto</p><p className="mt-2 text-xl font-bold text-cyan-300">{money(batch.estimated_material_cost)}</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-white/40">Real</p><p className="mt-2 text-xl font-bold text-emerald-300">{money(batch.total_actual_cost || batch.actual_material_cost)}</p></div></div>
    {batch.recipe_id && <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-white">Consumo do lote</h3><p className="text-xs text-white/40">Confirme o realizado antes de concluir.</p></div>{(batch.actual_consumption || []).some((line) => !line.loss) ? <Badge className="bg-emerald-500/20 text-emerald-200">Baixado</Badge> : <Badge variant="outline" className="border-amber-500/30 text-amber-200">Pendente</Badge>}</div><div className="mt-4 grid gap-3 sm:grid-cols-2">{(batch.planned_consumption || []).map((line) => <div key={line.stock_item_id} className="rounded-2xl border border-white/10 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-white">{line.stock_item_name || stockItems.find((item) => item.id === line.stock_item_id)?.name || line.stock_item_id}</p><p className="text-xs text-white/35">Previsto: {line.quantity} {line.unit}</p></div><Input type="number" min="0" step="any" disabled={(batch.actual_consumption || []).some((item) => !item.loss)} value={actual[line.stock_item_id] ?? line.quantity} onChange={(e) => setActual((state) => ({ ...state, [line.stock_item_id]: e.target.value }))} className="w-28 border-white/10 bg-white/5 text-right" /></div></div>)}</div>{['processing', 'paused'].includes(batch.status) && !(batch.actual_consumption || []).some((line) => !line.loss) && <Button onClick={postConsumption} disabled={busy} className="mt-4 bg-cyan-600 hover:bg-cyan-500"><FlaskConical className="mr-2 h-4 w-4" />Baixar consumo</Button>}</div>}
    {['processing', 'paused'].includes(batch.status) && <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><h3 className="font-semibold text-white">Custos adicionais da conclusão</h3><div className="mt-3 grid gap-3 sm:grid-cols-3"><div><Label>Energia (R$)</Label><Input type="number" min="0" step="0.01" value={costs.energy_cost} onChange={(e) => setCosts((state) => ({ ...state, energy_cost: e.target.value }))} className="mt-1 border-white/10 bg-white/5" /></div><div><Label>Água (R$)</Label><Input type="number" min="0" step="0.01" value={costs.water_cost} onChange={(e) => setCosts((state) => ({ ...state, water_cost: e.target.value }))} className="mt-1 border-white/10 bg-white/5" /></div><div><Label>Outros (R$)</Label><Input type="number" min="0" step="0.01" value={costs.other_cost} onChange={(e) => setCosts((state) => ({ ...state, other_cost: e.target.value }))} className="mt-1 border-white/10 bg-white/5" /></div></div><Input value={costs.completion_note} onChange={(e) => setCosts((state) => ({ ...state, completion_note: e.target.value }))} placeholder="Observação de conclusão" className="mt-3 border-white/10 bg-white/5" /></div>}
    <div className="flex flex-wrap justify-end gap-2">{['draft', 'scheduled', 'waiting_materials'].includes(batch.status) && <Button onClick={queue} disabled={busy} variant="outline" className="border-white/10"><RotateCcw className="mr-2 h-4 w-4" />Enviar à fila</Button>}{batch.status === 'queued' && <Button onClick={start} disabled={busy} className="bg-emerald-500 hover:bg-emerald-400"><Play className="mr-2 h-4 w-4" />Iniciar</Button>}{batch.status === 'processing' && activeLabor.length === 0 && <Button onClick={startLabor} disabled={busy} variant="outline" className="border-cyan-500/20 text-cyan-200"><Play className="mr-2 h-4 w-4" />Iniciar apontamento</Button>}{batch.status === 'processing' && <Button onClick={pause} disabled={busy} variant="outline" className="border-amber-500/20 text-amber-200"><Pause className="mr-2 h-4 w-4" />Pausar</Button>}{batch.status === 'paused' && <Button onClick={resume} disabled={busy} className="bg-emerald-500 hover:bg-emerald-400"><Play className="mr-2 h-4 w-4" />Retomar</Button>}{['processing', 'paused'].includes(batch.status) && <Button onClick={complete} disabled={busy} className="bg-gradient-to-r from-violet-500 to-fuchsia-500"><CheckCircle2 className="mr-2 h-4 w-4" />Concluir lote</Button>}{!['completed', 'cancelled'].includes(batch.status) && <Button onClick={cancel} disabled={busy} variant="ghost" className="text-red-300"><Square className="mr-2 h-4 w-4" />Cancelar</Button>}{busy && <Loader2 className="h-5 w-5 animate-spin text-violet-300" />}</div>
    {batch.capacity_override && <div className="flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200"><ShieldAlert className="h-4 w-4" />Capacidade excedida com autorização: {batch.capacity_override_reason}</div>}
  </DialogContent></Dialog>;
}
