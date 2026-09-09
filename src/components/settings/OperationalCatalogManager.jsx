import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BookOpenCheck, Loader2, Pencil, Plus, Power, Search, Star } from 'lucide-react';
import { toast } from 'sonner';
import useUnitAccess from '@/components/units/useUnitAccess';

const TYPES = [
  ['color', 'Cores'], ['material', 'Materiais'], ['pattern', 'Estampas'], ['size', 'Tamanhos'], ['brand', 'Marcas'],
  ['damage', 'Avarias'], ['risk', 'Riscos'], ['garment_detail', 'Detalhes'], ['pickup_failure_reason', 'Falhas de coleta'], ['delivery_failure_reason', 'Falhas de entrega'],
];
const empty = { catalog_type: 'color', label: '', code: '', unit_id: '', synonyms: '', category: '', description: '', color_hex: '#FF6600', favorite: false, sort_order: 0, active: true, change_reason: '' };

export default function OperationalCatalogManager() {
  const { units, selectedUnit } = useUnitAccess();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [type, setType] = useState('color');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(null);

  const load = async () => {
    setLoading(true);
    try { const response = await base44.functions.invoke('manage_operational_catalog', { action: 'list' }); setEntries(response.data.entries || []); }
    catch (error) { console.error(error); toast.error('Não foi possível carregar os catálogos.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => entries.filter((entry) => {
    if (entry.catalog_type !== type) return false;
    if (!showInactive && entry.active === false) return false;
    if (selectedUnit && selectedUnit !== 'all' && entry.unit_id && entry.unit_id !== selectedUnit) return false;
    const term = search.trim().toLowerCase();
    if (term && ![entry.label, entry.code, entry.category, ...(entry.synonyms || [])].some((value) => String(value || '').toLowerCase().includes(term))) return false;
    return true;
  }).sort((a, b) => Number(b.favorite) - Number(a.favorite) || Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.label.localeCompare(b.label, 'pt-BR')), [entries, type, showInactive, selectedUnit, search]);

  const save = async () => {
    setBusy('save');
    try {
      await base44.functions.invoke('manage_operational_catalog', { action: 'save', ...form, unit_id: form.unit_id === 'all' ? undefined : form.unit_id, synonyms: String(form.synonyms || '').split(',').map((item) => item.trim()).filter(Boolean) });
      toast.success(form.entry_id ? 'Item atualizado.' : 'Item adicionado ao catálogo.'); setForm(null); await load();
    } catch (error) { toast.error(error?.response?.data?.error === 'duplicate_catalog_entry' ? `Já existe: ${error.response.data.duplicate?.label}` : error?.response?.data?.error || 'Não foi possível salvar.'); }
    finally { setBusy(''); }
  };

  const toggle = async (entry) => {
    const reason = window.prompt(`Justificativa para ${entry.active === false ? 'reativar' : 'inativar'} ${entry.label}:`, entry.active === false ? 'Item revisado e liberado novamente' : 'Item não deve mais ser usado em novos registros');
    if (!reason || reason.trim().length < 8) return;
    setBusy(entry.id);
    try { await base44.functions.invoke('manage_operational_catalog', { action: 'set_active', entry_id: entry.id, active: entry.active === false, reason }); toast.success('Estado atualizado.'); await load(); }
    catch (error) { toast.error(error?.response?.data?.error || 'Não foi possível alterar.'); }
    finally { setBusy(''); }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando catálogos...</div>;
  return <div className="space-y-6">
    <div className="rounded-3xl border border-cyan-400/15 bg-gradient-to-br from-cyan-500/10 via-white/[0.025] to-violet-500/5 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs uppercase tracking-[0.18em] text-cyan-300">Padronização operacional</p><h2 className="mt-1 text-2xl font-bold text-white">Catálogos rápidos e pesquisáveis</h2><p className="mt-2 max-w-3xl text-sm text-white/45">Marcas, cores, materiais, avarias, riscos e motivos logísticos com sinônimos, favoritos e controle de duplicidade.</p></div><div className="flex gap-2"><Metric label="Itens ativos" value={entries.filter((entry) => entry.active !== false).length} /><Metric label="Favoritos" value={entries.filter((entry) => entry.favorite && entry.active !== false).length} /></div></div></div>
    <Card className="border-white/10 bg-white/5 text-white"><CardHeader><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div><CardTitle className="flex items-center gap-2"><BookOpenCheck className="h-5 w-5 text-cyan-300" />Cadastros operacionais</CardTitle><CardDescription className="text-white/40">Itens usados no orçamento, inspeção e logística sem listas fixas espalhadas pelo código.</CardDescription></div><Button onClick={() => setForm({ ...empty, catalog_type: type, unit_id: selectedUnit !== 'all' ? selectedUnit : 'all' })} className="bg-orange-500 hover:bg-orange-400"><Plus className="mr-2 h-4 w-4" />Novo item</Button></div></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-2">{TYPES.map(([code, label]) => <button key={code} onClick={() => setType(code)} className={`rounded-xl border px-3 py-2 text-sm ${type === code ? 'border-cyan-400/35 bg-cyan-500/15 text-cyan-100' : 'border-white/10 bg-white/[0.035] text-white/45'}`}>{label}<span className="ml-2 text-xs opacity-50">{entries.filter((entry) => entry.catalog_type === code && entry.active !== false).length}</span></button>)}</div><div className="flex flex-col gap-3 md:flex-row md:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-white/30" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, código, categoria ou sinônimo" className="border-white/10 bg-black/20 pl-9" /></div><label className="flex items-center gap-2 text-sm text-white/45"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} className="accent-orange-500" />Mostrar inativos</label></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visible.map((entry) => <div key={entry.id} className={`rounded-2xl border p-4 ${entry.active === false ? 'border-white/5 bg-black/10 opacity-55' : 'border-white/10 bg-black/15'}`}><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3">{entry.catalog_type === 'color' && <span className="h-8 w-8 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: entry.color_hex || '#777' }} />}<div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate font-semibold">{entry.label}</p>{entry.favorite && <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />}</div><p className="text-xs text-white/35">{entry.code || entry.slug} · {entry.unit_id ? units.find((unit) => unit.id === entry.unit_id)?.name || 'Unidade' : 'Global'}</p></div></div><Badge variant="outline" className={entry.active === false ? 'border-white/10 text-white/35' : 'border-emerald-500/20 text-emerald-300'}>{entry.active === false ? 'inativo' : 'ativo'}</Badge></div>{entry.synonyms?.length > 0 && <p className="mt-3 line-clamp-2 text-xs text-white/40">Sinônimos: {entry.synonyms.join(', ')}</p>}<div className="mt-4 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setForm({ ...entry, entry_id: entry.id, unit_id: entry.unit_id || 'all', synonyms: (entry.synonyms || []).join(', '), change_reason: '' })} className="border-white/10 bg-white/5"><Pencil className="mr-2 h-3.5 w-3.5" />Editar</Button><Button size="icon" variant="outline" disabled={busy === entry.id} onClick={() => toggle(entry)} className={entry.active === false ? 'border-emerald-500/20 text-emerald-300' : 'border-red-500/20 text-red-200'}>{busy === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}</Button></div></div>)}{visible.length === 0 && <div className="sm:col-span-2 xl:col-span-3"><Empty /></div>}</div></CardContent></Card>
    {form && <CatalogDialog form={form} setForm={setForm} units={units} busy={busy === 'save'} onClose={() => setForm(null)} onSave={save} />}
  </div>;
}

