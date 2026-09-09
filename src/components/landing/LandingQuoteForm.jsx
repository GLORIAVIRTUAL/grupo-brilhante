import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, Trash2, Shirt, Loader2, Send, CheckCircle2, ChevronDown, AlertTriangle, Search } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import PieceServiceOptions from '@/components/landing/PieceServiceOptions';

const SUGGESTIONS = {
  color: ['Branco', 'Preto', 'Azul', 'Vermelho', 'Verde', 'Bege', 'Cinza', 'Rosa', 'Amarelo', 'Laranja', 'Roxo', 'Marrom', 'Vinho', 'Dourado', 'Prateado', 'Multicolorido', 'Outro'],
  material: ['Algodão', 'Poliéster', 'Lã', 'Seda', 'Linho', 'Couro', 'Viscose', 'Sintético', 'Jeans', 'Veludo', 'Camurça', 'Renda', 'Cetim', 'Malha', 'Nylon', 'Elastano', 'Outro'],
  pattern: ['Liso', 'Listrado', 'Xadrez', 'Floral', 'Estampado', 'Poá', 'Animal print', 'Geométrico', 'Abstrato', 'Tie-dye', 'Camuflado', 'Bordado', 'Outro'],
  size: ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG', 'Infantil', 'Único', 'Outro'],
};
const DAMAGES = ['Mancha', 'Rasgo', 'Furo', 'Desgaste', 'Desbotado', 'Costura solta', 'Botão ausente', 'Zíper danificado'];
const COLLECTION_PRICE = 15;
const FREE_COLLECTION_THRESHOLD = 150;

