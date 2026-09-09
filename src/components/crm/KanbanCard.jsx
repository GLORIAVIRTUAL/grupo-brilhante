import React from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { motion } from 'framer-motion';
import { Clock, MessageSquare, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import CustomerSourceBadge from '@/components/crm/CustomerSourceBadge';

const formatBrasiliaDate = (value, includeYear = false) => {
  if (!value) return '';
  const normalizedValue = typeof value === 'string' && !/(Z|[+-]\d{2}:?\d{2})$/.test(value)
    ? `${value}Z`
    : value;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    ...(includeYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(normalizedValue)).replace(',', '');
};

export default function KanbanCard({ card, index, customer, onClick, onDeleteClick }) {
  const navigate = useNavigate();
  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'CRITICAL': return 'bg-red-500 text-white';
      case 'HIGH': return 'bg-orange-500 text-white';
      case 'MEDIUM': return 'bg-yellow-500 text-black';
      case 'LOW': return 'bg-blue-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  return (
    <Draggable draggableId={card.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="mb-3 group relative"
          style={provided.draggableProps.style}
        >
          <motion.div
            layoutId={card.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`bg-[#2a1b4e] p-4 rounded-xl border border-white/10 shadow-lg hover:border-[#FF6600]/50 transition-colors
              ${snapshot.isDragging ? 'shadow-2xl ring-2 ring-[#FF6600] rotate-2' : ''}
            `}
          >
            <div className="flex justify-between items-start mb-3">
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${getPriorityColor(card.priority)}`}>
                {card.priority}
              </span>
              {card.created_date && (
                <div className="flex items-center gap-1 text-[10px] text-gray-400" title="Horário de criação (Brasília)">
                  <Clock className="w-3 h-3" />
                  {formatBrasiliaDate(card.created_date)}
                </div>
              )}
            </div>

            <div className="mb-3">
              <CustomerSourceBadge source={card.customer_source} />
            </div>
            
            <div onClick={() => onClick(card)} className="cursor-pointer">
              <h4 className="font-semibold text-white mb-1 truncate hover:text-[#FF6600] transition-colors">
                {customer?.full_name || 'Cliente Desconhecido'}
              </h4>
            </div>

            {card.complaint_summary && (
              <div className="mb-3 p-2 bg-red-500/10 rounded-lg border border-red-500/20">
                <p className="text-xs text-red-200 line-clamp-3">"{card.complaint_summary}"</p>
              </div>
            )}

            {card.receipt_url && (
              <div className="mb-3">
                <a href={card.receipt_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="block group/receipt relative">
                  {card.receipt_url.toLowerCase().includes('.pdf') ? (
                    <div className="w-full h-24 bg-white/5 rounded-lg border border-white/10 flex flex-col items-center justify-center text-gray-400 hover:text-[#FF6600] transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round" className="mb-2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/></svg>
                      <span className="text-xs font-medium">Ver PDF</span>
                    </div>
                  ) : (
                    <div className="relative w-full h-24 rounded-lg border border-white/10 overflow-hidden bg-white/5 flex items-center justify-center">
                      <img 
                        src={card.receipt_url} 
                        alt="Comprovante" 
                        className="w-full h-full object-cover hover:opacity-80 transition-opacity" 
                        onError={(e) => {
                          e.target.style.display = 'none';
                          if (e.target.nextSibling) {
                            e.target.nextSibling.style.display = 'flex';
                          }
                        }}
                      />
                      <div className="absolute inset-0 flex-col items-center justify-center text-gray-400 hover:text-[#FF6600] transition-colors" style={{ display: 'none' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round" className="mb-2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                        <span className="text-xs font-medium text-center px-2">Ver Comprovante<br/>(Link Externo)</span>
                      </div>
                    </div>
                  )}
                </a>
              </div>
            )}
            
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/50 mb-3">
              <span className="truncate">ID: {card.id.slice(0,8)}</span>
              {card.created_date && (
                <>
                  <span>•</span>
                  <span className="truncate">{formatBrasiliaDate(card.created_date, true)}</span>
                </>
              )}
              {card.assigned_to && (
                <>
                  <span>•</span>
                  <span>{card.assigned_to}</span>
                </>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/5">
              <div className="flex -space-x-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 border border-[#2a1b4e] flex items-center justify-center text-[8px] font-bold text-white">
                  {customer?.full_name?.charAt(0) || '?'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); onDeleteClick && onDeleteClick(card.id); }}
                  className="text-white/40 hover:text-red-500 transition-colors"
                  title="Excluir card"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    if (card.customer_id) {
                        navigate(`/chat?customer_id=${card.customer_id}`);
                    }
                  }}
                  className="text-white/40 hover:text-[#FF6600] transition-colors"
                  title="Abrir chat"
                >
                  <MessageSquare className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </Draggable>
  );
}