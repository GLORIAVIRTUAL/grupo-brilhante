import { useEffect, useMemo, useState } from 'react';
import { Camera, Check, ChevronLeft, ChevronRight, FileImage, Loader2, Plus, ShieldCheck, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { uploadSecureFile } from '@/lib/secureFiles';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  const [files, setFiles] = useState([]);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogEntries, setCatalogEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [createdQuote, setCreatedQuote] = useState(null);
  const [createdOrder, setCreatedOrder] = useState(null);

  useEffect(() => {
    if (!open) return;
    base44.entities.Product.filter({ active: true }, 'name', 500)
      .then(setProducts)
      .catch(() => toast.error('Não foi possível carregar o catálogo.'));
    base44.entities.OperationalCatalogEntry.filter({ active: true }, 'sort_order', 2000)
      .then(setCatalogEntries)
      .catch(() => setCatalogEntries([]));
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
  const selectedCustomer = customers.find((customer) => customer.id === customerId);

  const reset = () => {
    files.forEach((entry) => URL.revokeObjectURL(entry.preview));
    setStep(1);
    setCustomerId('');
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
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-hidden border-white/10 bg-[#170c2b] p-0 text-white">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 p-2.5 shadow-lg shadow-violet-900/30"><Sparkles className="h-5 w-5" /></div>
            <div>
              <DialogTitle className="text-xl">Orçamento inteligente por imagens</DialogTitle>
              <DialogDescription className="text-white/50">A IA prepara o rascunho; o funcionário confirma antes de criar qualquer pedido ou cobrança.</DialogDescription>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {['Capturar', 'Revisar', 'Finalizar'].map((label, index) => (
              <div key={label} className={`rounded-full px-3 py-1.5 text-center text-xs font-medium ${step >= index + 1 ? 'bg-violet-500 text-white' : 'bg-white/5 text-white/35'}`}>{index + 1}. {label}</div>
            ))}
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(94vh-170px)]">
          <div className="p-6">
            {step === 1 && (
              <div className="space-y-6">
                <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                  <div className="rounded-3xl border border-dashed border-violet-400/40 bg-violet-500/5 p-8 text-center">
                    <Camera className="mx-auto h-10 w-10 text-violet-300" />
                    <h3 className="mt-3 text-lg font-semibold">Fotografe frente, verso, etiqueta e avarias</h3>
                    <p className="mx-auto mt-2 max-w-xl text-sm text-white/50">Use boa iluminação e evite peças sobrepostas. São aceitas até 12 imagens JPG, PNG ou WEBP.</p>
                    <Label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold hover:bg-violet-400">
                      <Plus className="h-4 w-4" /> Adicionar fotos
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={addFiles} className="sr-only" />
                    </Label>
                  </div>
                  <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="space-y-2">
                      <Label>Cliente</Label>
                      <Select value={customerId} onValueChange={setCustomerId}>
                        <SelectTrigger className="border-white/10 bg-black/20"><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                        <SelectContent>{customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.full_name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-100/80">
                      <div className="flex items-center gap-2 font-semibold text-emerald-300"><ShieldCheck className="h-4 w-4" /> Fluxo supervisionado</div>
                      <p className="mt-2">O preço vem do catálogo cadastrado. Imagens de baixa confiança entram em revisão.</p>
                    </div>
                    <Button onClick={analyze} disabled={busy || !customerId || files.length === 0} className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-500">
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
                  <Button onClick={saveQuote} disabled={busy || unresolved.length > 0} className="bg-violet-500 hover:bg-violet-400">Salvar orçamento <ChevronRight className="ml-2 h-4 w-4" /></Button>
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