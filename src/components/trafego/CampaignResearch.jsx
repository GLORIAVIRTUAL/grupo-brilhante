import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Lightbulb, Target, DollarSign, Users, Sparkles, MapPin, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import usePersistentState from '@/lib/usePersistentState';

const OBJECTIVE_LABELS = {
  OUTCOME_AWARENESS: 'Reconhecimento',
  OUTCOME_TRAFFIC: 'Tráfego',
  OUTCOME_ENGAGEMENT: 'Engajamento',
  OUTCOME_LEADS: 'Cadastros / Leads',
  OUTCOME_APP_PROMOTION: 'Promoção de App',
  OUTCOME_SALES: 'Vendas',
};

export default function CampaignResearch({ onUseRecommendation }) {
  const [briefing, setBriefing] = usePersistentState('trafego_research_briefing', '');
  const [goal, setGoal] = usePersistentState('trafego_research_goal', '');
  const [budget, setBudget] = usePersistentState('trafego_research_budget', '30');
  const [loading, setLoading] = useState(false);
  const [recommendation, setRecommendation] = usePersistentState('trafego_research_recommendation', null);

  const handleResearch = async () => {
    if (!briefing.trim() || !goal.trim()) {
      toast.error('Preencha o briefing e o objetivo.');
      return;
    }
    setLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Você é especialista sênior em Meta Ads (Facebook + Instagram) para lavanderias 5àsec no Brasil.

Analise o briefing abaixo e gere uma estratégia COMPLETA e PRONTA PARA USO. O cliente NÃO precisará preencher mais nada — todos os campos do anúncio devem vir prontos. Ele só revisará e poderá ajustar se quiser.

BRIEFING DA CAMPANHA:
${briefing}

OBJETIVO DE NEGÓCIO:
${goal}

ORÇAMENTO DIÁRIO (R$):
${budget}

Gere TUDO o necessário para publicar:
1. Nome estratégico da campanha (curto, claro, com período/tema)
2. Objetivo Meta correto (OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES)
3. Público-alvo COMPLETO: idade min/max, gênero, localização específica (cidade/bairros/raio em km — se não houver pista no briefing, sugira "São Paulo - SP, raio 8km da unidade"), interesses e comportamentos
4. Posicionamentos recomendados (feed, stories, reels, etc.)
5. CTA ideal (LEARN_MORE, SHOP_NOW, SIGN_UP, CONTACT_US, WHATSAPP_MESSAGE, MESSAGE_PAGE, BOOK_TRAVEL, GET_QUOTE)
6. Copy publicitária PRONTA:
   - headline: até 40 caracteres, impactante
   - primary_text: até 150 caracteres, com emoji e gatilho de ação
   - description: até 30 caracteres, complementar
7. URL de destino sugerida (use https://www.5asec.com.br por padrão, ou um link de WhatsApp se for o caso)
8. KPI principal a monitorar
9. Estimativa realista de alcance e custo por resultado
10. Justificativa estratégica detalhada

Tom da copy: premium, prático, conveniente. Português brasileiro informal mas profissional.`,
        response_json_schema: {
          type: 'object',
          properties: {
            suggested_campaign_name: { type: 'string' },
            meta_objective: { type: 'string', enum: Object.keys(OBJECTIVE_LABELS) },
            campaign_type_name: { type: 'string' },
            target_audience: {
              type: 'object',
              properties: {
                age_min: { type: 'number' },
                age_max: { type: 'number' },
                genders: { type: 'string' },
                locations: { type: 'string' },
                interests: { type: 'array', items: { type: 'string' } },
                behaviors: { type: 'array', items: { type: 'string' } }
              }
            },
            placements: { type: 'array', items: { type: 'string' } },
            cta: { type: 'string', enum: ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'CONTACT_US', 'WHATSAPP_MESSAGE', 'MESSAGE_PAGE', 'BOOK_TRAVEL', 'GET_QUOTE'] },
            copy: {
              type: 'object',
              properties: {
                headline: { type: 'string' },
                primary_text: { type: 'string' },
                description: { type: 'string' }
              }
            },
            link_url: { type: 'string' },
            main_kpi: { type: 'string' },
            estimated_reach: { type: 'string' },
            estimated_cost_per_result: { type: 'string' },
            strategic_reasoning: { type: 'string' }
          },
          required: ['meta_objective', 'campaign_type_name', 'strategic_reasoning', 'suggested_campaign_name', 'copy']
        },
        add_context_from_internet: false,
      });
      setRecommendation(result);
      toast.success('Estratégia completa gerada! Tudo pronto para publicar.');
    } catch (error) {
      toast.error('Erro ao gerar recomendação.');
    } finally {
      setLoading(false);
    }
  };

  const handleUse = () => {
    if (!recommendation) return;
    onUseRecommendation?.({
      name: recommendation.suggested_campaign_name || 'Nova campanha',
      objective: recommendation.meta_objective,
      daily_budget: Number(budget) || 30,
      age_min: recommendation.target_audience?.age_min,
      age_max: recommendation.target_audience?.age_max,
      locations: recommendation.target_audience?.locations,
      headline: recommendation.copy?.headline,
      primary_text: recommendation.copy?.primary_text,
      description: recommendation.copy?.description,
      cta_type: recommendation.cta,
      link_url: recommendation.link_url,
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Input */}
      <div className="space-y-5 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
        <div className="flex items-center gap-2 font-semibold text-white">
          <Lightbulb className="w-5 h-5 text-[#FF6600]" /> Briefing da campanha
        </div>

        <div className="space-y-2">
          <label className="text-sm text-gray-300">Descreva a campanha</label>
          <Textarea
            value={briefing}
            onChange={(e) => setBriefing(e.target.value)}
            className="min-h-[120px] border-white/10 bg-white/5"
            placeholder="Ex: Quero divulgar a promoção de inverno com 30% off em edredons. Unidade em Pinheiros - SP. Foco em mulheres de classe média que moram em apartamentos."
          />
          <p className="text-xs text-gray-500">💡 Inclua: produto/promoção, localização da unidade (cidade/bairro) e perfil do público se souber.</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-gray-300">Objetivo de negócio</label>
          <Input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="border-white/10 bg-white/5"
            placeholder="Ex: Atrair novos clientes para o WhatsApp"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-gray-300">Orçamento diário (R$)</label>
          <Input
            type="number"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="border-white/10 bg-white/5"
          />
        </div>

        <Button onClick={handleResearch} disabled={loading} className="h-12 w-full gap-2 bg-[#FF6600] hover:bg-[#e55c00]">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          {loading ? 'Analisando...' : 'Gerar estratégia completa com IA'}
        </Button>
      </div>

      {/* Result */}
      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
        <div className="flex items-center gap-2 font-semibold text-white">
          <Target className="w-5 h-5 text-[#FF6600]" /> Recomendação completa da IA
        </div>

        {!recommendation && (
          <div className="flex min-h-[400px] items-center justify-center rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
            A estratégia completa aparecerá aqui — pronta para publicar.
          </div>
        )}

        {recommendation && (
          <div className="space-y-4 text-sm">
            <div className="rounded-xl bg-gradient-to-r from-[#4C12A1]/40 to-[#FF6600]/20 p-4">
              <div className="text-xs uppercase tracking-wide text-gray-300">Nome sugerido / Tipo</div>
              <div className="mt-1 text-lg font-bold text-white">{recommendation.suggested_campaign_name}</div>
              <div className="text-xs text-gray-300 mt-1">{recommendation.campaign_type_name}</div>
              <Badge className="mt-2 border border-[#FF6600]/30 bg-[#FF6600]/15 text-[#FF6600]">
                {OBJECTIVE_LABELS[recommendation.meta_objective] || recommendation.meta_objective}
              </Badge>
            </div>

            {recommendation.target_audience && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="mb-2 flex items-center gap-2 text-white"><Users className="w-4 h-4" /> Público-alvo</div>
                <div className="space-y-1 text-gray-300">
                  <div><b>Idade:</b> {recommendation.target_audience.age_min}-{recommendation.target_audience.age_max}</div>
                  <div><b>Gênero:</b> {recommendation.target_audience.genders}</div>
                  <div className="flex gap-1"><MapPin className="w-3.5 h-3.5 mt-0.5 text-[#FF6600] flex-shrink-0" /> <span><b>Local:</b> {recommendation.target_audience.locations}</span></div>
                  {recommendation.target_audience.interests?.length > 0 && (
                    <div><b>Interesses:</b> {recommendation.target_audience.interests.join(', ')}</div>
                  )}
                  {recommendation.target_audience.behaviors?.length > 0 && (
                    <div><b>Comportamentos:</b> {recommendation.target_audience.behaviors.join(', ')}</div>
                  )}
                </div>
              </div>
            )}

            {recommendation.copy && (
              <div className="rounded-xl border border-[#FF6600]/30 bg-[#FF6600]/5 p-4 space-y-2">
                <div className="flex items-center gap-2 text-white"><MessageSquare className="w-4 h-4 text-[#FF6600]" /> Copy pronta</div>
                <div className="text-gray-300 space-y-1.5">
                  <div><span className="text-xs text-gray-400">Título:</span> <div className="font-semibold text-white">{recommendation.copy.headline}</div></div>
                  <div><span className="text-xs text-gray-400">Texto principal:</span> <div className="text-white">{recommendation.copy.primary_text}</div></div>
                  {recommendation.copy.description && <div><span className="text-xs text-gray-400">Descrição:</span> <div className="text-white">{recommendation.copy.description}</div></div>}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-gray-400">Alcance estimado</div>
                <div className="font-semibold text-white">{recommendation.estimated_reach || '-'}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 flex flex-col">
                <div className="text-xs text-gray-400 flex items-center gap-1"><DollarSign className="w-3 h-3" /> Custo/resultado</div>
                <div className="font-semibold text-white">{recommendation.estimated_cost_per_result || '-'}</div>
              </div>
            </div>

            {recommendation.placements?.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-gray-400">Posicionamentos</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {recommendation.placements.map((p) => (
                    <Badge key={p} className="bg-white/10 text-white">{p}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {recommendation.cta && (
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-gray-400">CTA</div>
                  <div className="font-semibold text-white">{recommendation.cta}</div>
                </div>
              )}
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-gray-400">KPI principal</div>
                <div className="font-semibold text-white">{recommendation.main_kpi || '-'}</div>
              </div>
            </div>

            <div className="rounded-xl border border-[#FF6600]/20 bg-[#FF6600]/5 p-4">
              <div className="text-xs uppercase tracking-wide text-[#FF6600]">Por que funciona</div>
              <p className="mt-1 text-gray-300 leading-relaxed">{recommendation.strategic_reasoning}</p>
            </div>

            <Button
              onClick={handleUse}
              className="w-full bg-[#4C12A1] hover:bg-[#5b17bf]"
            >
              Usar tudo na criação da campanha →
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}