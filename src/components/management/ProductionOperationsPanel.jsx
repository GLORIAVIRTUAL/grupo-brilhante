import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Calculator, Cpu, Gauge, Plus, Search, Timer, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import ProductionBatchDialog from './ProductionBatchDialog';
import BatchExecutionDialog from './BatchExecutionDialog';
import MachineManagementDialog from './MachineManagementDialog';
import ProductionCostProfileDialog from './ProductionCostProfileDialog';

const STATUS = { draft: 'Rascunho', scheduled: 'Agendado', waiting_materials: 'Sem insumos', queued: 'Na fila', processing: 'Em execução', paused: 'Pausado', completed: 'Concluído', cancelled: 'Cancelado', failed: 'Falhou' };
const STAGE = { washing: 'Lavagem', drying: 'Secagem', dry_cleaning: 'Lavagem a seco', ironing: 'Passadoria', finishing: 'Finalização', quality_control: 'Qualidade', packaging: 'Embalagem' };
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const statusTone = (status) => ({ processing: 'border-emerald-500/30 text-emerald-300', paused: 'border-amber-500/30 text-amber-200', waiting_materials: 'border-red-500/30 text-red-300', completed: 'border-sky-500/30 text-sky-300' }[status] || 'border-white/10 text-white/50');

function BatchCard({ batch, onOpen }) {
  const late = batch.scheduled_at && Date.parse(batch.scheduled_at) < Date.now() && !['processing', 'completed', 'cancelled'].includes(batch.status);
  return <button type="button" onClick={() => onOpen(batch)} className="w-full rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.05]"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-white">{batch.code}</p><p className="mt-1 text-xs text-white/40">{STAGE[batch.stage] || batch.stage} · {batch.machine_id || 'etapa manual'}</p></div><Badge variant="outline" className={statusTone(batch.status)}>{STATUS[batch.status] || batch.status}</Badge></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-black/15 p-2"><p className="text-[10px] uppercase text-white/30">Peças</p><p className="text-sm font-bold text-white">{batch.piece_count || batch.garment_item_ids?.length || 0}</p></div><div className="rounded-xl bg-black/15 p-2"><p className="text-[10px] uppercase text-white/30">Carga</p><p className={`text-sm font-bold ${Number(batch.capacity_percent || 0) > 100 ? 'text-red-300' : 'text-white'}`}>{Number(batch.capacity_percent || 0).toFixed(0)}%</p></div><div className="rounded-xl bg-black/15 p-2"><p className="text-[10px] uppercase text-white/30">Custo</p><p className="text-sm font-bold text-cyan-300">{money(batch.total_actual_cost || batch.estimated_material_cost)}</p></div></div>{late && <p className="mt-3 flex items-center gap-2 text-xs text-red-300"><AlertTriangle className="h-3.5 w-3.5" />Agendamento atrasado</p>}{batch.status === 'waiting_materials' && <p className="mt-3 flex items-center gap-2 text-xs text-amber-300"><AlertTriangle className="h-3.5 w-3.5" />Reponha os insumos para liberar</p>}</button>;
}

