import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Loader2, Plus, Ticket, Wallet, ShieldAlert } from 'lucide-react';
import { subDays } from 'date-fns';
import { toast } from 'sonner';
import useUnitAccess, { filterRecordsByUnit, getUnitLabel } from '@/components/units/useUnitAccess';
import UnitFilterSelect from '@/components/units/UnitFilterSelect';
import ManagementStats from '@/components/management/ManagementStats';
import ServiceTicketsTable from '@/components/management/ServiceTicketsTable';
import FinanceTable from '@/components/management/FinanceTable';
import FinanceEntryModal from '@/components/management/FinanceEntryModal';
import AdvancedQuoteModal from '@/components/crm/AdvancedQuoteModal';
import EditTicketModal from '@/components/management/EditTicketModal';
import DeleteReasonModal from '@/components/management/DeleteReasonModal';
import AuditLogTable from '@/components/management/AuditLogTable';
import MovementDetailsModal from '@/components/management/MovementDetailsModal';
import CustomDateFilter from '@/components/management/CustomDateFilter';
import ManagementCommandCenter from '@/components/management/ManagementCommandCenter';

const COLORS = ['#FF6600', '#4C12A1', '#25D366', '#00C853', '#FFC107', '#33691E'];

const renderPieLabel = ({ cx, cy, midAngle, outerRadius, name, percent }) => {
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 24;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" fontSize={12} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
      {`${name} (${(percent * 100).toFixed(0)}%)`}
    </text>
  );
};
const METHOD_LABEL = { cash: 'Dinheiro', pix: 'Pix', credit: 'Crédito', debit: 'Débito', boleto: 'Boleto', transfer: 'Transferência', link: 'Link', other: 'Outro' };

