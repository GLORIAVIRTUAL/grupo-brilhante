import { useMemo, useState } from 'react';
import { Banknote, CalendarClock, Check, CircleDollarSign, Landmark, Loader2, ReceiptText, ScanLine, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import PaymentReceiptDialog from './PaymentReceiptDialog';
import CustomerCreditDialog from './CustomerCreditDialog';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const date = (value) => value ? new Date(value).toLocaleDateString('pt-BR') : '—';

export default function FinancialOperationsPanel({ payables = [], receivables = [], payments = [], financialDocuments = [], cashSessions = [], bankTransactions = [], orders = [], customers = [], selectedUnitId, onNewBill, onCash, onRefresh }) {
  const [busyId, setBusyId] = useState(null);
  const [receiptTarget, setReceiptTarget] = useState(null);
  const [creditCustomer, setCreditCustomer] = useState(null);
  const scope = (record) => selectedUnitId === 'all' || record.unit_id === selectedUnitId;
  const scopedPayables = payables.filter(scope);
  const scopedReceivables = receivables.filter(scope);
  const scopedPayments = payments.filter(scope);
  const scopedOrders = orders.filter(scope);
  const scopedDocs = financialDocuments.filter(scope);
  const scopedCash = cashSessions.filter(scope);
  const scopedBank = bankTransactions.filter(scope);
  const now = new Date();
  const openPayables = scopedPayables.filter((item) => !['paid', 'cancelled'].includes(item.status));
  const openReceivables = scopedReceivables.filter((item) => !['paid', 'cancelled', 'written_off'].includes(item.status) && Number(item.open_amount || 0) > 0.009);
  const orderIdsWithReceivable = new Set(openReceivables.map((item) => item.order_id).filter(Boolean));
  const openOrders = scopedOrders.filter((item) => !orderIdsWithReceivable.has(item.id) && !['cancelled'].includes(item.status) && Math.max(0, Number(item.total_amount || 0) - Number(item.paid_amount || 0)) > 0.009);
  const overdue = openReceivables.filter((item) => item.due_date && new Date(item.due_date) < now);
  const payableTotal = openPayables.reduce((sum, item) => sum + Number(item.open_amount || 0), 0);
  const receivableTotal = openReceivables.reduce((sum, item) => sum + Number(item.open_amount || 0), 0) + openOrders.reduce((sum, item) => sum + Math.max(0, Number(item.total_amount || 0) - Number(item.paid_amount || 0)), 0);
  const unmatchedBank = scopedBank.filter((item) => ['unmatched', 'suggested'].includes(item.status));
  const pendingPayments = scopedPayments.filter((item) => item.status === 'pending_confirmation');
  const openCash = scopedCash.filter((item) => ['open', 'counting', 'pending_approval'].includes(item.status));
  const customersById = useMemo(() => Object.fromEntries(customers.map((customer) => [customer.id, customer])), [customers]);

  const approvePayable = async (payable) => {
    setBusyId(payable.id);
    try {
      await base44.functions.invoke('manage_accounts_payable', { action: 'approve', accounts_payable_id: payable.id });
      toast.success('Conta aprovada. Ela continua pendente até o pagamento ser registrado.');
      onRefresh?.();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.error === 'segregation_of_duties_required' ? 'Outro responsável deve aprovar esta conta.' : 'Não foi possível aprovar a conta.');
    } finally {
      setBusyId(null);
    }
  };

  const registerPayment = async (payable) => {
    if (!window.confirm(`Registrar o pagamento de ${money(payable.open_amount)} para “${payable.description}”?`)) return;
    setBusyId(payable.id);
    try {
      await base44.functions.invoke('manage_accounts_payable', {
        action: 'pay', accounts_payable_id: payable.id, amount: payable.open_amount,
        payment_method: payable.payment_method || 'bank_transfer', idempotency_key: crypto.randomUUID(),
        notes: 'Pagamento registrado manualmente na central financeira.',
      });
      toast.success('Pagamento registrado e refletido no financeiro.');
      onRefresh?.();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.error === 'payable_not_approved' ? 'A conta precisa ser aprovada primeiro.' : 'Não foi possível registrar o pagamento.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmPendingPayment = async (payment) => {
    const reference = window.prompt('Informe o NSU, E2E ou referência da confirmação:');
    if (!reference?.trim()) return;
    setBusyId(payment.id);
    try {
      await base44.functions.invoke('confirm_payment_tender', { payment_id: payment.id, confirmation_reference: reference.trim(), idempotency_key: crypto.randomUUID() });
      toast.success('Pagamento confirmado e aplicado ao saldo.');
      onRefresh?.();
    } catch (error) {
      console.error(error);
      const code = error.response?.data?.error;
      const message = code === 'confirmation_exceeds_current_balance'
        ? 'O saldo atual é menor que o pagamento. Revise antes de confirmar.'
        : code === 'confirmation_processing_repair_required'
          ? 'A confirmação anterior ficou incompleta. Não tente novamente: encaminhe o pagamento para conciliação administrativa.'
          : 'Não foi possível confirmar o pagamento.';
      toast.error(message);
    } finally { setBusyId(null); }
  };

  const stats = [
    { label: 'Contas a pagar', value: money(payableTotal), hint: `${openPayables.length} em aberto`, icon: WalletCards, tone: 'text-orange-300' },
    { label: 'A receber', value: money(receivableTotal), hint: `${openReceivables.length + openOrders.length} saldos`, icon: CircleDollarSign, tone: 'text-emerald-300' },
    { label: 'Vencidas', value: overdue.length, hint: 'Exigem prioridade', icon: CalendarClock, tone: 'text-red-300' },
    { label: 'Conciliações', value: unmatchedBank.length + pendingPayments.length, hint: `${pendingPayments.length} pagamentos aguardando confirmação`, icon: Landmark, tone: 'text-sky-300' },
  ];

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div><h2 className="text-xl font-semibold text-white">Financeiro operacional</h2><p className="text-sm text-white/45">Recebimentos mistos, documentos, vencimentos, caixa e conciliação.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={onCash} className="border-white/10 bg-white/5"><Banknote className="mr-2 h-4 w-4" />Operar caixa</Button><Button onClick={onNewBill} className="bg-gradient-to-r from-sky-500 to-violet-500"><ScanLine className="mr-2 h-4 w-4" />Ler conta</Button></div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{stats.map(({ label, value, hint, icon: Icon, tone }) => <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><div className="flex items-center justify-between"><p className="text-sm text-white/45">{label}</p><Icon className={`h-5 w-5 ${tone}`} /></div><p className="mt-3 text-2xl font-bold text-white">{value}</p><p className="mt-1 text-xs text-white/35">{hint}</p></div>)}</div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Contas a receber" subtitle="Receba parcialmente ou combine vários meios.">
          <table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-black/15 text-xs uppercase tracking-wide text-white/35"><tr><th className="px-5 py-3">Cliente / título</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3 text-right">Em aberto</th><th className="px-5 py-3 text-right">Ação</th></tr></thead><tbody className="divide-y divide-white/5">
            {openReceivables.slice(0, 20).map((item) => <tr key={item.id} className="hover:bg-white/[0.03]"><td className="px-5 py-4"><p className="font-medium text-white">{customersById[item.customer_id]?.full_name || item.description}</p><p className="mt-1 text-xs text-white/35">{item.receivable_number || item.description}</p></td><td className={item.due_date && new Date(item.due_date) < now ? 'px-4 py-4 text-red-300' : 'px-4 py-4 text-white/60'}>{date(item.due_date)}</td><td className="px-4 py-4 text-right font-semibold text-white">{money(item.open_amount)}</td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setCreditCustomer(customersById[item.customer_id])} className="text-fuchsia-200">Crédito</Button><Button size="sm" onClick={() => setReceiptTarget({ receivable: item, customer: customersById[item.customer_id] })} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">Receber</Button></div></td></tr>)}
            {openOrders.slice(0, 20).map((order) => <tr key={`order-${order.id}`} className="hover:bg-white/[0.03]"><td className="px-5 py-4"><p className="font-medium text-white">{customersById[order.customer_id]?.full_name || 'Cliente'}</p><p className="mt-1 text-xs text-white/35">Pedido {order.ticket_number || order.id}</p></td><td className="px-4 py-4 text-white/35">À vista</td><td className="px-4 py-4 text-right font-semibold text-white">{money(Number(order.total_amount || 0) - Number(order.paid_amount || 0))}</td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setCreditCustomer(customersById[order.customer_id])} className="text-fuchsia-200">Crédito</Button><Button size="sm" onClick={() => setReceiptTarget({ order, customer: customersById[order.customer_id] })} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">Receber</Button></div></td></tr>)}
          </tbody></table>
          {openReceivables.length + openOrders.length === 0 && <Empty text="Nenhum valor a receber." />}
        </Panel>

        <Panel title="Contas a pagar" subtitle="Aprovação e pagamento permanecem eventos separados.">
          <table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-black/15 text-xs uppercase tracking-wide text-white/35"><tr><th className="px-5 py-3">Descrição</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3 text-right">Em aberto</th><th className="px-5 py-3 text-right">Ação</th></tr></thead><tbody className="divide-y divide-white/5">{openPayables.slice(0, 20).map((payable) => <tr key={payable.id} className="hover:bg-white/[0.03]"><td className="px-5 py-4"><p className="font-medium text-white">{payable.description}</p><p className="mt-1 text-xs text-white/35">{payable.supplier_name || payable.category}</p></td><td className={payable.due_date && new Date(payable.due_date) < now ? 'px-4 py-4 text-red-300' : 'px-4 py-4 text-white/60'}>{date(payable.due_date)}</td><td className="px-4 py-4 text-right font-semibold text-white">{money(payable.open_amount)}</td><td className="px-5 py-4 text-right">{payable.approval_status === 'approved' ? <Button size="sm" onClick={() => registerPayment(payable)} disabled={busyId === payable.id} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">{busyId === payable.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Pagar'}</Button> : <Button size="sm" variant="outline" onClick={() => approvePayable(payable)} disabled={busyId === payable.id} className="border-white/10 bg-white/5">{busyId === payable.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="mr-2 h-3.5 w-3.5" />Aprovar</>}</Button>}</td></tr>)}</tbody></table>
          {openPayables.length === 0 && <Empty text="Nenhuma conta em aberto." />}
        </Panel>
      </div>

      {pendingPayments.length > 0 && <Panel title="Pagamentos aguardando confirmação" subtitle="Somente confirme após localizar o valor no terminal ou banco."><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-black/15 text-xs uppercase tracking-wide text-white/35"><tr><th className="px-5 py-3">Meio</th><th className="px-4 py-3">Referência</th><th className="px-4 py-3 text-right">Valor</th><th className="px-5 py-3 text-right">Ação</th></tr></thead><tbody className="divide-y divide-white/5">{pendingPayments.slice(0, 30).map((payment) => <tr key={payment.id}><td className="px-5 py-4 font-medium text-white">{payment.method}</td><td className="px-4 py-4 text-white/45">{payment.external_reference || 'Não informada'}</td><td className="px-4 py-4 text-right font-semibold text-white">{money(payment.tendered_amount || payment.amount)}</td><td className="px-5 py-4 text-right"><Button size="sm" disabled={busyId === payment.id} onClick={() => confirmPendingPayment(payment)} className="bg-sky-500 hover:bg-sky-400">{busyId === payment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirmar'}</Button></td></tr>)}</tbody></table></Panel>}

      <div className="grid gap-6 lg:grid-cols-2"><div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-violet-300" /><h3 className="font-semibold text-white">Documentos recentes</h3></div><div className="mt-4 space-y-3">{scopedDocs.slice(0, 6).map((document) => <div key={document.id} className="rounded-2xl border border-white/10 bg-black/15 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-white">{document.issuer_name || document.document_type?.replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-white/35">{date(document.due_date)}</p></div><Badge variant="outline" className="border-white/10 text-white/45">{document.status}</Badge></div><p className="mt-2 text-right font-semibold text-sky-300">{money(document.amount)}</p></div>)}{scopedDocs.length === 0 && <Empty text="Nenhum documento processado." />}</div></div><div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="flex items-center gap-2"><Banknote className="h-5 w-5 text-emerald-300" /><h3 className="font-semibold text-white">Caixas em operação</h3></div><p className="mt-3 text-3xl font-bold text-white">{openCash.length}</p><p className="text-sm text-white/40">Abertos ou aguardando conferência.</p></div></div>

      <PaymentReceiptDialog open={!!receiptTarget} onOpenChange={(value) => !value && setReceiptTarget(null)} order={receiptTarget?.order} receivable={receiptTarget?.receivable} customer={receiptTarget?.customer} cashSessions={cashSessions} onProcessed={() => { setReceiptTarget(null); onRefresh?.(); }} />
      <CustomerCreditDialog open={!!creditCustomer} onOpenChange={(value) => !value && setCreditCustomer(null)} customer={creditCustomer} onProcessed={() => { setCreditCustomer(null); onRefresh?.(); }} />
    </section>
  );
}

function Panel({ title, subtitle, children }) { return <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]"><div className="border-b border-white/10 p-5"><h3 className="font-semibold text-white">{title}</h3><p className="text-sm text-white/40">{subtitle}</p></div><div className="overflow-x-auto">{children}</div></div>; }
function Empty({ text }) { return <div className="py-10 text-center text-sm text-white/35">{text}</div>; }
