import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles, Loader2, Lightbulb } from 'lucide-react';
import usePersistentState from '@/lib/usePersistentState';

export default function GoogleAdsResearch({ onUseRecommendation }) {
  const [city, setCity] = usePersistentState('gads_research_city', '');
  const [budget, setBudget] = usePersistentState('gads_research_budget', 15);
  const [objective, setObjective] = usePersistentState('gads_research_objective', 'Atrair novos clientes para lavanderia 5àsec');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = usePersistentState('gads_research_result', null);

  const handleGenerate = async () => {
    if (!city) return;
    setLoading(true);
    setResult(null);
    try {
      const schema = {
        type: 'object',
        properties: {
          campaign_name: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          negative_keywords: { type: 'array', items: { type: 'string' } },
          headlines: { type: 'array', items: { type: 'string' } },
          descriptions: { type: 'array', items: { type: 'string' } },
          target_audience: { type: 'string' },
          recommended_daily_budget_brl: { type: 'number' },
          estimated_clicks_per_day: { type: 'string' },
          strategy_notes: { type: 'string' },
        },
        required: ['campaign_name', 'keywords', 'headlines', 'descriptions'],
      };

      const prompt = `Você é especialista em Google Ads para lavanderias 5àsec no Brasil.
Crie uma estratégia COMPLETA de campanha de PESQUISA (Search) para:
- Cidade: ${city}
- Orçamento diário: R$ ${budget}
- Objetivo: ${objective}

Regras:
- "headlines" devem ter NO MÁXIMO 30 caracteres cada (gere pelo menos 8)
- "descriptions" devem ter NO MÁXIMO 90 caracteres cada (gere pelo menos 3)
- "keywords" devem ser palavras-chave reais que pessoas digitam no Google buscando lavanderia (gere pelo menos 15)
- "negative_keywords" são palavras a evitar (ex: "máquina", "grátis", "trabalho")
- Use o tom premium e profissional da marca 5àsec`;

      const res = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: schema,
      });
      setResult(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card className="bg-white/5 backdrop-blur-xl border-white/10 p-6 text-white">
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4 text-white">
          <Sparkles className="w-5 h-5 text-[#FF6600]" />
          Briefing da Campanha
        </h3>
        <div className="space-y-4">
          <div>
            <Label className="text-gray-300">Cidade / Região</Label>
            <Input
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="Ex: São Paulo - SP"
              className="bg-white/5 border-white/10 text-white"
            />
          </div>
          <div>
            <Label className="text-gray-300">Orçamento diário (R$)</Label>
            <Input
              type="number"
              value={budget}
              onChange={e => setBudget(Number(e.target.value))}
              className="bg-white/5 border-white/10 text-white"
            />
          </div>
          <div>
            <Label className="text-gray-300">Objetivo</Label>
            <Textarea
              value={objective}
              onChange={e => setObjective(e.target.value)}
              className="bg-white/5 border-white/10 text-white"
              rows={3}
            />
          </div>
          <Button
            onClick={handleGenerate}
            disabled={loading || !city}
            className="w-full bg-[#FF6600] hover:bg-[#FF6600]/90"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4 mr-2" /> Gerar Estratégia com IA</>}
          </Button>
        </div>
      </Card>

      <Card className="bg-white/5 backdrop-blur-xl border-white/10 p-6 text-white">
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4 text-white">
          <Lightbulb className="w-5 h-5 text-yellow-400" />
          Estratégia Recomendada
        </h3>
        {!result && !loading && (
          <div className="text-gray-400 text-sm text-center py-12">
            Preencha o briefing e clique em "Gerar Estratégia" para receber recomendações personalizadas da IA.
          </div>
        )}
        {loading && (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-[#FF6600] mx-auto" />
            <p className="text-gray-400 mt-3 text-sm">A IA está pesquisando o melhor para você...</p>
          </div>
        )}
        {result && (
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-gray-400 text-xs uppercase mb-1">Nome da Campanha</div>
              <div className="font-semibold text-white">{result.campaign_name}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs uppercase mb-1">Headlines ({result.headlines?.length})</div>
              <div className="flex flex-wrap gap-1">
                {result.headlines?.map((h, i) => (
                  <span key={i} className="px-2 py-1 bg-[#FF6600]/20 text-[#FF6600] rounded text-xs">{h}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-gray-400 text-xs uppercase mb-1">Descriptions</div>
              <ul className="space-y-1 text-gray-200">
                {result.descriptions?.map((d, i) => <li key={i}>• {d}</li>)}
              </ul>
            </div>
            <div>
              <div className="text-gray-400 text-xs uppercase mb-1">Palavras-chave ({result.keywords?.length})</div>
              <div className="flex flex-wrap gap-1">
                {result.keywords?.map((k, i) => (
                  <span key={i} className="px-2 py-0.5 bg-white/10 text-white rounded text-xs">{k}</span>
                ))}
              </div>
            </div>
            {result.strategy_notes && (
              <div className="p-3 bg-white/5 rounded-lg text-gray-300 text-xs">
                💡 {result.strategy_notes}
              </div>
            )}
            <Button
              onClick={() => onUseRecommendation?.(result)}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              Usar esta estratégia para criar campanha →
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}