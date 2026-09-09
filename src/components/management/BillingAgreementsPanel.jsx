import { useMemo, useState } from 'react';
import { Building2, CalendarRange, CheckCircle2, Loader2, Plus, ReceiptText, UserPlus, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;

export default function BillingAgreementsPanel({ agreements = [], statements = [], customers = [], orders = [], selectedUnitId, defaultUnitId, onRefresh }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [closingAgreement, setClosingAgreement] = useState(null);
  const [period, setPeriod] = useState({ start: monthStart(), end: today() });
  const unitId = selectedUnitId === 'all' ? defaultUnitId : selectedUnitId;
  const scopedAgreements = agreements.filter((item) => selectedUnitId === 'all' || item.unit_id === selectedUnitId);
  const customersById = useMemo(() => Object.fromEntries(customers.map((customer) => [customer.id, customer])), [customers]);
  const statementsByAgreement = useMemo(() => statements.reduce((map, statement) => {
    map[statement.billing_agreement_id] = [...(map[statement.billing_agreement_id] || []), statement];
    return map;
  }, {}), [statements]);

  const run = async (name, payload, success) => {
    setBusyId(payload.billing_agreement_id || name);
    try {
      const response = await base44.functions.invoke(name, payload);
      toast.success(success);
      onRefresh?.();
      return response.data;
    } catch (error) {
      console.error(error);
      const code = error.response?.data?.error;
      const messages = {
        credit_limit_exceeded: 'O limite de crédito do convênio seria excedido.',
        agreement_not_active: 'Ative o convênio antes de utilizá-lo.',
        no_eligible_orders: 'Não existem pedidos faturáveis no período.',
        cost_center_required: 'Informe o centro de custo.',
        purchase_order_required: 'Informe o pedido de compra.',
      };
      toast.error(messages[code] || 'Não foi possível concluir a operação.');
      throw error;
    } finally {
      setBusyId(null);
    }
  };

  const closePeriod = async () => {
    if (!closingAgreement) return;
    const preview = await run('close_billing_period', {
      action: 'preview', billing_agreement_id: closingAgreement.id, period_start: period.start, period_end: period.end,
    }, 'Prévia calculada.');
    if (!window.confirm(`Fechar ${preview.preview.order_count} pedido(s) no valor de ${money(preview.preview.total)}?`)) return;
    await run('close_billing_period', {
      action: 'close', billing_agreement_id: closingAgreement.id, period_start: period.start, period_end: period.end,
    }, 'Faturamento criado para revisão.');
    setClosingAgreement(null);
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold text-white">Convênios e faturados</h2><p className="text-sm text-white/45">Limite de crédito, pedidos autorizados e fechamento periódico.</p></div><Button onClick={() => setCreateOpen(true)} disabled={!unitId} className="bg-gradient-to-r from-violet-500 to-fuchsia-500"><Plus className="mr-2 h-4 w-4" />Novo convênio</Button></div>

      <div className="grid gap-4 lg:grid-cols-2">
        {scopedAgreements.map((agreement) => {
          const agreementStatements = statementsByAgreement[agreement.id] || [];
          const openAmount = agreementStatements.filter((item) => !['paid', 'cancelled'].includes(item.status)).reduce((sum, item) => sum + Number(item.open_amount || 0), 0);
          const eligibleOrders = orders.filter((order) => order.unit_id === agreement.unit_id && (agreement.customer_ids || []).includes(order.customer_id) && !order.billing_agreement_id && order.status !== 'cancelled');
          return <div key={agreement.id} className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-2xl bg-violet-500/15 p-2.5 text-violet-300"><Building2 className="h-5 w-5" /></div><div><p className="font-semibold text-white">{agreement.name}</p><p className="text-xs text-white/35">{agreement.code} · {agreement.billing_cycle}</p></div></div><Badge variant="outline" className={agreement.status === 'active' ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-200'}>{agreement.status}</Badge></div><div className="mt-4 grid grid-cols-3 gap-2"><Metric label="Limite" value={money(agreement.credit_limit)} /><Metric label="Faturas abertas" value={money(openAmount)} /><Metric label="Clientes" value={(agreement.customer_ids || []).length} /></div><p className="mt-3 text-xs text-white/40">Responsável: {customersById[agreement.bill_to_customer_id]?.full_name || agreement.legal_name || 'Não informado'}</p><div className="mt-4 flex flex-wrap gap-2">{agreement.status !== 'active' && <Button size="sm" onClick={() => run('manage_billing_agreement', { action: 'activate', billing_agreement_id: agreement.id }, 'Convênio ativado.')} disabled={busyId === agreement.id} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"><CheckCircle2 className="mr-2 h-3.5 w-3.5" />Ativar</Button>}<Button size="sm" variant="outline" onClick={() => setClosingAgreement(agreement)} disabled={agreement.status !== 'active'} className="border-white/10 bg-white/5"><CalendarRange className="mr-2 h-3.5 w-3.5" />Fechar período</Button>{eligibleOrders.length > 0 && <Badge variant="outline" className="border-sky-500/25 text-sky-200">{eligibleOrders.length} pedido(s) elegível(is)</Badge>}</div><AgreementAssignments agreement={agreement} customers={customers} orders={eligibleOrders} busy={busyId === agreement.id} run={run} /></div>;
        })}
        {scopedAgreements.length === 0 && <div className="col-span-full rounded-3xl border border-dashed border-white/10 py-14 text-center"><Building2 className="mx-auto h-8 w-8 text-white/20" /><p className="mt-3 text-sm text-white/40">Nenhum convênio cadastrado nesta unidade.</p></div>}
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.03]"><div className="border-b border-white/10 p-5"><h3 className="font-semibold text-white">Fechamentos recentes</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-black/15 text-xs uppercase tracking-wide text-white/35"><tr><th className="px-5 py-3">Número</th><th className="px-4 py-3">Período</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Aberto</th><th className="px-4 py-3">Situação</th><th className="px-5 py-3 text-right">Ação</th></tr></thead><tbody className="divide-y divide-white/5">{statements.slice(0, 30).map((statement) => <tr key={statement.id}><td className="px-5 py-4 font-medium text-white">{statement.statement_number}</td><td className="px-4 py-4 text-white/55">{statement.period_start} a {statement.period_end}</td><td className="px-4 py-4 text-right text-white">{money(statement.total_amount)}</td><td className="px-4 py-4 text-right text-amber-200">{money(statement.open_amount)}</td><td className="px-4 py-4"><Badge variant="outline" className="border-white/10 text-white/55">{statement.status}</Badge></td><td className="px-5 py-4 text-right">{statement.status === 'review' && <Button size="sm" onClick={() => run('close_billing_period', { action: 'issue', billing_statement_id: statement.id }, 'Faturamento emitido.')} disabled={busyId === statement.id} className="bg-sky-500 hover:bg-sky-400"><ReceiptText className="mr-2 h-3.5 w-3.5" />Emitir</Button>}</td></tr>)}</tbody></table></div></div>

      <CreateAgreementDialog open={createOpen} onOpenChange={setCreateOpen} unitId={unitId} customers={customers} onCreated={() => { setCreateOpen(false); onRefresh?.(); }} />
      <Dialog open={!!closingAgreement} onOpenChange={(value) => !value && setClosingAgreement(null)}><DialogContent className="max-w-lg border-white/10 bg-[#170c2b] text-white"><DialogHeader><DialogTitle>Fechar período</DialogTitle><DialogDescription className="text-white/50">Os pedidos elegíveis serão agrupados em um demonstrativo e uma conta a receber.</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Início</Label><Input type="date" value={period.start} onChange={(event) => setPeriod((current) => ({ ...current, start: event.target.value }))} className="border-white/10 bg-black/20" /></div><div className="space-y-2"><Label>Fim</Label><Input type="date" value={period.end} onChange={(event) => setPeriod((current) => ({ ...current, end: event.target.value }))} className="border-white/10 bg-black/20" /></div></div><Button onClick={closePeriod} disabled={!!busyId} className="bg-violet-500 hover:bg-violet-400">{busyId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarRange className="mr-2 h-4 w-4" />}Calcular e fechar</Button></DialogContent></Dialog>
    </section>
  );
}

