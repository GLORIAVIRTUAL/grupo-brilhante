import { useEffect, useState } from 'react';
import { Calculator, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const EMPTY = { name: '', labor_hourly_cost_default: '', energy_kwh_cost: '', water_m3_cost: '', overhead_percent: '', packaging_cost_per_piece: '', quality_cost_per_piece: '' };

export default function ProductionCostProfileDialog({ open, onOpenChange, profiles = [], unitId, onCompleted }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const current = profiles.filter((profile) => profile.unit_id === unitId && profile.active).sort((a, b) => Date.parse(b.valid_from || '') - Date.parse(a.valid_from || ''))[0];
  useEffect(() => { if (open) setForm(current ? { name: current.name || '', labor_hourly_cost_default: current.labor_hourly_cost_default ?? '', energy_kwh_cost: current.energy_kwh_cost ?? '', water_m3_cost: current.water_m3_cost ?? '', overhead_percent: current.overhead_percent ?? '', packaging_cost_per_piece: current.packaging_cost_per_piece ?? '', quality_cost_per_piece: current.quality_cost_per_piece ?? '' } : EMPTY); }, [open, current]);
  const submit = async () => {
    if (!unitId) return toast.error('Selecione uma unidade específica.');
    setBusy(true);
    try {
      await base44.functions.invoke('manage_production_cost_profile', { action: 'create_version', unit_id: unitId, ...Object.fromEntries(Object.entries(form).map(([key, value]) => [key, key === 'name' ? value : Number(value || 0)])), active: true });
      toast.success('Nova versão de custos ativada.'); onOpenChange(false); onCompleted?.();
    } catch (error) { console.error(error); toast.error('Não foi possível salvar o perfil de custos.'); }
    finally { setBusy(false); }
  };
  const fields = [['labor_hourly_cost_default', 'Mão de obra por hora (R$)'], ['energy_kwh_cost', 'Energia por kWh (R$)'], ['water_m3_cost', 'Água por m³ (R$)'], ['overhead_percent', 'Rateio indireto (%)'], ['packaging_cost_per_piece', 'Embalagem por peça (R$)'], ['quality_cost_per_piece', 'Qualidade por peça (R$)']];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl border-white/10 bg-[#160d29] text-white"><DialogHeader><DialogTitle>Perfil de custos da produção</DialogTitle><DialogDescription className="text-white/45">Uma nova versão entra em vigor sem alterar o histórico dos lotes anteriores.</DialogDescription></DialogHeader><div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4 text-sm text-cyan-100"><div className="flex items-center gap-2"><Calculator className="h-4 w-4" /><strong>{current ? `Versão atual: ${current.name}` : 'Nenhum perfil vigente'}</strong></div><p className="mt-1 text-xs text-cyan-100/55">Os custos de máquina por ciclo são configurados em “Máquinas”.</p></div><div><Label>Nome da versão</Label><Input value={form.name} onChange={(e) => setForm((state) => ({ ...state, name: e.target.value }))} placeholder="Custos de setembro/2026" className="mt-1 border-white/10 bg-white/5" /></div><div className="grid gap-4 sm:grid-cols-2">{fields.map(([key, label]) => <div key={key}><Label>{label}</Label><Input type="number" min="0" step="0.0001" value={form[key]} onChange={(e) => setForm((state) => ({ ...state, [key]: e.target.value }))} className="mt-1 border-white/10 bg-white/5" /></div>)}</div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)} className="border-white/10">Cancelar</Button><Button onClick={submit} disabled={busy} className="bg-gradient-to-r from-cyan-500 to-violet-500">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar nova versão</Button></div></DialogContent></Dialog>;
}
