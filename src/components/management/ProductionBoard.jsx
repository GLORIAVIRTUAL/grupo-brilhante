import { useMemo, useState } from 'react';
import { ArrowRight, Boxes, CircleAlert, Clock3, Loader2, MapPin, PackageCheck, Search, Shirt } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const COLUMNS = [
  { key: 'intake', label: 'Entrada', statuses: ['draft', 'awaiting_approval', 'received', 'tagged'], color: 'from-sky-500 to-cyan-400' },
  { key: 'queue', label: 'Fila', statuses: ['queued'], color: 'from-violet-500 to-fuchsia-400' },
  { key: 'production', label: 'Em produção', statuses: ['washing', 'drying', 'ironing'], color: 'from-orange-500 to-amber-400' },
  { key: 'quality', label: 'Qualidade', statuses: ['quality_control'], color: 'from-indigo-500 to-blue-400' },
  { key: 'exceptions', label: 'Exceções', statuses: ['with_third_party', 'rework'], color: 'from-red-500 to-rose-400' },
  { key: 'ready', label: 'Prontas', statuses: ['ready', 'out_for_delivery'], color: 'from-emerald-500 to-teal-400' },
];

const NEXT_STATUS = {
  received: ['tagged', 'Etiquetar'],
  tagged: ['queued', 'Enviar à fila'],
  queued: ['washing', 'Iniciar lavagem'],
  washing: ['drying', 'Enviar à secagem'],
  drying: ['ironing', 'Enviar à passadoria'],
  ironing: ['quality_control', 'Controle de qualidade'],
  ready: ['out_for_delivery', 'Separar para entrega'],
  out_for_delivery: ['delivered', 'Confirmar entrega'],
};

const STATUS_LABEL = {
  draft: 'Rascunho', awaiting_approval: 'Aguardando aprovação', received: 'Recebida', tagged: 'Etiquetada', queued: 'Na fila',
  washing: 'Lavagem', drying: 'Secagem', ironing: 'Passadoria', quality_control: 'Controle de qualidade', with_third_party: 'Em terceiro',
  rework: 'Retrabalho', ready: 'Pronta', out_for_delivery: 'Em entrega', delivered: 'Entregue', cancelled: 'Cancelada',
};

function GarmentCard({ garment, customerName, onAdvance, onInspect, busy }) {
  const next = NEXT_STATUS[garment.status];
  const isOverdue = garment.due_at && new Date(garment.due_at) < new Date() && !['ready', 'out_for_delivery', 'delivered'].includes(garment.status);

  return (
    <article className="rounded-2xl border border-white/10 bg-[#1b1030] p-4 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-white/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-xl bg-white/5 p-2"><Shirt className="h-4 w-4 text-violet-300" /></div>
          <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{garment.product_name}</p><p className="text-xs text-white/40">{garment.garment_code}</p></div>
        </div>
        <Badge variant="outline" className={isOverdue ? 'border-red-500/30 text-red-300' : 'border-white/10 text-white/55'}>{STATUS_LABEL[garment.status] || garment.status}</Badge>
      </div>
      <div className="mt-4 space-y-2 text-xs text-white/55">
        <div className="flex items-center gap-2"><PackageCheck className="h-3.5 w-3.5" /><span>{garment.ticket_number || garment.order_id?.slice(0, 8)}</span></div>
        <div className="flex items-center gap-2"><Boxes className="h-3.5 w-3.5" /><span className="truncate">{customerName || 'Cliente'}</span></div>
        <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /><span className="truncate">{garment.location_label || 'Localização pendente'}</span></div>
        {garment.due_at && <div className={`flex items-center gap-2 ${isOverdue ? 'text-red-300' : ''}`}><Clock3 className="h-3.5 w-3.5" /><span>{new Date(garment.due_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span></div>}
      </div>
      {garment.status === 'quality_control' ? (
        <Button size="sm" onClick={() => onInspect?.(garment)} className="mt-4 w-full bg-indigo-500 hover:bg-indigo-400">Inspecionar qualidade</Button>
      ) : next ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onAdvance(garment, next[0])} className="mt-4 w-full border-white/10 bg-white/5 hover:bg-white/10">
          {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-2 h-3.5 w-3.5" />}{next[1]}
        </Button>
      ) : null}
    </article>
  );
}

export default function ProductionBoard({ garments = [], customers = [], selectedUnitId, defaultUnitId, onRefresh, onInspect }) {
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const customerMap = useMemo(() => Object.fromEntries(customers.map((customer) => [customer.id, customer.full_name])), [customers]);
  const unitId = selectedUnitId === 'all' ? defaultUnitId : selectedUnitId;

  const filtered = useMemo(() => garments.filter((garment) => {
    if (selectedUnitId !== 'all' && garment.unit_id !== selectedUnitId) return false;
    const haystack = `${garment.product_name} ${garment.garment_code} ${garment.ticket_number} ${customerMap[garment.customer_id]}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [garments, selectedUnitId, search, customerMap]);

  const advance = async (garment, status) => {
    setBusyId(garment.id);
    try {
      await base44.functions.invoke('update_garment_status', {
        garment_item_id: garment.id,
        status,
        reason: 'management_production_board',
      });
      toast.success(`${garment.garment_code} atualizado.`);
      onRefresh?.();
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível atualizar a peça. Verifique a transição e sua permissão.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-xl font-semibold text-white">Fluxo por peça</h2><p className="text-sm text-white/45">Cada roupa mantém código, fotos, localização e histórico próprios.</p></div>
        <div className="relative w-full sm:w-80"><Search className="absolute left-3 top-2.5 h-4 w-4 text-white/35" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar peça, ticket ou cliente" className="border-white/10 bg-white/5 pl-9" /></div>
      </div>
      {!unitId && <div className="flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200"><CircleAlert className="h-4 w-4" />Selecione uma unidade para operar as peças.</div>}
      <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-6">
        {COLUMNS.map((column) => {
          const columnGarments = filtered.filter((garment) => column.statuses.includes(garment.status));
          return (
            <div key={column.key} className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.025] p-3">
              <div className="mb-3 flex items-center justify-between px-1"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-r ${column.color}`} /><h3 className="text-sm font-semibold text-white/85">{column.label}</h3></div><Badge variant="outline" className="border-white/10 text-white/45">{columnGarments.length}</Badge></div>
              <div className="space-y-3">{columnGarments.map((garment) => <GarmentCard key={garment.id} garment={garment} customerName={customerMap[garment.customer_id]} onAdvance={advance} onInspect={onInspect} busy={busyId === garment.id} />)}{columnGarments.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 px-3 py-8 text-center text-xs text-white/30">Nenhuma peça</div>}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
