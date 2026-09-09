import { AlertTriangle, Check, Copy, Loader2, Minus, Plus, Ruler, Shirt, ShieldCheck, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import useUnitAccess from '@/components/units/useUnitAccess';

const SUGGESTIONS = {
  color: ['Branco', 'Preto', 'Azul', 'Vermelho', 'Verde', 'Bege', 'Cinza', 'Rosa'],
  material: ['Algodão', 'Poliéster', 'Lã', 'Seda', 'Linho', 'Couro', 'Viscose', 'Sintético'],
  pattern: ['Liso', 'Listrado', 'Xadrez', 'Floral', 'Estampado', 'Poá'],
  size: ['PP', 'P', 'M', 'G', 'GG', 'XG', 'Único'],
};

const DAMAGES = ['Mancha', 'Rasgo', 'Furo', 'Desgaste', 'Desbotado', 'Costura solta', 'Botão ausente', 'Zíper danificado'];
const RISKS = ['Tecido delicado', 'Risco de encolhimento', 'Risco de soltar tinta', 'Aplicações frágeis', 'Etiqueta ilegível', 'Peça sem etiqueta'];

function toggleValue(values = [], value) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function SuggestionField({ label, value, options, onChange, placeholder }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="border-white/10 bg-black/20" />
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button key={option} type="button" onClick={() => onChange(value === option ? '' : option)} className={`rounded-full border px-2.5 py-1 text-xs transition ${value === option ? 'border-orange-400 bg-orange-500/20 text-orange-100' : 'border-white/10 bg-white/5 text-white/45 hover:border-white/25 hover:text-white/80'}`}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiChoice({ title, values, options, onChange, tone = 'amber' }) {
  const selectedClass = tone === 'red' ? 'border-red-400/60 bg-red-500/15 text-red-100' : 'border-amber-400/60 bg-amber-500/15 text-amber-100';
  return (
    <div className="space-y-2">
      <Label>{title}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = values.includes(option);
          return <button key={option} type="button" onClick={() => onChange(toggleValue(values, option))} className={`rounded-xl border px-3 py-2 text-xs transition ${selected ? selectedClass : 'border-white/10 bg-white/5 text-white/50 hover:border-white/25 hover:text-white/80'}`}>{selected && <Check className="mr-1 inline h-3 w-3" />}{option}</button>;
        })}
      </div>
    </div>
  );
}

function pieceSummary(piece) {
  return [piece.attributes?.color, piece.attributes?.brand, piece.attributes?.material].filter(Boolean).join(' · ') || 'Características pendentes';
}

export function manualPieceNeedsAttention(piece) {
  const hasCondition = (piece.damages || []).length > 0 || (piece.risk_tags || []).length > 0;
  return !piece.condition_checked || (hasCondition && !piece.customer_authorized_risks);
}

