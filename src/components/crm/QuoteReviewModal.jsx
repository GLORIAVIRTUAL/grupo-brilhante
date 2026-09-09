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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ImageLightbox from "@/components/crm/ImageLightbox";
import GarmentReviewCard, { FALLBACK_CATALOG_OPTIONS } from "@/components/management/GarmentReviewCard";
import { 
  Loader2, 
  Plus, 
  Trash2, 
  Send, 
  AlertCircle,
  Calculator
} from 'lucide-react';

export default function QuoteReviewModal({ isOpen, onClose, card, customer }) {
  const [quote, setQuote] = useState(null);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [addition, setAddition] = useState(0);
  const [customMessage, setCustomMessage] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [zoomImage, setZoomImage] = useState(null);
  const [catalogEntries, setCatalogEntries] = useState([]);

  const catalogOptions = React.useMemo(() => {
    const byType = (type) => {
      const values = catalogEntries.filter((entry) => entry.catalog_type === type).map((entry) => entry.label).filter(Boolean);
      return values.length ? [...new Set(values)] : FALLBACK_CATALOG_OPTIONS[type];
    };
    return { brand: byType('brand'), size: byType('size'), damage: byType('damage'), color: byType('color'), pattern: byType('pattern'), material: byType('material') };
  }, [catalogEntries]);

  useEffect(() => {
    if (isOpen && card?.linked_quote_id) {
      loadData();
    } else if (isOpen) {
        setLoading(false); // No linked quote
    }
  }, [isOpen, card]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [quoteData, productsData, catalogData] = await Promise.all([
        base44.entities.Quote.get(card.linked_quote_id),
        base44.entities.Product.filter({ active: true }, 'name', 500),
        base44.entities.OperationalCatalogEntry.filter({ active: true }, 'sort_order', 2000).catch(() => [])
      ]);
      setQuote(quoteData);
      setItems(quoteData.items || []);
      setProducts(productsData);
      setCatalogEntries(catalogData);
      setDiscount(quoteData.discount || 0);
      setAddition(quoteData.addition || 0);
      setAdjustmentReason(quoteData.human_adjustments || '');
    } catch (err) {
      console.error("Error loading quote data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = () => {
    setItems([...items, { garment_type: '', qty: 1, unit_price: 0, notes: '' }]);
  };

  const handleRemoveItem = (index) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...items];
    const item = { ...newItems[index], [field]: value };

    // If changing product name, try to find price
    if (field === 'garment_type') {
        const product = products.find(p => p.name === value);
        if (product) {
            item.unit_price = product.price;
        }
    }

    newItems[index] = item;
    setItems(newItems);
  };

  const calculateTotal = () => {
    const subtotal = items.reduce((sum, item) => sum + ((item.qty ?? 1) * (item.unit_price || 0)), 0);
    return Math.max(0, subtotal - discount + addition);
  };

  const handleSendQuote = async () => {
    if (!quote) return;
    const discountValue = Number(discount || 0);
    const additionValue = Number(addition || 0);
    if ((discountValue > 0 || additionValue > 0) && adjustmentReason.trim().length < 8) {
      alert('Informe uma justificativa com pelo menos 8 caracteres para o ajuste comercial.');
      return;
    }
    setSending(true);
    try {
      const revisedResponse = await base44.functions.invoke('manage_quote_lifecycle', {
        action: 'revise',
        quote_id: quote.id,
        items,
        discount: discountValue,
        addition: additionValue,
        reason: adjustmentReason.trim(),
      });
      const revisedQuote = revisedResponse.data?.quote;
      const sentResponse = await base44.functions.invoke('manage_quote_lifecycle', {
        action: 'send',
        quote_id: revisedQuote?.id || quote.id,
      });
      const updatedQuote = sentResponse.data?.quote || revisedQuote;
      await base44.entities.CrmCard.update(card.id, {
        stage: 'Enviado ao cliente',
        priority: 'MEDIUM',
      });

      const pricedItems = updatedQuote?.items || items;
      const itemsList = pricedItems.map(i => `• ${i.qty ?? 1}x ${i.garment_type}: R$ ${Number(i.unit_price || 0).toFixed(2)}`).join('\n');
      let breakdown = `Subtotal: R$ ${Number(updatedQuote?.subtotal || 0).toFixed(2)}`;
      if (Number(updatedQuote?.discount || 0) > 0) breakdown += `\nDesconto: R$ ${Number(updatedQuote.discount).toFixed(2)}`;
      if (Number(updatedQuote?.addition || 0) > 0) breakdown += `\nAcréscimo: R$ ${Number(updatedQuote.addition).toFixed(2)}`;

      const message = `Olá ${customer.full_name}! Seu orçamento está pronto:

${itemsList}

${breakdown}
*Total: R$ ${Number(updatedQuote?.total || 0).toFixed(2)}*

${customMessage ? `${customMessage}\n\n` : ''}Para aprovar, responda "Aprovar".`;

      let notificationWarning = '';
      if (customer.phones?.[0]) {
        try {
          await base44.functions.invoke('zapi_sender', {
            phone: customer.phones[0],
            type: 'OPTION_LIST',
            message,
            customer_id: customer.id,
            unit_id: updatedQuote?.unit_id || quote.unit_id || customer.unit_id,
            optionList: {
              title: 'Aprovação do orçamento',
              buttonLabel: 'Abrir opções',
              options: [
                { id: 'approve_quote', title: 'Aprovar', description: 'Seguir com o orçamento' },
                { id: 'ask_human', title: 'Atendente', description: 'Falar com uma pessoa' },
              ],
            },
          });
        } catch (sendError) {
          console.error('Quote persisted but WhatsApp notification failed:', sendError);
          const sendCode = sendError.response?.data?.code;
          notificationWarning = ['ZAPI_NOT_CONFIGURED', 'INTERNAL_TOKEN_NOT_CONFIGURED'].includes(sendCode)
            ? 'Orçamento salvo e marcado como enviado, mas o WhatsApp está indisponível até a configuração da integração.'
            : 'Orçamento salvo e marcado como enviado, mas a notificação por WhatsApp falhou.';
        }
      }

      if (notificationWarning) alert(notificationWarning);
      onClose();
    } catch (err) {
      console.error("Error sending quote:", err);
      const code = err.response?.data?.error;
      const messages = {
        adjustment_reason_required: 'Informe uma justificativa válida para o ajuste.',
        commercial_approval_required: 'O ajuste excede sua alçada comercial.',
        mfa_required_for_adjustment: 'Este ajuste exige MFA verificado.',
      };
      alert(messages[code] || 'Não foi possível revisar e enviar o orçamento.');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a0b36] border border-white/10 text-white max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
             <Calculator className="w-5 h-5 text-[#FF6600]" />
             Revisão de Orçamento
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin text-[#FF6600]" /></div>
        ) : !quote ? (
          <div className="p-8 text-center text-gray-400">
             <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
             <p>Nenhum orçamento vinculado a este card.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
             {/* Customer Info */}
             <div className="bg-white/5 p-3 rounded-lg flex justify-between items-center text-sm">
                <div>
                   <span className="text-gray-400">Cliente:</span> <span className="font-bold">{customer?.full_name}</span>
                </div>
                <div>
                   <span className="text-gray-400">Status Atual:</span> <span className="bg-[#FF6600]/20 text-[#FF6600] px-2 py-0.5 rounded text-xs ml-2">{quote.status}</span>
                </div>
             </div>

             {/* Items List */}
             <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-2">
                   <Label>Itens do Pedido</Label>
                   <Button size="sm" variant="ghost" onClick={handleAddItem} className="h-8 text-[#FF6600] hover:text-white hover:bg-[#FF6600]/20">
                      <Plus className="w-4 h-4 mr-1" /> Adicionar Item
                   </Button>
                </div>

                <div className="flex-1 overflow-y-auto bg-black/20 rounded-lg border border-white/10 p-3 pr-4 space-y-3">
                   {items.map((item, index) => (
                      <div key={item.line_id || index} className="relative">
                         <GarmentReviewCard
                            item={item}
                            index={index}
                            products={products}
                            catalogOptions={catalogOptions}
                            onImageClick={setZoomImage}
                            onChange={(next) => setItems((current) => current.map((candidate, i) => (i === index ? next : candidate)))}
                         />
                         <button
                            type="button"
                            onClick={() => handleRemoveItem(index)}
                            className="absolute top-3 right-3 text-red-400 hover:text-red-300"
                            title="Remover item"
                         >
                            <Trash2 className="w-4 h-4" />
                         </button>
                      </div>
                   ))}
                </div>
             </div>

             {/* Totals */}
             <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="flex justify-between items-center text-sm">
                   <span className="text-gray-400">Subtotal:</span>
                   <span>R$ {items.reduce((sum, item) => sum + ((item.qty ?? 1) * (item.unit_price || 0)), 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                   <span className="text-gray-400">Desconto:</span>
                   <div className="w-24">
                      <Input 
                         type="number"
                         value={discount}
                         onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                         className="h-7 text-right bg-white/5 border-white/10 text-sm"
                      />
                   </div>
                </div>
                <div className="flex justify-between items-center text-sm">
                   <span className="text-gray-400">Acréscimo:</span>
                   <div className="w-24">
                      <Input 
                         type="number"
                         value={addition}
                         onChange={(e) => setAddition(parseFloat(e.target.value) || 0)}
                         className="h-7 text-right bg-white/5 border-white/10 text-sm"
                      />
                   </div>
                </div>

                {(Number(discount || 0) > 0 || Number(addition || 0) > 0) && (
                  <div className="pt-2">
                    <Label className="text-xs text-gray-400">Justificativa do ajuste comercial:</Label>
                    <Input
                      value={adjustmentReason}
                      onChange={(e) => setAdjustmentReason(e.target.value)}
                      placeholder="Motivo do desconto ou acréscimo"
                      className="mt-1 bg-white/5 border-white/10 text-sm"
                    />
                  </div>
                )}

                <div className="pt-2">
                    <Label className="text-xs text-gray-400">Mensagem adicional (opcional):</Label>
                    <Textarea 
                        value={customMessage}
                        onChange={(e) => setCustomMessage(e.target.value)}
                        placeholder="Ex: Conseguimos um desconto especial nas peças..."
                        className="bg-white/5 border-white/10 text-sm mt-1 min-h-[60px] resize-none"
                    />
                </div>

                <div className="flex justify-between items-center text-lg font-bold text-[#FF6600] pt-2 border-t border-white/10">
                   <span>Total Final:</span>
                   <span>R$ {calculateTotal().toFixed(2)}</span>
                </div>
             </div>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose} className="hover:bg-white/10 text-white">Cancelar</Button>
          <Button 
            onClick={handleSendQuote} 
            disabled={loading || sending || !quote}
            className="bg-[#4C12A1] hover:bg-[#5d1dbf] text-white"
          >
            {sending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Enviar Orçamento
          </Button>
        </DialogFooter>
        <ImageLightbox url={zoomImage} onClose={() => setZoomImage(null)} />
      </DialogContent>
    </Dialog>
  );
}