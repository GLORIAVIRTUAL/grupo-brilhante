import React from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Truck, MapPin, GripVertical, CheckCircle, Receipt, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getBrasiliaTimeParts } from '@/lib/pickupDateTime';
import { Button } from '@/components/ui/button';
import CustomerStatusBadge from '@/components/dashboard/CustomerStatusBadge';

export default function TodayPickupsColumn({ pickups, customerMap, timesByCustomer = {}, onReorder, onGenerateTicket }) {
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
    const reordered = Array.from(pickups);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    onReorder(reordered);
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
      <div className="mb-5 flex items-center gap-2">
        <Truck className="h-5 w-5 text-[#FF6600]" />
        <h3 className="text-lg font-bold text-white">Coletas de Hoje</h3>
        <span className="ml-auto rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/60">
          {pickups.length}
        </span>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="today-pickups">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-3">
              {pickups.length > 0 ? pickups.map((pickup, index) => {
                const customer = customerMap[pickup.customer_id];
                return (
                  <Draggable key={pickup.id} draggableId={pickup.id} index={index}>
                    {(drag, snapshot) => (
                      <div
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        className={cn(
                          'flex items-start gap-3 rounded-2xl border border-white/5 bg-white/5 p-4 transition-colors hover:bg-white/10',
                          snapshot.isDragging && 'ring-2 ring-[#FF6600] shadow-2xl'
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
                          onDragStart={(e) => handleNativeDragStart(e, customer?.full_name || 'Cliente', pickup.customer_id, pickup.id)}
                          title="Arraste o nome até uma máquina"
                        >
                          <div className="flex items-center gap-2 flex-wrap font-semibold text-white">
                            {customer?.full_name || 'Cliente'}
                            {pickup.status === 'completed' && <CheckCircle className="h-4 w-4 text-green-500" />}
                            <CustomerStatusBadge saleId={pickup.id} />
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-white/60">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">{pickup.address}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="text-right text-xs font-mono text-white/40">
                            {(() => { const { hour, minute } = getBrasiliaTimeParts(pickup.scheduled_at); return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`; })()}
                          </div>
                          {pickup.ticket_generated ? (
                            <div className="flex items-center gap-1 rounded-md bg-green-500/20 border border-green-500/40 text-green-300 text-xs font-semibold px-2 h-7">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Ticket gerado
                            </div>
                          ) : onGenerateTicket && (
                            <Button
                              size="sm"
                              className="h-7 gap-1 bg-[#FF6600] hover:bg-[#e55c00] text-white text-xs px-2"
                              title="Gerar Ticket / Orçamento"
                              onClick={() => onGenerateTicket(pickup)}
                            >
                              <Receipt className="w-3.5 h-3.5" /> Gerar Ticket
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </Draggable>
                );
              }) : (
                <div className="py-8 text-center text-gray-500">Nenhuma coleta agendada para hoje.</div>
              )}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}