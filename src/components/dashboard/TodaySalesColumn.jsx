import React from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { TrendingUp, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBrasiliaTime } from '@/lib/pickupDateTime';
import CustomerStatusBadge from '@/components/dashboard/CustomerStatusBadge';
import PaymentStatusBadge from '@/components/payments/PaymentStatusBadge';

export default function TodaySalesColumn({ sales, customerMap, timesByCustomer = {}, onReorder }) {
  const handleNativeDragStart = (e, customerName, customerId, saleId) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      customerName,
      saleId,
      times: timesByCustomer[customerId] || {}
    }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;
    const reordered = Array.from(sales);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    onReorder(reordered);
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
      <div className="mb-5 flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-green-400" />
        <h3 className="text-lg font-bold text-white">Vendas de Hoje</h3>
        <span className="ml-auto rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/60">
          {sales.length}
        </span>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="today-sales">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-3">
              {sales.length > 0 ? sales.map((sale, index) => {
                const customer = customerMap[sale.customer_id];
                return (
                  <Draggable key={sale.id} draggableId={sale.id} index={index}>
                    {(drag, snapshot) => (
                      <div
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        className={cn(
                          'flex items-start gap-3 rounded-2xl border border-white/5 bg-white/5 p-4 transition-colors hover:bg-white/10',
                          snapshot.isDragging && 'ring-2 ring-green-500 shadow-2xl'
                        )}
                      >
                        <div
                          {...drag.dragHandleProps}
                          className="mt-1 cursor-grab text-gray-500 hover:text-white active:cursor-grabbing"
                        >
                          <GripVertical className="h-4 w-4" />
                        </div>
                        <div
                          className="min-w-0 flex-1 cursor-grab active:cursor-grabbing"
                          draggable
                          onDragStart={(e) => handleNativeDragStart(e, customer?.full_name || 'Cliente', sale.customer_id, sale.id)}
                          title="Arraste o nome até uma máquina"
                        >
                          <div className="flex items-center gap-2 flex-wrap font-semibold text-white">
                            {customer?.full_name || 'Cliente'}
                            <CustomerStatusBadge saleId={sale.id} />
                          </div>
                          <div className="mt-1 text-xs text-white/60">
                            {sale.itemsCount} item(ns)
                          </div>
                          <div className="mt-2">
                            <PaymentStatusBadge status={sale.paymentStatus} />
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-green-400">
                            R$ {Number(sale.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-xs font-mono text-white/40">
                            {formatBrasiliaTime(sale.time)}
                          </div>
                        </div>
                      </div>
                    )}
                  </Draggable>
                );
              }) : (
                <div className="py-8 text-center text-gray-500">Nenhuma venda gerada hoje.</div>
              )}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}