import { useMemo, useState } from 'react';
import { Ban, CheckCircle2, Copy, FileClock, Loader2, PackageCheck, PencilLine, RotateCcw, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const dateTime = (value) => value ? new Date(value).toLocaleString('pt-BR') : '—';
const defaultValidity = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);

const statusLabel = {
  DRAFT: 'Rascunho', HUMAN_REVIEW: 'Em revisão', APPROVED: 'Aprovado internamente', SENT: 'Enviado',
  ACCEPTED: 'Aceito', REJECTED: 'Rejeitado', EXPIRED: 'Expirado', CANCELLED: 'Cancelado',
};

export default function QuoteLifecyclePanel({ quotes = [], customers = [], selectedUnitId, onRefresh }) {
  const [busyId, setBusyId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const customersById = useMemo(() => Object.fromEntries(customers.map((customer) => [customer.id, customer])), [customers]);
  const scopedQuotes = quotes.filter((quote) => selectedUnitId === 'all' || quote.unit_id === selectedUnitId);

  const run = async (quote, action, payload = {}, success = 'Orçamento atualizado.') => {
    setBusyId(quote.id);
    try {
      const response = await base44.functions.invoke('manage_quote_lifecycle', { action, quote_id: quote.id, ...payload });
      toast.success(success);
      onRefresh?.();
      return response.data;
    } catch (error) {
      console.error(error);
      const code = error.response?.data?.error;
      const messages = {
        adjustment_reason_required: 'Informe o motivo do ajuste.',
        manager_approval_required: 'Este ajuste exige aprovação gerencial.',
        quote_with_active_order_cannot_be_cancelled: 'O orçamento possui pedido ativo e não pode ser cancelado.',
        quote_expired: 'O orçamento expirou. Reabra antes do aceite.',
      };
      toast.error(messages[code] || 'Não foi possível atualizar o orçamento.');
      throw error;
    } finally {
      setBusyId(null);
    }
  };

  const convertToOrder = async (quote) => {
    setBusyId(quote.id);
    try {
      await base44.functions.invoke('approve_quote', { quote_id: quote.id });
      toast.success('Pedido criado a partir do orçamento aceito.');
      onRefresh?.();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.error === 'human_review_required' ? 'Existem itens que ainda exigem revisão humana.' : 'Não foi possível criar o pedido.');
    } finally { setBusyId(null); }
  };

  return (
    <section className="space-y-5">
      <div><h2 className="text-xl font-semibold text-white">Ciclo dos orçamentos</h2><p className="text-sm text-white/45">Validade, versões e decisões comerciais sem apagar o histórico.</p></div>
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]"><div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="bg-black/15 text-xs uppercase tracking-wide text-white/35"><tr><th className="px-5 py-3">Orçamento</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Versão</th><th className="px-4 py-3">Validade</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Situação</th><th className="px-5 py-3 text-right">Ações</th></tr></thead><tbody className="divide-y divide-white/5">{scopedQuotes.slice(0, 100).map((quote) => <tr key={quote.id} className="hover:bg-white/[0.025]"><td className="px-5 py-4"><p className="font-medium text-white">{quote.quote_number || `#${quote.id.slice(0, 8)}`}</p><p className="mt-1 text-xs text-white/30">{quote.origin || 'manual'}</p></td><td className="px-4 py-4 text-white/65">{customersById[quote.customer_id]?.full_name || quote.customer_id}</td><td className="px-4 py-4 text-white/55">v{quote.version_number || 1}</td><td className="px-4 py-4"><span className={quote.valid_until && new Date(quote.valid_until) < new Date() ? 'text-red-300' : 'text-white/55'}>{dateTime(quote.valid_until)}</span></td><td className="px-4 py-4 text-right font-semibold text-white">{money(quote.total)}</td><td className="px-4 py-4"><Badge variant="outline" className={quote.status === 'ACCEPTED' ? 'border-emerald-500/30 text-emerald-300' : quote.status === 'SENT' ? 'border-sky-500/30 text-sky-200' : ['REJECTED', 'EXPIRED', 'CANCELLED'].includes(quote.status) ? 'border-red-500/25 text-red-200' : 'border-white/10 text-white/55'}>{statusLabel[quote.status] || quote.status}</Badge></td><td className="px-5 py-4"><div className="flex justify-end gap-1">{['DRAFT', 'HUMAN_REVIEW', 'SENT', 'REJECTED', 'EXPIRED'].includes(quote.status) && <IconButton title="Ajustar e criar versão" icon={PencilLine} onClick={() => setDialog({ mode: 'revise', quote })} />}{['DRAFT', 'HUMAN_REVIEW'].includes(quote.status) && <IconButton title="Enviar" icon={Send} busy={busyId === quote.id} onClick={() => run(quote, 'send', { valid_until: quote.valid_until || new Date(Date.now() + 7 * 86400000).toISOString() }, 'Orçamento enviado.')} />}{['SENT', 'APPROVED'].includes(quote.status) && <><IconButton title="Aceitar" icon={CheckCircle2} busy={busyId === quote.id} tone="text-emerald-300" onClick={() => run(quote, 'accept', {}, 'Aceite registrado.')} /><IconButton title="Rejeitar" icon={XCircle} tone="text-red-300" onClick={() => setDialog({ mode: 'reject', quote })} /></>}{['REJECTED', 'EXPIRED', 'CANCELLED'].includes(quote.status) && <IconButton title="Reabrir" icon={RotateCcw} onClick={() => setDialog({ mode: 'reopen', quote })} />}{quote.status === 'ACCEPTED' && <IconButton title="Criar pedido" icon={PackageCheck} busy={busyId === quote.id} tone="text-emerald-300" onClick={() => convertToOrder(quote)} />}<IconButton title="Duplicar" icon={Copy} busy={busyId === quote.id} onClick={() => run(quote, 'duplicate', { reason: 'Duplicado pela central de Gestão' }, 'Nova cópia criada.')} />{!['CANCELLED', 'ACCEPTED'].includes(quote.status) && <IconButton title="Cancelar" icon={Ban} tone="text-red-300" onClick={() => setDialog({ mode: 'cancel', quote })} />}</div></td></tr>)}</tbody></table></div>{scopedQuotes.length === 0 && <div className="py-14 text-center"><FileClock className="mx-auto h-8 w-8 text-white/20" /><p className="mt-3 text-sm text-white/40">Nenhum orçamento nesta unidade.</p></div>}</div>
      <LifecycleDialog state={dialog} onClose={() => setDialog(null)} busy={!!busyId} run={run} />
    </section>
  );
}