export default function ManagementPage() {
  const { isAdmin, accessibleUnits, selectedUnit, selectedUnitId, setSelectedUnitId, defaultUnitId, loading: unitsLoading } = useUnitAccess();
  const [dateRange, setDateRange] = useState('30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [viewMovement, setViewMovement] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['mgmt-current-user'],
    queryFn: () => base44.auth.me()
  });

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['mgmt-audit'],
    queryFn: () => base44.entities.AuditLog.filter({}, '-created_date', 500),
    enabled: !!isAdmin
  });

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['mgmt-orders'],
    queryFn: () => base44.entities.Order.filter({}, '-created_date', 2000),
    staleTime: 2 * 60 * 1000
  });
  const { data: payments = [], isLoading: loadingPayments } = useQuery({
    queryKey: ['mgmt-payments'],
    queryFn: () => base44.entities.Payment.filter({}, '-created_date', 2000),
    staleTime: 2 * 60 * 1000
  });
  const { data: financeEntries = [], isLoading: loadingFinance } = useQuery({
    queryKey: ['mgmt-finance'],
    queryFn: () => base44.entities.FinanceEntry.filter({}, '-entry_date', 2000),
    staleTime: 2 * 60 * 1000
  });
  const { data: quotes = [] } = useQuery({
    queryKey: ['mgmt-quotes'],
    queryFn: () => base44.entities.Quote.filter({}, '-created_date', 2000),
    staleTime: 2 * 60 * 1000
  });
  const { data: customers = [] } = useQuery({
    queryKey: ['mgmt-customers'],
    queryFn: async () => {
      const all = [];
      const pageSize = 500;
      let skip = 0;
      while (true) {
        const batch = await base44.entities.Customer.list('-created_date', pageSize, skip);
        if (!batch || batch.length === 0) break;
        all.push(...batch);
        if (batch.length < pageSize) break;
        skip += pageSize;
      }
      return all;
    },
    staleTime: 5 * 60 * 1000
  });

  const createEntry = useMutation({
    mutationFn: (data) => base44.entities.FinanceEntry.create({ ...data, unit_id: selectedUnitId !== 'all' ? selectedUnitId : (defaultUnitId || undefined) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mgmt-finance'] })
  });
  // Registros operacionais e financeiros não são apagados: o backend aplica cancelamento auditado.
  const performDelete = async (reason) => {
    if (!deleteTarget) return;
    const entityType = deleteTarget.kind === 'finance_entry' ? 'finance_entry' : deleteTarget.kind;

    try {
      await base44.functions.invoke('cancel_management_record', {
        entity_type: entityType,
        entity_id: deleteTarget.record.id,
        reason
      });
      ['mgmt-payments', 'mgmt-orders', 'mgmt-quotes', 'mgmt-finance', 'mgmt-audit', 'command-garments'].forEach((key) => {
        queryClient.invalidateQueries({ queryKey: [key] });
      });
      setDeleteTarget(null);
      toast.success('Registro cancelado e preservado na auditoria.');
    } catch (error) {
      console.error(error);
      const code = error.response?.data?.error;
      if (code === 'settled_payment_requires_refund' || code === 'order_has_settled_payment') {
        toast.error('Existe pagamento liquidado. Faça estorno ou reembolso antes de cancelar.');
      } else {
        toast.error('Não foi possível cancelar o registro. Verifique sua permissão.');
      }
    }
  };

  // Abre o modal de motivo para uma movimentação financeira (venda ou lançamento manual)
  const requestDeleteMovement = (e) => {
    setDeleteTarget({
      kind: e.source === 'payment' ? 'payment' : 'finance_entry',
      record: e,
      label: e.description || (e.source === 'payment' ? 'Venda' : 'Lançamento'),
      customerName: '',
      amount: e.amount
    });
  };

  // Abre o modal de motivo para um ticket de serviço (Order)
  const requestDeleteTicket = (o) => {
    setDeleteTarget({
      kind: 'order',
      record: o,
      label: `Ticket #${o.ticket_number || o.id.slice(-6)}`,
      customerName: data.customerMap[o.customer_id] || '',
      amount: o.total_amount
    });
  };

  const updateTicket = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Order.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mgmt-orders'] })
  });

  const isLoading = unitsLoading || loadingOrders || loadingPayments || loadingFinance;
  const selectedUnitLabel = getUnitLabel(selectedUnit, selectedUnitId);

  const data = useMemo(() => {
    let startDate;
    let endDate = new Date(8640000000000000); // máximo
    if (dateRange === 'all') {
      startDate = new Date(0);
    } else if (dateRange === 'custom') {
      startDate = customStart ? new Date(`${customStart}T00:00:00`) : new Date(0);
      if (customEnd) endDate = new Date(`${customEnd}T23:59:59`);
    } else {
      startDate = subDays(new Date(), parseInt(dateRange, 10));
    }
    const inRange = (d) => { const t = new Date(d); return t >= startDate && t <= endDate; };

    const customerMap = {};
    customers.forEach((c) => { customerMap[c.id] = c.full_name; });

    const quoteMap = {};
    quotes.forEach((q) => { quoteMap[q.id] = q; });
    const orderMap = {};
    orders.forEach((o) => { orderMap[o.id] = o; });

    const scopedOrders = filterRecordsByUnit(orders, selectedUnitId, defaultUnitId)
      .filter((o) => inRange(o.created_date));

    const scopedPayments = filterRecordsByUnit(payments, selectedUnitId, defaultUnitId)
      .filter((p) => p.status === 'succeeded' && inRange(p.created_date || p.paid_at || new Date()));

    const scopedFinance = filterRecordsByUnit(financeEntries, selectedUnitId, defaultUnitId)
      .filter((f) => inRange(f.entry_date || f.created_date));

    // Unified movements
    const movements = [
      ...scopedPayments.map((p) => ({
        id: p.id, source: 'payment', type: 'income', category: 'Vendas',
        description: 'Pagamento de serviço', amount: p.amount, payment_method: p.payment_method,
        installments: p.installments, card_brand: p.card_brand,
        fee_percent: p.fee_percent, fee_amount: p.fee_amount,
        entry_date: p.paid_at || p.created_date, created_date: p.created_date,
        customer_id: p.customer_id, quote_id: p.quote_id, order_id: p.order_id,
        ticket_number: orderMap[p.order_id]?.ticket_number
      })),
      ...scopedFinance.map((f) => ({ ...f, source: 'manual' }))
    ].sort((a, b) => new Date(b.entry_date || b.created_date) - new Date(a.entry_date || a.created_date));

    const totalIncome = movements.filter((m) => m.type === 'income').reduce((s, m) => s + (m.amount || 0), 0);
    const totalExpense = movements.filter((m) => m.type === 'expense').reduce((s, m) => s + (m.amount || 0), 0);
    // Total descontado em taxas de maquininha
    const totalCardFees = movements.reduce((s, m) => s + (m.fee_amount || 0), 0);
    const balance = totalIncome - totalExpense;
    // Lucro líquido = saldo - taxas de cartão
    const netProfit = balance - totalCardFees;

    // Delivery time avg (days) for finished/delivered orders
    const deliveredDays = scopedOrders
      .filter((o) => o.expected_finish_at && o.created_date)
      .map((o) => (new Date(o.expected_finish_at) - new Date(o.created_date)) / (1000 * 60 * 60 * 24))
      .filter((d) => d >= 0);
    const avgDeliveryDays = deliveredDays.length ? deliveredDays.reduce((s, d) => s + d, 0) / deliveredDays.length : null;

    // Payment methods (income)
    const methodMap = {};
    movements.filter((m) => m.type === 'income').forEach((m) => {
      const k = METHOD_LABEL[m.payment_method] || 'Outro';
      methodMap[k] = (methodMap[k] || 0) + (m.amount || 0);
    });
    const paymentMethodsData = Object.keys(methodMap).map((k) => ({ name: k, value: methodMap[k] }));

    // Expenses by category
    const expenseMap = {};
    movements.filter((m) => m.type === 'expense').forEach((m) => {
      const k = m.category || 'Outros';
      expenseMap[k] = (expenseMap[k] || 0) + (m.amount || 0);
    });
    const expensesData = Object.keys(expenseMap).map((k) => ({ name: k, value: expenseMap[k] })).sort((a, b) => b.value - a.value);

    return { customerMap, quoteMap, scopedOrders, movements, totalIncome, totalExpense, totalCardFees, balance, netProfit, avgDeliveryDays, paymentMethodsData, expensesData };
  }, [orders, payments, financeEntries, customers, quotes, dateRange, customStart, customEnd, selectedUnitId, defaultUnitId]);

  if (isLoading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-[#FF6600]" />
        <p className="text-gray-400">Carregando gestão...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gestão da Lavanderia</h1>
          <p className="text-gray-400">Tickets de serviço, financeiro e indicadores — {selectedUnitLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UnitFilterSelect isAdmin={isAdmin} units={accessibleUnits} value={selectedUnitId} onChange={setSelectedUnitId} />
          <CustomDateFilter
            dateRange={dateRange}
            setDateRange={setDateRange}
            customStart={customStart}
            customEnd={customEnd}
            setCustomStart={setCustomStart}
            setCustomEnd={setCustomEnd}
          />
          <Button onClick={() => setModalOpen(true)} className="gap-2 bg-[#FF6600] hover:bg-[#FF6600]/90">
            <Plus className="h-4 w-4" /> Lançamento
          </Button>
        </div>
      </div>

      <ManagementCommandCenter
        selectedUnitId={selectedUnitId}
        defaultUnitId={defaultUnitId}
        customers={customers}
        onManualEntry={() => setModalOpen(true)}
        onManualQuote={() => setQuoteModalOpen(true)}
      />

      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/30">Indicadores e registros existentes</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <ManagementStats
        totalIncome={data.totalIncome}
        totalExpense={data.totalExpense}
        totalCardFees={data.totalCardFees}
        balance={data.balance}
        netProfit={data.netProfit}
        avgDeliveryDays={data.avgDeliveryDays}
      />

      <Tabs defaultValue="finance" className="w-full">
        <TabsList className="bg-white/5">
          <TabsTrigger value="finance" className="gap-2 text-white data-[state=active]:bg-[#4C12A1] data-[state=active]:text-white"><Wallet className="h-4 w-4" /> Financeiro</TabsTrigger>
          <TabsTrigger value="tickets" className="gap-2 text-white data-[state=active]:bg-[#4C12A1] data-[state=active]:text-white"><Ticket className="h-4 w-4" /> Tickets de Serviço</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="audit" className="gap-2 text-white data-[state=active]:bg-[#4C12A1] data-[state=active]:text-white"><ShieldAlert className="h-4 w-4" /> Auditoria</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="finance" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="border-white/10 bg-white/5">
              <CardHeader>
                <CardTitle className="text-white">Entradas por Forma de Pagamento</CardTitle>
                <CardDescription className="text-gray-300">Distribuição das receitas</CardDescription>
              </CardHeader>
              <CardContent className="h-[280px]">
                {data.paymentMethodsData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data.paymentMethodsData} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={5} dataKey="value"
                        label={renderPieLabel} labelLine={{ stroke: '#fff' }}>
                        {data.paymentMethodsData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RechartsTooltip contentStyle={{ backgroundColor: '#1a0b36', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8 }} formatter={(v) => [`R$ ${Number(v).toFixed(2)}`, 'Valor']} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="flex h-full items-center justify-center text-gray-500">Sem entradas no período</div>}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-white/5">
              <CardHeader>
                <CardTitle className="text-white">Despesas por Categoria</CardTitle>
                <CardDescription className="text-gray-300">Para onde o dinheiro está indo</CardDescription>
              </CardHeader>
              <CardContent className="h-[280px]">
                {data.expensesData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.expensesData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal vertical={false} />
                      <XAxis type="number" stroke="#fff" tick={{ fill: '#fff' }} fontSize={12} />
                      <YAxis type="category" dataKey="name" stroke="#fff" tick={{ fill: '#fff' }} fontSize={12} width={100} />
                      <RechartsTooltip contentStyle={{ backgroundColor: '#1a0b36', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8 }} cursor={{ fill: 'rgba(255,255,255,0.05)' }} formatter={(v) => [`R$ ${Number(v).toFixed(2)}`, 'Total']} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {data.expensesData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div className="flex h-full items-center justify-center text-gray-500">Sem despesas no período</div>}
              </CardContent>
            </Card>
          </div>

          <FinanceTable entries={data.movements} onDelete={requestDeleteMovement} onView={setViewMovement} />
        </TabsContent>

        <TabsContent value="tickets">
          <ServiceTicketsTable orders={data.scopedOrders} customerMap={data.customerMap} onEdit={setEditingTicket} onDelete={requestDeleteTicket} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="audit">
            <AuditLogTable logs={auditLogs} />
          </TabsContent>
        )}
      </Tabs>

      <FinanceEntryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={(d) => createEntry.mutateAsync(d)}
        onSelectIncome={() => setQuoteModalOpen(true)}
      />

      <AdvancedQuoteModal
        isOpen={quoteModalOpen}
        onClose={() => setQuoteModalOpen(false)}
        pipeline="ORDER"
        stage="NEW"
        unitId={selectedUnitId !== 'all' ? selectedUnitId : defaultUnitId}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['mgmt-payments'] });
          queryClient.invalidateQueries({ queryKey: ['mgmt-orders'] });
        }}
      />

      <EditTicketModal
        ticket={editingTicket}
        open={!!editingTicket}
        onClose={() => setEditingTicket(null)}
        onSave={(id, data) => updateTicket.mutateAsync({ id, data })}
      />

      <DeleteReasonModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={performDelete}
        title={deleteTarget?.kind === 'order' ? 'Cancelar ticket' : 'Cancelar movimentação'}
        itemLabel={deleteTarget?.label}
      />

      <MovementDetailsModal
        open={!!viewMovement}
        onClose={() => setViewMovement(null)}
        movement={viewMovement}
        customerName={viewMovement ? data.customerMap[viewMovement.customer_id] : ''}
        quote={viewMovement?.quote_id ? data.quoteMap[viewMovement.quote_id] : null}
        ticketNumber={viewMovement?.ticket_number}
      />
    </div>
  );
}