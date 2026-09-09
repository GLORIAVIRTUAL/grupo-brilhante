import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { format, subDays } from 'date-fns';
import { Loader2, TrendingUp, Truck, Package, DollarSign, Filter, Download, FileText, Bot, Users, MessageSquare, TrendingDown } from 'lucide-react';
import PickupsTable from '@/components/reports/PickupsTable';
import DRESection from '@/components/reports/DRESection';
import { jsPDF } from 'jspdf';
import useUnitAccess, { filterRecordsByUnit, getUnitLabel } from '@/components/units/useUnitAccess';
import UnitFilterSelect from '@/components/units/UnitFilterSelect';
import SpecializedReportsPanel from '@/components/reports/SpecializedReportsPanel';

const COLORS = ['#FF6600', '#4C12A1', '#25D366', '#00C853', '#FFC107', '#33691E'];

const getSlug = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();

export default function ReportsPage() {
  const {
    isAdmin,
    accessibleUnits,
    selectedUnit,
    selectedUnitId,
    setSelectedUnitId,
    defaultUnitId,
    loading: unitsLoading
  } = useUnitAccess();
  const [dateRange, setDateRange] = useState('30');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [productTypeFilter, setProductTypeFilter] = useState('all');
  const [expenseFilter, setExpenseFilter] = useState('all');
  const [generatingChatPdf, setGeneratingChatPdf] = useState(false);
  const [generatingPickupsPdf, setGeneratingPickupsPdf] = useState(false);
  const [generatingUsersPdf, setGeneratingUsersPdf] = useState(false);
  const [generatingConvPdf, setGeneratingConvPdf] = useState(false);

  const downloadReportPdf = async (functionName, filename, setLoading) => {
    setLoading(true);
    try {
      const response = await (/** @type {any} */ (base44.functions)).invoke(functionName, {}, { responseType: 'blob' });
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  };

  const downloadChatReportPdf = () => downloadReportPdf('chatReportPdf', 'relatorio-chat-5asec.pdf', setGeneratingChatPdf);
  const downloadPickupsReportPdf = () => downloadReportPdf('pickupsReportPdf', 'relatorio-coletas-5asec.pdf', setGeneratingPickupsPdf);
  const downloadUsersReportPdf = () => downloadReportPdf('userPerformanceReportPdf', 'relatorio-performance-usuarios-5asec.pdf', setGeneratingUsersPdf);
  const downloadConversationsReportPdf = () => downloadReportPdf('conversationsPerDayReportPdf', 'relatorio-conversas-por-dia-5asec.pdf', setGeneratingConvPdf);

  // Relatórios precisam refletir pagamentos confirmados agora (webhook/caixa),
  // por isso não reutilizam cache antigo ao abrir a página.
  const freshQuery = { staleTime: 0, refetchOnMount: 'always' };

  const { data: payments = [], isLoading: loadingPayments } = useQuery({
    queryKey: ['reports-payments'],
    queryFn: () => base44.entities.Payment.filter({}, '-created_date', 2000),
    ...freshQuery
  });

  const { data: quotes = [], isLoading: loadingQuotes } = useQuery({
    queryKey: ['reports-quotes'],
    queryFn: () => base44.entities.Quote.filter({ status: 'ACCEPTED' }, '-created_date', 2000),
    ...freshQuery
  });

  const { data: pickups = [], isLoading: loadingPickups } = useQuery({
    queryKey: ['reports-pickups'],
    queryFn: () => base44.entities.Pickup.filter({}, '-created_date', 2000)
  });

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['reports-products'],
    queryFn: () => base44.entities.Product.filter({}, '-created_date', 1000)
  });

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ['reports-customers'],
    queryFn: () => base44.entities.Customer.filter({}, '-created_date', 2000)
  });

  const { data: financeEntries = [], isLoading: loadingFinance } = useQuery({
    queryKey: ['reports-finance'],
    queryFn: () => base44.entities.FinanceEntry.filter({}, '-created_date', 2000),
    ...freshQuery
  });

  const isLoading = unitsLoading || loadingPayments || loadingQuotes || loadingPickups || loadingProducts || loadingCustomers || loadingFinance;
  const selectedUnitLabel = getUnitLabel(selectedUnit, selectedUnitId);

  const filteredData = useMemo(() => {
    const now = new Date();
    const startDate = dateRange === 'all' ? new Date(0) : subDays(now, parseInt(dateRange, 10));

    const scopedPayments = filterRecordsByUnit(payments, selectedUnitId, defaultUnitId);
    const scopedQuotes = filterRecordsByUnit(quotes, selectedUnitId, defaultUnitId);

    const validPayments = scopedPayments.filter((payment) => {
      const date = new Date(payment.created_date || payment.paid_at || new Date());
      if (date < startDate) return false;
      if (paymentFilter !== 'all' && payment.payment_method !== paymentFilter) return false;
      return true;
    });

    const succeededPayments = validPayments.filter((payment) => payment.status === 'succeeded');

    const validPickups = pickups.filter((pickup) => {
      const date = new Date(pickup.scheduled_at || pickup.created_date);
      return date >= startDate;
    });

    const validQuotes = scopedQuotes.filter((quote) => new Date(quote.created_date) >= startDate);

    const salesByDayMap = {};
    succeededPayments.forEach((payment) => {
      const date = new Date(payment.created_date || payment.paid_at || new Date());
      const dateStr = format(date, 'yyyy-MM-dd');
      salesByDayMap[dateStr] = (salesByDayMap[dateStr] || 0) + (payment.amount || 0);
    });

    const salesChartData = Object.keys(salesByDayMap)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .map((key) => ({ date: format(new Date(`${key}T12:00:00Z`), 'dd/MM'), total: salesByDayMap[key] }));

    const methodsCount = {};
    succeededPayments.forEach((payment) => {
      const method = payment.payment_method || 'Outro';
      methodsCount[method] = (methodsCount[method] || 0) + (payment.amount || 0);
    });
    const paymentMethodsData = Object.keys(methodsCount).map((key) => ({ name: key.toUpperCase(), value: methodsCount[key] }));

    const pickupsStatus = {};
    validPickups.forEach((pickup) => {
      const status = pickup.status || 'unknown';
      pickupsStatus[status] = (pickupsStatus[status] || 0) + 1;
    });
    const pickupsData = Object.keys(pickupsStatus).map((key) => ({ name: key.toUpperCase(), value: pickupsStatus[key] }));

    const customerMap = {};
    customers.forEach((customer) => {
      customerMap[customer.id] = customer.full_name;
    });

    const pickupsByDayMap = {};
    const pickupsByNeighborhoodMap = {};
    const pickupsByFeeMap = { Grátis: 0, Paga: 0 };
    const pickupsByCustomerMap = {};

    validPickups.forEach((pickup) => {
      const date = new Date(pickup.scheduled_at || pickup.created_date);
      const dateStr = format(date, 'yyyy-MM-dd');
      pickupsByDayMap[dateStr] = (pickupsByDayMap[dateStr] || 0) + 1;

      const neighborhood = pickup.neighborhood || 'Não Informado';
      pickupsByNeighborhoodMap[neighborhood] = (pickupsByNeighborhoodMap[neighborhood] || 0) + 1;

      const isFree = !pickup.fee || pickup.fee === 0;
      pickupsByFeeMap[isFree ? 'Grátis' : 'Paga'] += 1;

      const customerName = customerMap[pickup.customer_id] || 'Desconhecido';
      pickupsByCustomerMap[customerName] = (pickupsByCustomerMap[customerName] || 0) + 1;
    });

    const pickupsChartData = Object.keys(pickupsByDayMap)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .map((key) => ({ date: format(new Date(`${key}T12:00:00Z`), 'dd/MM'), total: pickupsByDayMap[key] }));

    const pickupsNeighborhoodData = Object.keys(pickupsByNeighborhoodMap)
      .map((key) => ({ name: key, value: pickupsByNeighborhoodMap[key] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const pickupsFeeData = Object.keys(pickupsByFeeMap)
      .map((key) => ({ name: key, value: pickupsByFeeMap[key] }))
      .filter((item) => item.value > 0);

    const pickupsCustomerData = Object.keys(pickupsByCustomerMap)
      .map((key) => ({ name: key, value: pickupsByCustomerMap[key] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const productMap = {};
    products.forEach((product) => {
      productMap[product.name] = product;
    });

    const itemsSold = {};
    validQuotes.forEach((quote) => {
      (quote.items || []).forEach((item) => {
        const product = productMap[item.garment_type];
        const type = product ? (product.family || product.category || 'Outros') : 'Outros';
        if (productTypeFilter !== 'all' && type !== productTypeFilter) return;

        const key = item.garment_type;
        if (!itemsSold[key]) itemsSold[key] = { name: key, qty: 0, revenue: 0, type };
        itemsSold[key].qty += item.qty || 1;
        itemsSold[key].revenue += (item.unit_price || 0) * (item.qty || 1);
      });
    });

    const topItemsData = Object.values(itemsSold).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    const uniqueTypes = new Set();
    products.forEach((product) => uniqueTypes.add(product.family || product.category || 'Outros'));

    const quoteMap = {};
    validQuotes.forEach((quote) => {
      quoteMap[quote.id] = quote;
    });

    // DRE — usa lançamentos financeiros (FinanceEntry) escopados por unidade e data
    const scopedFinance = filterRecordsByUnit(financeEntries, selectedUnitId, defaultUnitId);
    const validFinance = scopedFinance.filter((entry) => {
      const date = new Date(entry.entry_date || entry.created_date);
      return date >= startDate;
    });

    const financeIncome = validFinance.filter((e) => e.type === 'income');
    const financeExpense = validFinance.filter((e) => {
      if (e.type !== 'expense') return false;
      if (expenseFilter !== 'all' && e.category !== expenseFilter) return false;
      return true;
    });

    const sumBy = (list) => {
      const map = {};
      list.forEach((e) => {
        const cat = e.category || 'Outros';
        map[cat] = (map[cat] || 0) + (e.amount || 0);
      });
      return Object.keys(map)
        .map((name) => ({ name, value: map[name] }))
        .sort((a, b) => b.value - a.value);
    };

    const paymentsRevenue = succeededPayments.reduce((total, p) => total + (p.amount || 0), 0);
    const financeIncomeTotal = financeIncome.reduce((total, e) => total + (e.amount || 0), 0);
    const totalExpenses = financeExpense.reduce((total, e) => total + (e.amount || 0), 0);
    const totalDreRevenue = paymentsRevenue + financeIncomeTotal;

    const revenueByCategory = [
      ...(paymentsRevenue > 0 ? [{ name: 'Vendas (Pagamentos)', value: paymentsRevenue }] : []),
      ...sumBy(financeIncome),
    ];

    const expenseCategories = Array.from(
      new Set(scopedFinance.filter((e) => e.type === 'expense').map((e) => e.category || 'Outros'))
    ).filter(Boolean);

    const dre = {
      totalRevenue: totalDreRevenue,
      totalExpenses,
      netResult: totalDreRevenue - totalExpenses,
      revenueByCategory,
      expensesByCategory: sumBy(financeExpense),
      expenseCategories,
    };

    return {
      dre,
      totalRevenue: succeededPayments.reduce((total, payment) => total + (payment.amount || 0), 0),
      totalPickups: validPickups.length,
      totalSalesCount: succeededPayments.length,
      salesChartData,
      paymentMethodsData,
      pickupsData,
      pickupsChartData,
      pickupsNeighborhoodData,
      pickupsFeeData,
      pickupsCustomerData,
      topItemsData,
      uniqueTypes: Array.from(uniqueTypes).filter(Boolean),
      validPickups,
      customerMap,
      succeededPayments,
      quoteMap
    };
  }, [payments, quotes, pickups, products, customers, financeEntries, dateRange, paymentFilter, productTypeFilter, expenseFilter, selectedUnitId, defaultUnitId]);

  const exportSalesToCSV = () => {
    const headers = ['Data/Hora', 'Cliente', 'Serviços', 'Valor', 'Método de Pagamento'];
    const rows = filteredData.succeededPayments.map((payment) => {
      const date = payment.paid_at || payment.created_date
        ? format(new Date(payment.paid_at || payment.created_date), 'dd/MM/yyyy HH:mm')
        : '-';
      const customer = filteredData.customerMap[payment.customer_id] || 'Desconhecido';

      let services = '-';
      if (payment.quote_id && filteredData.quoteMap[payment.quote_id]?.items?.length) {
        services = filteredData.quoteMap[payment.quote_id].items
          .map((item) => `${item.qty}x ${item.garment_type}`)
          .join(', ');
      }

      const amount = payment.amount ? `R$ ${payment.amount.toFixed(2)}` : 'R$ 0,00';
      const method = payment.payment_method || '-';
      return `"${date}";"${customer}";"${services}";"${amount}";"${method}"`;
    });

    const csvContent = `data:text/csv;charset=utf-8,\uFEFF${[headers.join(';')].concat(rows).join('\n')}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `relatorio_vendas_${getSlug(selectedUnitLabel)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportSalesToPDF = () => {
    const pdf = new jsPDF('p', 'mm', 'a4');
    /** @type {[number, number, number]} */
    const primaryColor = [26, 11, 54];
    /** @type {[number, number, number]} */
    const lightGray = [240, 240, 240];
    /** @type {[number, number, number]} */
    const darkGray = [60, 60, 60];

    pdf.setFillColor(...primaryColor);
    pdf.rect(0, 0, 210, 30, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(18);
    pdf.setFont(undefined, 'bold');
    pdf.text('Relatório de Vendas', 196, 14, { align: 'right' });
    pdf.setFontSize(10);
    pdf.setFont(undefined, 'normal');
    pdf.text(selectedUnitLabel, 196, 20, { align: 'right' });
    pdf.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 196, 25, { align: 'right' });

    let y = 40;
    const drawHeaders = (startY) => {
      pdf.setFillColor(...lightGray);
      pdf.rect(14, startY - 6, 182, 10, 'F');
      pdf.setFontSize(11);
      pdf.setTextColor(...primaryColor);
      pdf.setFont(undefined, 'bold');
      pdf.text('Data/Hora', 16, startY);
      pdf.text('Cliente', 50, startY);
      pdf.text('Serviços', 95, startY);
      pdf.text('Método', 155, startY);
      pdf.text('Valor', 180, startY);
      return startY + 8;
    };

    y = drawHeaders(y);
    pdf.setFont(undefined, 'normal');
    pdf.setFontSize(10);

    filteredData.succeededPayments.forEach((payment, index) => {
      if (y > 270) {
        pdf.addPage();
        y = drawHeaders(20);
        pdf.setFont(undefined, 'normal');
        pdf.setFontSize(10);
      }

      if (index % 2 === 0) {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(14, y - 5, 182, 8, 'F');
      }

      const date = payment.paid_at || payment.created_date
        ? format(new Date(payment.paid_at || payment.created_date), 'dd/MM/yyyy HH:mm')
        : '-';
      const customer = (filteredData.customerMap[payment.customer_id] || 'Desconhecido').substring(0, 20);

      let services = '-';
      if (payment.quote_id && filteredData.quoteMap[payment.quote_id]?.items?.length) {
        services = filteredData.quoteMap[payment.quote_id].items
          .map((item) => `${item.qty}x ${item.garment_type}`)
          .join(', ')
          .substring(0, 30);
      }

      const amount = payment.amount ? `R$ ${payment.amount.toFixed(2)}` : 'R$ 0,00';
      const method = payment.payment_method || '-';

      pdf.setTextColor(...darkGray);
      pdf.text(date, 16, y);
      pdf.text(customer, 50, y);
      pdf.text(services, 95, y);
      pdf.text(method, 155, y);
      pdf.setTextColor(0, 150, 0);
      pdf.text(amount, 180, y);
      y += 8;
    });

    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      pdf.setTextColor(150);
      pdf.setFontSize(8);
      pdf.text(`Página ${page} de ${pageCount}`, 105, 290, { align: 'center' });
    }

    pdf.save(`relatorio_vendas_${getSlug(selectedUnitLabel)}.pdf`);
  };

  if (isLoading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-[#FF6600]" />
        <p className="text-gray-400">Carregando relatórios...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Relatórios e Métricas</h1>
          <p className="text-gray-400">
            {selectedUnitId === 'all'
              ? 'Visão consolidada das vendas das 5 unidades. As coletas seguem compartilhadas para todos.'
              : `Vendas da ${selectedUnitLabel}. As coletas seguem compartilhadas para todos.`}
          </p>
        </div>

        <UnitFilterSelect
          isAdmin={isAdmin}
          units={accessibleUnits}
          value={selectedUnitId}
          onChange={setSelectedUnitId}
        />
      </div>

      <SpecializedReportsPanel />

      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/35">Relatórios legados preservados</p>
        <p className="mt-1 text-sm text-white/45">Vendas, DRE, meios de pagamento, produtos, conversas e coletas continuam disponíveis abaixo.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
          <Filter className="h-4 w-4 text-gray-400" />
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="h-8 w-32 border-0 bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="all">Todo o período</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
          <DollarSign className="h-4 w-4 text-gray-400" />
          <Select value={paymentFilter} onValueChange={setPaymentFilter}>
            <SelectTrigger className="h-8 w-36 border-0 bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Pagamentos</SelectItem>
              <SelectItem value="pix">Pix</SelectItem>
              <SelectItem value="credit">Cartão Crédito</SelectItem>
              <SelectItem value="debit">Cartão Débito</SelectItem>
              <SelectItem value="link">Link</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
          <Package className="h-4 w-4 text-gray-400" />
          <Select value={productTypeFilter} onValueChange={setProductTypeFilter}>
            <SelectTrigger className="h-8 w-40 border-0 bg-transparent">
              <SelectValue placeholder="Tipo de Serviço" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Tipos</SelectItem>
              {filteredData.uniqueTypes.map((type) => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
          <TrendingDown className="h-4 w-4 text-gray-400" />
          <Select value={expenseFilter} onValueChange={setExpenseFilter}>
            <SelectTrigger className="h-8 w-44 border-0 bg-transparent">
              <SelectValue placeholder="Categoria de Despesa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as Despesas</SelectItem>
              {filteredData.dre.expenseCategories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportSalesToCSV} className="h-9 gap-2 border-white/20 bg-transparent text-white hover:bg-white/10">
            <FileText className="h-4 w-4" /> Excel (Vendas)
          </Button>
          <Button variant="outline" size="sm" onClick={exportSalesToPDF} className="h-9 gap-2 border-white/20 bg-transparent text-white hover:bg-white/10">
            <Download className="h-4 w-4" /> PDF (Vendas)
          </Button>
          <Button variant="outline" size="sm" onClick={downloadPickupsReportPdf} disabled={generatingPickupsPdf} className="h-9 gap-2 border-[#4C12A1] bg-transparent text-white hover:bg-[#4C12A1]/20">
            {generatingPickupsPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
            {generatingPickupsPdf ? 'Gerando...' : 'PDF (Coletas)'}
          </Button>
          <Button variant="outline" size="sm" onClick={downloadUsersReportPdf} disabled={generatingUsersPdf} className="h-9 gap-2 border-[#25D366] bg-transparent text-white hover:bg-[#25D366]/20">
            {generatingUsersPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            {generatingUsersPdf ? 'Gerando...' : 'PDF (Usuários)'}
          </Button>
          <Button variant="outline" size="sm" onClick={downloadConversationsReportPdf} disabled={generatingConvPdf} className="h-9 gap-2 border-[#FF6600] bg-transparent text-white hover:bg-[#FF6600]/20">
            {generatingConvPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
            {generatingConvPdf ? 'Gerando...' : 'PDF (Conversas/Dia)'}
          </Button>
          <Button size="sm" onClick={downloadChatReportPdf} disabled={generatingChatPdf} className="h-9 gap-2 bg-[#FF6600] text-white hover:bg-[#FF6600]/90">
            {generatingChatPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            {generatingChatPdf ? 'Gerando...' : 'PDF (Chat IA)'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-white/10 bg-white/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Receita Total (Pagos)</CardTitle>
            <TrendingUp className="h-4 w-4 text-[#FF6600]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">R$ {filteredData.totalRevenue.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Vendas Realizadas</CardTitle>
            <DollarSign className="h-4 w-4 text-[#25D366]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{filteredData.totalSalesCount}</div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Coletas Agendadas</CardTitle>
            <Truck className="h-4 w-4 text-[#4C12A1]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{filteredData.totalPickups}</div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-2 mt-8">
        <h2 className="border-b border-white/10 pb-4 text-2xl font-bold">Financeiro (DRE)</h2>
      </div>

      <DRESection dre={filteredData.dre} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-white">Vendas por Dia</CardTitle>
            <CardDescription className="text-gray-300">Evolução da receita no período</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {filteredData.salesChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredData.salesChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="date" stroke="#888" fontSize={12} />
                  <YAxis stroke="#888" fontSize={12} tickFormatter={(value) => `R$${value}`} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#1a0b36', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px' }}
                    itemStyle={{ color: '#FF6600' }}
                    formatter={(value) => [`R$ ${Number(value).toFixed(2)}`, 'Receita']}
                  />
                  <Line type="monotone" dataKey="total" stroke="#FF6600" strokeWidth={3} dot={{ fill: '#FF6600', r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">Nenhum dado no período</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-white">Top Produtos e Serviços</CardTitle>
            <CardDescription className="text-gray-300">Mais vendidos por receita gerada</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {filteredData.topItemsData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredData.topItemsData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal vertical={false} />
                  <XAxis type="number" stroke="#888" fontSize={12} />
                  <YAxis type="category" dataKey="name" stroke="#888" fontSize={12} width={120} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#1a0b36', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px' }}
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    formatter={(value) => [`R$ ${Number(value).toFixed(2)}`, 'Receita']}
                  />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                    {filteredData.topItemsData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">Nenhum dado no período</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-white">Vendas por Forma de Pagamento</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {filteredData.paymentMethodsData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={filteredData.paymentMethodsData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={{ stroke: '#888' }}
                  >
                    {filteredData.paymentMethodsData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#1a0b36', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px' }}
                    formatter={(value) => [`R$ ${Number(value).toFixed(2)}`, 'Valor']}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">Nenhum dado no período</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-white">Status das Coletas</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {filteredData.pickupsData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={filteredData.pickupsData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={{ stroke: '#888' }}
                  >
                    {filteredData.pickupsData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#1a0b36', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px' }}
                    formatter={(value) => [value, 'Quantidade']}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">Nenhum dado no período</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 mt-12">
        <h2 className="border-b border-white/10 pb-4 text-2xl font-bold">Detalhamento de Coletas</h2>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-white">Coletas por Dia</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {filteredData.pickupsChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredData.pickupsChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="date" stroke="#888" fontSize={12} />
                  <YAxis stroke="#888" fontSize={12} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#1a0b36', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px' }}
                    itemStyle={{ color: '#4C12A1' }}
                    formatter={(value) => [value, 'Coletas']}
                  />
                  <Line type="monotone" dataKey="total" stroke="#4C12A1" strokeWidth={3} dot={{ fill: '#4C12A1', r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">Nenhum dado no período</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-white">Coletas: Grátis vs Paga</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {filteredData.pickupsFeeData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={filteredData.pickupsFeeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={{ stroke: '#888' }}
                  >
                    {filteredData.pickupsFeeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.name === 'Grátis' ? '#25D366' : '#FF6600'} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#1a0b36', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px' }}
                    formatter={(value) => [value, 'Quantidade']}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">Nenhum dado no período</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-white">Top Bairros (Coletas)</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {filteredData.pickupsNeighborhoodData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredData.pickupsNeighborhoodData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal vertical={false} />
                  <XAxis type="number" stroke="#888" fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" stroke="#888" fontSize={12} width={100} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#1a0b36', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px' }}
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    formatter={(value) => [value, 'Coletas']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {filteredData.pickupsNeighborhoodData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">Nenhum dado no período</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-white">Top Clientes (Coletas)</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {filteredData.pickupsCustomerData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredData.pickupsCustomerData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal vertical={false} />
                  <XAxis type="number" stroke="#888" fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" stroke="#888" fontSize={12} width={120} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: '#1a0b36', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px' }}
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    formatter={(value) => [value, 'Coletas']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {filteredData.pickupsCustomerData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">Nenhum dado no período</div>
            )}
          </CardContent>
        </Card>
      </div>

      <PickupsTable pickups={filteredData.validPickups} customerMap={filteredData.customerMap} />
    </div>
  );
}