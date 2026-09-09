import { useMemo, useState } from 'react';
import { Boxes, Check, Loader2, MapPin, Plus, Printer, ScanLine, Search, Shirt, Warehouse } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import GarmentScannerDialog from './GarmentScannerDialog';

const TERMINAL = new Set(['delivered', 'cancelled']);
const STATUS_LABELS = {
  received: 'Recebida', tagged: 'Etiquetada', queued: 'Na fila', washing: 'Lavagem', drying: 'Secagem', ironing: 'Passadoria',
  quality_control: 'Qualidade', with_third_party: 'Em terceiro', rework: 'Retrabalho', ready: 'Pronta', out_for_delivery: 'Em entrega', delivered: 'Entregue', cancelled: 'Cancelada',
};
const LOCATION_TYPES = [
  ['reception', 'Recepção'], ['production', 'Produção'], ['machine', 'Máquina'], ['rack', 'Arara'], ['shelf', 'Prateleira'],
  ['locker', 'Locker'], ['dispatch', 'Expedição'], ['third_party', 'Terceiro'], ['other', 'Outro'],
];

function searchableGarment(garment, customerName) {
  const attributes = garment.attributes || {};
  const condition = garment.condition || {};
  return [garment.product_name, garment.garment_code, garment.ticket_number, customerName, garment.location_label, garment.status,
    ...Object.values(attributes), ...(condition.damages || []), ...(condition.risk_tags || []), ...(garment.services || []).flatMap((service) => [service.name, service.code])]
    .filter(Boolean).join(' ').toLowerCase();
}

