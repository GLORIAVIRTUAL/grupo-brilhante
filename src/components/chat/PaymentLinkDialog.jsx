import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { base44 } from '@/api/base44Client';
import { Loader2, CreditCard, QrCode, Send, AlertCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function PaymentLinkDialog({ isOpen, onClose, customer, onSendLink }) {
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [billingType, setBillingType] = useState('pix');
  const [generating, setGenerating] = useState(false);
  const [paymentResult, setPaymentResult] = useState(null);

  useEffect(() => {
    if (isOpen && customer?.id) {
      loadOrders();
    }
    if (!isOpen) {
      setSelectedOrderId('');
      setPaymentResult(null);
      setBillingType('pix');
    }
  }, [isOpen, customer?.id]);

  const loadOrders = async () => {
    setLoadingOrders(true);
    try {
      const result = await base44.entities.Order.filter({ customer_id: customer.id }, '-created_date', 20);
      // Only show orders with an open balance
      const openOrders = (result || []).filter((o) => {
        const open = Number(o.total_amount || 0) - Number(o.paid_amount || 0);
        return open > 0.01 && !['cancelled', 'delivered', 'finished'].includes(o.status);
      });
      setOrders(openOrders);
      if (openOrders.length > 0) setSelectedOrderId(openOrders[0].id);
    } catch (err) {
      console.error('Error loading orders', err);
      toast.error('Não foi possível carregar os pedidos do cliente.');
    } finally {
      setLoadingOrders(false);
    }
  };

  const selectedOrder = orders.find((o) => o.id === selectedOrderId);
  const openAmount = selectedOrder ? Math.max(0, Number(selectedOrder.total_amount || 0) - Number(selectedOrder.paid_amount || 0)) : 0;

  const handleGenerate = async () => {
    if (!selectedOrderId) {
      toast.error('Selecione um pedido.');
      return;
    }
    setGenerating(true);
    setPaymentResult(null);
    try {
      const response = await base44.functions.invoke('generate_payment_link', {
        order_id: selectedOrderId,
        billing_type: billingType,
      });
      // base44.functions.invoke retorna o objeto direto (sem wrapper .data)
      const result = response?.data || response;
      if (result?.status === 'pending_verification') {
        toast.warning('Verificação pendente', { description: result.message || 'A cobrança pode ter sido criada. Verifique antes de repetir.' });
        return;
      }
      if (!result?.url && !result?.pix_qr_code) throw new Error(result?.message || 'no_url_returned');
      setPaymentResult(result);
      toast.success(result?.pix_qr_code ? 'Pix gerado!' : 'Link de pagamento gerado!');
    } catch (err) {
      console.error(err);
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível gerar o link.';
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!paymentResult || !onSendLink) return;
    const label = billingType === 'pix' ? 'Pix' : 'Cartão de Crédito';
    let message = `💳 *Pagamento via ${label}*\n\nOlá! Você pode pagar seu pedido de R$ ${openAmount.toFixed(2)} `;
    if (paymentResult.pix_copy_paste_key) {
      message += `usando o Pix Copia e Cola abaixo:\n\n${paymentResult.pix_copy_paste_key}\n\nApós o pagamento, seu pedido será confirmado automaticamente. 🧺`;
    } else if (paymentResult.url) {
      message += `clicando no link seguro abaixo:\n\n${paymentResult.url}\n\nApós o pagamento, seu pedido será confirmado automaticamente. 🧺`;
    }
    await onSendLink(message);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a0b36] border border-white/10 text-white max-w-md">
        <DialogTitle className="text-xl flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-[#FF6600]" />
          Gerar Link de Pagamento
        </DialogTitle>
        <DialogDescription className="text-gray-400">
          Gere um link Asaas e envie na conversa para o cliente pagar antecipadamente.
        </DialogDescription>

        <div className="space-y-4 mt-4">
          {/* Order selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Pedido</label>
            {loadingOrders ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando pedidos...
              </div>
            ) : orders.length === 0 ? (
              <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-200">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Nenhum pedido com saldo em aberto encontrado para este cliente.</span>
              </div>
            ) : (
              <select
                value={selectedOrderId}
                onChange={(e) => { setSelectedOrderId(e.target.value); setPaymentResult(null); }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:border-[#FF6600]/50 focus:outline-none"
                style={{ colorScheme: 'dark' }}
              >
                {orders.map((o) => {
                  const open = Math.max(0, Number(o.total_amount || 0) - Number(o.paid_amount || 0));
                  return (
                    <option key={o.id} value={o.id}>
                      {o.ticket_number || o.id.slice(0, 8)} — R$ {open.toFixed(2)} em aberto
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Billing type selection */}
          {orders.length > 0 && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Forma de pagamento</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setBillingType('pix'); setPaymentResult(null); }}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${
                      billingType === 'pix'
                      ? 'bg-[#FF6600]/20 border-[#FF6600] text-white'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    <QrCode className="w-5 h-5 mb-1" />
                    <span className="text-xs">Pix</span>
                  </button>
                  <button
                    onClick={() => { setBillingType('credit_card'); setPaymentResult(null); }}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${
                      billingType === 'credit_card'
                      ? 'bg-[#FF6600]/20 border-[#FF6600] text-white'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    <CreditCard className="w-5 h-5 mb-1" />
                    <span className="text-xs">Cartão de Crédito</span>
                  </button>
                </div>
              </div>

              {selectedOrder && (
                <div className="bg-white/5 rounded-lg p-3 border border-white/10 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total do pedido</span>
                    <span className="font-medium">R$ {Number(selectedOrder.total_amount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-gray-400">Pago</span>
                    <span className="font-medium text-green-400">R$ {Number(selectedOrder.paid_amount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between mt-1 pt-1 border-t border-white/10">
                    <span className="text-gray-300 font-medium">Em aberto</span>
                    <span className="font-bold text-[#FF6600]">R$ {openAmount.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {!paymentResult ? (
                <Button
                  onClick={handleGenerate}
                  disabled={generating || !selectedOrderId}
                  className="w-full bg-[#FF6600] hover:bg-[#ff7b24] gap-2"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                  {generating ? 'Gerando...' : 'Gerar Link'}
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm text-green-200">
                    ✅ {paymentResult.pix_qr_code ? 'Pix gerado!' : 'Link gerado!'} Clique abaixo para enviar na conversa.
                  </div>

                  {paymentResult.pix_qr_code && (
                    <div className="flex flex-col items-center gap-2">
                      <img
                        src={paymentResult.pix_qr_code.startsWith('data:')
                          ? paymentResult.pix_qr_code
                          : `data:image/png;base64,${paymentResult.pix_qr_code}`}
                        alt="QR Code Pix"
                        className="w-44 h-44 rounded-lg bg-white p-2"
                      />
                      <p className="text-xs text-gray-400">Escaneie o QR Code acima</p>
                    </div>
                  )}

                  {paymentResult.pix_copy_paste_key && (
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400">Código Pix Copia e Cola</label>
                      <div className="flex gap-2">
                        <input
                          readOnly
                          value={paymentResult.pix_copy_paste_key}
                          className="flex-1 bg-black/30 border border-white/10 rounded-lg px-2 py-2 text-xs font-mono text-white"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            navigator.clipboard.writeText(paymentResult.pix_copy_paste_key);
                            toast.success('Código Pix copiado!');
                          }}
                          className="px-3"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {paymentResult.url && !paymentResult.pix_qr_code && (
                    <div className="bg-black/20 border border-white/10 rounded-lg p-2 text-xs text-gray-400 break-all max-h-20 overflow-y-auto">
                      {paymentResult.url}
                    </div>
                  )}

                  <Button
                    onClick={handleSend}
                    className="w-full bg-green-600 hover:bg-green-700 gap-2"
                  >
                    <Send className="w-4 h-4" /> Enviar na Conversa
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}