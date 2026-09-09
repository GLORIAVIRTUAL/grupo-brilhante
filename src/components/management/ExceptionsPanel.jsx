import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, Loader2, Plus, RotateCcw, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { uploadSecureFile } from '@/lib/secureFiles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

export default function ExceptionsPanel({ jobs = [], partners = [], reworkCases = [], garments = [], unitId, onRefresh }) {
  const [showCreate, setShowCreate] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [garmentIds, setGarmentIds] = useState([]);
  const [serviceDescription, setServiceDescription] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [expectedReturnAt, setExpectedReturnAt] = useState('');
  const [busyId, setBusyId] = useState(null);
  const scopedJobs = jobs.filter((job) => job.unit_id === unitId);
  const scopedRework = reworkCases.filter((item) => item.unit_id === unitId && !['completed', 'cancelled'].includes(item.status));
  const eligibleGarments = useMemo(() => garments.filter((garment) => garment.unit_id === unitId && !['delivered', 'cancelled', 'with_third_party'].includes(garment.status)), [garments, unitId]);
  const garmentMap = useMemo(() => Object.fromEntries(garments.map((garment) => [garment.id, garment])), [garments]);
  const partnerMap = useMemo(() => Object.fromEntries(partners.map((partner) => [partner.id, partner])), [partners]);

  const createJob = async () => {
    if (!partnerId || garmentIds.length === 0) return toast.error('Selecione parceiro e ao menos uma peça.');
    setBusyId('create');
    try {
      await base44.functions.invoke('manage_third_party_job', {
        action: 'create', unit_id: unitId, partner_id: partnerId, garment_item_ids: garmentIds,
        service_description: serviceDescription, estimated_cost: Number(estimatedCost || 0),
        expected_return_at: expectedReturnAt ? new Date(expectedReturnAt).toISOString() : undefined,
      });
      toast.success('Ordem terceirizada criada. Anexe a evidência ao enviar.');
      setShowCreate(false); setPartnerId(''); setGarmentIds([]); setServiceDescription(''); setEstimatedCost(''); setExpectedReturnAt('');
      onRefresh?.();
    } catch (error) {
      console.error(error); toast.error('Não foi possível criar a ordem terceirizada.');
    } finally { setBusyId(null); }
  };

  const actWithEvidence = async (job, action, file) => {
    if (!file) return;
    setBusyId(job.id);
    try {
      const upload = await uploadSecureFile({ file, documentType: 'third_party_document', unitId, metadata: { third_party_job_id: job.id, action } });
      await base44.functions.invoke('manage_third_party_job', {
        action, third_party_job_id: job.id,
        ...(action === 'send' ? { outbound_asset_ids: [upload.asset.id] } : { return_asset_ids: [upload.asset.id], actual_cost: job.actual_cost || job.estimated_cost }),
      });
      toast.success(action === 'send' ? 'Peças enviadas com cadeia de custódia.' : 'Retorno registrado e enviado à qualidade.');
      onRefresh?.();
    } catch (error) {
      console.error(error); toast.error('Não foi possível atualizar a ordem terceirizada.');
    } finally { setBusyId(null); }
  };

  const complete = async (job) => {
    setBusyId(job.id);
    try {
      await base44.functions.invoke('manage_third_party_job', { action: 'complete', third_party_job_id: job.id });
      toast.success('Serviço terceirizado concluído.'); onRefresh?.();
    } catch (error) {
      console.error(error); toast.error(error.response?.data?.error === 'approved_quality_inspection_required' ? 'Todas as peças precisam ser aprovadas na qualidade.' : 'Não foi possível concluir.');
    } finally { setBusyId(null); }
  };

  return (
    <section className="space-y-5 rounded-3xl border border-white/10 bg-white/[0.025] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-white">Terceiros e retrabalho</h2><p className="text-sm text-white/40">Cadeia de custódia, custos, retorno e qualidade.</p></div><Button variant="outline" onClick={() => setShowCreate((value) => !value)} className="border-white/10 bg-white/5"><Plus className="mr-2 h-4 w-4" />Nova ordem externa</Button></div>

      {showCreate && <div className="grid gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 lg:grid-cols-5"><div className="space-y-2"><Label>Parceiro</Label><Select value={partnerId} onValueChange={setPartnerId}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{partners.filter((partner) => partner.active !== false).map((partner) => <SelectItem key={partner.id} value={partner.id}>{partner.trade_name || partner.corporate_name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2 lg:col-span-2"><Label>Peças</Label><div className="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">{eligibleGarments.map((garment) => <label key={garment.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5"><input type="checkbox" checked={garmentIds.includes(garment.id)} onChange={(event) => setGarmentIds((current) => event.target.checked ? [...current, garment.id] : current.filter((id) => id !== garment.id))} /><span>{garment.garment_code} · {garment.product_name}</span></label>)}</div></div><div className="space-y-2"><Label>Serviço e custo</Label><Input value={serviceDescription} onChange={(event) => setServiceDescription(event.target.value)} placeholder="Descrição" className="border-white/10 bg-black/20" /><Input type="number" value={estimatedCost} onChange={(event) => setEstimatedCost(event.target.value)} placeholder="Custo estimado" className="border-white/10 bg-black/20" /></div><div className="space-y-2"><Label>Retorno previsto</Label><Input type="datetime-local" value={expectedReturnAt} onChange={(event) => setExpectedReturnAt(event.target.value)} className="border-white/10 bg-black/20" /><Button onClick={createJob} disabled={busyId === 'create'} className="w-full bg-violet-500 hover:bg-violet-400">{busyId === 'create' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Criar</Button></div></div>}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{scopedJobs.filter((job) => job.status !== 'cancelled').slice(0, 12).map((job) => <article key={job.id} className="rounded-2xl border border-white/10 bg-[#1b1030] p-4"><div className="flex items-start justify-between gap-3"><div className="flex gap-2"><Truck className="mt-0.5 h-4 w-4 text-sky-300" /><div><p className="font-semibold text-white">{job.code}</p><p className="text-xs text-white/40">{partnerMap[job.partner_id]?.trade_name || partnerMap[job.partner_id]?.corporate_name || 'Parceiro'}</p></div></div><Badge variant="outline" className="border-white/10 text-white/50">{job.status}</Badge></div><p className="mt-3 text-sm text-white/55">{job.service_description || 'Serviço externo'}</p><div className="mt-3 flex items-center justify-between text-xs text-white/40"><span>{job.garment_item_ids?.length || 0} peça(s)</span><span>{money(job.actual_cost || job.estimated_cost)}</span></div><div className="mt-4">{job.status === 'draft' && <Label className="flex cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"><ArrowUpFromLine className="mr-2 h-4 w-4" />Anexar e enviar<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => actWithEvidence(job, 'send', event.target.files?.[0])} /></Label>}{['sent', 'in_progress'].includes(job.status) && <Label className="flex cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"><ArrowDownToLine className="mr-2 h-4 w-4" />Registrar retorno<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => actWithEvidence(job, 'receive', event.target.files?.[0])} /></Label>}{job.status === 'quality_control' && <Button size="sm" onClick={() => complete(job)} disabled={busyId === job.id} className="w-full bg-emerald-500 text-slate-950 hover:bg-emerald-400">{busyId === job.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Concluir após qualidade</Button>}</div></article>)}</div>

      <div className="rounded-2xl border border-white/10 bg-black/15 p-4"><div className="flex items-center gap-2"><RotateCcw className="h-4 w-4 text-orange-300" /><h3 className="font-semibold text-white">Retrabalhos em aberto</h3><Badge variant="outline" className="border-orange-500/30 text-orange-200">{scopedRework.length}</Badge></div><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{scopedRework.map((item) => <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-sm font-medium text-white">{garmentMap[item.garment_item_id]?.garment_code || item.garment_item_id}</p><p className="mt-1 text-xs text-white/45">{item.description}</p><p className="mt-2 text-xs text-orange-200">{item.status} · {item.priority}</p></div>)}{scopedRework.length === 0 && <p className="text-sm text-white/35">Nenhum retrabalho em aberto.</p>}</div></div>
    </section>
  );
}
