import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calculator, Ruler, Save, Pencil } from "lucide-react";
import { toast } from "sonner";

const PI = 3.14;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const brl = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

const DEFAULT_PRICES = { cortina_tipo_I: 30, cortina_tipo_II: 45, cortina_tipo_III: 65, tapete: 80 };

const PRODUCTS = [
  { id: 'cortina', label: 'Cortina', shape: 'rect', delivery: '3 a 5 dias úteis' },
  { id: 'tapete_quad', label: 'Tapete quadrangular / retangular', shape: 'rect', delivery: '10 a 15 dias' },
  { id: 'tapete_circular', label: 'Tapete circular', shape: 'circle', delivery: '10 a 15 dias' },
];

export default function SquareMeterCalculator() {
  const [productType, setProductType] = useState('cortina');
  const [cortinaTipo, setCortinaTipo] = useState('I');
  const [width, setWidth] = useState('');
  const [length, setLength] = useState('');
  const [diameter, setDiameter] = useState('');

  const [pricing, setPricing] = useState(DEFAULT_PRICES);
  const [pricingId, setPricingId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_PRICES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const records = await base44.entities.SquareMeterPricing.list('', 1);
        if (records.length > 0) {
          setPricing(records[0]);
          setDraft(records[0]);
          setPricingId(records[0].id);
        } else {
          const created = await base44.entities.SquareMeterPricing.create(DEFAULT_PRICES);
          setPricing(created);
          setDraft(created);
          setPricingId(created.id);
        }
      } catch (e) {
        console.error('Erro ao carregar preços por m²:', e);
      }
    })();
  }, []);

  const product = PRODUCTS.find(p => p.id === productType);

  const cortinaPrice = (tipo) => pricing[`cortina_tipo_${tipo}`];

  const result = (() => {
    const w = parseFloat(String(width).replace(',', '.'));
    const l = parseFloat(String(length).replace(',', '.'));
    const d = parseFloat(String(diameter).replace(',', '.'));

    if (product.shape === 'circle') {
      if (!(d > 0)) return null;
      const area = round2((PI * d * d) / 4);
      return { area, unit: pricing.tapete, total: round2(area * pricing.tapete) };
    }
    if (!(w > 0) || !(l > 0)) return null;
    const area = round2(w * l);
    const unit = productType === 'cortina' ? cortinaPrice(cortinaTipo) : pricing.tapete;
    return { area, unit, total: round2(area * unit) };
  })();

  const handleSave = async () => {
    const payload = {
      cortina_tipo_I: parseFloat(String(draft.cortina_tipo_I).replace(',', '.')) || 0,
      cortina_tipo_II: parseFloat(String(draft.cortina_tipo_II).replace(',', '.')) || 0,
      cortina_tipo_III: parseFloat(String(draft.cortina_tipo_III).replace(',', '.')) || 0,
      tapete: parseFloat(String(draft.tapete).replace(',', '.')) || 0,
    };
    setSaving(true);
    try {
      if (pricingId) {
        await base44.entities.SquareMeterPricing.update(pricingId, payload);
      } else {
        const created = await base44.entities.SquareMeterPricing.create(payload);
        setPricingId(created.id);
      }
      setPricing(payload);
      setEditing(false);
      toast.success('Preços por m² atualizados! A Glória já usa os novos valores.');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao salvar os preços.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-cyan-400" />
          Calculadora por m² (Cortinas e Tapetes)
        </CardTitle>
        <CardDescription className="text-gray-400">
          Calcule o valor da lavagem por metro quadrado. A Glória usa exatamente estas regras no WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Preços editáveis */}
        <div className="p-4 rounded-xl bg-black/20 border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-cyan-300">Preços por m² (R$)</Label>
            {!editing ? (
              <Button size="sm" variant="outline" className="bg-white/5 border-white/10 hover:bg-white/10 gap-1 h-8"
                onClick={() => { setDraft(pricing); setEditing(true); }}>
                <Pencil className="w-3.5 h-3.5" /> Editar preços
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="h-8 text-gray-400 hover:text-white"
                  onClick={() => { setDraft(pricing); setEditing(false); }}>
                  Cancelar
                </Button>
                <Button size="sm" className="h-8 bg-[#FF6600] hover:bg-[#e55c00] gap-1" onClick={handleSave} disabled={saving}>
                  <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { key: 'cortina_tipo_I', label: 'Cortina Tipo I' },
              { key: 'cortina_tipo_II', label: 'Cortina Tipo II' },
              { key: 'cortina_tipo_III', label: 'Cortina Tipo III' },
              { key: 'tapete', label: 'Tapete (m²)' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <span className="text-xs text-gray-400">{f.label}</span>
                {editing ? (
                  <Input
                    type="text" inputMode="decimal"
                    value={draft[f.key]}
                    onChange={(e) => setDraft(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="bg-black/30 border-white/10 h-9"
                  />
                ) : (
                  <div className="text-lg font-bold text-[#FF6600]">{brl(pricing[f.key])}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Produto</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PRODUCTS.map(p => (
              <button
                key={p.id}
                onClick={() => setProductType(p.id)}
                className={`p-3 rounded-lg border text-sm text-left transition-colors ${
                  productType === p.id
                    ? 'bg-cyan-600/20 border-cyan-500 text-white'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/30'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {productType === 'cortina' && (
          <div className="space-y-2">
            <Label>Tipo da cortina</Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { t: 'I', desc: 'Tipo I' },
                { t: 'II', desc: 'Tipo II (Especial)' },
                { t: 'III', desc: 'Tipo III (Dupla)' },
              ].map(o => (
                <button
                  key={o.t}
                  onClick={() => setCortinaTipo(o.t)}
                  className={`p-3 rounded-lg border text-sm transition-colors ${
                    cortinaTipo === o.t
                      ? 'bg-[#FF6600]/20 border-[#FF6600] text-white'
                      : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/30'
                  }`}
                >
                  <div className="font-medium">{o.desc}</div>
                  <div className="text-xs text-gray-400">{brl(cortinaPrice(o.t))}/m²</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {product.shape === 'circle' ? (
            <div className="space-y-2 sm:col-span-2">
              <Label>Diâmetro (m)</Label>
              <Input
                type="text" inputMode="decimal" placeholder="Ex: 2,00"
                value={diameter} onChange={(e) => setDiameter(e.target.value)}
                className="bg-black/20 border-white/10"
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Altura (m)</Label>
                <Input
                  type="text" inputMode="decimal" placeholder="Ex: 1,50"
                  value={width} onChange={(e) => setWidth(e.target.value)}
                  className="bg-black/20 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label>Comprimento (m)</Label>
                <Input
                  type="text" inputMode="decimal" placeholder="Ex: 2,00"
                  value={length} onChange={(e) => setLength(e.target.value)}
                  className="bg-black/20 border-white/10"
                />
              </div>
            </>
          )}
        </div>

        <div className="p-4 rounded-xl bg-black/20 border border-white/10">
          {result ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Ruler className="w-4 h-4 text-cyan-400" />
                Área: <span className="text-white font-medium">{result.area.toFixed(2).replace('.', ',')} m²</span>
                <span className="text-gray-600">×</span>
                <span className="text-white font-medium">{brl(result.unit)}/m²</span>
              </div>
              <div className="text-2xl font-bold text-[#FF6600]">
                Valor da lavagem: {brl(result.total)}
              </div>
              <div className="text-xs text-gray-400">Prazo de entrega: {product.delivery}</div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">Preencha as medidas para ver o valor.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}