import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ProductIcon from "@/components/ui/ProductIcon";
import { Label } from "@/components/ui/label";
import { 
  Loader2, 
  Package, 
  CheckCircle2, 
  Clock, 
  Truck, 
  CreditCard,
  MessageSquare
} from 'lucide-react';
import { format } from 'date-fns';

export default function OrderDetailsModal({ isOpen, onClose, card, customer }) {
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]); 
  const [loading, setLoading] = useState(true);
  const [notifying, setNotifying] = useState(false);
  const [paymentLink, setPaymentLink] = useState(null);
  const [generatingLink, setGeneratingLink] = useState(false);

  useEffect(() => {
    if (isOpen && card?.linked_order_id) {
      loadData();
    } else if (isOpen) {
        setLoading(false);
    }
  }, [isOpen, card]);

  const loadData = async () => {
    setLoading(true);
    try {
      const orderData = await base44.entities.Order.get(card.linked_order_id);
      setOrder(orderData);
      
      if (card.linked_quote_id) {
          const quoteData = await base44.entities.Quote.get(card.linked_quote_id);
          if (quoteData && quoteData.items) {
              setItems(quoteData.items);
          }
      }
      
    } catch (err) {
      console.error("Error loading order data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
      if (!order) return;
      try {
          await base44.entities.Order.update(order.id, { status: newStatus });
          setOrder({ ...order, status: newStatus });
          
          // Sync CRM Card if needed? 
          // The Kanban handles sync from drag, but this is manual.
          // Map status to stage
          const stageMap = {
              'pending': 'Recebido',
              'processing': 'Em processamento',
              'ready': 'Pronto',
              'delivered': 'Entregue',
              'finished': 'Finalizado'
          };
          if (stageMap[newStatus]) {
              await base44.entities.CrmCard.update(card.id, { stage: stageMap[newStatus] });
          }
      } catch (err) {
          console.error("Error updating status:", err);
      }
  };

  const handleNotifyReady = async () => {
      if (!customer?.phones?.[0]) return;
      setNotifying(true);
      try {
          let message = `Olá ${customer.full_name}! Seu pedido #${order.ticket_number || order.id.slice(0,4)} está PRONTO para retirada! 🧴✨\n\nVenha buscar quando quiser.`;
          
          if (paymentLink) {
              message += `\n\nPara facilitar, aqui está o link de pagamento: ${paymentLink}`;
          }

          await base44.functions.invoke('zapi_sender', {
              phone: customer.phones[0],
              message,
              customer_id: customer.id,
              unit_id: order.unit_id || customer.unit_id,
          });
          alert("Notificação enviada!");
      } catch (err) {
          console.error("Error notifying:", err);
          const code = err.response?.data?.code;
          alert(['ZAPI_NOT_CONFIGURED', 'INTERNAL_TOKEN_NOT_CONFIGURED'].includes(code)
              ? 'WhatsApp indisponível até a configuração da integração. O pedido não foi alterado.'
              : 'Não foi possível enviar a notificação. O pedido não foi alterado.');
      } finally {
          setNotifying(false);
      }
  };

  const handleGeneratePaymentLink = async () => {
      if (!order) return;
      
      if (paymentLink) {
          navigator.clipboard.writeText(paymentLink);
          alert("Link copiado para a área de transferência!");
          return;
      }

      setGeneratingLink(true);
      try {
          const res = await base44.functions.invoke('generate_payment_link', {
              amount: order.total_amount,
              customer_id: customer?.id,
              quote_id: order.id
          });
          
          if (res.data?.url) {
              setPaymentLink(res.data.url);
              // Copy to clipboard
              navigator.clipboard.writeText(res.data.url);
              alert("Link gerado e copiado para a área de transferência!");
          }
      } catch (err) {
          console.error("Error generating link:", err);
          alert("Erro ao gerar link.");
      } finally {
          setGeneratingLink(false);
      }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a0b36] border border-white/10 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
             <Package className="w-5 h-5 text-[#FF6600]" />
             Detalhes do Pedido
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin text-[#FF6600]" /></div>
        ) : !order ? (
          <div className="p-8 text-center text-gray-400">
             <p>Pedido não encontrado.</p>
          </div>
        ) : (
          <div className="space-y-6">
             {/* Header Info */}
             <div className="flex justify-between items-start bg-white/5 p-4 rounded-xl border border-white/5">
                <div>
                   <h3 className="font-bold text-lg">{customer?.full_name}</h3>
                   <span className="text-sm text-gray-400">Ticket: #{order.ticket_number || order.id.slice(0,4)}</span>
                </div>
                <div className="text-right">
                   <div className="text-xl font-bold text-[#FF6600]">R$ {order.total_amount?.toFixed(2)}</div>
                   <span className="text-xs text-gray-400">
                       {order.closed_at ? `Fechado em ${format(new Date(order.closed_at), 'dd/MM')}` : 'Em aberto'}
                   </span>
                </div>
             </div>

             {/* Items List */}
             {items.length > 0 && (
                 <div className="bg-white/5 rounded-xl border border-white/5 overflow-hidden">
                     <div className="px-4 py-2 bg-white/5 border-b border-white/5 text-xs font-semibold text-gray-400">
                         Itens do Pedido
                     </div>
                     <div className="divide-y divide-white/5">
                         {items.map((item, idx) => (
                             <div key={idx} className="p-3 flex justify-between items-center text-sm">
                                 <div className="flex items-center gap-3">
                                     <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center">
                                         <ProductIcon name={item.garment_type} className="w-4 h-4 text-gray-400" />
                                     </div>
                                     <div>
                                         <div className="font-medium">{item.garment_type}</div>
                                         <div className="text-xs text-gray-500">Qtd: {item.qty}</div>
                                     </div>
                                 </div>
                                 <div className="font-mono">
                                     R$ {(item.unit_price * item.qty).toFixed(2)}
                                 </div>
                             </div>
                         ))}
                     </div>
                     <div className="p-3 bg-black/20 flex justify-between items-center text-sm font-medium border-t border-white/5">
                         <span>Subtotal</span>
                         <span>R$ {items.reduce((acc, i) => acc + (i.unit_price * i.qty), 0).toFixed(2)}</span>
                     </div>
                 </div>
             )}

             {/* Status Control */}
             <div className="space-y-3">
                 <Label>Status Atual</Label>
                 <div className="grid grid-cols-3 gap-2">
                     {['pending', 'processing', 'ready'].map(s => (
                         <button
                            key={s}
                            onClick={() => handleStatusChange(s)}
                            className={`p-2 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1
                                ${order.status === s 
                                    ? 'bg-[#FF6600] border-[#FF6600] text-white' 
                                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                }`}
                         >
                             {s === 'pending' && <Clock className="w-4 h-4" />}
                             {s === 'processing' && <Loader2 className="w-4 h-4" />}
                             {s === 'ready' && <CheckCircle2 className="w-4 h-4" />}
                             <span className="capitalize">{s}</span>
                         </button>
                     ))}
                     {['delivered', 'finished'].map(s => (
                         <button
                            key={s}
                            onClick={() => handleStatusChange(s)}
                            className={`p-2 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1
                                ${order.status === s 
                                    ? 'bg-green-600 border-green-600 text-white' 
                                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                }`}
                         >
                             {s === 'delivered' && <Truck className="w-4 h-4" />}
                             {s === 'finished' && <CheckCircle2 className="w-4 h-4" />}
                             <span className="capitalize">{s}</span>
                         </button>
                     ))}
                 </div>
             </div>

             {/* Actions */}
             <div className="grid grid-cols-2 gap-3 pt-4 border-t border-white/10">
                 <Button 
                    variant="outline" 
                    className="bg-white/5 border-white/10 hover:bg-white/10 text-white gap-2"
                    onClick={handleNotifyReady}
                    disabled={notifying}
                 >
                    <MessageSquare className="w-4 h-4" />
                    {notifying ? 'Enviando...' : 'Avisar que está Pronto'}
                 </Button>
                 <Button 
                    className="bg-[#4C12A1] hover:bg-[#5d1dbf] text-white gap-2"
                    onClick={handleGeneratePaymentLink}
                    disabled={generatingLink}
                 >
                    {generatingLink ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                    {paymentLink ? 'Copiar Link Novamente' : 'Gerar Link Pagamento'}
                 </Button>
             </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="hover:bg-white/10 text-white">Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}