import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  ShoppingBag,
  Users,
  TrendingUp,
  ArrowRight,
  ShoppingCart,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { isSameBrasiliaDay, getBrasiliaDateKey } from '@/lib/pickupDateTime';
import LaundryFactory from '../components/dashboard/LaundryFactoryV2';
import StatsCard from '../components/dashboard/StatsCard';
import TodayPickupsColumn from '@/components/dashboard/TodayPickupsColumn';
import TodaySalesColumn from '@/components/dashboard/TodaySalesColumn';
import ProductionBatchesColumn from '@/components/dashboard/ProductionBatchesColumn';
import useUnitAccess, { filterRecordsByUnit, getUnitLabel } from '@/components/units/useUnitAccess';
import UnitFilterSelect from '@/components/units/UnitFilterSelect';
import AdvancedQuoteModal from '@/components/crm/AdvancedQuoteModal';
import SellOptionsDialog from '@/components/dashboard/SellOptionsDialog';
import IntelligentQuoteModal from '@/components/management/IntelligentQuoteModal';
import { toast } from 'sonner';

export default function Dashboard() {
  const {
    user,
    isAdmin,
    accessibleUnits,
    selectedUnit,
    selectedUnitId,
    setSelectedUnitId,
    defaultUnitId,
    loading: unitsLoading
  } = useUnitAccess();
  const [stats, setStats] = useState({
    activeChats: 0,
    ordersInProcess: 0,
    revenueToday: 0,
    totalCustomers: 0
  });
  const [todayPickups, setTodayPickups] = useState([]);
  const [todaySales, setTodaySales] = useState([]);
  const [productionBatches, setProductionBatches] = useState([]);
  const [customerMap, setCustomerMap] = useState({});
  const [timesByCustomer, setTimesByCustomer] = useState({});
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [ticketPickup, setTicketPickup] = useState(null);
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [sellChoiceOpen, setSellChoiceOpen] = useState(false);
  const [photoQuoteOpen, setPhotoQuoteOpen] = useState(false);

  const handleGenerateTicket = (pickup) => {
    const customer = customerMap[pickup.customer_id];
    window.initialQuoteData = {
      id: pickup.customer_id,
      name: customer?.full_name || '',
      phone: (customer?.phones && customer.phones[0]) || ''
    };
    setTicketPickup(pickup);
  };

  const refetchTimeoutRef = React.useRef(null);

  useEffect(() => {
    if (unitsLoading) return;

    fetchDashboardData();

    // Debounce subscription-triggered refetches. Generating a ticket creates/updates
    // several records at once, firing many subscriptions in a burst. Without debounce
    // this triggers a flood of API calls -> 429 rate limit -> dashboard renders empty.
    const debouncedRefetch = () => {
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      refetchTimeoutRef.current = setTimeout(() => fetchDashboardData(), 1500);
    };

    const unsubOrders = base44.entities.Order.subscribe(debouncedRefetch);
    const unsubChats = base44.entities.Conversation.subscribe(debouncedRefetch);
    const unsubPayments = base44.entities.Payment.subscribe(debouncedRefetch);
    const unsubQuotes = base44.entities.Quote.subscribe(debouncedRefetch);
    const unsubPickups = base44.entities.Pickup.subscribe(debouncedRefetch);
    const unsubBatches = base44.entities.ProductionBatch.subscribe(debouncedRefetch);

    return () => {
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      unsubOrders();
      unsubChats();
      unsubPayments();
      unsubQuotes();
      unsubPickups();
      unsubBatches();
    };
  }, [unitsLoading, selectedUnitId, defaultUnitId]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [conversations, orders, payments, quotes, pickups, batches] = await Promise.all([
        base44.entities.Conversation.list('-last_message_at', 50),
        base44.entities.Order.list('-updated_date', 200),
        base44.entities.Payment.list('-paid_at', 200),
        base44.entities.Quote.list('-updated_date', 200),
        base44.entities.Pickup.list('-scheduled_at', 1000),
        base44.entities.ProductionBatch.list('-created_date', 200)
      ]);

      const openBatches = filterRecordsByUnit(batches, selectedUnitId, defaultUnitId)
        .filter((batch) => ['draft', 'scheduled', 'waiting_materials', 'queued', 'processing', 'paused'].includes(batch.status));
      setProductionBatches(openBatches);

      const visibleOrders = filterRecordsByUnit(orders, selectedUnitId, defaultUnitId);
      const visiblePayments = filterRecordsByUnit(payments, selectedUnitId, defaultUnitId);
      const visibleQuotes = filterRecordsByUnit(quotes, selectedUnitId, defaultUnitId);
      const activeConversations = conversations.filter((conversation) => conversation.status === 'OPEN');
      const ordersInProcess = visibleOrders.filter((order) => ['processing', 'ready'].includes(order.status));

      const today = getBrasiliaDateKey();
      const todayRevenue = visiblePayments
        .filter((payment) => payment.status === 'succeeded' && payment.paid_at && payment.paid_at.startsWith(today))
        .reduce((sum, payment) => sum + (payment.amount || 0), 0);

      const unitCustomerIds = new Set([
        ...visibleOrders.map((order) => order.customer_id),
        ...visibleQuotes.map((quote) => quote.customer_id)
      ].filter(Boolean));

      // Coletas de hoje (mesma ordem da página de Coletas: por horário agendado)
      const now = new Date();
      const pickupsToday = pickups
        .filter((p) => p.status !== 'cancelled' && isSameBrasiliaDay(p.scheduled_at, today))
        .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

      // Situação de pagamento por orçamento: usa a Order vinculada e, como reforço,
      // os pagamentos confirmados que apontam para o orçamento.
      const paymentStatusByQuote = {};
      visibleOrders.forEach((order) => {
        if (order.source_quote_id && !paymentStatusByQuote[order.source_quote_id]) {
          paymentStatusByQuote[order.source_quote_id] = order.payment_status || 'unpaid';
        }
      });
      visiblePayments.forEach((payment) => {
        if (payment.status === 'succeeded' && payment.quote_id) {
          paymentStatusByQuote[payment.quote_id] = 'paid';
        }
      });

      // Vendas de hoje (orçamentos finalizados): orçamentos aceitos/aprovados criados/atualizados hoje
      const salesToday = visibleQuotes
        .filter((q) => ['ACCEPTED', 'APPROVED'].includes(q.status))
        .filter((q) => {
          const ref = q.updated_date || q.created_date;
          return ref && getBrasiliaDateKey(ref) === today;
        })
        .sort((a, b) => new Date(a.created_date) - new Date(b.created_date))
        .map((q) => ({
          id: q.id,
          customer_id: q.customer_id,
          total: q.total,
          itemsCount: Array.isArray(q.items) ? q.items.reduce((s, it) => s + (it.qty || 1), 0) : 0,
          time: q.updated_date || q.created_date,
          paymentStatus: paymentStatusByQuote[q.id] || 'unpaid'
        }));

      // Busca os nomes dos clientes que aparecem nas coletas/vendas de hoje.
      // Uma única listagem paginada evita o 429 (rate limit) que ocorria ao
      // buscar cada cliente individualmente em paralelo.
      const neededCustomerIds = new Set([
        ...pickupsToday.map((p) => p.customer_id),
        ...salesToday.map((s) => s.customer_id)
      ].filter(Boolean));

      // Busca somente os clientes necessários por ID (em lotes) — varrer a base
      // inteira paginada travava o dashboard agora que passou de 5.000 clientes.
      const custMap = {};
      const idList = [...neededCustomerIds];
      for (let i = 0; i < idList.length; i += 100) {
        const chunk = idList.slice(i, i + 100);
        const batch = await base44.entities.Customer.filter({ id: { $in: chunk } });
        batch.forEach((customer) => { custMap[customer.id] = customer; });
      }

      // Mapa de tempos de processo (lavar/secar/passar/lavagem a seco) por cliente,
      // usando a Order mais recente de cada cliente. Os arrays vêm ordenados por -updated_date.
      const timesMap = {};
      visibleOrders.forEach((order) => {
        if (order.customer_id && !timesMap[order.customer_id]) {
          timesMap[order.customer_id] = {
            wash_time: order.wash_time,
            dry_time: order.dry_time,
            dry_clean_time: order.dry_clean_time,
            iron_time: order.iron_time
          };
        }
      });

      // Preserva ordem manual já definida pelo usuário (drag-and-drop)
      setTodayPickups((prev) => mergePreservingOrder(prev, pickupsToday));
      setTodaySales((prev) => mergePreservingOrder(prev, salesToday));
      setCustomerMap(custMap);
      setTimesByCustomer(timesMap);

      setStats({
        activeChats: activeConversations.length,
        ordersInProcess: ordersInProcess.length,
        revenueToday: todayRevenue,
        totalCustomers: unitCustomerIds.size
      });
    } catch (error) {
      console.error('Dashboard data fetch error:', error);
      // On rate limit (429) or transient errors, KEEP the data already on screen
      // instead of clearing pickups/sales. Retry shortly after.
      const status = error?.status || error?.response?.status;
      if (status === 429) {
        if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
        refetchTimeoutRef.current = setTimeout(() => fetchDashboardData(), 4000);
      }
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  };

  // Mantém a ordem manual (drag-and-drop) dos itens já presentes e adiciona novos ao final
  const mergePreservingOrder = (prev, next) => {
    const nextMap = {};
    next.forEach((item) => { nextMap[item.id] = item; });
    const ordered = prev
      .filter((item) => nextMap[item.id])
      .map((item) => nextMap[item.id]);
    const existingIds = new Set(ordered.map((item) => item.id));
    next.forEach((item) => {
      if (!existingIds.has(item.id)) ordered.push(item);
    });
    return ordered;
  };

  const unitTitle = getUnitLabel(selectedUnit, selectedUnitId).toUpperCase();

  // Só mostra o loader de tela cheia na primeira carga. Recarregamentos em background
  // (assinaturas em tempo real) não podem desmontar a árvore, senão o modal de venda
  // é reiniciado e a tela do Pix/QR Code desaparece.
  if (unitsLoading || (loading && !hasLoadedOnce)) {
    return (
      <div className="flex h-96 items-center justify-center text-gray-400">
        <Loader2 className="mr-2 h-6 w-6 animate-spin text-[#FF6600]" /> Carregando dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white/90 md:text-3xl">{unitTitle}</h1>
            <p className="mt-1 text-gray-400">
              {selectedUnitId === 'all'
                ? 'Visão consolidada das 5 unidades da operação.'
                : 'Bem-vindo à central de comando da sua 5àsec.'}
            </p>
            {user && (
              <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-gray-300">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-tr from-[#FF6600] to-yellow-500 text-[11px] font-bold text-white">
                  {(user.full_name || user.email || '?').charAt(0).toUpperCase()}
                </span>
                Logado como <span className="font-semibold text-white">{user.full_name || user.email}</span>
              </p>
            )}
          </div>

          <UnitFilterSelect
            isAdmin={isAdmin}
            units={accessibleUnits}
            value={selectedUnitId}
            onChange={setSelectedUnitId}
          />
        </div>

        <div className="flex justify-center">
          <Button
            onClick={() => setSellChoiceOpen(true)}
            className="gap-3 animate-pulse rounded-2xl border-2 border-green-400/60 bg-green-500/10 px-12 py-7 text-xl font-bold text-green-300 shadow-lg shadow-green-500/20 backdrop-blur-sm hover:bg-green-500/20 hover:text-green-200"
          >
            <ShoppingCart className="h-7 w-7" /> VENDER
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Atendimentos Ativos"
          value={stats.activeChats.toString()}
          subtext="Chat compartilhado"
          icon={MessageSquare}
          color="orange"
        />
        <StatsCard
          title="Pedidos em Processo"
          value={stats.ordersInProcess.toString()}
          subtext="Somente da unidade selecionada"
          icon={ShoppingBag}
          color="purple"
        />
        <StatsCard
          title="Faturamento Hoje"
          value={`R$ ${stats.revenueToday.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          subtext="Pagamentos confirmados"
          icon={TrendingUp}
          color="green"
        />
        <StatsCard
          title="Total Clientes"
          value={stats.totalCustomers.toString()}
          subtext="Clientes com vendas/orçamentos"
          icon={Users}
          color="blue"
        />
      </div>

      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
        <LaundryFactory />
      </motion.div>

      <ProductionBatchesColumn batches={productionBatches} />

      <div>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Serviços de Hoje</h2>
          <Link to="/pickups" className="flex items-center gap-1 text-sm text-[#FF6600] transition-colors hover:text-white">
            Ver coletas <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <TodayPickupsColumn
            pickups={todayPickups}
            customerMap={customerMap}
            timesByCustomer={timesByCustomer}
            onReorder={setTodayPickups}
            onGenerateTicket={handleGenerateTicket}
          />
          <TodaySalesColumn
            sales={todaySales}
            customerMap={customerMap}
            timesByCustomer={timesByCustomer}
            onReorder={setTodaySales}
          />
        </div>
      </div>

      <SellOptionsDialog
        open={sellChoiceOpen}
        onOpenChange={setSellChoiceOpen}
        onPhotoQuote={() => { setSellChoiceOpen(false); setPhotoQuoteOpen(true); }}
        onManualQuote={() => { setSellChoiceOpen(false); setSellModalOpen(true); }}
      />

      <IntelligentQuoteModal
        open={photoQuoteOpen}
        onOpenChange={setPhotoQuoteOpen}
        customers={Object.values(customerMap)}
        defaultUnitId={selectedUnitId !== 'all' ? selectedUnitId : defaultUnitId}
        onCreated={fetchDashboardData}
      />

      <AdvancedQuoteModal
        isOpen={sellModalOpen}
        onClose={() => setSellModalOpen(false)}
        onSuccess={() => { setSellModalOpen(false); fetchDashboardData(); toast.success('Venda registrada com sucesso!'); }}
        pipeline="ORDER"
        stage="pending"
        unitId={selectedUnitId !== 'all' ? selectedUnitId : defaultUnitId}
      />

      {ticketPickup && (
        <AdvancedQuoteModal
          isOpen={!!ticketPickup}
          onClose={() => setTicketPickup(null)}
          onSuccess={async () => {
            try { await base44.entities.Pickup.update(ticketPickup.id, { ticket_generated: true }); } catch (e) { console.error(e); }
            setTicketPickup(null);
            toast.success('Ticket gerado com sucesso!');
          }}
          skipLinkStep
          pipeline="ORDER"
          stage="pending"
          unitId={
            customerMap[ticketPickup.customer_id]?.unit_id ||
            (selectedUnitId !== 'all' ? selectedUnitId : defaultUnitId)
          }
        />
      )}
    </div>
  );
}