import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Loader2, Play, Save, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const STATUS = { draft: 'Rascunho', counting: 'Contagem', review: 'Revisão', approved: 'Aprovado', cancelled: 'Cancelado' };

export default function InventoryCountPanel({ counts = [], stockItems = [], selectedUnitId, onRefresh }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [reasons, setReasons] = useState({});
  const [setup, setSetup] = useState({ scope: 'all', category: '', blind_count: true, freeze_movements: false });
  const scopedCounts = useMemo(() => counts.filter((count) => selectedUnitId === 'all' || count.unit_id === selectedUnitId), [counts, selectedUnitId]);
  const active = scopedCounts.find((count) => ['counting', 'review'].includes(count.status));
  const stockMap = useMemo(() => Object.fromEntries(stockItems.map((item) => [item.id, item])), [stockItems]);
  const categories = [...new Set(stockItems.map((item) => item.category).filter(Boolean))].sort();

  const invoke = async (payload, success) => {
    setBusy(true);
    try { const result = await base44.functions.invoke('manage_inventory_count', payload); toast.success(success); onRefresh?.(); return result.data || result; }
    catch (error) { console.error(error); toast.error('Não foi possível concluir a operação de inventário.'); throw error; }
    finally { setBusy(false); }
  };

  const create = async () => {
    if (!selectedUnitId || selectedUnitId === 'all') return toast.error('Selecione uma unidade específica.');
    await invoke({ action: 'create', unit_id: selectedUnitId, ...setup }, 'Inventário iniciado.');
    setCreateOpen(false);
  };

  const saveCounts = async () => {
    if (!active || active.status !== 'counting') return;
    const pending = (active.items || []).filter((line) => drafts[line.stock_item_id] !== undefined && drafts[line.stock_item_id] !== '');
    if (pending.length === 0) return toast.error('Informe pelo menos uma contagem.');
    setBusy(true);
    try {
      for (const line of pending) await base44.functions.invoke('manage_inventory_count', { action: 'record', inventory_count_id: active.id, stock_item_id: line.stock_item_id, counted_quantity: Number(drafts[line.stock_item_id]), reason: reasons[line.stock_item_id] || line.reason || '' });
      toast.success(`${pending.length} contagem(ns) salva(s).`); setDrafts({}); onRefresh?.();
    } catch (error) { console.error(error); toast.error('Uma das contagens não pôde ser salva.'); }
    finally { setBusy(false); }
  };

  const submit = async () => invoke({ action: 'submit', inventory_count_id: active.id }, 'Inventário enviado para revisão.');
  const approve = async () => {
    const missingReason = (active.items || []).some((line) => Number(line.difference || 0) !== 0 && !String(reasons[line.stock_item_id] || line.reason || '').trim());
    if (missingReason) return toast.error('Justifique todas as divergências antes de aprovar.');
    if (Object.keys(reasons).length > 0) {
      setBusy(true);
      try {
        for (const line of active.items || []) if (reasons[line.stock_item_id] && reasons[line.stock_item_id] !== line.reason) await base44.functions.invoke('manage_inventory_count', { action: 'review_item', inventory_count_id: active.id, stock_item_id: line.stock_item_id, reason: reasons[line.stock_item_id], review_status: 'accepted' });
      } catch (error) { console.error(error); toast.error('Não foi possível atualizar as justificativas.'); setBusy(false); return; }
      setBusy(false);
    }
    await invoke({ action: 'approve', inventory_count_id: active.id, idempotency_key: crypto.randomUUID() }, 'Inventário aprovado e saldos ajustados.');
  };
  const cancel = async () => { const reason = window.prompt('Motivo do cancelamento:'); if (reason?.trim()) await invoke({ action: 'cancel', inventory_count_id: active.id, reason }, 'Inventário cancelado.'); };

  return <section className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-lg font-semibold text-white">Inventário físico</h3><p className="text-sm text-white/45">Contagem cega, revisão de divergências e ajuste auditado.</p></div><Button onClick={() => setCreateOpen(true)} disabled={!!active} className="bg-violet-500 hover:bg-violet-400"><Play className="mr-2 h-4 w-4" />Iniciar inventário</Button></div>
    {active ? <div className="rounded-3xl border border-violet-400/20 bg-violet-500/[0.05] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-violet-300" /><h4 className="font-semibold text-white">{active.code}</h4><Badge variant="outline" className="border-violet-400/30 text-violet-200">{STATUS[active.status]}</Badge></div><p className="mt-1 text-xs text-white/40">{active.counted_item_count || 0}/{active.item_count || active.items?.length || 0} itens · divergência {money(active.total_variance_value)}</p></div><div className="flex flex-wrap gap-2">{active.status === 'counting' && <><Button size="sm" variant="outline" onClick={saveCounts} disabled={busy} className="border-white/10"><Save className="mr-2 h-4 w-4" />Salvar</Button><Button size="sm" onClick={submit} disabled={busy}><Send className="mr-2 h-4 w-4" />Revisar</Button></>}{active.status === 'review' && <Button size="sm" onClick={approve} disabled={busy} className="bg-emerald-500 hover:bg-emerald-400"><CheckCircle2 className="mr-2 h-4 w-4" />Aprovar ajustes</Button>}<Button size="sm" variant="ghost" onClick={cancel} disabled={busy} className="text-red-300"><XCircle className="mr-2 h-4 w-4" />Cancelar</Button></div></div>
      <div className="mt-5 max-h-[520px] overflow-auto rounded-2xl border border-white/10"><table className="w-full min-w-[760px] text-left text-sm"><thead className="sticky top-0 bg-[#21143a] text-xs uppercase text-white/35"><tr><th className="px-4 py-3">Insumo</th>{!active.blind_count && <th className="px-4 py-3 text-right">Sistema</th>}<th className="px-4 py-3 text-right">Contado</th><th className="px-4 py-3 text-right">Diferença</th><th className="px-4 py-3">Justificativa</th></tr></thead><tbody className="divide-y divide-white/5">{(active.items || []).map((line) => { const item = stockMap[line.stock_item_id] || {}; const counted = drafts[line.stock_item_id] ?? line.counted_quantity ?? ''; const difference = counted === '' ? line.difference : Number(counted) - Number(line.system_quantity || 0); return <tr key={line.stock_item_id}><td className="px-4 py-3"><p className="font-medium text-white">{item.name || line.stock_item_id}</p><p className="text-xs text-white/35">{item.sku} · {item.base_unit}</p></td>{!active.blind_count && <td className="px-4 py-3 text-right text-white/55">{line.system_quantity}</td>}<td className="px-4 py-3"><Input type="number" min="0" step="any" disabled={active.status !== 'counting'} value={counted} onChange={(e) => setDrafts((state) => ({ ...state, [line.stock_item_id]: e.target.value }))} className="ml-auto w-28 border-white/10 bg-white/5 text-right" /></td><td className={`px-4 py-3 text-right font-medium ${Number(difference || 0) === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{difference == null || difference === '' ? '—' : Number(difference) > 0 ? `+${difference}` : difference}</td><td className="px-4 py-3"><Input disabled={active.status === 'counting' && Number(difference || 0) === 0} value={reasons[line.stock_item_id] ?? line.reason ?? ''} onChange={(e) => setReasons((state) => ({ ...state, [line.stock_item_id]: e.target.value }))} placeholder={Number(difference || 0) !== 0 ? 'Obrigatória' : 'Sem divergência'} className="min-w-44 border-white/10 bg-white/5" /></td></tr>; })}</tbody></table></div>
    </div> : <div className="rounded-3xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">Nenhum inventário em andamento.</div>}
    <div className="grid gap-3 md:grid-cols-3">{scopedCounts.filter((count) => !['counting', 'review'].includes(count.status)).slice(0, 6).map((count) => <div key={count.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center justify-between"><span className="font-medium text-white">{count.code}</span><Badge variant="outline" className="border-white/10 text-white/50">{STATUS[count.status] || count.status}</Badge></div><p className="mt-2 text-xs text-white/40">{count.item_count || count.items?.length || 0} itens · {count.variance_item_count || 0} divergências</p><p className="mt-2 font-semibold text-white/70">{money(count.total_variance_value)}</p></div>)}</div>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="border-white/10 bg-[#160d29] text-white"><DialogHeader><DialogTitle>Novo inventário</DialogTitle><DialogDescription className="text-white/45">Escolha o escopo e se as movimentações devem ser bloqueadas durante a contagem.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>Escopo</Label><select value={setup.scope} onChange={(e) => setSetup((state) => ({ ...state, scope: e.target.value }))} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#201334] px-3 text-sm"><option value="all">Todos os insumos</option><option value="category">Uma categoria</option></select></div>{setup.scope === 'category' && <div><Label>Categoria</Label><select value={setup.category} onChange={(e) => setSetup((state) => ({ ...state, category: e.target.value }))} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#201334] px-3 text-sm"><option value="">Selecione</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></div>}<label className="flex items-start gap-3 rounded-2xl border border-white/10 p-3"><input type="checkbox" checked={setup.blind_count} onChange={(e) => setSetup((state) => ({ ...state, blind_count: e.target.checked }))} className="mt-1" /><span><strong className="block text-sm text-white">Contagem cega</strong><span className="text-xs text-white/40">O saldo do sistema fica oculto do contador.</span></span></label><label className="flex items-start gap-3 rounded-2xl border border-white/10 p-3"><input type="checkbox" checked={setup.freeze_movements} onChange={(e) => setSetup((state) => ({ ...state, freeze_movements: e.target.checked }))} className="mt-1" /><span><strong className="block text-sm text-white">Congelar movimentações</strong><span className="text-xs text-white/40">Bloqueia entradas, saídas e transferências durante a contagem.</span></span></label></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCreateOpen(false)} className="border-white/10">Cancelar</Button><Button onClick={create} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Iniciar</Button></div></DialogContent></Dialog>
  </section>;
}