function CatalogDialog({ form, setForm, units, busy, onClose, onSave }) { return <Dialog open onOpenChange={(value) => !value && !busy && onClose()}><DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto border-white/10 bg-[#160a2b] text-white"><DialogHeader><DialogTitle>{form.entry_id ? 'Editar item' : 'Novo item'} — {TYPES.find(([code]) => code === form.catalog_type)?.[1]}</DialogTitle><DialogDescription className="text-white/40">Itens já usados são inativados, nunca apagados.</DialogDescription></DialogHeader><div className="grid gap-4 md:grid-cols-2"><Field label="Tipo"><Select value={form.catalog_type} onValueChange={(value) => setForm({ ...form, catalog_type: value })}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent>{TYPES.map(([code, label]) => <SelectItem key={code} value={code}>{label}</SelectItem>)}</SelectContent></Select></Field><Field label="Unidade"><Select value={form.unit_id || 'all'} onValueChange={(value) => setForm({ ...form, unit_id: value })}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Global</SelectItem>{units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Nome"><Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} className="border-white/10 bg-black/20" /></Field><Field label="Código"><Input value={form.code || ''} onChange={(event) => setForm({ ...form, code: event.target.value })} className="border-white/10 bg-black/20" /></Field><Field label="Categoria"><Input value={form.category || ''} onChange={(event) => setForm({ ...form, category: event.target.value })} className="border-white/10 bg-black/20" /></Field>{form.catalog_type === 'color' && <Field label="Cor"><Input type="color" value={form.color_hex || '#FF6600'} onChange={(event) => setForm({ ...form, color_hex: event.target.value })} className="h-10 border-white/10 bg-black/20 p-1" /></Field>}<div className="md:col-span-2"><Field label="Sinônimos separados por vírgula"><Input value={form.synonyms || ''} onChange={(event) => setForm({ ...form, synonyms: event.target.value })} placeholder="Ex.: vermelho escuro, bordô, vinho" className="border-white/10 bg-black/20" /></Field></div><div className="md:col-span-2"><Field label="Descrição"><Input value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} className="border-white/10 bg-black/20" /></Field></div><Field label="Ordem"><Input type="number" value={form.sort_order || 0} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} className="border-white/10 bg-black/20" /></Field><label className="flex items-center gap-2 self-end rounded-xl border border-white/10 px-3 py-2 text-sm text-white/60"><input type="checkbox" checked={form.favorite === true} onChange={(event) => setForm({ ...form, favorite: event.target.checked })} className="accent-amber-400" />Favorito no atendimento</label><div className="md:col-span-2"><Field label="Justificativa"><Input value={form.change_reason || ''} onChange={(event) => setForm({ ...form, change_reason: event.target.value })} placeholder="Mínimo 8 caracteres" className="border-white/10 bg-black/20" /></Field></div></div><Button onClick={onSave} disabled={busy || !form.label || String(form.change_reason || '').trim().length < 8} className="bg-orange-500 hover:bg-orange-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Salvar item</Button></DialogContent></Dialog>; }
function Field({ label, children }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function Metric({ label, value }) { return <div className="min-w-24 rounded-2xl border border-white/10 bg-black/15 px-4 py-3"><p className="text-xs text-white/35">{label}</p><p className="mt-1 text-xl font-bold text-white">{value}</p></div>; }
function Empty() { return <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">Nenhum item encontrado.</div>; }