export default function ProductionOperationsPanel({ batches = [], machines = [], recipes = [], garments = [], customers = [], laborEntries = [], stockItems = [], costProfiles = [], selectedUnitId, defaultUnitId, onRefresh }) {
  const [search, setSearch] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [machineOpen, setMachineOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const unitId = selectedUnitId === 'all' ? defaultUnitId : selectedUnitId;
  const scopedBatches = useMemo(() => batches.filter((batch) => (selectedUnitId === 'all' || batch.unit_id === selectedUnitId) && `${batch.code} ${batch.stage} ${batch.machine_id} ${batch.status}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => { const priority = { urgent: 0, high: 1, normal: 2 }; return (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2) || Date.parse(a.scheduled_at || a.created_date || 0) - Date.parse(b.scheduled_at || b.created_date || 0); }), [batches, selectedUnitId, search]);
  const scopedMachines = machines.filter((machine) => !machine.unit_id || selectedUnitId === 'all' || machine.unit_id === selectedUnitId);
  const active = scopedBatches.filter((batch) => !['completed', 'cancelled'].includes(batch.status));
  const running = active.filter((batch) => batch.status === 'processing');
  const queued = active.filter((batch) => ['queued', 'scheduled', 'draft'].includes(batch.status));
  const blocked = active.filter((batch) => ['waiting_materials', 'failed', 'paused'].includes(batch.status));
  const averageCapacity = running.length ? running.reduce((sum, batch) => sum + Number(batch.capacity_percent || 0), 0) / running.length : 0;
  const actualCost = scopedBatches.filter((batch) => batch.status === 'completed').reduce((sum, batch) => sum + Number(batch.total_actual_cost || 0), 0);
  const groups = [
    { key: 'waiting', label: 'Planejamento', statuses: ['draft', 'scheduled', 'waiting_materials'], color: 'bg-amber-400' },
    { key: 'queued', label: 'Fila', statuses: ['queued'], color: 'bg-violet-400' },
    { key: 'running', label: 'Em execução', statuses: ['processing', 'paused'], color: 'bg-emerald-400' },
    { key: 'done', label: 'Concluídos', statuses: ['completed'], color: 'bg-sky-400' },
  ];

  return <section className="space-y-6">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div><h2 className="text-xl font-semibold text-white">Planejamento e execução</h2><p className="text-sm text-white/45">Lotes, capacidade, máquinas, operadores, consumo e custos reais.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setCostOpen(true)} className="border-white/10 bg-white/5"><Calculator className="mr-2 h-4 w-4" />Custos</Button><Button variant="outline" onClick={() => setMachineOpen(true)} className="border-white/10 bg-white/5"><Cpu className="mr-2 h-4 w-4" />Máquinas</Button><Button onClick={() => setBatchOpen(true)} className="bg-gradient-to-r from-violet-500 to-fuchsia-500"><Plus className="mr-2 h-4 w-4" />Novo lote</Button></div></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[
      { label: 'Em execução', value: running.length, Icon: Activity, tone: 'text-emerald-300' },
      { label: 'Na fila', value: queued.length, Icon: Timer, tone: 'text-violet-300' },
      { label: 'Bloqueados', value: blocked.length, Icon: AlertTriangle, tone: 'text-amber-300' },
      { label: 'Carga média', value: `${averageCapacity.toFixed(0)}%`, Icon: Gauge, tone: 'text-sky-300' },
      { label: 'Custo concluído', value: money(actualCost), Icon: WalletCards, tone: 'text-cyan-300' },
    ].map(({ label, value, Icon, tone }) => <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="flex items-center justify-between"><span className="text-sm text-white/45">{label}</span><Icon className={`h-5 w-5 ${tone}`} /></div><p className="mt-3 text-2xl font-bold text-white">{value}</p></div>)}</div>
    <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-white">Mapa de máquinas</h3><p className="text-xs text-white/40">Estado em tempo real e lote associado.</p></div><Badge variant="outline" className="border-white/10 text-white/50">{scopedMachines.length} equipamentos</Badge></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{scopedMachines.map((machine) => { const batch = scopedBatches.find((row) => row.id === machine.production_batch_id); const runningMachine = ['running', 'paused', 'finished'].includes(machine.operational_status); return <button type="button" key={machine.machine_id} onClick={() => batch && setSelectedBatch(batch)} className={`rounded-2xl border p-4 text-left ${runningMachine ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-white/10 bg-black/10'}`}><div className="flex items-start justify-between gap-2"><div><p className="font-medium text-white">{machine.name || machine.machine_id}</p><p className="text-xs text-white/35">{machine.machine_id}</p></div><span className={`h-2.5 w-2.5 rounded-full ${runningMachine ? 'bg-emerald-400 animate-pulse' : machine.operational_status === 'maintenance' ? 'bg-amber-400' : 'bg-white/25'}`} /></div><p className="mt-3 text-xs text-white/45">{batch ? `${batch.code} · ${batch.piece_count} peças` : machine.operational_status || 'idle'}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400" style={{ width: `${Math.min(100, Number(batch?.capacity_percent || 0))}%` }} /></div></button>; })}{scopedMachines.length === 0 && <button type="button" onClick={() => setMachineOpen(true)} className="col-span-full rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">Configure ou importe as máquinas atuais.</button>}</div></div>
    <div className="relative max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-white/35" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lote, etapa, máquina ou estado" className="border-white/10 bg-white/5 pl-9" /></div>
    <div className="grid gap-4 xl:grid-cols-4">{groups.map((group) => { const rows = scopedBatches.filter((batch) => group.statuses.includes(batch.status)).slice(0, group.key === 'done' ? 12 : 100); return <div key={group.key} className="rounded-3xl border border-white/10 bg-white/[0.02] p-3"><div className="mb-3 flex items-center justify-between px-1"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${group.color}`} /><h3 className="text-sm font-semibold text-white/80">{group.label}</h3></div><Badge variant="outline" className="border-white/10 text-white/45">{rows.length}</Badge></div><div className="space-y-3">{rows.map((batch) => <BatchCard key={batch.id} batch={batch} onOpen={setSelectedBatch} />)}{rows.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-7 text-center text-xs text-white/30">Nenhum lote</div>}</div></div>; })}</div>
    <ProductionBatchDialog open={batchOpen} onOpenChange={setBatchOpen} garments={garments} customers={customers} machines={machines} recipes={recipes} unitId={unitId} onCreated={onRefresh} />
    <BatchExecutionDialog open={!!selectedBatch} onOpenChange={(value) => !value && setSelectedBatch(null)} batch={selectedBatch ? batches.find((batch) => batch.id === selectedBatch.id) || selectedBatch : null} laborEntries={laborEntries} stockItems={stockItems} onCompleted={onRefresh} />
    <MachineManagementDialog open={machineOpen} onOpenChange={setMachineOpen} machines={machines} unitId={unitId} onCompleted={onRefresh} />
    <ProductionCostProfileDialog open={costOpen} onOpenChange={setCostOpen} profiles={costProfiles} unitId={unitId} onCompleted={onRefresh} />
  </section>;
}
