import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Brain, Loader2, ThumbsUp, AlertTriangle, Lightbulb, Target,
  TrendingUp, TrendingDown, Trophy, Zap, X
} from 'lucide-react';
import { toast } from 'sonner';

export default function CampaignAnalysis({ insights, totals, campaigns = [], datePresetLabel, onClose }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);

  const hasData = insights.length > 0 && totals.impressions > 0;

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const summary = insights.map(i => ({
        name: i.campaign_name,
        spend: Number(i.spend || 0),
        impressions: Number(i.impressions || 0),
        clicks: Number(i.clicks || 0),
        reach: Number(i.reach || 0),
        ctr: Number(i.ctr || 0),
        cpc: Number(i.cpc || 0),
      }));

      const avgCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions * 100) : 0;
      const avgCpc = totals.clicks > 0 ? (totals.spend / totals.clicks) : 0;
      const avgCpm = totals.impressions > 0 ? (totals.spend / totals.impressions * 1000) : 0;

      const campaignsList = campaigns.map(c => ({ name: c.name, objective: c.objective, status: c.status }));

      const noDataContext = !hasData ? `

⚠️ ATENÇÃO: A conta NÃO TEM ENTREGAS no período. As campanhas existem mas estão PAUSADAS, sem orçamento ativo, ou foram recém-criadas.

CAMPANHAS EXISTENTES NA CONTA (${campaigns.length}):
${JSON.stringify(campaignsList, null, 2)}

Sua análise deve focar em:
1. Por que não há entregas (provavelmente todas pausadas)
2. Quais campanhas reativar primeiro e por quê
3. Como estruturar a conta para começar a gerar resultados
4. O que falta para uma estratégia de tráfego pago funcional para lavanderia 5àsec
5. Recomendações para ativar a operação de tráfego pago do zero ou destravar a atual` : '';

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Você é um GESTOR DE TRÁFEGO PAGO SÊNIOR especializado em Meta Ads para lavanderias 5àsec no Brasil.

Analise os dados reais de campanhas abaixo como faria um profissional de tráfego pago experiente. Seja DIRETO, TÉCNICO e ACIONÁVEL.

PERÍODO: ${datePresetLabel}

TOTAIS:
- Gasto: R$ ${totals.spend.toFixed(2)}
- Impressões: ${totals.impressions.toLocaleString('pt-BR')}
- Cliques: ${totals.clicks.toLocaleString('pt-BR')}
- Alcance: ${totals.reach.toLocaleString('pt-BR')}
- CTR médio: ${avgCtr.toFixed(2)}%
- CPC médio: R$ ${avgCpc.toFixed(2)}
- CPM médio: R$ ${avgCpm.toFixed(2)}

CAMPANHAS COM ENTREGAS (${insights.length}):
${JSON.stringify(summary, null, 2)}
${noDataContext}

BENCHMARKS DO SETOR (Brasil — serviços/varejo local):
- CTR bom: 1.5-3%  | excelente: >3%
- CPC bom: R$ 0,50-1,50  | ruim: >R$ 3
- CPM bom: R$ 10-25  | ruim: >R$ 40

Faça uma análise COMPLETA de gestor de tráfego em JSON:

1. health_score: nota geral 0-100 da saúde da conta
2. overall_diagnosis: diagnóstico geral em 2-3 frases (objetivo, sem floreio)
3. top_performer: nome da melhor campanha + por quê
4. worst_performer: nome da pior campanha + por quê (se houver)
5. positives: lista de 3-5 pontos positivos concretos (com dados)
6. negatives: lista de 3-5 alertas/problemas concretos (com dados)
7. recommendations: lista de 4-6 RECOMENDAÇÕES ACIONÁVEIS, ordenadas por prioridade (do mais impactante para o menos). Cada uma com:
   - action: o que fazer (curto e direto)
   - reason: justificativa baseada em dados
   - expected_impact: impacto esperado (ex: "redução de 30% no CPC")
   - priority: "alta" | "média" | "baixa"
8. budget_reallocation: sugestão concreta de como redistribuir orçamento entre campanhas (pausar X, aumentar Y em Z%)
9. next_steps: 3 próximos passos imediatos (o que fazer hoje)

