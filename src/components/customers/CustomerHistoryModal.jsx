import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { format } from 'date-fns';
import { 
  ShoppingBag, 
  FileText, 
  MessageSquare, 
  Clock, 
  CheckCircle2, 
  AlertCircle
} from 'lucide-react';

export default function CustomerHistoryModal({ customer, isOpen, onClose }) {
  const [orders, setOrders] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (customer && isOpen) {
      loadHistory();
    }
  }, [customer, isOpen]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const [ordersData, quotesData, convData] = await Promise.all([
        base44.entities.Order.filter({ customer_id: customer.id }, '-created_date', 20),
        base44.entities.Quote.filter({ customer_id: customer.id }, '-created_date', 20),
        base44.entities.Conversation.filter({ customer_id: customer.id }, '-last_message_at', 10)
      ]);
      setOrders(ordersData);
      setQuotes(quotesData);
      setConversations(convData);
    } catch (err) {
      console.error("Error loading history:", err);
    } finally {
      setLoading(false);
    }
  };

  const StatusBadge = ({ status }) => {
    const colors = {
      pending: "bg-yellow-500/10 text-yellow-500",
      processing: "bg-blue-500/10 text-blue-500",
      ready: "bg-purple-500/10 text-purple-500",
      delivered: "bg-green-500/10 text-green-500",
      finished: "bg-green-500/10 text-green-500",
      cancelled: "bg-red-500/10 text-red-500",
      // Quotes
      DRAFT: "bg-gray-500/10 text-gray-500",
      SENT: "bg-blue-500/10 text-blue-500",
      ACCEPTED: "bg-green-500/10 text-green-500",
      REJECTED: "bg-red-500/10 text-red-500",
      HUMAN_REVIEW: "bg-orange-500/10 text-orange-500"
    };
    return (
      <Badge className={`${colors[status] || "bg-gray-500/10 text-gray-500"} border-0 capitalize`}>
        {status}
      </Badge>
    );
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a0b36] border border-white/10 text-white max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-2xl">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6600] to-orange-600 flex items-center justify-center text-lg font-bold">
              {customer?.full_name?.charAt(0)}
            </div>
            <div>
              <div>{customer?.full_name}</div>
              <div className="text-sm font-normal text-gray-400 font-mono">
                {customer?.phones?.[0]}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="orders" className="flex-1 flex flex-col mt-4">
          <TabsList className="bg-white/5 border border-white/5 w-full justify-start">
            <TabsTrigger value="orders" className="data-[state=active]:bg-[#FF6600]">
              <ShoppingBag className="w-4 h-4 mr-2" /> Pedidos ({orders.length})
            </TabsTrigger>
            <TabsTrigger value="quotes" className="data-[state=active]:bg-[#FF6600]">
              <FileText className="w-4 h-4 mr-2" /> Orçamentos ({quotes.length})
            </TabsTrigger>
            <TabsTrigger value="conversations" className="data-[state=active]:bg-[#FF6600]">
              <MessageSquare className="w-4 h-4 mr-2" /> Conversas ({conversations.length})
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 mt-4 overflow-hidden relative">
             <ScrollArea className="h-full pr-4">
                {loading ? (
                  <div className="text-center py-10 text-gray-500">Carregando...</div>
                ) : (
                  <>
                    <TabsContent value="orders" className="space-y-3 m-0">
                      {orders.length === 0 ? <p className="text-gray-500">Nenhum pedido encontrado.</p> : 
                        orders.map(order => (
                          <div key={order.id} className="bg-white/5 p-4 rounded-xl border border-white/5 flex justify-between items-center">
                             <div>
                               <div className="font-bold flex items-center gap-2">
                                  #{order.ticket_number || order.id.slice(0,6)}
                                  <StatusBadge status={order.status} />
                               </div>
                               <div className="text-sm text-gray-400 mt-1">
                                  {order.created_date ? format(new Date(order.created_date), "dd/MM/yyyy HH:mm") : '-'}
                               </div>
                             </div>
                             <div className="text-right">
                               <div className="text-lg font-bold text-[#FF6600]">
                                 R$ {order.total_amount?.toFixed(2)}
                               </div>
                               {order.closed_at && <div className="text-xs text-green-500 flex items-center justify-end gap-1"><CheckCircle2 className="w-3 h-3"/> Fechado</div>}
                             </div>
                          </div>
                        ))
                      }
                    </TabsContent>

                    <TabsContent value="quotes" className="space-y-3 m-0">
                      {quotes.length === 0 ? <p className="text-gray-500">Nenhum orçamento encontrado.</p> :
                        quotes.map(quote => (
                          <div key={quote.id} className="bg-white/5 p-4 rounded-xl border border-white/5 flex justify-between items-center">
                             <div>
                               <div className="font-bold flex items-center gap-2">
                                  Orçamento
                                  <StatusBadge status={quote.status} />
                               </div>
                               <div className="text-sm text-gray-400 mt-1">
                                  {quote.items?.length || 0} itens • {quote.created_date ? format(new Date(quote.created_date), "dd/MM/yyyy HH:mm") : '-'}
                               </div>
                             </div>
                             <div className="text-right">
                               <div className="text-lg font-bold text-white">
                                 R$ {quote.total?.toFixed(2)}
                               </div>
                             </div>
                          </div>
                        ))
                      }
                    </TabsContent>

                    <TabsContent value="conversations" className="space-y-3 m-0">
                      {conversations.length === 0 ? <p className="text-gray-500">Nenhuma conversa encontrada.</p> :
                        conversations.map(conv => (
                          <div key={conv.id} className="bg-white/5 p-4 rounded-xl border border-white/5 flex justify-between items-center">
                             <div className="flex items-center gap-3">
                               <div className="p-2 bg-green-500/10 rounded-lg">
                                 <MessageSquare className="w-5 h-5 text-green-500" />
                               </div>
                               <div>
                                  <div className="font-medium text-sm">WhatsApp</div>
                                  <div className="text-xs text-gray-400">
                                    Última msg: {conv.last_message_at ? format(new Date(conv.last_message_at), "dd/MM HH:mm") : '-'}
                                  </div>
                               </div>
                             </div>
                             <Badge variant="outline" className="border-white/10 text-gray-300">
                                {conv.status}
                             </Badge>
                          </div>
                        ))
                      }
                    </TabsContent>
                  </>
                )}
             </ScrollArea>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}