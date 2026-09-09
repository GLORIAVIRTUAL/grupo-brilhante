import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Brain, Loader2, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Target, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';

const SEVERITY_STYLES = {
  critical: { bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-300', icon: AlertTriangle, iconColor: 'text-red-400' },
  warning: { bg: 'bg-yellow-500/10 border-yellow-500/30', text: 'text-yellow-300', icon: AlertTriangle, iconColor: 'text-yellow-400' },
  opportunity: { bg: 'bg-blue-500/10 border-blue-500/30', text: 'text-blue-300', icon: Lightbulb, iconColor: 'text-blue-400' },
  good: { bg: 'bg-green-500/10 border-green-500/30', text: 'text-green-300', icon: CheckCircle2, iconColor: 'text-green-400' },
};

export default function GoogleAdsAIAnalysis({ campaigns, totals }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);

  const analyze = async () => {
    if (!campaigns || campaigns.length === 0) {
      toast.error('Sem dados de campanhas para analisar');
      return;
    }
    setLoading(true);
    setAnalysis(null);

    const summary = campaigns.map(c => ({
      nome: c.name,
      status: c.status,
      tipo: c.channel_type,
      impressoes: c.impressions || 0,
      cliques: c.clicks || 0,
      ctr_percent: ((c.ctr || 0) * 100).toFixed(2),
      cpc_medio_brl: (c.avg_cpc_brl || 0).toFixed(2),
      investido_brl: (c.cost_brl || 0).toFixed(2),
      conversoes: c.conversions || 0,
      orcamento_diario_brl: c.budget_brl || 0,
      cpa_brl: c.conversions > 0 ? ((c.cost_brl || 0) / c.conversions).toFixed(2) : 'sem conversões',
    }));

    const prompt = `
Você é um gestor de tráfego pago profissional sênior, especialista em Google Ads, com 10+ anos de experiência otimizando campanhas para o setor de serviços locais (lavanderias 5àsec no Brasil).

Analise os dados reais a seguir das campanhas dos últimos 30 dias e gere uma análise profissional e ACIONÁVEL.

DADOS CONSOLIDADOS:
- Total impressões: ${totals.impressions}
- Total cliques: ${totals.clicks}
- Total investido: R$ ${totals.cost.toFixed(2)}
- Total conversões: ${totals.conversions.toFixed(0)}
- CTR geral: ${totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : 0}%
- CPA geral: ${totals.conversions > 0 ? (totals.cost / totals.conversions).toFixed(2) : 'sem conversões'}

CAMPANHAS:
${JSON.stringify(summary, null, 2)}

BENCHMARKS PARA SERVIÇOS LOCAIS NO BRASIL:
- CTR Search bom: > 4% (excelente: > 7%)
- CTR Display bom: > 0.5%
- CPC para lavanderia: R$ 1,50 a R$ 4,00 (média BR)
- CPA aceitável para lavanderia: até R$ 25
- Conversão = lead qualificado (orçamento, WhatsApp)

Responda em JSON puro com a seguinte estrutura:
{
  "resumo_executivo": "2-3 frases avaliando a saúde geral das campanhas",
  "nota_geral": "número de 0 a 10",
  "principais_insights": [
    {
      "severidade": "critical|warning|opportunity|good",
      "titulo": "Frase curta e direta",
      "descricao": "Explicação técnica",
      "acao_recomendada": "O que fazer concretamente"
    }
  ],
  "campanhas_para_pausar": ["nome da campanha 1", ...],
  "campanhas_para_escalar": ["nome da campanha 1", ...],
  "proximos_passos": ["passo 1 prático", "passo 2", "passo 3"]
}

Seja DIRETO, técnico e prático. Identifique campanhas com problemas (CTR baixo, CPC alto, sem conversões) e oportunidades (escalar campanhas vencedoras). NÃO seja genérico.`;

    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            resumo_executivo: { type: 'string' },
            nota_geral: { type: 'string' },
            principais_insights: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severidade: { type: 'string' },
                  titulo: { type: 'string' },
                  descricao: { type: 'string' },
                  acao_recomendada: { type: 'string' },
                },
              },
            },
            campanhas_para_pausar: { type: 'array', items: { type: 'string' } },
            campanhas_para_escalar: { type: 'array', items: { type: 'string' } },
            proximos_passos: { type: 'array', items: { type: 'string' } },
          },
        },
      });
      setAnalysis(res);
      toast.success('Análise concluída');
    } catch (e) {
      toast.error('Falha ao analisar: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/20 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Análise IA — Gestor de Tráfego</h3>
            <p className="text-xs text-gray-400">Avaliação profissional + sugestões de otimização</p>
          </div>
        </div>
        <Button
          onClick={analyze}
          disabled={loading || !campaigns?.length}
          className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
        >
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analisando...</> : <><Brain className="w-4 h-4 mr-2" /> Analisar com IA</>}
        </Button>
      </div>

      {analysis && (
        <div className="space-y-4 mt-4">
          {/* Resumo + Nota */}
          <div className="flex gap-4 items-start">
            <div className="flex-shrink-0 w-20 h-20 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center justify-center">
              <div className="text-2xl font-bold text-[#FF6600]">{analysis.nota_geral}</div>
              <div className="text-[10px] text-gray-400 uppercase">Nota /10</div>
            </div>
            <div className="flex-1 p-4 rounded-lg bg-white/5 border border-white/10">
              <p className="text-sm text-gray-200 leading-relaxed">{analysis.resumo_executivo}</p>
            </div>
          </div>

          {/* Insights */}
          {analysis.principais_insights?.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-400" /> Insights e ações
              </h4>
              {analysis.principais_insights.map((insight, i) => {
                const style = SEVERITY_STYLES[insight.severidade] || SEVERITY_STYLES.opportunity;
                const Icon = style.icon;
                return (
                  <div key={i} className={`p-3 rounded-lg border ${style.bg}`}>
                    <div className="flex items-start gap-3">
                      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${style.iconColor}`} />
                      <div className="flex-1">
                        <div className={`font-semibold text-sm ${style.text}`}>{insight.titulo}</div>
                        <p className="text-xs text-gray-300 mt-1">{insight.descricao}</p>
                        <div className="mt-2 text-xs text-gray-400">
                          <span className="text-[#FF6600] font-semibold">▶ Ação:</span> {insight.acao_recomendada}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pausar / Escalar */}
          <div className="grid md:grid-cols-2 gap-3">
            {analysis.campanhas_para_pausar?.length > 0 && (
              <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <div className="flex items-center gap-2 text-red-300 text-sm font-semibold mb-2">
                  <TrendingDown className="w-4 h-4" /> Pausar / Revisar
                </div>
                <ul className="text-xs text-red-200/80 space-y-1">
                  {analysis.campanhas_para_pausar.map((c, i) => <li key={i}>• {c}</li>)}
                </ul>
              </div>
            )}
            {analysis.campanhas_para_escalar?.length > 0 && (
              <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                <div className="flex items-center gap-2 text-green-300 text-sm font-semibold mb-2">
                  <TrendingUp className="w-4 h-4" /> Escalar orçamento
                </div>
                <ul className="text-xs text-green-200/80 space-y-1">
                  {analysis.campanhas_para_escalar.map((c, i) => <li key={i}>• {c}</li>)}
                </ul>
              </div>
            )}
          </div>

          {/* Próximos passos */}
          {analysis.proximos_passos?.length > 0 && (
            <div className="p-4 rounded-lg bg-[#FF6600]/10 border border-[#FF6600]/30">
              <div className="flex items-center gap-2 text-[#FF6600] text-sm font-semibold mb-2">
                <Target className="w-4 h-4" /> Próximos passos práticos
              </div>
              <ol className="text-sm text-gray-200 space-y-1.5 list-decimal list-inside">
                {analysis.proximos_passos.map((p, i) => <li key={i}>{p}</li>)}
              </ol>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}