Tom: profissional, direto, baseado em números. Sem termos vagos como "melhorar o desempenho" — sempre seja específico.`,
        response_json_schema: {
          type: 'object',
          properties: {
            health_score: { type: 'number' },
            overall_diagnosis: { type: 'string' },
            top_performer: { type: 'string' },
            worst_performer: { type: 'string' },
            positives: { type: 'array', items: { type: 'string' } },
            negatives: { type: 'array', items: { type: 'string' } },
            recommendations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  action: { type: 'string' },
                  reason: { type: 'string' },
                  expected_impact: { type: 'string' },
                  priority: { type: 'string', enum: ['alta', 'média', 'baixa'] }
                }
              }
            },
            budget_reallocation: { type: 'string' },
            next_steps: { type: 'array', items: { type: 'string' } }
          },
          required: ['health_score', 'overall_diagnosis', 'positives', 'negatives', 'recommendations', 'next_steps']
        },
        model: 'claude_sonnet_4_6'
      });
      setAnalysis(result);
      toast.success('Análise profissional gerada!');
    } catch (error) {
      toast.error('Erro ao gerar análise.');
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (s) => s >= 75 ? 'text-green-400' : s >= 50 ? 'text-amber-400' : 'text-red-400';
  const priorityColor = (p) =>
    p === 'alta' ? 'bg-red-500/15 text-red-400 border-red-500/30' :
    p === 'média' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
    'bg-blue-500/15 text-blue-400 border-blue-500/30';

  return (
    <div className="rounded-2xl border border-[#FF6600]/30 bg-gradient-to-br from-[#4C12A1]/30 to-[#FF6600]/10 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-6 h-6 text-[#FF6600]" />
          <div>
            <div className="font-bold text-white text-lg">Análise IA — Gestor de Tráfego</div>
            <div className="text-xs text-gray-400">Diagnóstico profissional com recomendações acionáveis</div>
          </div>
        </div>
        {analysis && (
          <Button onClick={() => setAnalysis(null)} variant="ghost" size="icon" className="text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {!analysis && (
        <>
          {!hasData && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-200">
              ⚠️ Não há entregas no período. A IA vai analisar a estrutura da conta e recomendar o que fazer para ativar resultados.
            </div>
          )}
          <Button onClick={runAnalysis} disabled={loading || (insights.length === 0 && campaigns.length === 0)} className="w-full h-12 bg-[#FF6600] hover:bg-[#e55c00]">
            {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Brain className="w-5 h-5 mr-2" />}
            {loading ? 'Analisando como um gestor profissional...' : hasData ? 'Gerar análise completa do desempenho' : 'Diagnosticar conta e recomendar próximos passos'}
          </Button>
        </>
      )}

      {analysis && (
        <div className="space-y-4">
          {/* Health Score + Diagnóstico */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-center">
              <div className="text-xs uppercase text-gray-400 tracking-wide">Saúde da conta</div>
              <div className={`text-5xl font-bold mt-1 ${scoreColor(analysis.health_score)}`}>{analysis.health_score}</div>
              <div className="text-xs text-gray-500">de 100</div>
            </div>
            <div className="md:col-span-2 rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="text-xs uppercase text-gray-400 tracking-wide mb-1">Diagnóstico geral</div>
              <p className="text-white text-sm leading-relaxed">{analysis.overall_diagnosis}</p>
            </div>
          </div>

          {/* Top & Worst */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {analysis.top_performer && (
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4">
                <div className="flex items-center gap-2 text-green-400 text-xs uppercase tracking-wide"><Trophy className="w-4 h-4" /> Melhor campanha</div>
                <p className="text-white text-sm mt-1">{analysis.top_performer}</p>
              </div>
            )}
            {analysis.worst_performer && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                <div className="flex items-center gap-2 text-red-400 text-xs uppercase tracking-wide"><TrendingDown className="w-4 h-4" /> Pior campanha</div>
                <p className="text-white text-sm mt-1">{analysis.worst_performer}</p>
              </div>
            )}
          </div>

          {/* Positivos & Negativos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
              <div className="flex items-center gap-2 text-green-400 font-semibold mb-2"><ThumbsUp className="w-4 h-4" /> Pontos positivos</div>
              <ul className="space-y-1.5">
                {analysis.positives?.map((p, i) => (
                  <li key={i} className="text-sm text-gray-200 flex gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span> {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 text-amber-400 font-semibold mb-2"><AlertTriangle className="w-4 h-4" /> Alertas</div>
              <ul className="space-y-1.5">
                {analysis.negatives?.map((n, i) => (
                  <li key={i} className="text-sm text-gray-200 flex gap-2">
                    <span className="text-amber-400 flex-shrink-0">!</span> {n}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Recomendações */}
          <div className="rounded-xl border border-[#FF6600]/30 bg-[#FF6600]/5 p-4">
            <div className="flex items-center gap-2 text-[#FF6600] font-semibold mb-3"><Lightbulb className="w-4 h-4" /> Recomendações acionáveis</div>
            <div className="space-y-3">
              {analysis.recommendations?.map((r, i) => (
                <div key={i} className="rounded-lg bg-black/30 border border-white/10 p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="font-semibold text-white text-sm">{i + 1}. {r.action}</div>
                    <Badge className={`text-xs border ${priorityColor(r.priority)}`}>{r.priority}</Badge>
                  </div>
                  <p className="text-xs text-gray-400 mb-1">{r.reason}</p>
                  {r.expected_impact && (
                    <div className="text-xs text-green-400 flex items-center gap-1 mt-1">
                      <TrendingUp className="w-3 h-3" /> Impacto esperado: {r.expected_impact}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Realocação de orçamento */}
          {analysis.budget_reallocation && (
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center gap-2 text-white font-semibold mb-2"><Target className="w-4 h-4 text-[#FF6600]" /> Realocação de orçamento sugerida</div>
              <p className="text-sm text-gray-300 leading-relaxed">{analysis.budget_reallocation}</p>
            </div>
          )}

          {/* Próximos passos */}
          <div className="rounded-xl border border-[#4C12A1]/30 bg-[#4C12A1]/10 p-4">
            <div className="flex items-center gap-2 text-white font-semibold mb-2"><Zap className="w-4 h-4 text-[#FF6600]" /> Próximos passos (faça hoje)</div>
            <ol className="space-y-1.5">
              {analysis.next_steps?.map((s, i) => (
                <li key={i} className="text-sm text-gray-200 flex gap-2">
                  <span className="text-[#FF6600] font-bold flex-shrink-0">{i + 1}.</span> {s}
                </li>
              ))}
            </ol>
          </div>

          <Button onClick={runAnalysis} disabled={loading} variant="outline" className="w-full bg-transparent border-white/15 text-white hover:bg-white/10">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Brain className="w-4 h-4 mr-2" />}
            Gerar nova análise
          </Button>
        </div>
      )}
    </div>
  );
}