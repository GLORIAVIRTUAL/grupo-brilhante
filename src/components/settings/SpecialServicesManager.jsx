import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Save, Plus, Trash2 } from 'lucide-react';
import { toast } from "sonner";

const EMPTY_ROW = { item_label: '', keywords: '', bactericida: '', revitalizante: '', impermeabilizacao: '', per_m2: false, sort_order: 50 };

export default function SpecialServicesManager() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const list = await base44.entities.SpecialServicePricing.list('sort_order');
    setRows(list);
    setLoading(false);
  };

  const setField = (id, field, value) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

  const saveAll = async () => {
    setSaving(true);
    try {
      await base44.entities.SpecialServicePricing.bulkUpdate(rows.map(r => ({
        id: r.id,
        item_label: r.item_label,
        keywords: r.keywords || '',
        bactericida: num(r.bactericida),
        revitalizante: num(r.revitalizante),
        impermeabilizacao: num(r.impermeabilizacao),
        per_m2: !!r.per_m2,
        sort_order: Number(r.sort_order) || 0
      })));
      toast.success("Tabela salva. A Glória já usa estes valores.");
      load();
    } catch (e) {
      toast.error("Erro ao salvar a tabela.");
    } finally {
      setSaving(false);
    }
  };

  const addRow = async () => {
    await base44.entities.SpecialServicePricing.create({ ...EMPTY_ROW, item_label: 'Nova peça', bactericida: 0 });
    load();
  };

  const removeRow = async (id) => {
    if (!confirm('Remover esta linha da tabela?')) return;
    await base44.entities.SpecialServicePricing.delete(id);
    load();
  };

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-pink-400" />
            Serviços Especiais e Tabela de Preços
          </CardTitle>
          <CardDescription className="text-gray-400">
            Estes valores ficam salvos no banco de dados e são consultados pela Glória em cada atendimento. Edite aqui e a IA passa a usar imediatamente.
          </CardDescription>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={addRow} className="border-white/10 hover:bg-white/5 text-gray-300">
            <Plus className="w-4 h-4 mr-2" /> Linha
          </Button>
          <Button onClick={saveAll} disabled={saving} className="bg-pink-600 hover:bg-pink-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Salvar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin text-pink-400" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-300">
              <thead className="text-xs text-gray-400 uppercase bg-black/20 border-b border-white/10">
                <tr>
                  <th className="px-3 py-3">Peça</th>
                  <th className="px-3 py-3">Palavras-chave (IA)</th>
                  <th className="px-3 py-3">Bactericida</th>
                  <th className="px-3 py-3">Branco+ / Revit. / Engom.</th>
                  <th className="px-3 py-3">Impermeabilização</th>
                  <th className="px-3 py-3">Ordem</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/5">
                    <td className="px-3 py-2">
                      <Input value={row.item_label || ''} onChange={(e) => setField(row.id, 'item_label', e.target.value)} className="bg-black/20 border-white/10 h-9 min-w-[140px]" />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={row.keywords || ''} onChange={(e) => setField(row.id, 'keywords', e.target.value)} placeholder="edredom, cobertor, manta" className="bg-black/20 border-white/10 h-9 min-w-[220px]" />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="number" value={row.bactericida ?? ''} onChange={(e) => setField(row.id, 'bactericida', e.target.value)} className="bg-black/20 border-white/10 h-9 w-24" />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="number" value={row.revitalizante ?? ''} onChange={(e) => setField(row.id, 'revitalizante', e.target.value)} placeholder="-" className="bg-black/20 border-white/10 h-9 w-24" />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="number" value={row.impermeabilizacao ?? ''} onChange={(e) => setField(row.id, 'impermeabilizacao', e.target.value)} placeholder="-" className="bg-black/20 border-white/10 h-9 w-24" />
                    </td>
                    <td className="px-3 py-2">
                      <Input type="number" value={row.sort_order ?? 0} onChange={(e) => setField(row.id, 'sort_order', e.target.value)} className="bg-black/20 border-white/10 h-9 w-20" />
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => removeRow(row.id)} className="text-red-400 hover:text-red-300">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-500 mt-4">
              As palavras-chave são o que a IA procura na conversa para aplicar o valor certo. A linha "Demais Peças" deve ficar sem palavras-chave (é o valor padrão).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}