export default function LandingQuoteForm({ unitId }) {
  const [products, setProducts] = useState([]);
  const [services, setServices] = useState([]);
  const [ironing, setIroning] = useState({ percent: 70, active: true });
  const [collectionSelected, setCollectionSelected] = useState(false);
  const [pieces, setPieces] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [honeypot, setHoneypot] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [finalTotal, setFinalTotal] = useState(0);

  useEffect(() => {
    Promise.all([
      base44.entities.Product.list(),
      base44.entities.LaundryService.filter({ active: true }),
      base44.entities.IroningSettings.list('-updated_date', 1),
    ])
      .then(([productRows, serviceRows, ironingRows]) => {
        setProducts(productRows);
        setServices(serviceRows);
        if (ironingRows[0]) setIroning(ironingRows[0]);
      })
      .catch(() => {
        setProducts([]);
        setServices([]);
      });
  }, []);

  const addPiece = (product) => {
    const id = `p${Date.now()}`;
    setPieces((prev) => [...prev, {
      line_id: id,
      product_id: product.id,
      garment_type: product.name,
      unit_price: Number(product.price) || 0,
      quantity: 1,
      service_type: 'cleaning',
      include_ironing: false,
      special_service_ids: [],
      attributes: { color: '', brand: '', material: '', pattern: '', size: '' },
      damages: [],
      notes: '',
    }]);
    setExpandedId(id);
    setSearch('');
    setSearchFocused(false);
  };

  const filteredProducts = products.filter((p) =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase())
  );

  const specialServices = services.filter((service) => service.category === 'special_treatment');
  const serviceSubtotal = pieces.reduce((sum, piece) => {
    const basePrice = Number(piece.unit_price) || 0;
    const ironingPrice = piece.include_ironing ? basePrice * Number(ironing?.percent ?? 70) / 100 : 0;
    const specialPrice = specialServices
      .filter((service) => (piece.special_service_ids || []).includes(service.id))
      .reduce((total, service) => total + (Number(service.base_price) || 0), 0);
    return sum + (basePrice + ironingPrice + specialPrice) * (piece.quantity || 1);
  }, 0);
  const collectionIsFree = serviceSubtotal > FREE_COLLECTION_THRESHOLD;
  const collectionPrice = collectionSelected && !collectionIsFree ? COLLECTION_PRICE : 0;
  const estimatedTotal = serviceSubtotal + collectionPrice;
  const fmt = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const updatePiece = (id, patch) => {
    setPieces((prev) => prev.map((p) => p.line_id === id ? { ...p, ...patch } : p));
  };
  const updateAttr = (id, field, value) => {
    setPieces((prev) => prev.map((p) => p.line_id === id ? { ...p, attributes: { ...p.attributes, [field]: value } } : p));
  };
  const toggleDamage = (id, d) => {
    setPieces((prev) => prev.map((p) => {
      if (p.line_id !== id) return p;
      const has = (p.damages || []).includes(d);
      return { ...p, damages: has ? p.damages.filter((x) => x !== d) : [...(p.damages || []), d] };
    }));
  };
  const removePiece = (id) => setPieces((prev) => prev.filter((p) => p.line_id !== id));
  const changeQty = (id, delta) => {
    setPieces((prev) => prev.map((p) => p.line_id === id ? { ...p, quantity: Math.max(1, (p.quantity || 1) + delta) } : p));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Informe seu nome.');
    if (!form.phone.trim()) return setError('Informe seu telefone com DDD.');
    if (pieces.length === 0) return setError('Adicione ao menos uma peça.');
    setLoading(true);
    try {
      const lines = pieces.map((p, i) => {
        const attrs = [p.attributes?.color, p.attributes?.material, p.attributes?.pattern, p.attributes?.size, p.attributes?.brand].filter(Boolean).join(', ');
        const dmg = (p.damages || []).length ? ` | avarias: ${p.damages.join(', ')}` : '';
        const obs = p.notes ? ` | obs: ${p.notes}` : '';
        const mainService = p.include_ironing
          ? `Lavagem + Passadoria (+${Number(ironing?.percent ?? 70)}% do valor da peça)`
          : 'Lavagem';
        const extras = specialServices.filter((service) => (p.special_service_ids || []).includes(service.id));
        const extraText = extras.length ? ` | especiais: ${extras.map((service) => service.name).join(', ')}` : '';
        return `${p.quantity}x ${p.garment_type}${attrs ? ` (${attrs})` : ''} | serviço: ${mainService}${extraText}${dmg}${obs}`;
      });
      if (collectionSelected) {
        lines.push(collectionIsFree
          ? 'Coleta/entrega: Grátis (orçamento acima de R$ 150,00)'
          : `Coleta/entrega: ${fmt(COLLECTION_PRICE)}`);
      }
      const message = `Olá! Sou ${form.name.trim()} e gostaria de um orçamento:\n${lines.join('\n')}`;
      const res = await base44.functions.invoke('landing_widget_start', {
        name: form.name.trim(),
        phone: form.phone.trim(),
        message,
        unit_id: unitId || null,
        honeypot,
      });
      const data = res?.data || res;
      if (data?.error) return setError(data.error);
      setFinalTotal(estimatedTotal);
      setDone(true);
    } catch (err) {
      setError('Não foi possível enviar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="lq-success">
        <CheckCircle2 className="lq-success-icon" />
        <p className="lq-success-title">Orçamento recebido!</p>
        <div className="lq-success-total">
          <p>Valor estimado</p>
          <strong>{fmt(finalTotal)}</strong>
        </div>
        <p className="lq-success-copy">
          Sua solicitação foi enviada. Nossa equipe entrará em contato pelo número de WhatsApp informado para confirmar o pedido e todos os detalhes.
        </p>
        <p className="lq-warning">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          O valor pode ser ajustado caso alguma peça exija tratamento especial.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="lq-form">
      <input value={honeypot} onChange={(e) => setHoneypot(e.target.value)} type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      {/* Customer */}
      <div className="lq-row">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome" className="lq-input" />
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Telefone / WhatsApp" className="lq-input" />
      </div>

      {/* Search bar to locate garment types */}
      <div className="lq-search">
        <div className="relative">
          <Search className="lq-search-icon" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSearchFocused(true); }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            placeholder="Buscar tipo de peça (ex: camisa, vestido, manta...)"
            className="lq-input"
          />
        </div>
        {searchFocused && search && (
          <div className="lq-search-results">
            {filteredProducts.length === 0 ? (
              <p className="lq-empty px-3 py-4">Nenhuma peça encontrada para "{search}".</p>
            ) : (
              filteredProducts.slice(0, 20).map((prod) => (
                <button key={prod.id} type="button" onMouseDown={(e) => { e.preventDefault(); addPiece(prod); }} className="lq-search-option">
                  <Shirt className="w-4 h-4 text-[#FF6600] shrink-0" />
                  <span className="text-xs font-medium truncate flex-1">{prod.name}</span>
                  {Number(prod.price) > 0 ? <span className="text-[10px] text-[#806889]">{fmt(prod.price)}</span> : null}
                  <Plus className="w-3.5 h-3.5 text-[#806889]" />
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Pieces list */}
      <div className="lq-pieces">
        <AnimatePresence>
          {pieces.map((p, i) => {
            const open = expandedId === p.line_id;
            return (
              <motion.div key={p.line_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="lq-piece">
                <div className="lq-piece-head">
                  <button type="button" onClick={() => setExpandedId(open ? null : p.line_id)} className="lq-piece-toggle">
                    <Shirt className="w-4 h-4 text-[#FF6600] shrink-0" />
                    <span className="text-sm font-medium truncate">{i + 1}. {p.garment_type}</span>
                    <ChevronDown className={`w-4 h-4 text-[#806889] transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  <div className="lq-quantity">
                    <button type="button" onClick={() => changeQty(p.line_id, -1)} className="p-1 hover:bg-white/10 rounded"><Minus className="w-3 h-3" /></button>
                    <span className="text-xs font-semibold w-5 text-center">{p.quantity}</span>
                    <button type="button" onClick={() => changeQty(p.line_id, 1)} className="p-1 hover:bg-white/10 rounded"><Plus className="w-3 h-3" /></button>
                  </div>
                  <button type="button" onClick={() => removePiece(p.line_id)} className="lq-remove"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <AnimatePresence>
                  {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="lq-details space-y-3">
                      <PieceServiceOptions
                        piece={p}
                        updatePiece={(patch) => updatePiece(p.line_id, patch)}
                        ironing={ironing}
                        specialServices={specialServices}
                        fmt={fmt}
                      />
                      <div className="lq-attr-grid">
                        <AttrField label="Cor" value={p.attributes?.color} options={SUGGESTIONS.color} onChange={(v) => updateAttr(p.line_id, 'color', v)} />
                        <AttrField label="Tecido" value={p.attributes?.material} options={SUGGESTIONS.material} onChange={(v) => updateAttr(p.line_id, 'material', v)} />
                        <AttrField label="Estampa" value={p.attributes?.pattern} options={SUGGESTIONS.pattern} onChange={(v) => updateAttr(p.line_id, 'pattern', v)} />
                        <AttrField label="Tamanho" value={p.attributes?.size} options={SUGGESTIONS.size} onChange={(v) => updateAttr(p.line_id, 'size', v)} />
                      </div>
                      <input value={p.attributes?.brand || ''} onChange={(e) => updateAttr(p.line_id, 'brand', e.target.value)} placeholder="Marca (opcional)" className="lq-input" />
                      <div>
                        <p className="lq-attr-label">Avarias observadas</p>
                        <div className="lq-chips">
                          {DAMAGES.map((d) => {
                            const sel = (p.damages || []).includes(d);
                            return <button key={d} type="button" onClick={() => toggleDamage(p.line_id, d)} className={`lq-chip ${sel ? 'active' : ''}`}>{d}</button>;
                          })}
                        </div>
                      </div>
                      <textarea value={p.notes || ''} onChange={(e) => updatePiece(p.line_id, { notes: e.target.value })} placeholder="Observações da peça (local da mancha, estado...)" rows={2} className="lq-textarea" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Hint to add via search */}
      {pieces.length === 0 && (
        <p className="lq-empty">Use a busca acima para encontrar e adicionar suas peças.</p>
      )}

      {pieces.length > 0 && (
        <div className="lq-piece">
          <div className="lq-details space-y-2">
            <p className="lq-attr-label">Coleta e entrega (opcional)</p>
            <div className="lq-chips">
              <button type="button" onClick={() => setCollectionSelected(false)} className={`lq-chip ${!collectionSelected ? 'active' : ''}`}>Sem coleta</button>
              <button type="button" onClick={() => setCollectionSelected(true)} className={`lq-chip ${collectionSelected ? 'active' : ''}`}>
                Coleta e entrega · {collectionIsFree ? 'Grátis' : fmt(COLLECTION_PRICE)}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-red-400 text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</p>}

      {/* Estimated budget */}
      {collectionIsFree && (
        <div className="lq-free-collection" role="status">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Seu orçamento passou de R$ 150,00 — a coleta agora é grátis!
        </div>
      )}
      {pieces.length > 0 && (
        <div className="lq-estimate">
          <div>
            <span className="lq-estimate-label">Valor estimado</span>
            <p className="lq-warning">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              O valor pode ser ajustado caso alguma peça exija tratamento especial.
            </p>
          </div>
          <strong className="lq-estimate-value">{fmt(estimatedTotal)}</strong>
        </div>
      )}

      <button type="submit" disabled={loading || pieces.length === 0} className="lq-send">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {loading ? 'Enviando...' : `Pedir orçamento (${pieces.length} ${pieces.length === 1 ? 'peça' : 'peças'})`}
      </button>
    </form>
  );
}

function AttrField({ label, value, options, onChange }) {
  return (
    <div>
      <p className="lq-attr-label">{label}</p>
      <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={`Ex: ${options[0]}`} className="lq-input" />
      <div className="lq-chips">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => onChange(value === o ? '' : o)} className={`lq-chip ${value === o ? 'active' : ''}`}>{o}</button>
        ))}
      </div>
    </div>
  );
}