import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Send, Loader2, CheckCircle2, X } from 'lucide-react';
import { toast } from 'sonner';
import usePersistentState from '@/lib/usePersistentState';

const BRASIL_GEO_ID = 2076;

export default function SearchCampaignForm({ prefill }) {
  const [name, setName] = usePersistentState('gads_search_name', '');
  const [budget, setBudget] = usePersistentState('gads_search_budget', 15);
  const [finalUrl, setFinalUrl] = usePersistentState('gads_search_final_url', '');
  const [keywords, setKeywords] = usePersistentState('gads_search_keywords', '');
  const [headlines, setHeadlines] = usePersistentState('gads_search_headlines', '');
  const [descriptions, setDescriptions] = usePersistentState('gads_search_descriptions', '');
  const [startPaused, setStartPaused] = usePersistentState('gads_search_start_paused', true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = usePersistentState('gads_search_result', null);

  useEffect(() => {
    if (prefill) {
      setName(prefill.campaign_name || '');
      setBudget(prefill.recommended_daily_budget_brl || 15);
      setKeywords((prefill.keywords || []).join('\n'));
      setHeadlines((prefill.headlines || []).join('\n'));
      setDescriptions((prefill.descriptions || []).join('\n'));
    }
  }, [prefill]);

  const handleCreate = async () => {
    if (!name || !finalUrl) {
      toast.error('Nome e URL de destino são obrigatórios');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('google_ads_api', {
        action: 'create_search_campaign',
        name,
        daily_budget_brl: Number(budget),
        final_url: finalUrl,
        location_ids: [BRASIL_GEO_ID],
        keywords: keywords.split('\n').map(k => k.trim()).filter(Boolean),
        headlines: headlines.split('\n').map(h => h.trim()).filter(Boolean),
        descriptions: descriptions.split('\n').map(d => d.trim()).filter(Boolean),
        start_paused: startPaused,
      });
      setResult(res.data);
      toast.success('Campanha criada com sucesso!');
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      toast.error(`Falha: ${msg}`);
      setResult({ error: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-white/5 backdrop-blur-xl border-white/10 p-6 text-white">
      <h3 className="text-lg font-semibold mb-4 text-white">Campanha de Pesquisa (Search)</h3>
      <div className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label className="text-gray-300">Nome</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="bg-white/5 border-white/10 text-white" />
          </div>
          <div>
            <Label className="text-gray-300">Orçamento diário (R$)</Label>
            <Input type="number" value={budget} onChange={e => setBudget(e.target.value)} className="bg-white/5 border-white/10 text-white" />
          </div>
        </div>

        <div>
          <Label className="text-gray-300">URL de destino</Label>
          <Input value={finalUrl} onChange={e => setFinalUrl(e.target.value)} placeholder="https://5asec.com.br" className="bg-white/5 border-white/10 text-white" />
        </div>

        <div>
          <Label className="text-gray-300">Palavras-chave <span className="text-xs text-gray-500">(uma por linha)</span></Label>
          <Textarea value={keywords} onChange={e => setKeywords(e.target.value)} rows={5} className="bg-white/5 border-white/10 text-white font-mono text-sm" />
        </div>

        <div>
          <Label className="text-gray-300">Headlines <span className="text-xs text-gray-500">(máx. 30 chars, mín. 3)</span></Label>
          <Textarea value={headlines} onChange={e => setHeadlines(e.target.value)} rows={5} className="bg-white/5 border-white/10 text-white font-mono text-sm" />
        </div>

        <div>
          <Label className="text-gray-300">Descriptions <span className="text-xs text-gray-500">(máx. 90 chars, mín. 2)</span></Label>
          <Textarea value={descriptions} onChange={e => setDescriptions(e.target.value)} rows={4} className="bg-white/5 border-white/10 text-white font-mono text-sm" />
        </div>

        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
          <div>
            <Label className="text-white">Criar pausada</Label>
            <p className="text-xs text-gray-400">Recomendado: revise antes de ativar</p>
          </div>
          <Switch checked={startPaused} onCheckedChange={setStartPaused} />
        </div>

        <Button onClick={handleCreate} disabled={loading} className="w-full bg-[#FF6600] hover:bg-[#FF6600]/90">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4 mr-2" /> Criar Campanha</>}
        </Button>

        {result?.error && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            <div className="flex items-center gap-2 font-semibold mb-2"><X className="w-4 h-4" /> Erro</div>
            <pre className="whitespace-pre-wrap text-xs">{result.error}</pre>
          </div>
        )}
        {result?.success && (
          <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-300 text-sm">
            <div className="flex items-center gap-2 font-semibold mb-2"><CheckCircle2 className="w-4 h-4" /> Campanha criada!</div>
            <p className="text-xs">ID: <span className="font-mono">{result.campaign_id}</span></p>
            <a href={`https://ads.google.com/aw/campaigns?campaignId=${result.campaign_id}`} target="_blank" rel="noopener noreferrer" className="text-[#FF6600] underline text-xs">Abrir no Google Ads →</a>
          </div>
        )}
      </div>
    </Card>
  );
}