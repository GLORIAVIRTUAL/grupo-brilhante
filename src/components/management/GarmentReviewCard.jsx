import { Check, FileImage } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CatalogMultiField, CatalogSelectField } from '@/components/management/CatalogChoiceFields';

export const FALLBACK_CATALOG_OPTIONS = {
  size: ['PP', 'P', 'M', 'G', 'GG', 'XG', 'Único'],
  damage: ['Mancha', 'Rasgo', 'Furo', 'Desgaste', 'Desbotado', 'Costura solta', 'Botão ausente', 'Zíper danificado'],
  brand: [],
  color: ['Branco', 'Preto', 'Cinza', 'Azul', 'Vermelho', 'Verde', 'Amarelo', 'Rosa', 'Marrom', 'Bege', 'Estampado', 'Colorido'],
  pattern: ['Liso', 'Estampado', 'Listrado', 'Xadrez', 'Floral', 'Poá'],
  material: ['Algodão', 'Poliéster', 'Linho', 'Seda', 'Lã', 'Jeans', 'Couro', 'Viscose', 'Elastano', 'Misto'],
};

const EMPTY_ATTRIBUTES = { color: '', brand: '', pattern: '', size: '', material: '' };

function currency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function confidenceTone(confidence) {
  if (confidence >= 0.92) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (confidence >= 0.75) return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
  return 'bg-red-500/15 text-red-200 border-red-500/30';
}

export default function GarmentReviewCard({ item, index, products, onChange, catalogOptions, onImageClick }) {
  const selectedProduct = products.find((product) => product.id === item.product_id)
    || products.find((product) => product.name && product.name === (item.product_name || item.garment_type));
  const confidence = Number(item.confidence || 0);
  const needsAttention = item.recognition_status !== 'confirmed';

  const updateProduct = (productId) => {
    const product = products.find((candidate) => candidate.id === productId);
    onChange({
      ...item,
      product_id: product?.id || null,
      garment_type: product?.name || 'Peça não identificada',
      unit_price: Number(product?.price || 0),
      subtotal: Number(product?.price || 0) * Number(item.qty || 1),
      total_amount: Number(product?.price || 0) * Number(item.qty || 1),
      recognition_status: product ? 'confirmed' : 'suggested',
    });
  };

  const updateField = (field, value) => {
    const next = { ...item, [field]: value };
    if (field === 'qty' || field === 'unit_price') {
      next.subtotal = Number(next.qty || 1) * Number(next.unit_price || 0);
      next.total_amount = next.subtotal - Number(next.discount_amount || 0) + Number(next.additional_amount || 0);
    }
    onChange(next);
  };

  const updateAttribute = (field, value) => {
    onChange({ ...item, attributes: { ...EMPTY_ATTRIBUTES, ...(item.attributes || {}), [field]: value } });
  };

  return (
    <article className={`rounded-2xl border p-4 ${needsAttention ? 'border-amber-400/40 bg-amber-400/5' : 'border-white/10 bg-white/[0.04]'}`}>
      <div className="grid gap-4 lg:grid-cols-[150px_1fr]">
        <div>
          {item.image_url ? (
            <img
              src={item.image_url}
              alt={`Peça ${index + 1}`}
              onClick={onImageClick ? () => onImageClick(item.image_url) : undefined}
              className={`h-40 w-full rounded-xl object-cover ${onImageClick ? 'cursor-zoom-in' : ''}`}
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-xl bg-white/5"><FileImage className="h-8 w-8 text-white/30" /></div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline" className={confidenceTone(confidence)}>{Math.round(confidence * 100)}% confiança</Badge>
            {needsAttention ? <Badge variant="outline" className="border-amber-400/30 text-amber-200">revisar</Badge> : <Badge variant="outline" className="border-emerald-500/30 text-emerald-300"><Check className="mr-1 h-3 w-3" />confirmado</Badge>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_110px_140px]">
            <div className="space-y-1.5">
              <Label>Item do catálogo</Label>
              <Select value={selectedProduct?.id || ''} onValueChange={updateProduct}>
                <SelectTrigger className="border-white/10 bg-black/20"><SelectValue placeholder="Selecione a peça" /></SelectTrigger>
                <SelectContent>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name} · {currency(product.price)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Quantidade</Label>
              <Input type="number" min="1" max="99" value={item.qty || 1} onChange={(event) => updateField('qty', Math.max(1, Number(event.target.value || 1)))} className="border-white/10 bg-black/20" />
            </div>
            <div className="space-y-1.5">
              <Label>Preço unitário</Label>
              <Input type="number" min="0" step="0.01" value={item.unit_price ?? selectedProduct?.price ?? 0} onChange={(event) => updateField('unit_price', Math.max(0, Number(event.target.value || 0)))} className="border-white/10 bg-black/20" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[['color', 'Cor'], ['pattern', 'Estampa'], ['material', 'Material']].map(([field, label]) => (
              <CatalogSelectField
                key={field}
                label={label}
                value={item.attributes?.[field]}
                options={catalogOptions[field]?.length ? catalogOptions[field] : FALLBACK_CATALOG_OPTIONS[field]}
                onChange={(value) => updateAttribute(field, value)}
              />
            ))}
            <CatalogSelectField label="Marca" value={item.attributes?.brand} options={catalogOptions.brand} onChange={(value) => updateAttribute('brand', value)} />
            <CatalogSelectField label="Tamanho" value={item.attributes?.size} options={catalogOptions.size} onChange={(value) => updateAttribute('size', value)} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <CatalogMultiField label="Avarias e riscos" values={item.damages || []} options={catalogOptions.damage} onChange={(damages) => onChange({ ...item, damages })} />
            <div className="space-y-1.5">
              <Label>Observação</Label>
              <Input value={item.notes || ''} onChange={(event) => updateField('notes', event.target.value)} className="border-white/10 bg-black/20" />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}