import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Cpu, Thermometer, Save, Loader2, Check } from 'lucide-react';

const MODELS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Econômico — recomendado)', hint: 'Barato e rápido. Suporta todas as funções da Glória: ferramentas, agendamento, fotos e áudio.' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (Mais barato)', hint: 'O mais econômico. Um pouco menos preciso em regras longas.' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Alta precisão)', hint: 'Mais caro. Use só se precisar de máxima precisão nas regras.' }
];

export default function AiModelSettings() {
  const [record, setRecord] = useState(null);
  const [model, setModel] = useState('gemini-2.5-flash');
  const [temperature, setTemperature] = useState(0.3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await base44.entities.AiSettings.list('-created_date', 1);
      if (list.length > 0) {
        setRecord(list[0]);
        setModel(/^gemini/.test(list[0].model || '') ? list[0].model : 'gemini-2.5-flash');
        setTemperature(typeof list[0].temperature === 'number' ? list[0].temperature : 0.3);
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      if (record) {
        await base44.entities.AiSettings.update(record.id, { model, temperature });
      } else {
        const created = await base44.entities.AiSettings.create({ model, temperature });
        setRecord(created);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const hint = MODELS.find((m) => m.value === model)?.hint;

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-blue-400" /> Modelo e Parâmetros
        </CardTitle>
        <CardDescription className="text-gray-400">
          Configure o cérebro da sua IA. Estas opções valem para todas as conversas da Glória.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-[#FF6600]" /></div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Modelo de IA</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="bg-white/5 border-white/10">
                    <SelectValue placeholder="Selecione o modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">{hint}</p>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between">
                  <Label className="flex items-center gap-2">
                    <Thermometer className="w-4 h-4 text-orange-400" />
                    Temperatura (Criatividade)
                  </Label>
                  <span className="text-sm font-mono text-[#FF6600]">{temperature}</span>
                </div>
                <Slider
                  value={[temperature]}
                  max={1}
                  step={0.1}
                  onValueChange={(vals) => setTemperature(vals[0])}
                  className="py-4"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Preciso (0.0)</span>
                  <span>Criativo (1.0)</span>
                </div>
                <p className="text-xs text-gray-500">Para atendimento com regras rígidas, use entre 0.2 e 0.3.</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              {saved && (
                <span className="text-sm text-green-400 flex items-center gap-1">
                  <Check className="w-4 h-4" /> Salvo
                </span>
              )}
              <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Salvar Configurações de IA
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}