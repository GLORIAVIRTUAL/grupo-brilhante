import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { base44 } from '@/api/base44Client';
import { Loader2, Search, Plus, Minus, ShoppingCart, User, CreditCard, CheckCircle2, ArrowRight, ArrowLeft, Shirt, DollarSign, Copy, Send } from 'lucide-react';
import ProductIcon from '@/components/ui/ProductIcon';
import TimeField from '@/components/management/TimeField';
import { toast } from 'sonner';
import ManualGarmentCharacteristics from './ManualGarmentCharacteristics';

export default function AdvancedQuoteModal({ isOpen, onClose, pipeline, stage, unitId, onSuccess, skipLinkStep = false }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [createdOrder, setCreatedOrder] = useState(null);
  const [paymentLinkResult, setPaymentLinkResult] = useState(null);
  const [products, setProducts] = useState([]);
  const [laundryServices, setLaundryServices] = useState([]);
  const [pricingPieceId, setPricingPieceId] = useState(null);
  const [categories, setCategories] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Form Data
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState(null);
  const [allCustomers, setAllCustomers] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cart, setCart] = useState([]); // Resumo agregado para seleção e preço
  const [garmentItems, setGarmentItems] = useState([]); // Uma entrada para cada peça física
  const [activeGarmentId, setActiveGarmentId] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [paymentMethod, setPaymentMethod] = useState('cash'); // cash, pix, credit_card, machine
  const [machineType, setMachineType] = useState('debit'); // debit, credit (quando machine)
  const [installments, setInstallments] = useState(1); // parcelas quando crédito
  const [cardBrandId, setCardBrandId] = useState(''); // bandeira selecionada na maquininha
  const [cardFees, setCardFees] = useState([]);
  const [times, setTimes] = useState({ wash_time: '', dry_time: '', dry_clean_time: '', iron_time: '' });

  useEffect(() => {
    if (isOpen) {
      fetchProducts();
      setStep(1);
      setCart([]);
      setGarmentItems([]);
      setLaundryServices([]);
      setPricingPieceId(null);
      setActiveGarmentId('');
      setPaymentReceived(false);
      setCreatedOrder(null);
      setPaymentLinkResult(null);
      setCustomerPhone('');
      setCustomerName('');
      setCustomerId(null);
      setPriority('MEDIUM');
      setPaymentMethod('cash');
      setMachineType('debit');
      setInstallments(1);
      setCardBrandId('');
      setTimes({ wash_time: '', dry_time: '', dry_clean_time: '', iron_time: '' });
      base44.entities.CardFee.filter({ active: true }, '-created_date', 200)
        .then(setCardFees).catch(() => setCardFees([]));
    }
  }, [isOpen]);

  // Initial Data Injection
  useEffect(() => {
    // Check for props first (if I added them) or window global
    const initData = window.initialQuoteData;
    if (isOpen && initData) {
        if (initData.phone) {
            setCustomerPhone(initData.phone);
            // Don't auto search if we have ID, just set it
        }
        if (initData.name) {
            setCustomerName(initData.name);
        }
        if (initData.id) {
            setCustomerId(initData.id);
        }
        // If we have phone but no ID, search
        if (initData.phone && !initData.id) {
             handlePhoneSearch(initData.phone);
        }
        
        window.initialQuoteData = null;
    }
  }, [isOpen]);

  const fetchProducts = async () => {
    try {
      const [productResult, serviceResult] = await Promise.allSettled([
        base44.entities.Product.list(),
        base44.entities.LaundryService.filter({ active: true }, 'name', 500),
      ]);
      const items = productResult.status === 'fulfilled' ? productResult.value : [];
      const services = serviceResult.status === 'fulfilled' ? serviceResult.value : [];
      setProducts(items);
      setLaundryServices(services);
      const cats = [...new Set(items.map(p => p.category || 'Outros'))];
      setCategories(cats);
      if (productResult.status === 'rejected') throw productResult.reason;
    } catch (err) {
      console.error("Error fetching products", err);
      toast.error('Não foi possível carregar o catálogo de peças.');
    }
  };

  // Load ALL customers once for autocomplete (paginated to fetch every record)
  useEffect(() => {
    if (isOpen && allCustomers.length === 0) {
      (async () => {
        try {
          const all = [];
          const pageSize = 500;
          let skip = 0;
          while (true) {
            const batch = await base44.entities.Customer.list('-created_date', pageSize, skip);
            if (!batch || batch.length === 0) break;
            all.push(...batch);
            if (batch.length < pageSize) break;
            skip += pageSize;
          }
          setAllCustomers(all);
        } catch (e) {
          console.error('Error loading customers', e);
        }
      })();
    }
  }, [isOpen]);

  const selectCustomer = (cust) => {
    setCustomerId(cust.id);
    setCustomerName(cust.full_name || '');
    setCustomerPhone((cust.phones && cust.phones[0]) || '');
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handlePhoneSearch = async (phone) => {
    setCustomerPhone(phone);
    setCustomerId(null);
    const clean = phone.replace(/\D/g, '');
    if (clean.length >= 3) {
      const matches = allCustomers.filter((c) =>
        (c.phones || []).some((p) => (p || '').replace(/\D/g, '').includes(clean))
      ).slice(0, 6);
      setSuggestions(matches);
      setShowSuggestions(matches.length > 0);
      const exact = allCustomers.find((c) => (c.phones || []).some((p) => (p || '').replace(/\D/g, '') === clean));
      if (exact) {
        setCustomerName(exact.full_name);
        setCustomerId(exact.id);
      }
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  const handleNameSearch = (name) => {
    setCustomerName(name);
    setCustomerId(null);
    if (name.length >= 2) {
      const matches = allCustomers.filter((c) =>
        (c.full_name || '').toLowerCase().includes(name.toLowerCase())
      ).slice(0, 6);
      setSuggestions(matches);
      setShowSuggestions(matches.length > 0);
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  const createManualGarment = (product, template = {}) => ({
    line_id: crypto.randomUUID(),
    product_id: product.id,
    garment_type: product.name,
    unit_price: Number(product.price || 0),
    attributes: {
      color: '',
      brand: '',
      pattern: '',
      size: '',
      material: '',
      ...(template.attributes || {}),
      freeform: { ...(template.attributes?.freeform || {}) }
    },
    damages: [],
    risk_tags: [...(product.risk_tags || [])],
    notes: product.description || '',
    customer_authorized_risks: false,
    condition_checked: false,
    image_ids: [],
    document_asset_ids: [],
    services: template.services?.length
      ? template.services.map((service) => ({ ...service }))
      : (product.default_service_ids || []).map((serviceId) => ({ service_id: serviceId, quantity: 1 })),
    confidence: 1,
    recognition_status: 'manual'
  });

  const addToCart = (product) => {
    const piece = createManualGarment(product);
    setGarmentItems((current) => [...current, piece]);
    setActiveGarmentId(piece.line_id);
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      return existing
        ? current.map((item) => item.product.id === product.id ? { ...item, qty: item.qty + 1 } : item)
        : [...current, { product, qty: 1 }];
    });
  };

  const removeFromCart = (productId) => {
    setCart((current) => current.filter((item) => item.product.id !== productId));
    setGarmentItems((current) => {
      const remaining = current.filter((piece) => piece.product_id !== productId);
      if (!remaining.some((piece) => piece.line_id === activeGarmentId)) setActiveGarmentId(remaining[0]?.line_id || '');
      return remaining;
    });
  };

  const updateQty = (productId, delta) => {
    const cartItem = cart.find((item) => item.product.id === productId);
    if (!cartItem) return;

    if (delta > 0) {
      const template = [...garmentItems].reverse().find((piece) => piece.product_id === productId);
      const piece = createManualGarment(cartItem.product, template);
      setGarmentItems((current) => [...current, piece]);
      setActiveGarmentId(piece.line_id);
      setCart((current) => current.map((item) => item.product.id === productId ? { ...item, qty: item.qty + 1 } : item));
      return;
    }

    if (cartItem.qty <= 1) {
      removeFromCart(productId);
      return;
    }

    const matching = garmentItems.filter((piece) => piece.product_id === productId);
    const removed = matching[matching.length - 1];
    setGarmentItems((current) => current.filter((piece) => piece.line_id !== removed?.line_id));
    if (removed?.line_id === activeGarmentId) {
      const replacementPiece = matching[matching.length - 2] || garmentItems.find((piece) => piece.product_id !== productId);
      setActiveGarmentId(replacementPiece?.line_id || '');
    }
    setCart((current) => current.map((item) => item.product.id === productId ? { ...item, qty: item.qty - 1 } : item));
  };

  const updateGarmentPiece = (lineId, nextPiece) => {
    setGarmentItems((current) => current.map((piece) => piece.line_id === lineId ? nextPiece : piece));
  };

  const applyAppearanceToSameProduct = (source) => {
    setGarmentItems((current) => current.map((piece) => piece.product_id === source.product_id && piece.line_id !== source.line_id ? {
      ...piece,
      attributes: { ...(source.attributes || {}), freeform: { ...(source.attributes?.freeform || {}) } },
    } : piece));
    toast.success('Identificação visual aplicada às peças iguais. A condição deve ser conferida individualmente.');
  };

  const repriceGarmentPiece = async (nextPiece) => {
    if (!unitId) return;
    setPricingPieceId(nextPiece.line_id);
    try {
      const response = await base44.functions.invoke('price_garment_services', {
        unit_id: unitId,
        customer_id: customerId || undefined,
        priority: priority === 'CRITICAL' ? 'urgent' : priority === 'HIGH' ? 'high' : 'normal',
        items: [nextPiece],
      });
      const priced = response.data?.items?.[0];
      if (priced) setGarmentItems((current) => current.map((piece) => piece.line_id === nextPiece.line_id ? { ...piece, ...priced } : piece));
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.error === 'service_not_compatible' ? 'Esse serviço não é compatível com a peça.' : 'Não foi possível recalcular os serviços.');
    } finally {
      setPricingPieceId(null);
    }
  };

  const cartTotal = garmentItems.reduce((sum, piece) => sum + Number(piece.total_amount ?? piece.unit_price ?? 0), 0);

  const handleNextStep = async () => {
    if (step !== 2) {
      setStep((current) => current + 1);
      return;
    }
    if (garmentItems.length === 0) return;
    if (!unitId || unitId === 'all') {
      toast.error('Selecione uma unidade específica antes de continuar.');
      return;
    }

    setLoading(true);
    try {
      const response = await base44.functions.invoke('price_garment_services', {
        unit_id: unitId,
        customer_id: customerId || undefined,
        priority: priority === 'CRITICAL' ? 'urgent' : priority === 'HIGH' ? 'high' : 'normal',
        items: garmentItems,
      });
      setGarmentItems(response.data?.items || garmentItems);
      setStep(3);
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível validar os preços e serviços das peças.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (loading) return;
    if (!unitId) {
      toast.error("Selecione uma unidade antes de gerar o orçamento.");
      return;
    }
    if (cart.length === 0) {
      toast.error("Adicione ao menos um item ao orçamento.");
      return;
    }

    setLoading(true);
    try {
      let finalCustomerId = customerId;
      const cleanPhone = customerPhone.replace(/\D/g, '');

      if (!finalCustomerId && cleanPhone) {
        const existing = await base44.entities.Customer.filter({ phones: cleanPhone });
        if (existing?.length > 0) {
          finalCustomerId = existing[0].id;
        } else {
          const newCustomer = await base44.entities.Customer.create({
            full_name: customerName || `Cliente ${cleanPhone}`,
            phones: [cleanPhone],
            status: 'active',
            unit_id: unitId
          });
          finalCustomerId = newCustomer.id;
          toast.success('Novo cliente cadastrado automaticamente!');
        }
      }

      if (!finalCustomerId) throw new Error('customer_required');

      const quoteItems = garmentItems.map((piece) => ({
        line_id: piece.line_id,
        product_id: piece.product_id,
        garment_type: piece.garment_type,
        qty: 1,
        unit_price: Number(piece.unit_price || 0),
        subtotal: Number(piece.unit_price || 0),
        total_amount: Number(piece.unit_price || 0),
        confidence: 1,
        recognition_status: 'manual',
        image_ids: piece.image_ids || [],
        document_asset_ids: piece.document_asset_ids || [],
        attributes: piece.attributes || {},
        damages: piece.damages || [],
        risk_tags: piece.risk_tags || [],
        services: piece.services || [],
        notes: piece.notes || '',
        condition_checked: Boolean(piece.condition_checked),
        customer_authorized_risks: Boolean(piece.customer_authorized_risks)
      }));

      const quote = await base44.entities.Quote.create({
        customer_id: finalCustomerId,
        unit_id: unitId,
        status: 'APPROVED',
        origin: 'management_manual',
        items: quoteItems,
        subtotal: cartTotal,
        total: cartTotal,
        discount: 0,
        addition: 0,
        catalog_version: products[0]?.catalog_version || '1',
        reviewed_at: new Date().toISOString(),
        metadata: { priority, characteristic_capture: 'per_piece' }
      });

      const approval = await base44.functions.invoke('approve_quote', { quote_id: quote.id });
      const order = approval.data?.order;
      if (!order) {
        const errorCode = approval.data?.error || 'order_creation_failed';
        throw new Error(errorCode);
      }

      const timingPatch = {
        wash_time: times.wash_time === '' ? undefined : Number(times.wash_time),
        dry_time: times.dry_time === '' ? undefined : Number(times.dry_time),
        dry_clean_time: times.dry_clean_time === '' ? undefined : Number(times.dry_clean_time),
        iron_time: times.iron_time === '' ? undefined : Number(times.iron_time)
      };
      await base44.entities.Order.update(order.id, timingPatch);

      let finalOrder = order;
      let paymentRequiresReconciliation = false;
      if (paymentReceived) {
        let finalMethod = paymentMethod;
        let paymentNote = '';
        let cardBrand;
        let feePercent;
        const selectedBrand = cardFees.find((fee) => fee.id === cardBrandId);

        if (paymentMethod === 'machine') {
          finalMethod = machineType;
          cardBrand = selectedBrand?.brand;
          feePercent = machineType === 'credit' ? selectedBrand?.credit_fees?.[installments] : selectedBrand?.debit_fee;
          paymentNote = machineType === 'credit' ? `Maquininha - Crédito ${installments}x` : 'Maquininha - Débito';
          if (cardBrand) paymentNote += ` (${cardBrand})`;
        } else if (paymentMethod === 'credit_card') {
          finalMethod = 'credit';
          paymentNote = 'Cartão de Crédito (link Asaas) confirmado';
        } else {
          paymentNote = paymentMethod === 'pix' ? 'Pix informado no balcão' : 'Dinheiro recebido no balcão';
        }

        const paymentResponse = await base44.functions.invoke('record_counter_payment', {
          order_id: order.id,
          payment_method: finalMethod,
          confirmed_received: true,
          terminal_confirmed: paymentMethod === 'machine',
          installments: paymentMethod === 'machine' && machineType === 'credit' ? installments : undefined,
          card_brand: cardBrand,
          fee_percent: feePercent != null ? Number(feePercent) : undefined,
          idempotency_key: crypto.randomUUID(),
          notes: paymentNote
        });
        finalOrder = paymentResponse.data?.order || order;
        paymentRequiresReconciliation = paymentResponse.data?.requires_reconciliation === true;
      }

      // Generate Asaas payment link for Pix/Credit Card when payment not yet received
      if (!paymentReceived && (paymentMethod === 'pix' || paymentMethod === 'credit_card')) {
        try {
          const linkResponse = await base44.functions.invoke('generate_payment_link', {
            order_id: finalOrder.id,
            billing_type: paymentMethod === 'credit_card' ? 'credit_card' : 'pix',
          });
          setPaymentLinkResult(linkResponse.data || linkResponse);
        } catch (linkError) {
          console.error('Failed to generate Asaas payment link', linkError);
          toast.error('Venda criada, mas falhou ao gerar link de pagamento Asaas.');
        }
      }

      setCreatedOrder(finalOrder);
      setStep(5);
      toast.success(!paymentReceived ? 'Ticket criado sem registrar pagamento.' : paymentRequiresReconciliation ? 'Ticket criado. O pagamento aguarda conciliação.' : 'Ticket criado e pagamento registrado.');
    } catch (error) {
      console.error(error);
      const errorMessages = {
        order_creation_failed: 'Falha ao criar o ticket. Tente novamente.',
        customer_required: 'Informe o telefone ou nome do cliente.',
        quote_not_found: 'Orçamento não encontrado. Reinicie o processo.',
        human_review_required: 'Existem peças com identificação pendente. Confirme-as antes de aprovar.',
        quote_not_approvable: 'Este orçamento não pode mais ser aprovado.',
        forbidden: 'Você não tem permissão para aprovar orçamentos.',
        forbidden_unit: 'Você não tem acesso à unidade deste orçamento.',
        approve_quote_failed: 'Falha interna ao aprovar orçamento. Tente novamente.'
      };
      const message = errorMessages[error.message] || `Não foi possível concluir o orçamento: ${error.message}`;
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };



  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a0b36] border border-white/10 text-white max-w-6xl h-[90vh] flex flex-col p-0 overflow-hidden">
        <div className="p-6 border-b border-white/10 bg-white/5 flex justify-between items-center">
            <div>
                <DialogTitle className="text-xl">Novo orçamento manual</DialogTitle>
                <DialogDescription className="text-gray-400">
                    {step === 1 && "Identifique o cliente"}
                    {step === 2 && "Selecione os itens"}
                    {step === 3 && "Registre as características de cada peça"}
                    {step === 4 && "Revise e defina o pagamento"}
                </DialogDescription>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
                {[1, 2, 3, 4].map((number, index) => (
                    <React.Fragment key={number}>
                        {index > 0 && <div className={`h-0.5 w-8 ${step >= number ? 'bg-[#FF6600]' : 'bg-gray-600'}`} />}
                        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${step >= number ? 'bg-[#FF6600] text-white' : 'bg-gray-700 text-gray-400'}`}>{number}</div>
                    </React.Fragment>
                ))}
            </div>
        </div>

        <div className="flex-1 overflow-hidden relative">
            {/* STEP 1: CLIENTE */}
            {step === 1 && (
                <div className="p-8 max-w-md mx-auto space-y-6 mt-10">
                    <div className="space-y-2 relative">
                        <Label>WhatsApp do Cliente</Label>
                        <div className="relative">
                            <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                            <Input 
                                value={customerPhone}
                                onChange={(e) => handlePhoneSearch(e.target.value)}
                                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                                placeholder="Ex: 5511999999999"
                                className="pl-10 bg-white/5 border-white/10 h-12"
                                autoFocus
                            />
                        </div>
                        {showSuggestions && suggestions.length > 0 && (
                            <div className="absolute z-50 left-0 right-0 top-16 bg-[#23123f] border border-white/10 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                                {suggestions.map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => selectCustomer(c)}
                                        className="w-full text-left px-4 py-2.5 hover:bg-white/10 transition-colors border-b border-white/5 last:border-0"
                                    >
                                        <div className="font-medium text-white">{c.full_name || 'Sem nome'}</div>
                                        <div className="text-xs text-gray-400">{(c.phones && c.phones[0]) || 'Sem telefone'}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                        {customerId && (
                            <p className="text-xs text-[#25D366] flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Cliente cadastrado encontrado
                            </p>
                        )}
                    </div>
                    
                    <div className="space-y-2" style={{ marginTop: showSuggestions && suggestions.length > 0 ? '15rem' : undefined }}>
                        <Label>Nome do Cliente</Label>
                        <Input 
                            value={customerName}
                            onChange={(e) => handleNameSearch(e.target.value)}
                            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                            placeholder="Nome completo"
                            className="bg-white/5 border-white/10 h-12"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Prioridade</Label>
                        <Select value={priority} onValueChange={setPriority}>
                            <SelectTrigger className="bg-white/5 border-white/10 h-12">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="LOW">Baixa</SelectItem>
                                <SelectItem value="MEDIUM">Média</SelectItem>
                                <SelectItem value="HIGH">Alta</SelectItem>
                                <SelectItem value="CRITICAL">Urgente</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}

            {/* STEP 2: ITENS */}
            {step === 2 && (
                <div className="flex h-full">
                    {/* Catalog */}
                    <div className="flex-1 p-6 border-r border-white/10 overflow-hidden flex flex-col">
                        <div className="mb-2 relative">
                            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                            <Input 
                                placeholder="Buscar serviços..." 
                                className="pl-10 bg-white/5 border-white/10" 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        
                        {searchTerm ? (
                            <div className="flex-1 overflow-y-auto mt-2 pr-2 custom-scrollbar">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pb-20">
                                    {products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map(product => (
                                        <div 
                                            key={product.id} 
                                            onClick={() => addToCart(product)}
                                            className="bg-white/5 border border-white/10 rounded-xl p-4 cursor-pointer hover:border-[#FF6600] transition-all group relative overflow-hidden"
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-gray-400 group-hover:text-white group-hover:bg-[#FF6600] transition-colors">
                                                    <ProductIcon product={product} className="w-6 h-6" />
                                                </div>
                                                <span className="font-bold text-[#FF6600]">R$ {product.price}</span>
                                            </div>
                                            <h3 className="font-medium text-white truncate">{product.name}</h3>
                                            <p className="text-xs text-gray-500 line-clamp-2 mt-1">{product.description}</p>
                                            
                                            <div className="absolute inset-0 bg-[#FF6600]/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <Plus className="w-8 h-8 text-[#FF6600]" />
                                            </div>
                                        </div>
                                    ))}
                                    {products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                                        <div className="col-span-full text-center text-gray-500 py-10">
                                            Nenhum item encontrado para "{searchTerm}"
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <Tabs defaultValue={categories[0]} className="flex-1 flex flex-col overflow-hidden">
                                <div className="w-full pb-4 flex-shrink-0">
                                    <TabsList className="bg-transparent h-auto p-0 gap-2 flex-wrap justify-start">
                                        {categories.map(cat => (
                                            <TabsTrigger 
                                                key={cat} 
                                                value={cat}
                                                className="data-[state=active]:bg-[#FF6600] data-[state=active]:text-white bg-white/5 border border-white/10 px-4 py-2 rounded-full"
                                            >
                                                {cat}
                                            </TabsTrigger>
                                        ))}
                                    </TabsList>
                                </div>
                                
                                <div className="flex-1 overflow-y-auto mt-2 pr-2 custom-scrollbar">
                                    {categories.map(cat => (
                                        <TabsContent key={cat} value={cat} className="mt-0 outline-none">
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pb-20">
                                                {products.filter(p => p.category === cat).map(product => (
                                                    <div 
                                                        key={product.id} 
                                                        onClick={() => addToCart(product)}
                                                        className="bg-white/5 border border-white/10 rounded-xl p-4 cursor-pointer hover:border-[#FF6600] transition-all group relative overflow-hidden"
                                                    >
                                                        <div className="flex justify-between items-start mb-2">
                                                            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-gray-400 group-hover:text-white group-hover:bg-[#FF6600] transition-colors">
                                                                <ProductIcon product={product} className="w-6 h-6" />
                                                            </div>
                                                            <span className="font-bold text-[#FF6600]">R$ {product.price}</span>
                                                        </div>
                                                        <h3 className="font-medium text-white truncate">{product.name}</h3>
                                                        <p className="text-xs text-gray-500 line-clamp-2 mt-1">{product.description}</p>
                                                        
                                                        <div className="absolute inset-0 bg-[#FF6600]/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                            <Plus className="w-8 h-8 text-[#FF6600]" />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </TabsContent>
                                    ))}
                                </div>
                            </Tabs>
                        )}
                    </div>

                    {/* Cart Sidebar */}
                    <div className="w-80 bg-black/20 flex flex-col">
                        <div className="p-4 border-b border-white/10 bg-white/5">
                            <h3 className="font-bold flex items-center gap-2">
                                <ShoppingCart className="w-4 h-4 text-[#FF6600]" />
                                Carrinho ({cart.reduce((a, b) => a + b.qty, 0)})
                            </h3>
                        </div>
                        
                        <ScrollArea className="flex-1 p-4">
                            {cart.length === 0 ? (
                                <div className="text-center text-gray-500 mt-10">
                                    <Shirt className="w-12 h-12 mx-auto mb-2 opacity-20" />
                                    Nenhum item selecionado
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {cart.map((item) => (
                                        <div key={item.product.id} className="bg-white/5 rounded-lg p-3 flex items-center gap-3">
                                            <div className="w-10 h-10 rounded bg-white/10 flex items-center justify-center text-gray-400">
                                                <ProductIcon product={item.product} className="w-5 h-5" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium truncate">{item.product.name}</div>
                                                <div className="text-xs text-gray-400">R$ {garmentItems.filter((piece) => piece.product_id === item.product.id).reduce((sum, piece) => sum + Number(piece.total_amount ?? piece.unit_price ?? 0), 0).toFixed(2)} no grupo</div>
                                            </div>
                                            <div className="flex items-center gap-2 bg-black/20 rounded-md p-1">
                                                <button onClick={(e) => { e.stopPropagation(); updateQty(item.product.id, -1); }} className="p-1 hover:text-red-400"><Minus className="w-3 h-3" /></button>
                                                <span className="text-xs w-4 text-center">{item.qty}</span>
                                                <button onClick={(e) => { e.stopPropagation(); updateQty(item.product.id, 1); }} className="p-1 hover:text-green-400"><Plus className="w-3 h-3" /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ScrollArea>

                        <div className="p-4 border-t border-white/10 bg-white/5 space-y-4">
                            <div className="flex justify-between items-end">
                                <span className="text-gray-400">Total Estimado</span>
                                <span className="text-2xl font-bold text-[#FF6600]">R$ {cartTotal.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* STEP 3: CARACTERÍSTICAS POR PEÇA */}
            {step === 3 && (
                <ManualGarmentCharacteristics
                    pieces={garmentItems}
                    activePieceId={activeGarmentId}
                    onActivePieceChange={setActiveGarmentId}
                    onPieceChange={updateGarmentPiece}
                    onApplyAppearance={applyAppearanceToSameProduct}
                    services={laundryServices}
                    onRepricePiece={repriceGarmentPiece}
                    pricingPieceId={pricingPieceId}
                />
            )}

            {/* STEP 4: REVISÃO E PAGAMENTO */}
            {step === 4 && (
                <div className="flex flex-col h-full items-center p-8 space-y-8 overflow-y-auto custom-scrollbar">
                    <div className="bg-green-500/10 p-4 rounded-full">
                        <CheckCircle2 className="w-16 h-16 text-green-500" />
                    </div>
                    
                    <div className="text-center space-y-2">
                        <h2 className="text-2xl font-bold">Tudo pronto para criar!</h2>
                        <p className="text-gray-400">O orçamento será gerado e o card criado no CRM.</p>
                    </div>

                    <div className="bg-white/5 rounded-2xl p-6 w-full max-w-lg border border-white/10">
                        <div className="flex justify-between py-2 border-b border-white/10">
                            <span className="text-gray-400">Cliente</span>
                            <span className="font-medium">{customerName || 'Novo Cliente'}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-white/10">
                            <span className="text-gray-400">Itens</span>
                            <span className="font-medium">{cart.reduce((a, b) => a + b.qty, 0)} peças</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-white/10">
                            <span className="text-gray-400">Total</span>
                            <span className="font-bold text-[#FF6600]">R$ {cartTotal.toFixed(2)}</span>
                        </div>

                        <div className="mt-4 max-h-44 space-y-2 overflow-y-auto pr-1">
                            {garmentItems.map((piece, index) => (
                                <div key={piece.line_id} className="rounded-xl border border-white/10 bg-black/15 p-3 text-sm">
                                    <div className="flex items-center justify-between gap-3"><span className="font-medium">{index + 1}. {piece.garment_type}</span><span className="text-orange-300">R$ {Number(piece.unit_price || 0).toFixed(2)}</span></div>
                                    <p className="mt-1 text-xs text-white/45">{[piece.attributes?.color, piece.attributes?.brand, piece.attributes?.material, piece.attributes?.size].filter(Boolean).join(' · ') || 'Sem características aplicáveis'}</p>
                                    {(piece.damages || []).length > 0 && <p className="mt-1 text-xs text-red-300">Avarias: {piece.damages.join(', ')}</p>}
                                </div>
                            ))}
                        </div>
                        
                        <div className="mt-6 space-y-2">
                            <Label>Forma de pagamento, se já recebida</Label>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                    { id: 'cash', label: 'Dinheiro', icon: DollarSign },
                                    { id: 'pix', label: 'Pix', icon: DollarSign },
                                    { id: 'credit_card', label: 'Cartão de Crédito', icon: CreditCard },
                                    { id: 'machine', label: 'Maquininha', icon: CreditCard }
                                ].map(method => (
                                    <button
                                        key={method.id}
                                        onClick={() => setPaymentMethod(method.id)}
                                        className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${
                                            paymentMethod === method.id 
                                            ? 'bg-[#FF6600]/20 border-[#FF6600] text-white' 
                                            : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                        }`}
                                    >
                                        <method.icon className="w-5 h-5 mb-1" />
                                        <span className="text-xs">{method.label}</span>
                                    </button>
                                ))}
                            </div>

                            {paymentMethod === 'machine' && (
                                <div className="mt-3 space-y-3 bg-black/20 rounded-lg p-4 border border-white/10">
                                    <div className="space-y-2">
                                        <Label className="text-sm">Tipo de Cartão</Label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {[
                                                { id: 'debit', label: 'Débito' },
                                                { id: 'credit', label: 'Crédito' }
                                            ].map(t => (
                                                <button
                                                    key={t.id}
                                                    onClick={() => { setMachineType(t.id); setCardBrandId(''); }}
                                                    className={`p-2.5 rounded-lg border text-sm transition-all ${
                                                        machineType === t.id
                                                        ? 'bg-[#FF6600]/20 border-[#FF6600] text-white'
                                                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                                    }`}
                                                >
                                                    {t.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-sm">Bandeira do Cartão</Label>
                                        {(() => {
                                            const opts = cardFees.filter((f) => f.card_type === machineType);
                                            if (opts.length === 0) {
                                                return <p className="text-xs text-gray-500">Nenhuma bandeira de {machineType === 'debit' ? 'débito' : 'crédito'} cadastrada. Cadastre em Configurações → Taxas de Cartões.</p>;
                                            }
                                            return (
                                                <Select value={cardBrandId} onValueChange={setCardBrandId}>
                                                    <SelectTrigger className="bg-white/5 border-white/10 h-11">
                                                        <SelectValue placeholder="Selecione a bandeira" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {opts.map((f) => (
                                                            <SelectItem key={f.id} value={f.id}>{f.brand}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            );
                                        })()}
                                    </div>

                                    {machineType === 'credit' && (
                                        <div className="space-y-2">
                                            <Label className="text-sm">Parcelas</Label>
                                            <Select value={String(installments)} onValueChange={(v) => setInstallments(Number(v))}>
                                                <SelectTrigger className="bg-white/5 border-white/10 h-11">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                                                        <SelectItem key={n} value={String(n)}>
                                                            {n}x de R$ {(cartTotal / n).toFixed(2)}{n === 1 ? ' (à vista)' : ''}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => setPaymentReceived((value) => !value)}
                            className={`mt-5 flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-all ${paymentReceived ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}
                        >
                            <CheckCircle2 className={`h-5 w-5 ${paymentReceived ? 'text-emerald-400' : 'text-gray-500'}`} />
                            <div>
                                <div className="font-medium">Pagamento já foi recebido e conferido</div>
                                <div className="text-xs text-gray-400">Desmarcado por padrão. O orçamento nunca confirma pagamento automaticamente.</div>
                            </div>
                        </button>

                        <div className="mt-6 space-y-4 border-t border-white/10 pt-4">
                            <Label className="text-[#FF6600]">Tempos de Processo (opcional)</Label>
                            <TimeField label="Lavagem" value={times.wash_time} onChange={(v) => setTimes({ ...times, wash_time: v })} />
                            <TimeField label="Secagem" value={times.dry_time} onChange={(v) => setTimes({ ...times, dry_time: v })} />
                            <TimeField label="Lavagem a Seco" value={times.dry_clean_time} onChange={(v) => setTimes({ ...times, dry_clean_time: v })} />
                            <TimeField label="Passar" value={times.iron_time} onChange={(v) => setTimes({ ...times, iron_time: v })} />
                        </div>
                    </div>
                </div>
            )}
            
            {/* STEP 5: SUCESSO */}
            {step === 5 && (
                <div className="flex flex-col h-full items-center justify-center p-8 space-y-6 overflow-y-auto">
                    <div className="bg-green-500/10 p-4 rounded-full">
                        <CheckCircle2 className="w-16 h-16 text-green-500" />
                    </div>
                    <div className="text-center space-y-2">
                        <h2 className="text-2xl font-bold">Ticket criado com rastreabilidade</h2>
                        <p className="text-gray-400">O orçamento foi convertido em peças individuais.</p>
                    </div>
                    <div className="bg-white/5 rounded-2xl p-6 w-full max-w-lg border border-white/10 text-center">
                        <p className="text-sm text-gray-400">Número do ticket</p>
                        <p className="mt-2 text-2xl font-bold text-[#FF6600]">{createdOrder?.ticket_number || createdOrder?.id?.slice(0, 8) || 'Criado'}</p>
                        <p className="mt-4 text-sm text-gray-400">
                            {paymentReceived ? 'Pagamento registrado após confirmação explícita do funcionário.' : 'Pagamento pendente. Gere um link ou receba no caixa quando necessário.'}
                        </p>
                    </div>

                    {paymentLinkResult && (
                        <div className="bg-white/5 rounded-2xl p-6 w-full max-w-lg border border-[#FF6600]/30 space-y-4">
                            <h3 className="text-lg font-bold text-[#FF6600] flex items-center gap-2">
                                <CreditCard className="w-5 h-5" />
                                {paymentLinkResult.billing_type === 'pix' ? 'Pix Gerado — Envie ao Cliente' : 'Link de Pagamento Gerado'}
                            </h3>

                            {paymentLinkResult.pix_qr_code && (
                                <div className="flex flex-col items-center gap-3">
                                    <img
                                        src={paymentLinkResult.pix_qr_code.startsWith('data:')
                                            ? paymentLinkResult.pix_qr_code
                                            : `data:image/png;base64,${paymentLinkResult.pix_qr_code}`}
                                        alt="QR Code Pix"
                                        className="w-48 h-48 rounded-lg bg-white p-2"
                                    />
                                    <p className="text-xs text-gray-400">Escaneie o QR Code acima</p>
                                </div>
                            )}

                            {paymentLinkResult.pix_copy_paste_key && (
                                <div className="space-y-2">
                                    <Label className="text-xs text-gray-400">Código Pix Copia e Cola</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            readOnly
                                            value={paymentLinkResult.pix_copy_paste_key}
                                            className="bg-black/30 border-white/10 text-xs font-mono"
                                        />
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => {
                                                navigator.clipboard.writeText(paymentLinkResult.pix_copy_paste_key);
                                                toast.success('Código Pix copiado!');
                                            }}
                                            className="px-3"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {paymentLinkResult.url && !paymentLinkResult.pix_qr_code && (
                                <div className="space-y-2">
                                    <Label className="text-xs text-gray-400">Link de Pagamento</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            readOnly
                                            value={paymentLinkResult.url}
                                            className="bg-black/30 border-white/10 text-xs"
                                        />
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => {
                                                navigator.clipboard.writeText(paymentLinkResult.url);
                                                toast.success('Link copiado!');
                                            }}
                                            className="px-3"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </Button>
                                    </div>
                                    <a href={paymentLinkResult.url} target="_blank" rel="noopener noreferrer" className="block">
                                        <Button type="button" className="w-full bg-[#FF6600] hover:bg-[#ff7b24]">
                                            Abrir Link de Pagamento
                                        </Button>
                                    </a>
                                </div>
                            )}

                            {customerPhone && (
                                <a
                                    href={`https://wa.me/${customerPhone.replace(/\D/g, '')}?text=${encodeURIComponent(
                                        `Olá! Aqui está o seu pagamento de R$ ${cartTotal.toFixed(2)} referente ao pedido #${createdOrder?.ticket_number || createdOrder?.id?.slice(0, 8)}.${paymentLinkResult.pix_copy_paste_key ? `\n\nPix Copia e Cola:\n${paymentLinkResult.pix_copy_paste_key}` : ''}${paymentLinkResult.url && !paymentLinkResult.pix_qr_code ? `\n\nLink de pagamento: ${paymentLinkResult.url}` : ''}`
                                    )}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block"
                                >
                                    <Button type="button" className="w-full bg-green-600 hover:bg-green-700 gap-2">
                                        <Send className="w-4 h-4" />
                                        Enviar via WhatsApp
                                    </Button>
                                </a>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>

        <div className="p-4 border-t border-white/10 bg-white/5 flex justify-between items-center">
            {step > 1 && step < 5 ? (
                <Button variant="ghost" onClick={() => setStep(step - 1)} className="gap-2">
                    <ArrowLeft className="w-4 h-4" /> Voltar
                </Button>
            ) : step === 5 ? (
                 <div /> // Spacer
            ) : (
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            )}

            {step < 4 && (
                <Button 
                    onClick={handleNextStep}
                    className="bg-[#FF6600] hover:bg-[#ff7b24] gap-2"
                    disabled={loading || (step === 1 && !customerPhone) || (step === 2 && garmentItems.length === 0)}
                >
                    {loading && step === 2 ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {loading && step === 2 ? 'Validando serviços' : 'Próximo'} <ArrowRight className="w-4 h-4" />
                </Button>
            )}
            
            {step === 4 && (
                <Button onClick={handleSubmit} disabled={loading} className="bg-green-600 hover:bg-green-700 gap-2 px-8">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Confirmar e Criar Ticket
                </Button>
            )}
            
            {step === 5 && (
                <Button onClick={() => { onSuccess(); onClose(); }} className="bg-[#FF6600] hover:bg-[#ff7b24] gap-2 px-8">
                    Concluir
                </Button>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}