export default function GarmentLocationPanel({ garments = [], locations = [], customers = [], selectedUnitId, defaultUnitId, onRefresh, onPrintLabels, onDeliver }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [locationFilter, setLocationFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [destinationId, setDestinationId] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newLocation, setNewLocation] = useState({ code: '', name: '', location_type: 'rack', capacity: '' });

  const unitId = selectedUnitId === 'all' ? defaultUnitId : selectedUnitId;
  const customerMap = useMemo(() => Object.fromEntries(customers.map((customer) => [customer.id, customer.full_name])), [customers]);
  const scopedLocations = useMemo(() => locations.filter((location) => location.active !== false && (!unitId || location.unit_id === unitId)), [locations, unitId]);
  const scopedGarments = useMemo(() => garments.filter((garment) => {
    if (unitId && garment.unit_id !== unitId) return false;
    if (statusFilter === 'active' && TERMINAL.has(garment.status)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'active' && garment.status !== statusFilter) return false;
    if (locationFilter === 'unassigned' && garment.location_id) return false;
    if (!['all', 'unassigned'].includes(locationFilter) && garment.location_id !== locationFilter) return false;
    return !search || searchableGarment(garment, customerMap[garment.customer_id]).includes(search.toLowerCase().trim());
  }), [garments, unitId, statusFilter, locationFilter, search, customerMap]);
  const selectedGarments = useMemo(() => garments.filter((garment) => selectedIds.includes(garment.id)), [garments, selectedIds]);
  const unassigned = scopedGarments.filter((garment) => !garment.location_id && !TERMINAL.has(garment.status)).length;

  const toggle = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  const selectVisible = () => setSelectedIds((current) => scopedGarments.every((garment) => current.includes(garment.id)) ? current.filter((id) => !scopedGarments.some((garment) => garment.id === id)) : [...new Set([...current, ...scopedGarments.map((garment) => garment.id)])]);

  const handleScan = (code) => {
    const garment = garments.find((item) => item.garment_code?.toUpperCase() === code.toUpperCase() || item.id === code);
    if (!garment) return toast.error('Peça não encontrada para este código.');
    if (unitId && garment.unit_id !== unitId) return toast.error('A peça pertence a outra unidade.');
    setSelectedIds((current) => current.includes(garment.id) ? current : [...current, garment.id]);
    setSearch(garment.garment_code);
    setScannerOpen(false);
    toast.success(`${garment.garment_code} selecionada.`);
  };

  const move = async (targetLocationId) => {
    if (selectedGarments.length === 0) return toast.error('Selecione ou leia ao menos uma peça.');
    setBusy(true);
    try {
      await base44.functions.invoke('move_garments', {
        garment_item_ids: selectedGarments.map((garment) => garment.id),
        location_id: targetLocationId || null,
        reason: targetLocationId ? 'counter_location_assignment' : 'counter_location_clear',
        idempotency_key: crypto.randomUUID(),
      });
      toast.success(targetLocationId ? `${selectedGarments.length} peça(s) movimentada(s).` : 'Localização removida das peças.');
      setSelectedIds([]);
      setDestinationId('');
      onRefresh?.();
    } catch (error) {
      console.error(error);
      const code = error.response?.data?.error;
      toast.error(code === 'location_capacity_exceeded' ? 'A posição não possui capacidade disponível.' : code === 'terminal_garment_cannot_move' ? 'Peças entregues ou canceladas não podem ser movimentadas.' : 'Não foi possível movimentar as peças.');
    } finally {
      setBusy(false);
    }
  };

  const createLocation = async () => {
    if (!unitId || !newLocation.code.trim() || !newLocation.name.trim()) return toast.error('Informe unidade, código e nome.');
    setBusy(true);
    try {
      await base44.functions.invoke('manage_location', {
        action: 'create', unit_id: unitId, code: newLocation.code, name: newLocation.name,
        location_type: newLocation.location_type, capacity: Number(newLocation.capacity || 0), scan_required: true,
      });
      toast.success('Posição criada.');
      setCreateOpen(false);
      setNewLocation({ code: '', name: '', location_type: 'rack', capacity: '' });
      onRefresh?.();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.error === 'location_code_exists' ? 'Já existe uma posição ativa com esse código.' : 'Não foi possível criar a posição.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div><h2 className="flex items-center gap-2 text-xl font-semibold text-white"><Warehouse className="h-5 w-5 text-cyan-300" />Localização e etiquetas</h2><p className="text-sm text-white/45">Encontre por qualquer característica, leia etiquetas e mova peças para posições físicas.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setCreateOpen(true)} className="border-white/10 bg-white/5"><Plus className="mr-2 h-4 w-4" />Nova posição</Button><Button variant="outline" onClick={() => setScannerOpen(true)} className="border-cyan-400/20 bg-cyan-500/5 text-cyan-200"><ScanLine className="mr-2 h-4 w-4" />Ler etiqueta</Button><Button onClick={() => onPrintLabels?.(selectedGarments)} disabled={selectedGarments.length === 0} className="bg-orange-500 hover:bg-orange-400"><Printer className="mr-2 h-4 w-4" />Etiquetas ({selectedGarments.length})</Button></div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs text-white/40">Peças ativas</p><p className="mt-1 text-2xl font-bold">{garments.filter((garment) => (!unitId || garment.unit_id === unitId) && !TERMINAL.has(garment.status)).length}</p></div>
        <div className="rounded-3xl border border-amber-400/20 bg-amber-500/5 p-4"><p className="text-xs text-amber-100/50">Sem localização</p><p className="mt-1 text-2xl font-bold text-amber-200">{unassigned}</p></div>
        <div className="rounded-3xl border border-cyan-400/20 bg-cyan-500/5 p-4"><p className="text-xs text-cyan-100/50">Posições ativas</p><p className="mt-1 text-2xl font-bold text-cyan-200">{scopedLocations.length}</p></div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_180px_220px]">
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-white/30" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Peça, cliente, ticket, cor, marca, tamanho, serviço, avaria ou posição" className="border-white/10 bg-black/20 pl-9" /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Ativas</SelectItem><SelectItem value="all">Todos os estados</SelectItem>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={locationFilter} onValueChange={setLocationFilter}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as posições</SelectItem><SelectItem value="unassigned">Sem localização</SelectItem>{scopedLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.code} · {location.name}</SelectItem>)}</SelectContent></Select>
      </div>

      {selectedGarments.length > 0 && <div className="flex flex-col gap-3 rounded-3xl border border-violet-400/20 bg-violet-500/5 p-4 lg:flex-row lg:items-end"><div className="flex-1 space-y-2"><Label>Destino das {selectedGarments.length} peça(s)</Label><Select value={destinationId} onValueChange={setDestinationId}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue placeholder="Selecione arara, prateleira ou expedição" /></SelectTrigger><SelectContent>{scopedLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.code} · {location.name} ({location.current_occupancy || 0}/{location.capacity || '∞'})</SelectItem>)}</SelectContent></Select></div><Button onClick={() => move(destinationId)} disabled={busy || !destinationId} className="bg-violet-500 hover:bg-violet-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}Guardar na posição</Button><Button variant="outline" onClick={() => move(null)} disabled={busy} className="border-white/10 bg-white/5">Remover posição</Button>{onDeliver && <Button onClick={() => onDeliver(selectedGarments)} disabled={busy} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">Entregar selecionadas</Button>}</div>}

      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3"><button type="button" onClick={selectVisible} className="text-xs font-medium text-cyan-200 hover:text-cyan-100">Selecionar resultados</button><span className="text-xs text-white/35">{scopedGarments.length} resultado(s)</span></div>
        <div className="max-h-[560px] overflow-auto"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="sticky top-0 z-10 bg-[#160c29] text-xs uppercase tracking-wide text-white/35"><tr><th className="px-5 py-3"></th><th className="px-3 py-3">Peça</th><th className="px-3 py-3">Cliente/ticket</th><th className="px-3 py-3">Características</th><th className="px-3 py-3">Serviços</th><th className="px-3 py-3">Estado</th><th className="px-5 py-3">Posição</th></tr></thead><tbody className="divide-y divide-white/5">{scopedGarments.map((garment) => { const checked = selectedIds.includes(garment.id); const attrs = garment.attributes || {}; return <tr key={garment.id} onClick={() => toggle(garment.id)} className={`cursor-pointer hover:bg-white/[0.035] ${checked ? 'bg-cyan-500/[0.07]' : ''}`}><td className="px-5 py-3"><div className={`flex h-6 w-6 items-center justify-center rounded-lg border ${checked ? 'border-cyan-300 bg-cyan-400 text-slate-950' : 'border-white/15 text-transparent'}`}><Check className="h-3.5 w-3.5" /></div></td><td className="px-3 py-3"><div className="flex items-center gap-2"><Shirt className="h-4 w-4 text-violet-300" /><div><p className="font-medium text-white">{garment.product_name}</p><p className="font-mono text-xs text-white/35">{garment.garment_code}</p></div></div></td><td className="px-3 py-3"><p className="text-white/70">{customerMap[garment.customer_id] || 'Cliente'}</p><p className="text-xs text-white/35">{garment.ticket_number}</p></td><td className="px-3 py-3 text-xs text-white/55">{[attrs.color, attrs.brand, attrs.size, attrs.material].filter(Boolean).join(' · ') || '—'}</td><td className="px-3 py-3 text-xs text-white/55">{(garment.services || []).map((service) => service.name).filter(Boolean).join(' + ') || 'Catálogo legado'}</td><td className="px-3 py-3"><Badge variant="outline" className="border-white/10 text-white/55">{STATUS_LABELS[garment.status] || garment.status}</Badge></td><td className="px-5 py-3 text-white/60"><span className="flex items-center gap-2"><Boxes className="h-3.5 w-3.5" />{garment.location_label || 'Sem localização'}</span></td></tr>; })}</tbody></table></div>
        {scopedGarments.length === 0 && <div className="py-16 text-center text-sm text-white/35">Nenhuma peça corresponde aos filtros.</div>}
      </div>

      <GarmentScannerDialog open={scannerOpen} onOpenChange={setScannerOpen} onScan={handleScan} title="Localizar pela etiqueta" description="A peça encontrada será selecionada para movimentação, impressão ou entrega." />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="border-white/10 bg-[#170c2b] text-white"><DialogHeader><DialogTitle>Nova posição física</DialogTitle><DialogDescription className="text-white/50">Cadastre araras, prateleiras, produção, expedição ou lockers.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Código</Label><Input value={newLocation.code} onChange={(event) => setNewLocation((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="AR-A01" className="border-white/10 bg-black/20" /></div><div className="space-y-2"><Label>Nome</Label><Input value={newLocation.name} onChange={(event) => setNewLocation((current) => ({ ...current, name: event.target.value }))} placeholder="Arara A · posição 01" className="border-white/10 bg-black/20" /></div><div className="space-y-2"><Label>Tipo</Label><Select value={newLocation.location_type} onValueChange={(value) => setNewLocation((current) => ({ ...current, location_type: value }))}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent>{LOCATION_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Capacidade (0 = ilimitada)</Label><Input type="number" min="0" value={newLocation.capacity} onChange={(event) => setNewLocation((current) => ({ ...current, capacity: event.target.value }))} className="border-white/10 bg-black/20" /></div></div><Button onClick={createLocation} disabled={busy} className="bg-cyan-500 text-slate-950 hover:bg-cyan-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Criar posição</Button></DialogContent></Dialog>
    </section>
  );
}
