import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Shirt, CalendarX } from 'lucide-react';
import { toast } from "sonner";

export default function IroningServiceManager() {
  const [record, setRecord] = useState(null);
  const [percent, setPercent] = useState('70');
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const rows = await base44.entities.IroningSettings.list('-updated_date', 1);
    if (rows[0]) {
      setRecord(rows[0]);
      setPercent(String(rows[0].percent ?? 70));
      setActive(rows[0].active !== false);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    const value = parseFloat(String(percent).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      toast.error("Informe um percentual entre 1 e 100.");
      return;
    }
    setSaving(true);
    const data = { percent: value, active, days_label: 'Segunda a Sexta' };
    if (record) await base44.entities.IroningSettings.update(record.id, data);
    else await base44.entities.IroningSettings.create(data);
    setSaving(false);
    toast.success("Serviço de passadoria atualizado.");
    load();
  };

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="animate-spin text-[#FF6600]" /></div>;
  }

  const pct = parseFloat(String(percent).replace(',', '.')) || 0;

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shirt className="w-5 h-5 text-sky-400" /> Passadoria (só passar as roupas)
        </CardTitle>
        <CardDescription className="text-gray-400">
          Serviço de passar sem lavar. O valor é um percentual do preço de lavagem da mesma peça no catálogo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <Label>Serviço disponível</Label>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>

        <div className="space-y-2 max-w-xs">
          <Label>Percentual sobre o valor da lavagem (%)</Label>
          <Input
            type="number"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            autoComplete="off"
            className="bg-black/20 border-white/10"
          />
          <p className="text-xs text-gray-400">
            Exemplo: peça com lavagem de R$ 100,00 → passar custa R$ {(100 * pct / 100).toFixed(2).replace('.', ',')}.
          </p>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <CalendarX className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-200">
            <strong>Passadoria só de Segunda a Sexta-feira.</strong> Não é realizada aos sábados, domingos e feriados —
            a Glória é obrigada a informar isso e nunca pode agendar passadoria no sábado.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}