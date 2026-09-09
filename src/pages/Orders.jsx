import React, { useEffect, useState } from 'react';
import { DragDropContext } from '@hello-pangea/dnd';
import { base44 } from '@/api/base44Client';
import {
  Kanban,
  AlertCircle,
  Users,
  ShoppingBag,
  CreditCard,
  Package,
  Loader2
} from 'lucide-react';
import QuoteReviewModal from '@/components/crm/QuoteReviewModal';
import OrderDetailsModal from '@/components/crm/OrderDetailsModal';
import KanbanColumn from '@/components/crm/KanbanColumn';
import NewItemModal from '@/components/crm/NewItemModal';
import AdvancedQuoteModal from '@/components/crm/AdvancedQuoteModal';
import useUnitAccess, { filterRecordsByUnit, getUnitLabel } from '@/components/units/useUnitAccess';
import UnitFilterSelect from '@/components/units/UnitFilterSelect';
import DateRangeFilter from '@/components/crm/DateRangeFilter';
import syncNewCustomerCards from '@/lib/syncNewCustomerCards';
import { startOfDay, startOfWeek, startOfMonth, endOfDay, endOfWeek, endOfMonth, parseISO } from 'date-fns';

const PIPELINES = {
  NEW_CUSTOMER: {
    label: 'Novos Clientes',
    icon: Users,
    columns: ['Novo cliente', 'Qualificação', 'Primeiro orçamento', 'Convertido', 'Inativo']
  },
  QUOTE: {
    label: 'Orçamentos',
    icon: ShoppingBag,
    columns: ['Coletando itens', 'Em análise humana', 'Enviado ao cliente', 'Aprovado', 'Expirado']
  },
  COMPLAINT: {
    label: 'Reclamações',
    icon: AlertCircle,
    columns: ['Aberta', 'Em tratativa', 'Resolvida']
  },
  PAYMENT: {
    label: 'Pagamentos',
    icon: CreditCard,
    columns: ['Link gerado', 'Aguardando Pix', 'Pago', 'Falhou/Expirou', 'Conciliado']
  },
  PLAN: {
    label: 'Planos/Pacotes',
    icon: Package,
    columns: ['Lead plano', 'Oferta enviada', 'Assinou/Ativou', 'Renovação próxima', 'Cancelado']
  },
  ORDER: {
    label: 'Pedidos',
    icon: Kanban,
    columns: ['Recebido', 'Em processamento', 'Pronto', 'Entregue', 'Finalizado']
  }
};