export default function ManualGarmentCharacteristics({ pieces, activePieceId, onActivePieceChange, onPieceChange, onApplyAppearance, services = [], onRepricePiece, pricingPieceId }) {
  const { selectedUnitId } = useUnitAccess();
  const { data: catalogEntries = [] } = useQuery({
    queryKey: ['operational-catalogs', selectedUnitId],
    queryFn: () => base44.entities.OperationalCatalogEntry.filter({ active: true }, 'sort_order', 2000),
    staleTime: 5 * 60 * 1000,
  });
  const activePiece = pieces.find((piece) => piece.line_id === activePieceId) || pieces[0];
  if (!activePiece) return <div className="p-8 text-center text-white/45">Adicione peças ao carrinho para registrar as características.</div>;

  const visibleCatalogs = catalogEntries.filter((entry) => !entry.unit_id || selectedUnitId === 'all' || !selectedUnitId || entry.unit_id === selectedUnitId);
  const catalogOptions = (type, fallback) => {
    const values = visibleCatalogs.filter((entry) => entry.catalog_type === type).map((entry) => entry.label).filter(Boolean);
    return values.length ? [...new Set(values)] : fallback;
  };
  const update = (patch) => onPieceChange(activePiece.line_id, { ...activePiece, ...patch });
  const updateAttribute = (field, value) => update({ attributes: { ...(activePiece.attributes || {}), [field]: value } });
  const hasCondition = (activePiece.damages || []).length > 0 || (activePiece.risk_tags || []).length > 0;
  const pendingCount = pieces.filter(manualPieceNeedsAttention).length;
  const compatibleServices = services.filter((service) => !service.compatible_product_ids?.length || service.compatible_product_ids.includes(activePiece.product_id));
  const selectedServices = activePiece.services || [];
  const isPricing = pricingPieceId === activePiece.line_id;

  const changeServices = (nextServices) => {
    const nextPiece = { ...activePiece, services: nextServices };
    onPieceChange(activePiece.line_id, nextPiece);
    onRepricePiece?.(nextPiece);
  };

  const toggleService = (service) => {
    const exists = selectedServices.some((entry) => entry.service_id === service.id);
    changeServices(exists
      ? selectedServices.filter((entry) => entry.service_id !== service.id)
      : [...selectedServices, { service_id: service.id, name: service.name, quantity: 1 }]);
  };

  const updateServiceQuantity = (serviceId, delta) => {
    changeServices(selectedServices.map((entry) => entry.service_id === serviceId
      ? { ...entry, quantity: Math.max(1, Number(entry.quantity || 1) + delta) }
      : entry));
  };

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[280px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-white/10 bg-black/15">
        <div className="border-b border-white/10 p-4">
          <div className="flex items-center justify-between gap-3"><div><p className="font-semibold">Peças físicas</p><p className="text-xs text-white/40">{pieces.length} peça(s) · {pendingCount} pendência(s)</p></div><Badge variant="outline" className={pendingCount ? 'border-amber-400/30 text-amber-200' : 'border-emerald-400/30 text-emerald-300'}>{pendingCount ? 'revisar' : 'pronto'}</Badge></div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-2 p-3">
            {pieces.map((piece, index) => {
              const selected = piece.line_id === activePiece.line_id;
              const needsAttention = manualPieceNeedsAttention(piece);
              return (
                <button key={piece.line_id} type="button" onClick={() => onActivePieceChange(piece.line_id)} className={`w-full rounded-2xl border p-3 text-left transition ${selected ? 'border-orange-400/60 bg-orange-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
                  <div className="flex items-start gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-orange-500 text-white' : 'bg-white/5 text-white/40'}`}><Shirt className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold">{index + 1}. {piece.garment_type}</p>{needsAttention ? <AlertTriangle className="h-3.5 w-3.5 text-amber-300" /> : <Check className="h-3.5 w-3.5 text-emerald-300" />}</div><p className="mt-1 truncate text-xs text-white/40">{pieceSummary(piece)}</p></div></div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </aside>

      <ScrollArea className="min-h-0">
        <div className="space-y-6 p-5 md:p-6">
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-xs uppercase tracking-[0.16em] text-orange-300">Peça selecionada</p><h3 className="mt-1 text-xl font-bold">{activePiece.garment_type}</h3><p className="text-sm text-white/40">R$ {Number(activePiece.unit_price || 0).toFixed(2)} · cadastro manual individual</p></div>
            <Button type="button" variant="outline" onClick={() => onApplyAppearance(activePiece)} className="border-white/15 bg-white/5"><Copy className="mr-2 h-4 w-4" />Aplicar identificação às iguais</Button>
          </div>

          <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.025] p-5">
            <div><h4 className="font-semibold">Identificação visual</h4><p className="text-sm text-white/40">Use os atalhos ou digite livremente.</p></div>
            <div className="grid gap-5 md:grid-cols-2">
              <SuggestionField label="Cor predominante" value={activePiece.attributes?.color} options={catalogOptions('color', SUGGESTIONS.color)} onChange={(value) => updateAttribute('color', value)} placeholder="Ex.: azul-marinho" />
              <SuggestionField label="Marca" value={activePiece.attributes?.brand} options={catalogOptions('brand', [])} onChange={(value) => updateAttribute('brand', value)} placeholder="Ex.: Reserva" />
              <SuggestionField label="Tecido / composição" value={activePiece.attributes?.material} options={catalogOptions('material', SUGGESTIONS.material)} onChange={(value) => updateAttribute('material', value)} placeholder="Ex.: 80% algodão, 20% poliéster" />
              <SuggestionField label="Estampa" value={activePiece.attributes?.pattern} options={catalogOptions('pattern', SUGGESTIONS.pattern)} onChange={(value) => updateAttribute('pattern', value)} placeholder="Ex.: geométrica" />
              <SuggestionField label="Tamanho" value={activePiece.attributes?.size} options={catalogOptions('size', SUGGESTIONS.size)} onChange={(value) => updateAttribute('size', value)} placeholder="Ex.: 42 ou king" />
              <div className="space-y-2"><Label>Detalhes e acessórios</Label><Input value={activePiece.attributes?.freeform?.details || ''} onChange={(event) => updateAttribute('freeform', { ...(activePiece.attributes?.freeform || {}), details: event.target.value })} placeholder="Ex.: cinto, pedras, bordado, forro" className="border-white/10 bg-black/20" /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label className="flex items-center gap-2"><Ruler className="h-4 w-4 text-violet-300" />Largura (cm)</Label><Input type="number" min="0" step="0.1" value={activePiece.attributes?.width_cm ?? ''} onChange={(event) => updateAttribute('width_cm', event.target.value === '' ? undefined : Number(event.target.value))} className="border-white/10 bg-black/20" /></div>
              <div className="space-y-2"><Label className="flex items-center gap-2"><Ruler className="h-4 w-4 text-violet-300" />Altura/comprimento (cm)</Label><Input type="number" min="0" step="0.1" value={activePiece.attributes?.height_cm ?? ''} onChange={(event) => updateAttribute('height_cm', event.target.value === '' ? undefined : Number(event.target.value))} className="border-white/10 bg-black/20" /></div>
            </div>
          </section>

          <section className="space-y-4 rounded-3xl border border-violet-400/20 bg-violet-500/[0.055] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><h4 className="flex items-center gap-2 font-semibold"><Wrench className="h-4 w-4 text-violet-300" />Serviços desta peça</h4><p className="text-sm text-white/40">Combine limpeza, passadoria e tratamentos. O preço é recalculado no servidor.</p></div>
              <div className="text-right"><p className="text-xs text-white/40">Total da peça</p><p className="text-xl font-bold text-violet-200">R$ {Number(activePiece.total_amount ?? activePiece.unit_price ?? 0).toFixed(2)}</p></div>
            </div>

            {compatibleServices.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {compatibleServices.map((service) => {
                  const selected = selectedServices.find((entry) => entry.service_id === service.id);
                  return (
                    <div key={service.id} className={`rounded-2xl border p-3 transition ${selected ? 'border-violet-400/60 bg-violet-500/15' : 'border-white/10 bg-black/15 hover:border-white/20'}`}>
                      <button type="button" onClick={() => toggleService(service)} disabled={isPricing} className="w-full text-left disabled:opacity-50">
                        <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{service.name}</p><p className="mt-1 text-xs text-white/40">{service.category?.replaceAll('_', ' ') || 'serviço'}{service.estimated_minutes ? ` · ${service.estimated_minutes} min` : ''}</p></div><div className={`flex h-6 w-6 items-center justify-center rounded-lg border ${selected ? 'border-violet-300 bg-violet-400 text-slate-950' : 'border-white/15 text-transparent'}`}><Check className="h-3.5 w-3.5" /></div></div>
                        <p className="mt-3 text-sm font-medium text-violet-200">R$ {Number(selected?.unit_price ?? service.base_price ?? 0).toFixed(2)}</p>
                      </button>
                      {selected && <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3"><span className="text-xs text-white/40">Quantidade do serviço</span><div className="flex items-center gap-2 rounded-lg bg-black/20 p-1"><button type="button" disabled={isPricing || Number(selected.quantity || 1) <= 1} onClick={() => updateServiceQuantity(service.id, -1)} className="rounded p-1 hover:bg-white/10 disabled:opacity-30"><Minus className="h-3 w-3" /></button><span className="min-w-5 text-center text-xs font-semibold">{selected.quantity || 1}</span><button type="button" disabled={isPricing} onClick={() => updateServiceQuantity(service.id, 1)} className="rounded p-1 hover:bg-white/10 disabled:opacity-30"><Plus className="h-3 w-3" /></button></div></div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/40">Nenhum serviço estruturado está disponível para esta peça. O preço padrão do catálogo será preservado.</div>
            )}
            {isPricing && <div className="flex items-center gap-2 text-xs text-violet-200"><Loader2 className="h-3.5 w-3.5 animate-spin" />Recalculando preço, prazo e etapas…</div>}
            {selectedServices.length === 0 && compatibleServices.length > 0 && <p className="text-xs text-amber-200/80">Nenhum serviço selecionado. O sistema manterá o preço legado do produto.</p>}
          </section>

          <section className="space-y-5 rounded-3xl border border-white/10 bg-white/[0.025] p-5">
            <div><h4 className="font-semibold">Condição de entrada</h4><p className="text-sm text-white/40">Registre o que já existe antes do processamento.</p></div>
            <MultiChoice title="Avarias observadas" values={activePiece.damages || []} options={catalogOptions('damage', DAMAGES)} onChange={(damages) => update({ damages, condition_checked: true, customer_authorized_risks: damages.length || (activePiece.risk_tags || []).length ? false : activePiece.customer_authorized_risks })} tone="red" />
            <MultiChoice title="Riscos do tratamento" values={activePiece.risk_tags || []} options={catalogOptions('risk', RISKS)} onChange={(risk_tags) => update({ risk_tags, condition_checked: true, customer_authorized_risks: risk_tags.length || (activePiece.damages || []).length ? false : activePiece.customer_authorized_risks })} />
            <div className="space-y-2"><Label>Observações da peça</Label><Textarea value={activePiece.notes || ''} onChange={(event) => update({ notes: event.target.value })} placeholder="Local da mancha, estado dos botões, instruções do cliente…" className="min-h-24 border-white/10 bg-black/20" /></div>

            <div className="grid gap-3 md:grid-cols-2">
              <button type="button" onClick={() => update({ condition_checked: !activePiece.condition_checked })} className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${activePiece.condition_checked ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}><ShieldCheck className={`mt-0.5 h-5 w-5 ${activePiece.condition_checked ? 'text-emerald-300' : 'text-white/30'}`} /><div><p className="font-medium">Conferência visual realizada</p><p className="mt-1 text-xs text-white/40">Confirme mesmo quando não houver avaria aparente.</p></div></button>
              <button type="button" disabled={!hasCondition} onClick={() => hasCondition && update({ customer_authorized_risks: !activePiece.customer_authorized_risks })} className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${activePiece.customer_authorized_risks ? 'border-amber-400/50 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}><AlertTriangle className={`mt-0.5 h-5 w-5 ${activePiece.customer_authorized_risks ? 'text-amber-300' : 'text-white/30'}`} /><div><p className="font-medium">Cliente ciente das avarias e riscos</p><p className="mt-1 text-xs text-white/40">Necessário quando houver qualquer marcação acima.</p></div></button>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
