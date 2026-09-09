import React from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { MoreHorizontal, Plus } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import KanbanCard from './KanbanCard';

export default function KanbanColumn({ columnId, cards, customers, onCardClick, onAddClick, onDeleteClick }) {
  return (
    <div className="w-80 flex flex-col h-full shrink-0">
      {/* Column Header */}
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-white/90 text-sm uppercase tracking-wider">{columnId}</h3>
          <span className="bg-white/10 px-2 py-0.5 rounded-full text-xs text-white/60 font-mono">
            {cards.length}
          </span>
        </div>
        <button className="text-white/40 hover:text-white transition-colors">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Droppable Area */}
      <Droppable droppableId={columnId}>
        {(provided, snapshot) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef}
            className={`flex-1 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-3 transition-colors overflow-y-auto custom-scrollbar
              ${snapshot.isDraggingOver ? 'bg-white/10 border-[#FF6600]/30' : ''}
            `}
          >
            <AnimatePresence>
              {cards.map((card, index) => (
                <KanbanCard 
                  key={card.id} 
                  card={card} 
                  index={index} 
                  customer={customers[card.customer_id]} 
                  onClick={onCardClick}
                  onDeleteClick={onDeleteClick}
                />
              ))}
            </AnimatePresence>
            {provided.placeholder}
            
            <button 
              onClick={() => onAddClick && onAddClick(columnId)}
              className="w-full py-2 mt-2 flex items-center justify-center gap-2 text-white/30 hover:text-white hover:bg-white/5 rounded-lg border border-dashed border-white/10 transition-all text-sm"
            >
              <Plus className="w-4 h-4" /> Adicionar
            </button>
          </div>
        )}
      </Droppable>
    </div>
  );
}