export default function Orders() {
  const {
    isAdmin,
    accessibleUnits,
    selectedUnit,
    selectedUnitId,
    setSelectedUnitId,
    defaultUnitId,
    loading: unitsLoading
  } = useUnitAccess();
  const [activePipeline, setActivePipeline] = useState('QUOTE');
  const [cards, setCards] = useState([]);
  const [customers, setCustomers] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState(null);
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [isAdvancedQuoteModalOpen, setIsAdvancedQuoteModalOpen] = useState(false);
  const [newItemStage, setNewItemStage] = useState(null);
  const [dateFilter, setDateFilter] = useState('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });

  useEffect(() => {
    if (unitsLoading) return;
    fetchData();
  }, [activePipeline, selectedUnitId, unitsLoading]);

  useEffect(() => {
    if (activePipeline !== 'NEW_CUSTOMER') return;
    return base44.entities.Customer.subscribe((event) => {
      if (event.type === 'create') fetchData();
    });
  }, [activePipeline, selectedUnitId, defaultUnitId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const allCustomers = await base44.entities.Customer.list('-created_date', 500);
      if (activePipeline === 'NEW_CUSTOMER') {
        await syncNewCustomerCards(allCustomers, defaultUnitId);
      }
      const fetchedCards = await base44.entities.CrmCard.filter({ pipeline_type: activePipeline });

      const visibleCards = filterRecordsByUnit(fetchedCards, selectedUnitId, defaultUnitId);
      const customerMap = {};
      allCustomers.forEach((customer) => {
        customerMap[customer.id] = customer;
      });

      setCards(visibleCards);
      setCustomers(customerMap);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCardClick = (card) => {
    if (activePipeline === 'QUOTE') {
      setSelectedCard(card);
      setIsQuoteModalOpen(true);
    } else if (activePipeline === 'ORDER') {
      setSelectedCard(card);
      setIsOrderModalOpen(true);
    }
  };

  const handleDeleteCard = async (cardId) => {
    if (!window.confirm('Tem certeza que deseja excluir este card?')) return;
    try {
      await base44.entities.CrmCard.delete(cardId);
      fetchData();
    } catch (error) {
      console.error('Failed to delete card:', error);
    }
  };

  const onDragEnd = async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const newStage = destination.droppableId;
    const updatedCards = cards.map((card) =>
      card.id === draggableId ? { ...card, stage: newStage } : card
    );
    setCards(updatedCards);

    try {
      await base44.entities.CrmCard.update(draggableId, { stage: newStage });

      if (activePipeline === 'ORDER') {
        const card = cards.find((item) => item.id === draggableId);
        if (card?.linked_order_id) {
          const statusMap = {
            Recebido: 'pending',
            'Em processamento': 'processing',
            Pronto: 'ready',
            Entregue: 'delivered',
            Finalizado: 'finished'
          };

          if (statusMap[newStage]) {
            await base44.entities.Order.update(card.linked_order_id, { status: statusMap[newStage] });
          }
        }
      }
    } catch (error) {
      console.error('Failed to update card stage:', error);
      fetchData();
    }
  };

  const getDateRange = () => {
    const now = new Date();
    switch (dateFilter) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'week':
        return { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) };
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'custom':
        return {
          start: customRange.start ? startOfDay(parseISO(customRange.start)) : null,
          end: customRange.end ? endOfDay(parseISO(customRange.end)) : null,
        };
      default:
        return null;
    }
  };

  const filteredCards = (() => {
    const range = getDateRange();
    if (!range) return cards;
    return cards.filter((card) => {
      if (!card.created_date) return false;
      const created = new Date(card.created_date);
      if (range.start && created < range.start) return false;
      if (range.end && created > range.end) return false;
      return true;
    });
  })();

  const getCardsByColumn = (column) => filteredCards.filter((card) => card.stage === column);

  const handleAddClick = (stage) => {
    if (selectedUnitId === 'all') {
      alert('Selecione uma unidade específica para criar novos cards.');
      return;
    }

    setNewItemStage(stage);
    if (activePipeline === 'QUOTE') {
      setIsAdvancedQuoteModalOpen(true);
    } else {
      setIsNewItemModalOpen(true);
    }
  };

  if (unitsLoading || loading) {
    return (
      <div className="flex h-96 items-center justify-center text-gray-400">
        <Loader2 className="mr-2 h-6 w-6 animate-spin text-[#FF6600]" /> Carregando CRM...
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-100px)] flex-col">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">CRM & Pedidos</h1>
          <p className="mt-1 text-sm text-white/60">
            {selectedUnitId === 'all'
              ? 'Visão consolidada do CRM de todas as unidades.'
              : `Exibindo somente ${getUnitLabel(selectedUnit, selectedUnitId)}.`}
          </p>
        </div>

        <div className="flex flex-col gap-3 md:items-end">
          <UnitFilterSelect
            isAdmin={isAdmin}
            units={accessibleUnits}
            value={selectedUnitId}
            onChange={setSelectedUnitId}
          />

          <DateRangeFilter
            value={dateFilter}
            onChange={setDateFilter}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
          />

          <div className="custom-scrollbar flex max-w-full items-center gap-2 overflow-x-auto rounded-lg border border-white/10 bg-white/5 p-1 pb-1.5">
            {Object.entries(PIPELINES).map(([key, config]) => {
              const Icon = config.icon;
              const isActive = activePipeline === key;
              return (
                <button
                  key={key}
                  onClick={() => setActivePipeline(key)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-[#FF6600] text-white shadow-lg shadow-orange-500/20'
                      : 'text-white/60 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden lg:inline">{config.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="custom-scrollbar flex-1 overflow-x-auto pb-4">
          <div className="flex h-full min-w-max gap-6">
            {PIPELINES[activePipeline].columns.map((column) => (
              <KanbanColumn
                key={column}
                columnId={column}
                cards={getCardsByColumn(column)}
                customers={customers}
                onCardClick={handleCardClick}
                onAddClick={handleAddClick}
                onDeleteClick={handleDeleteCard}
              />
            ))}
          </div>
        </div>
      </DragDropContext>

      <QuoteReviewModal
        isOpen={isQuoteModalOpen}
        onClose={() => {
          setIsQuoteModalOpen(false);
          setSelectedCard(null);
          fetchData();
        }}
        card={selectedCard}
        customer={selectedCard ? customers[selectedCard.customer_id] : null}
      />

      <OrderDetailsModal
        isOpen={isOrderModalOpen}
        onClose={() => {
          setIsOrderModalOpen(false);
          setSelectedCard(null);
          fetchData();
        }}
        card={selectedCard}
        customer={selectedCard ? customers[selectedCard.customer_id] : null}
      />

      <NewItemModal
        isOpen={isNewItemModalOpen}
        onClose={() => setIsNewItemModalOpen(false)}
        pipeline={activePipeline}
        stage={newItemStage}
        unitId={selectedUnitId}
        onSuccess={fetchData}
      />

      <AdvancedQuoteModal
        isOpen={isAdvancedQuoteModalOpen}
        onClose={() => setIsAdvancedQuoteModalOpen(false)}
        pipeline={activePipeline}
        stage={newItemStage}
        unitId={selectedUnitId}
        onSuccess={fetchData}
      />
    </div>
  );
}