function AgreementAssignments({ agreement, customers, orders, busy, run }) {
  const [customerId, setCustomerId] = useState('');
  const [orderId, setOrderId] = useState('');
  return <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2"><div className="space-y-2"><p className="text-xs font-medium text-white/45">Vincular cliente</p><div className="flex gap-2"><select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-white/10 bg-black/25 px-2 text-xs text-white"><option value="">Selecione</option>{customers.filter((customer) => customer.unit_id === agreement.unit_id && !(agreement.customer_ids || []).includes(customer.id)).slice(0, 500).map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}</select><Button size="icon" variant="outline" disabled={!customerId || busy} onClick={async () => { await run('manage_billing_agreement', { action: 'assign_customer', billing_agreement_id: agreement.id, customer_id: customerId }, 'Cliente vinculado.'); setCustomerId(''); }} className="border-white/10"><UserPlus className="h-4 w-4" /></Button></div></div><div className="space-y-2"><p className="text-xs font-medium text-white/45">Autorizar pedido faturado</p><div className="flex gap-2"><select value={orderId} onChange={(event) => setOrderId(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-white/10 bg-black/25 px-2 text-xs text-white"><option value="">Selecione</option>{orders.slice(0, 300).map((order) => <option key={order.id} value={order.id}>{order.ticket_number || order.id} · {money(Number(order.total_amount || 0) - Number(order.paid_amount || 0))}</option>)}</select><Button size="icon" variant="outline" disabled={!orderId || busy} onClick={async () => { await run('manage_billing_agreement', { action: 'assign_order', billing_agreement_id: agreement.id, order_id: orderId }, 'Pedido autorizado para faturamento.'); setOrderId(''); }} className="border-white/10"><WalletCards className="h-4 w-4" /></Button></div></div></div>;
}

function CreateAgreementDialog({ open, onOpenChange, unitId, customers, onCreated }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', bill_to_customer_id: '', agreement_type: 'corporate', credit_limit: '', payment_term_days: '30', billing_cycle: 'monthly' });
  const submit = async () => {
    if (!form.code.trim() || !form.name.trim() || !form.bill_to_customer_id) return toast.error('Informe código, nome e responsável financeiro.');
    setBusy(true);
    try {
      await base44.functions.invoke('manage_billing_agreement', { action: 'create', unit_id: unitId, ...form, credit_limit: Number(form.credit_limit || 0), payment_term_days: Number(form.payment_term_days || 0) });
      toast.success('Convênio criado em rascunho.');
      setForm({ code: '', name: '', bill_to_customer_id: '', agreement_type: 'corporate', credit_limit: '', payment_term_days: '30', billing_cycle: 'monthly' });
      onCreated?.();
    } catch (error) { console.error(error); toast.error('Não foi possível criar o convênio.'); } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}><DialogContent className="max-w-2xl border-white/10 bg-[#170c2b] text-white"><DialogHeader><DialogTitle>Novo convênio</DialogTitle><DialogDescription className="text-white/50">Começa em rascunho e precisa ser ativado antes de receber pedidos.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><Field label="Código"><Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} className="border-white/10 bg-black/20" /></Field><Field label="Nome"><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="border-white/10 bg-black/20" /></Field><Field label="Responsável financeiro"><select value={form.bill_to_customer_id} onChange={(event) => setForm((current) => ({ ...current, bill_to_customer_id: event.target.value }))} className="h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 text-sm text-white"><option value="">Selecione</option>{customers.filter((customer) => !unitId || customer.unit_id === unitId).slice(0, 1000).map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}</select></Field><Field label="Tipo"><select value={form.agreement_type} onChange={(event) => setForm((current) => ({ ...current, agreement_type: event.target.value }))} className="h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 text-sm text-white"><option value="corporate">Empresa</option><option value="condominium">Condomínio</option><option value="hotel">Hotel</option><option value="healthcare">Saúde</option><option value="employee">Funcionários</option><option value="partner">Parceiro</option><option value="other">Outro</option></select></Field><Field label="Limite de crédito"><Input type="number" min="0" step="0.01" value={form.credit_limit} onChange={(event) => setForm((current) => ({ ...current, credit_limit: event.target.value }))} className="border-white/10 bg-black/20" /></Field><Field label="Prazo em dias"><Input type="number" min="0" value={form.payment_term_days} onChange={(event) => setForm((current) => ({ ...current, payment_term_days: event.target.value }))} className="border-white/10 bg-black/20" /></Field></div><Button onClick={submit} disabled={busy || !unitId} className="bg-violet-500 hover:bg-violet-400">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar convênio</Button></DialogContent></Dialog>;
}

function Metric({ label, value }) { return <div className="rounded-2xl bg-black/15 p-3"><p className="text-[10px] uppercase tracking-wide text-white/30">{label}</p><p className="mt-1 text-sm font-semibold text-white">{value}</p></div>; }
function Field({ label, children }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
