import { useMemo, useState } from 'react';
import { Banknote, Check, ClipboardCheck, Loader2, MinusCircle, PlusCircle, RefreshCw, RotateCcw, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const methodLabels = { cash: 'Dinheiro', pix: 'Pix', credit: 'Crédito', debit: 'Débito', bank_transfer: 'Transferência', customer_balance: 'Crédito do cliente', invoiced: 'Faturado', other: 'Outros' };

export default function CashSessionModal({ open, onOpenChange, unitId, sessions = [], onProcessed }) {
  const [busy, setBusy] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('0');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [countedAmount, setCountedAmount] = useState('');
  const [differenceReason, setDifferenceReason] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [position, setPosition] = useState(null);
  const unitSessions = useMemo(() => sessions.filter((session) => session.unit_id === unitId).sort((a, b) => new Date(b.opened_at || b.created_date).getTime() - new Date(a.opened_at || a.created_date).getTime()), [sessions, unitId]);
  const activeSession = unitSessions.find((session) => ['open', 'counting', 'pending_approval'].includes(session.status)) || null;
  const lastClosedSession = unitSessions.find((session) => session.status === 'closed') || null;
  const displayed = position?.cash_session || activeSession;

  const run = async (payload, successMessage, options = {}) => {
    setBusy(true);
    try {
      const response = await base44.functions.invoke('manage_cash_session', payload);
      if (successMessage) toast.success(successMessage);
      if (payload.action === 'position') setPosition(response.data);
      else {
        setPosition(response.data?.position ? { ...response.data, cash_session: response.data.cash_session } : null);
        onProcessed?.(response.data);
      }
      if (options.resetMovement) { setMovementAmount(''); setMovementReason(''); }
      return response.data;
    } catch (error) {
      console.error(error);
      const code = error.response?.data?.error;
      const messages = {
        difference_reason_required: 'Informe um motivo detalhado para a diferença.',
        manager_approval_required: 'Esta operação exige aprovação gerencial.',
        approval_reason_required: 'Informe por que a diferença está sendo aprovada.',
        reopen_reason_required: 'Informe o motivo da reabertura.',
        operator_already_has_active_session: 'O operador já possui outro caixa em andamento.',
      };
      toast.error(messages[code] || 'Não foi possível operar o caixa.');
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const addMovement = (movementType) => {
    if (!activeSession || Number(movementAmount) <= 0) return toast.error('Informe um valor válido.');
    if (!movementReason.trim()) return toast.error('Informe o motivo.');
    run({ action: 'movement', cash_session_id: activeSession.id, movement_type: movementType, amount: Number(movementAmount), payment_method: 'cash', reason: movementReason }, movementType === 'supply' ? 'Suprimento registrado.' : 'Sangria registrada.', { resetMovement: true });
  };

  const paymentSummary = displayed?.payment_summary || position?.position?.payment_summary || {};
  const expected = Number(displayed?.expected_cash_amount ?? activeSession?.expected_cash_amount ?? 0);
  const difference = countedAmount === '' ? 0 : Number(countedAmount) - expected;

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-white/10 bg-[#170c2b] text-white">
        <DialogHeader><div className="flex items-center gap-3"><div className="rounded-2xl bg-emerald-500/15 p-2.5 text-emerald-300"><Banknote className="h-5 w-5" /></div><div><DialogTitle>Caixa da unidade</DialogTitle><DialogDescription className="text-white/50">Abertura, posição do turno, conferência e aprovação são auditadas.</DialogDescription></div></div></DialogHeader>

        {!activeSession ? (
          <div className="space-y-5 py-3">
            <div className="space-y-2"><Label>Fundo de abertura</Label><Input type="number" min="0" step="0.01" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} className="border-white/10 bg-white/5" /></div>
            <Button disabled={busy || !unitId} onClick={() => run({ action: 'open', unit_id: unitId, opening_amount: Number(openingAmount || 0) }, 'Caixa aberto com sucesso.')} className="w-full bg-emerald-500 text-slate-950 hover:bg-emerald-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}Abrir caixa</Button>
            {lastClosedSession && <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4"><div className="flex items-center justify-between"><div><p className="font-medium">Último fechamento</p><p className="text-xs text-white/40">{lastClosedSession.session_number || lastClosedSession.id}</p></div><Badge variant="outline" className="border-emerald-500/30 text-emerald-300">Fechado</Badge></div><div className="mt-3 grid grid-cols-3 gap-2"><Metric label="Esperado" value={money(lastClosedSession.expected_cash_amount)} /><Metric label="Contado" value={money(lastClosedSession.counted_cash_amount)} /><Metric label="Diferença" value={money(lastClosedSession.difference_amount)} /></div><div className="mt-3 flex gap-2"><Input value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Motivo da reabertura" className="border-white/10 bg-black/20" /><Button variant="outline" disabled={busy || reopenReason.trim().length < 8} onClick={() => run({ action: 'reopen', cash_session_id: lastClosedSession.id, reopen_reason: reopenReason }, 'Nova sessão aberta a partir do fechamento anterior.')} className="border-amber-500/20 text-amber-200"><RotateCcw className="mr-2 h-4 w-4" />Reabrir</Button></div></div>}
          </div>
        ) : activeSession.status === 'pending_approval' ? (
          <div className="space-y-5 py-3"><div className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-5"><div className="flex items-center gap-2 text-amber-200"><ClipboardCheck className="h-5 w-5" /><h3 className="font-semibold">Diferença aguardando aprovação</h3></div><div className="mt-4 grid grid-cols-3 gap-2"><Metric label="Esperado" value={money(activeSession.expected_cash_amount)} /><Metric label="Contado" value={money(activeSession.counted_cash_amount)} /><Metric label="Diferença" value={money(activeSession.difference_amount)} /></div><p className="mt-3 text-sm text-white/55">Justificativa do operador: {activeSession.difference_reason || 'Não informada'}</p></div><div className="space-y-2"><Label>Justificativa da aprovação</Label><Input value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} className="border-white/10 bg-black/20" /></div><Button disabled={busy || approvalReason.trim().length < 8} onClick={() => run({ action: 'approve', cash_session_id: activeSession.id, approval_reason: approvalReason }, 'Diferença aprovada e caixa fechado.')} className="w-full bg-amber-500 text-slate-950 hover:bg-amber-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Aprovar e finalizar</Button></div>
        ) : (
          <div className="space-y-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{activeSession.session_number || 'Sessão em andamento'}</p><p className="text-xs text-white/40">Operador: {activeSession.operator_name}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => run({ action: 'position', cash_session_id: activeSession.id }, 'Posição atualizada.')} className="border-white/10 bg-white/5"><RefreshCw className="mr-2 h-3.5 w-3.5" />Atualizar posição</Button></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Fundo" value={money(displayed?.opening_amount)} /><Metric label="Dinheiro esperado" value={money(expected)} /><Metric label="Recebimentos" value={displayed?.receipt_count || 0} /><Metric label="Pendente conciliar" value={money(displayed?.pending_reconciliation_amount)} /></div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"><h3 className="font-semibold">Resumo por meio</h3><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(methodLabels).map(([key, label]) => <Metric key={key} label={label} value={money(paymentSummary[key])} />)}</div></div>
            <div className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4"><h3 className="font-semibold">Movimento manual</h3><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Valor</Label><Input type="number" min="0" step="0.01" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} className="border-white/10 bg-black/20" /></div><div className="space-y-2"><Label>Motivo</Label><Input value={movementReason} onChange={(event) => setMovementReason(event.target.value)} className="border-white/10 bg-black/20" /></div></div><div className="grid grid-cols-2 gap-3"><Button variant="outline" disabled={busy} onClick={() => addMovement('supply')} className="border-emerald-500/20 text-emerald-200"><PlusCircle className="mr-2 h-4 w-4" />Suprimento</Button><Button variant="outline" disabled={busy} onClick={() => addMovement('withdrawal')} className="border-red-500/20 text-red-200"><MinusCircle className="mr-2 h-4 w-4" />Sangria</Button></div></div>
            <div className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center gap-2"><Scale className="h-4 w-4 text-violet-300" /><h3 className="font-semibold">Conferência e fechamento</h3></div><div className="space-y-2"><Label>Dinheiro contado</Label><Input type="number" min="0" step="0.01" value={countedAmount} onChange={(event) => setCountedAmount(event.target.value)} className="border-white/10 bg-black/20" /></div>{countedAmount !== '' && Math.abs(difference) >= 0.01 && <div className="space-y-2"><Label>Motivo da diferença de {money(difference)}</Label><Input value={differenceReason} onChange={(event) => setDifferenceReason(event.target.value)} className="border-amber-500/30 bg-amber-500/5" /></div>}<Button disabled={busy || countedAmount === '' || (Math.abs(difference) >= 0.01 && differenceReason.trim().length < 8)} onClick={() => run({ action: 'close', cash_session_id: activeSession.id, counted_cash_amount: Number(countedAmount), difference_reason: differenceReason }, 'Fechamento registrado.')} className="w-full bg-violet-500 hover:bg-violet-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Conferir e fechar</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }) { return <div className="rounded-2xl border border-white/8 bg-black/15 p-3"><p className="text-[10px] uppercase tracking-wide text-white/30">{label}</p><p className="mt-1 text-sm font-semibold text-white">{value}</p></div>; }
