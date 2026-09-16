import { useEffect, useMemo, useState } from 'react';
import { Camera, Check, ChevronLeft, ChevronRight, FileImage, Loader2, Plus, Search, ShieldCheck, Sparkles, Trash2, TriangleAlert, User } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { uploadSecureFile } from '@/lib/secureFiles';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import GarmentReviewCard, { FALLBACK_CATALOG_OPTIONS as FALLBACK_OPTIONS } from '@/components/management/GarmentReviewCard';

function currency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function PreviewCard({ entry, onRemove }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <img src={entry.preview} alt="Peça aguardando análise" className="h-40 w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-10">
        <span className="truncate text-xs text-white/80">{entry.file.name}</span>
        <button type="button" onClick={onRemove} className="rounded-full bg-black/50 p-1.5 text-white hover:bg-red-500" aria-label="Remover foto">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function IntelligentQuoteModal({ open, onOpenChange, customers = [], defaultUnitId, onCreated }) {
  const [step, setStep] = useState(1);
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [allCustomers, setAllCustomers] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogEntries, setCatalogEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [createdQuote, setCreatedQuote] = useState(null);
  const [createdOrder, setCreatedOrder] = useState(null);

  // Carrega TODOS os clientes (paginado) quando o modal abre — não depende
  // mais da lista filtrada do dashboard, que só tinha clientes com atividade do dia.
  useEffect(() => {
    if (!open) return;
    base44.entities.Product.filter({ active: true }, 'name', 500)
      .then(setProducts)
      .catch(() => toast.error('Não foi possível carregar o catálogo.'));
    base44.entities.OperationalCatalogEntry.filter({ active: true }, 'sort_order', 2000)
      .then(setCatalogEntries)
      .catch(() => setCatalogEntries([]));

    let cancelled = false;
    (async () => {
      setCustomersLoading(true);
      try {
        if (customers.length && !allCustomers.length) setAllCustomers(customers);
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
        if (!cancelled) setAllCustomers(all);
      } catch (e) {
        console.error('Error loading customers', e);
      } finally {
        if (!cancelled) setCustomersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const catalogOptions = useMemo(() => {
    const byType = (type) => {
      const values = catalogEntries
        .filter((entry) => entry.catalog_type === type && (!entry.unit_id || !defaultUnitId || entry.unit_id === defaultUnitId))
        .map((entry) => entry.label)
        .filter(Boolean);
      return values.length ? [...new Set(values)] : FALLBACK_OPTIONS[type];
    };
    return { brand: byType('brand'), size: byType('size'), damage: byType('damage'), color: byType('color'), pattern: byType('pattern'), material: byType('material') };
  }, [catalogEntries, defaultUnitId]);

  useEffect(() => () => files.forEach((entry) => URL.revokeObjectURL(entry.preview)), [files]);

  const total = useMemo(() => items.reduce((sum, item) => sum + Number(item.total_amount ?? Number(item.qty || 1) * Number(item.unit_price || 0)), 0), [items]);
  const unresolved = items.filter((item) => !item.product_id || item.recognition_status !== 'confirmed');
  const selectedCustomer = allCustomers.find((customer) => customer.id === customerId);

  const handleCustomerSearch = (value) => {
    setCustomerSearch(value);
    setCustomerId('');
    if (value.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const query = value.toLowerCase().trim();
    const digits = query.replace(/\D/g, '');
    const matches = allCustomers
      .filter((c) => {
        const name = (c.full_name || '').toLowerCase();
        const phones = (c.phones || []).map((p) => (p || '').replace(/\D/g, ''));
        return name.includes(query) || (digits && phones.some((p) => p.includes(digits)));
      })
      .slice(0, 8);
    setSuggestions(matches);
    setShowSuggestions(matches.length > 0);
  };

  const selectCustomer = (customer) => {
    setCustomerId(customer.id);
    setCustomerSearch(customer.full_name || '');
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const reset = () => {
    files.forEach((entry) => URL.revokeObjectURL(entry.preview));
    setStep(1);
    setCustomerId('');
    setCustomerSearch('');
    setSuggestions([]);
    setShowSuggestions(false);
    setFiles([]);
    setItems([]);
    setCreatedQuote(null);
    setCreatedOrder(null);
    setBusy(false);
  };

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && !busy) reset();
    onOpenChange(nextOpen);
  };

  const addFiles = (event) => {
    const selected = [...(event.target.files || [])].slice(0, Math.max(0, 12 - files.length));
    const next = selected.map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }));
    setFiles((current) => [...current, ...next].slice(0, 12));
    event.target.value = '';
  };

  const removeFile = (id) => {
    setFiles((current) => {
      const removed = current.find((entry) => entry.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return current.filter((entry) => entry.id !== id);
    });
  };

  const analyze = async () => {
    if (!customerId) return toast.error('Selecione o cliente.');
    if (!defaultUnitId) return toast.error('Selecione uma unidade.');
    if (files.length === 0) return toast.error('Adicione ao menos uma foto.');

    setBusy(true);
    try {
      const uploaded = [];
      for (const entry of files) {
        try {
          const result = await uploadSecureFile({
            file: entry.file,
            documentType: 'garment_photo',
            unitId: defaultUnitId,
            customerId,
            metadata: { source: 'management_vision_quote' },
          });
          uploaded.push(result.asset.id);
        } catch (uploadError) {
          if (uploadError.code === 'DUPLICATE_DOCUMENT' && uploadError.asset?.id) {
            uploaded.push(uploadError.asset.id);
          } else {
            throw uploadError;
          }
        }
      }

      const response = await base44.functions.invoke('analyze_garment_images', {
        document_asset_ids: uploaded,
        customer_id: customerId,
      });
      const analyzedItems = response.data?.items || [];
      setItems(analyzedItems);
      setStep(2);
      if (analyzedItems.some((item) => item.recognition_status !== 'confirmed')) {
        toast.info('Alguns itens precisam da sua confirmação.');
      } else {
        toast.success('Fotos analisadas com sucesso.');
      }
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Não foi possível analisar as fotos.');
    } finally {
      setBusy(false);
    }
  };

  const confirmItem = (index) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, recognition_status: item.product_id ? 'confirmed' : 'suggested' } : item));
  };

  const saveQuote = async () => {
    if (unresolved.length > 0) return toast.error('Confirme todos os itens antes de finalizar.');
    setBusy(true);
    try {
      const now = new Date();
      const quote = await base44.entities.Quote.create({
        customer_id: customerId,
        unit_id: defaultUnitId,
        status: 'APPROVED',
        origin: 'management_vision',
        items,
        subtotal: total,
        discount: 0,
        addition: 0,
        total,
        catalog_version: products[0]?.catalog_version || '1',
        valid_until: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        reviewed_at: now.toISOString(),
      });
      setCreatedQuote(quote);
      setStep(3);
      onCreated?.({ quote });
      toast.success('Orçamento salvo sem gerar cobrança.');
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível salvar o orçamento.');
    } finally {
      setBusy(false);
    }
  };

  const createOrder = async () => {
    if (!createdQuote) return;
    setBusy(true);
    try {
      const response = await base44.functions.invoke('approve_quote', { quote_id: createdQuote.id });
      setCreatedOrder(response.data?.order);
      onCreated?.({ quote: createdQuote, order: response.data?.order });
      toast.success('Ticket e peças criados com rastreabilidade.');
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.error === 'human_review_required' ? 'Ainda existem itens pendentes de revisão.' : 'Não foi possível criar o ticket.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-hidden border-white/10 bg-[#17364F] p-0 text-white">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-gradient-to-br from-[#216FA1] to-[#2d8ac4] p-2.5 shadow-lg shadow-blue-900/30"><Sparkles className="h-5 w-5" /></div>
            <div>
              <DialogTitle className="text-xl">Orçamento inteligente por imagens</DialogTitle>
              <DialogDescription className="text-white/50">A IA prepara o rascunho; o funcionário confirma antes de criar qualquer pedido ou cobrança.</DialogDescription>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {['Capturar', 'Revisar', 'Finalizar'].map((label, index) => (
              <div key={label} className={`rounded-full px-3 py-1.5 text-center text-xs font-medium ${step >= index + 1 ? 'bg-[#216FA1] text-white' : 'bg-white/5 text-white/35'}`}>{index + 1}. {label}</div>
            ))}
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(94vh-170px)]">
          <div className="p-6">
            {step === 1 && (
              <div className="space-y-6">
                <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                  <div className="rounded-3xl border border-dashed border-[#216FA1]/40 bg-[#216FA1]/5 p-8 text-center">
                    <Camera className="mx-auto h-10 w-10 text-blue-300" />
                    <h3 className="mt-3 text-lg font-semibold">Fotografe frente, verso, etiqueta e avarias</h3>
                    <p className="mx-auto mt-2 max-w-xl text-sm text-white/50">Use boa iluminação e evite peças sobrepostas. São aceitas até 12 imagens JPG, PNG ou WEBP.</p>
                    <Label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#216FA1] px-4 py-2 text-sm font-semibold hover:bg-[#2d8ac4]">
                      <Plus className="h-4 w-4" /> Adicionar fotos
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={addFiles} className="sr-only" />
                    </Label>
                  </div>
                  <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="space-y-2">
                      <Label>Cliente</Label>
                      <div className="relative">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input
                          value={customerSearch}
                          onChange={(e) => handleCustomerSearch(e.target.value)}
                          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                          placeholder={customersLoading ? 'Carregando clientes...' : 'Buscar por nome ou telefone'}
                          className="pl-10 bg-black/20 border-white/10"
                          autoFocus
                        />
                        {customersLoading && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-gray-400" />}
                        {showSuggestions && suggestions.length > 0 && (
                          <div className="absolute z-50 left-0 right-0 top-12 bg-[#17364F] border border-[#216FA1]/40 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                            {suggestions.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); selectCustomer(c); }}
                                className="w-full text-left px-4 py-2.5 hover:bg-white/10 transition-colors border-b border-white/5 last:border-0"
                              >
                                <div className="flex items-center gap-2">
                                  <User className="h-3.5 w-3.5 text-gray-500" />
                                  <span className="font-medium text-white">{c.full_name || 'Sem nome'}</span>
                                </div>
                                <div className="text-xs text-gray-400 ml-5.5">{(c.phones && c.phones[0]) || 'Sem telefone'}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {customerId && (
                        <p className="text-xs text-emerald-300 flex items-center gap-1">
                          <Check className="w-3 h-3" /> {selectedCustomer?.full_name || 'Cliente selecionado'}
                        </p>
                      )}
                    </div>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-100/80">
                      <div className="flex items-center gap-2 font-semibold text-emerald-300"><ShieldCheck className="h-4 w-4" /> Fluxo supervisionado</div>
                      <p className="mt-2">O preço vem do catálogo cadastrado. Imagens de baixa confiança entram em revisão.</p>
                    </div>
                    <Button onClick={analyze} disabled={busy || !customerId || files.length === 0} className="w-full bg-gradient-to-r from-[#216FA1] to-[#2d8ac4]">
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Analisar {files.length || ''} foto{files.length === 1 ? '' : 's'}
                    </Button>
                  </div>
                </div>
                {files.length > 0 && <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">{files.map((entry) => <PreviewCard key={entry.id} entry={entry} onRemove={() => removeFile(entry.id)} />)}</div>}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div><h3 className="font-semibold">Revise somente o que precisa de atenção</h3><p className="text-sm text-white/50">{unresolved.length} de {items.length} item(ns) ainda precisam de confirmação.</p></div>
                  <div className="min-w-52"><Progress value={items.length ? ((items.length - unresolved.length) / items.length) * 100 : 0} className="h-2" /><p className="mt-1 text-right text-xs text-white/40">Total: {currency(total)}</p></div>
                </div>
                {items.map((item, index) => (
                  <div key={item.line_id || index} className="space-y-2">
                    <GarmentReviewCard item={item} index={index} products={products} catalogOptions={catalogOptions} onChange={(next) => setItems((current) => current.map((candidate, itemIndex) => itemIndex === index ? next : candidate))} />
                    {item.product_id && item.recognition_status !== 'confirmed' && <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => confirmItem(index)}><Check className="mr-2 h-4 w-4" />Confirmar item</Button></div>}
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
                  <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}><ChevronLeft className="mr-2 h-4 w-4" />Voltar às fotos</Button>
                  <Button onClick={saveQuote} disabled={busy || unresolved.length > 0} className="bg-[#216FA1] hover:bg-[#2d8ac4]">Salvar orçamento <ChevronRight className="ml-2 h-4 w-4" /></Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="mx-auto max-w-2xl space-y-6 py-6 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300"><Check className="h-8 w-8" /></div>
                <div><h3 className="text-2xl font-bold">Orçamento criado</h3><p className="mt-2 text-white/50">{selectedCustomer?.full_name} · {items.length} item(ns) · {currency(total)}</p></div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-left">
                  <div className="flex gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /><div><p className="font-semibold">Nenhuma cobrança foi registrada.</p><p className="mt-1 text-sm text-white/50">Crie o ticket somente quando o cliente aprovar o orçamento. O pagamento continuará sendo uma etapa separada.</p></div></div>
                </div>
                {createdOrder ? (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-200">Ticket <strong>{createdOrder.ticket_number}</strong> criado com peças individualizadas.</div>
                ) : (
                  <Button onClick={createOrder} disabled={busy} className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 hover:from-emerald-400 hover:to-cyan-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Cliente aprovou: criar ticket</Button>
                )}
                <div><Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={busy}>Fechar</Button></div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}