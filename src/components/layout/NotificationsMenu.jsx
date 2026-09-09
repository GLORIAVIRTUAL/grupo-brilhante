import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { 
  Bell, 
  Check, 
  Trash2, 
  AlertTriangle, 
  Info, 
  MessageCircle,
  Clock
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { format } from 'date-fns';

export default function NotificationsMenu() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    loadNotifications();

    // Subscribe to new notifications
    const unsub = base44.entities.StaffNotification.subscribe((event) => {
        if (event.type === 'create') {
            setNotifications(prev => [event.data, ...prev]);
            setUnreadCount(prev => prev + 1);
        }
    });

    return () => unsub();
  }, []);

  const loadNotifications = async () => {
    try {
        const list = await base44.entities.StaffNotification.list('-sent_at', 20);
        setNotifications(list);
        setUnreadCount(list.filter(n => !n.ack_at).length);
    } catch (err) {
        console.error("Error loading notifications:", err);
    }
  };

  const markAsRead = async (id) => {
      try {
          await base44.entities.StaffNotification.update(id, { ack_at: new Date().toISOString() });
          setNotifications(prev => prev.map(n => n.id === id ? { ...n, ack_at: new Date().toISOString() } : n));
          setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (err) {
          console.error("Error marking as read:", err);
      }
  };

  const markAllRead = async () => {
      // In a real app, bulk update or loop. MVP loop.
      const unread = notifications.filter(n => !n.ack_at);
      for (const n of unread) {
          await markAsRead(n.id);
      }
  };

  const getIcon = (type) => {
      switch (type) {
          case 'NEW_QUOTE': return <MessageCircle className="w-4 h-4 text-blue-400" />;
          case 'SLA_BREACH': return <Clock className="w-4 h-4 text-red-500" />;
          case 'COMPLAINT': return <AlertTriangle className="w-4 h-4 text-orange-500" />;
          case 'SYSTEM_ERROR': return <AlertTriangle className="w-4 h-4 text-red-500" />;
          default: return <Info className="w-4 h-4 text-gray-400" />;
      }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="relative p-2 hover:bg-white/10 rounded-full h-10 w-10">
           <Bell className={`w-5 h-5 ${unreadCount > 0 ? 'text-white' : 'text-gray-400'}`} />
           {unreadCount > 0 && (
               <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
           )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 bg-[#1a0b36] border border-white/10 text-white shadow-xl">
         <div className="flex items-center justify-between p-3 border-b border-white/10 bg-white/5">
             <h4 className="font-semibold text-sm">Notificações</h4>
             {unreadCount > 0 && (
                 <button onClick={markAllRead} className="text-xs text-[#FF6600] hover:text-white transition-colors">
                     Marcar todas como lidas
                 </button>
             )}
         </div>
         <ScrollArea className="h-[300px]">
             {notifications.length === 0 ? (
                 <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm p-4">
                     <Bell className="w-8 h-8 mb-2 opacity-20" />
                     Nenhuma notificação recente
                 </div>
             ) : (
                 <div className="divide-y divide-white/5">
                     {notifications.map((n) => (
                         <div 
                            key={n.id} 
                            className={`p-3 hover:bg-white/5 transition-colors flex gap-3 ${!n.ack_at ? 'bg-white/[0.02]' : 'opacity-60'}`}
                         >
                             <div className="mt-1 flex-shrink-0">
                                 {getIcon(n.type)}
                             </div>
                             <div className="flex-1 space-y-1">
                                 <p className="text-sm font-medium leading-none">
                                     {n.type === 'NEW_QUOTE' && 'Novo Orçamento'}
                                     {n.type === 'SLA_BREACH' && 'Alerta de Prazo'}
                                     {n.type === 'COMPLAINT' && 'Nova Reclamação'}
                                     {n.type === 'SYSTEM_ERROR' && 'Erro no Sistema'}
                                 </p>
                                 <p className="text-xs text-gray-400">
                                     {n.payload ? JSON.stringify(n.payload).slice(0, 50) : 'Detalhes indisponíveis'}
                                     {/* Better payload parsing would be good */}
                                 </p>
                                 <div className="flex items-center justify-between mt-2">
                                     <span className="text-[10px] text-gray-500">{format(new Date(n.sent_at), 'HH:mm dd/MM')}</span>
                                     {!n.ack_at && (
                                         <button onClick={() => markAsRead(n.id)} className="text-[10px] text-blue-400 hover:text-blue-300">
                                             Marcar lida
                                         </button>
                                     )}
                                 </div>
                             </div>
                         </div>
                     ))}
                 </div>
             )}
         </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}