function LifecycleDialog({ state, onClose, busy, run }) {
  const [reason, setReason] = useState('');
  const [discount, setDiscount] = useState('');
  const [addition, setAddition] = useState('');
  const [validUntil, setValidUntil] = useState(defaultValidity());
  if (!state) return null;
  const config = {
    revise: { title: 'Nova versão do orçamento', description: 'Os itens serão recalculados pelo servidor antes do ajuste.', action: 'revise', button: 'Criar versão' },
    reject: { title: 'Rejeitar orçamento', description: 'O motivo ficará no histórico do cliente.', action: 'reject', button: 'Registrar rejeição' },
    cancel: { title: 'Cancelar orçamento', description: 'Orçamentos com pedido ativo não podem ser cancelados.', action: 'cancel', button: 'Cancelar orçamento' },
    reopen: { title: 'Reabrir orçamento', description: 'A reabertura exige justificativa e cria nova versão.', action: 'reopen', button: 'Reabrir' },
  }[state.mode];
  const submit = async () => {
    const payload = state.mode === 'revise'
      ? { items: state.quote.items || [], discount: Number(discount || 0), addition: Number(addition || 0), reason, valid_until: new Date(validUntil).toISOString() }
      : state.mode === 'reopen' ? { reason, valid_until: new Date(validUntil).toISOString() } : { reason };
    await run(state.quote, config.action, payload, `${config.button} concluído.`);
    onClose();
  };
  return <Dialog open onOpenChange={(value) => !value && !busy && onClose()}><DialogContent className="max-w-xl border-white/10 bg-[#170c2b] text-white"><DialogHeader><DialogTitle>{config.title}</DialogTitle><DialogDescription className="text-white/50">{config.description}</DialogDescription></DialogHeader>{state.mode === 'revise' && <div className="grid grid-cols-2 gap-3"><Field label="Desconto"><Input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} className="border-white/10 bg-black/20" /></Field><Field label="Acréscimo"><Input type="number" min="0" step="0.01" value={addition} onChange={(event) => setAddition(event.target.value)} className="border-white/10 bg-black/20" /></Field></div>}{['revise', 'reopen'].includes(state.mode) && <Field label="Validade"><Input type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className="border-white/10 bg-black/20" /></Field>}<Field label="Motivo"><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Obrigatório para governança e auditoria" className="border-white/10 bg-black/20" /></Field><Button onClick={submit} disabled={busy || reason.trim().length < (state.mode === 'reject' ? 3 : 8)} className="bg-violet-500 hover:bg-violet-400">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{config.button}</Button></DialogContent></Dialog>;
}

function IconButton({ title, icon: Icon, onClick, busy = false, tone = 'text-white/65' }) { return <Button size="icon" variant="ghost" title={title} onClick={onClick} disabled={busy} className={tone}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}</Button>; }
function Field({ label, children }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
