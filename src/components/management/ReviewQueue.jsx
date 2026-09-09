import { useMemo, useState } from 'react';
import { Check, CircleAlert, Clock3, FileSearch, Loader2, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const LABELS = {
  garment_recognition: 'Reconhecimento de peça',
  purchase_document: 'Nota de compra',
  financial_document: 'Conta financeira',
  payment_receipt: 'Comprovante de pagamento',
  stock_divergence: 'Divergência de estoque',
  quality_exception: 'Exceção de qualidade',
  other: 'Outra revisão',
};

const PRIORITY = {
  critical: 'border-red-500/40 bg-red-500/10 text-red-200',
  high: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
  normal: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  low: 'border-white/10 bg-white/5 text-white/50',
};

export default function ReviewQueue({ reviews = [], selectedUnitId, onRefresh }) {
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const pending = useMemo(() => reviews
    .filter((review) => ['pending', 'in_progress'].includes(review.status))
    .filter((review) => selectedUnitId === 'all' || review.unit_id === selectedUnitId)
    .filter((review) => `${review.summary} ${(review.reason_codes || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, normal: 2, low: 3 };
      return (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || new Date(a.due_at || a.created_date) - new Date(b.due_at || b.created_date);
    }), [reviews, selectedUnitId, search]);

  const resolve = async (review) => {
    setBusyId(review.id);
    try {
      await base44.functions.invoke('resolve_human_review', { review_id: review.id, action: 'approve' });
      toast.success('Revisão registrada. Execute a ação especializada no módulo correspondente quando necessário.');
      onRefresh?.();
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível concluir a revisão.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-xl font-semibold text-white">Central de revisão</h2><p className="text-sm text-white/45">A IA automatiza o rascunho; decisões sensíveis continuam sob responsabilidade humana.</p></div>
        <div className="relative w-full sm:w-80"><Search className="absolute left-3 top-2.5 h-4 w-4 text-white/35" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pendência" className="border-white/10 bg-white/5 pl-9" /></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {pending.map((review) => (
          <article key={review.id} className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3"><div className="rounded-xl bg-violet-500/15 p-2 text-violet-300"><FileSearch className="h-5 w-5" /></div><div><h3 className="font-semibold text-white">{LABELS[review.review_type] || review.review_type}</h3><p className="mt-1 text-sm text-white/55">{review.summary}</p></div></div>
              <Badge variant="outline" className={PRIORITY[review.priority] || PRIORITY.normal}>{review.priority}</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">{(review.reason_codes || []).map((reason) => <Badge key={reason} variant="outline" className="border-white/10 text-white/45">{reason.replaceAll('_', ' ')}</Badge>)}</div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
              <div className="flex items-center gap-2 text-xs text-white/40"><Clock3 className="h-3.5 w-3.5" />{review.due_at ? new Date(review.due_at).toLocaleString('pt-BR') : 'Sem prazo definido'}</div>
              <Button size="sm" onClick={() => resolve(review)} disabled={busyId === review.id} className="bg-violet-500 hover:bg-violet-400">{busyId === review.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}Revisado</Button>
            </div>
          </article>
        ))}
      </div>

      {pending.length === 0 && <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 py-16 text-center"><ShieldCheck className="h-10 w-10 text-emerald-300" /><h3 className="mt-3 font-semibold text-white">Nenhuma revisão pendente</h3><p className="mt-1 text-sm text-white/40">Itens de baixa confiança e exceções aparecerão aqui.</p></div>}
      {pending.some((review) => review.review_type === 'payment_receipt') && <div className="flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200"><CircleAlert className="h-4 w-4" />Comprovantes não confirmam pagamentos sozinhos; valide a liquidação no banco ou adquirente.</div>}
    </section>
  );
}
