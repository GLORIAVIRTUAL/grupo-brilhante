import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Send, Loader2, CheckCircle2, X, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import ImageUrlList from './ImageUrlList';
import usePersistentState from '@/lib/usePersistentState';

const BRASIL_GEO_ID = 2076;

export default function DisplayCampaignForm() {
  const [name, setName] = usePersistentState('gads_display_name', '');
  const [budget, setBudget] = usePersistentState('gads_display_budget', 15);
  const [finalUrl, setFinalUrl] = usePersistentState('gads_display_final_url', '');
  const [businessName, setBusinessName] = usePersistentState('gads_display_business_name', '5àsec');
  const [headlines, setHeadlines] = usePersistentState('gads_display_headlines', '');
  const [longHeadline, setLongHeadline] = usePersistentState('gads_display_long_headline', '');
  const [descriptions, setDescriptions] = usePersistentState('gads_display_descriptions', '');
  const [marketingImages, setMarketingImages] = usePersistentState('gads_display_marketing_images', []);
  const [squareImages, setSquareImages] = usePersistentState('gads_display_square_images', []);
  const [logoImages, setLogoImages] = usePersistentState('gads_display_logo_images', []);
  const [startPaused, setStartPaused] = usePersistentState('gads_display_start_paused', true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = usePersistentState('gads_display_result', null);

  const handleCreate = async () => {
    if (!name || !finalUrl) {
      toast.error('Nome e URL de destino são obrigatórios');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('google_ads_api', {
        action: 'create_display_campaign',
        name,
        daily_budget_brl: Number(budget),
        final_url: finalUrl,
        business_name: businessName,
        location_ids: [BRASIL_GEO_ID],
        headlines: headlines.split('\n').map(h => h.trim()).filter(Boolean),
        long_headline: longHeadline,
        descriptions: descriptions.split('\n').map(d => d.trim()).filter(Boolean),
        marketing_image_urls: marketingImages,
        square_image_urls: squareImages,
        logo_image_urls: logoImages,
        start_paused: startPaused,
      });
      setResult(res.data);
      toast.success('Campanha Display criada!');
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
      <h3 className="text-lg font-semibold mb-1 flex items-center gap-2 text-white">
        <ImageIcon className="w-5 h-5 text-pink-400" /> Campanha Display (com imagens)
      </h3>
      <p className="text-xs text-gray-400 mb-4">Banners exibidos em sites parceiros do Google.</p>

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

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label className="text-gray-300">URL de destino</Label>
            <Input value={finalUrl} onChange={e => setFinalUrl(e.target.value)} placeholder="https://5asec.com.br" className="bg-white/5 border-white/10 text-white" />
          </div>
          <div>
            <Label className="text-gray-300">Nome da empresa</Label>
            <Input value={businessName} onChange={e => setBusinessName(e.target.value)} className="bg-white/5 border-white/10 text-white" />
          </div>
        </div>

        <div>
          <Label className="text-gray-300">Headlines curtos <span className="text-xs text-gray-500">(máx. 30 chars, 1-5)</span></Label>
          <Textarea value={headlines} onChange={e => setHeadlines(e.target.value)} rows={3} className="bg-white/5 border-white/10 text-white font-mono text-sm" placeholder="Lavanderia Premium&#10;Coleta Grátis" />
        </div>

        <div>
          <Label className="text-gray-300">Headline longo <span className="text-xs text-gray-500">(máx. 90 chars)</span></Label>
          <Input value={longHeadline} onChange={e => setLongHeadline(e.target.value)} className="bg-white/5 border-white/10 text-white" placeholder="Lavanderia premium 5àsec com coleta e entrega grátis" />
        </div>

        <div>
          <Label className="text-gray-300">Descriptions <span className="text-xs text-gray-500">(máx. 90 chars, 1-5)</span></Label>
          <Textarea value={descriptions} onChange={e => setDescriptions(e.target.value)} rows={3} className="bg-white/5 border-white/10 text-white font-mono text-sm" />
        </div>

        <ImageUrlList
          label="Imagens retangulares (1.91:1)"
          hint="Recomendado: 1200x628px. Mínimo 1, máximo 15."
          urls={marketingImages}
          onChange={setMarketingImages}
        />
        <ImageUrlList
          label="Imagens quadradas (1:1)"
          hint="Recomendado: 1200x1200px. Mínimo 1, máximo 15."
          urls={squareImages}
          onChange={setSquareImages}
        />
        <ImageUrlList
          label="Logos (1:1)"
          hint="Opcional. Recomendado: 1200x1200px."
          urls={logoImages}
          onChange={setLogoImages}
        />

        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
          <div>
            <Label className="text-white">Criar pausada</Label>
            <p className="text-xs text-gray-400">Recomendado: revise antes de ativar</p>
          </div>
          <Switch checked={startPaused} onCheckedChange={setStartPaused} />
        </div>

        <Button onClick={handleCreate} disabled={loading} className="w-full bg-[#FF6600] hover:bg-[#FF6600]/90">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4 mr-2" /> Criar Campanha Display</>}
        </Button>

        {result?.error && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            <div className="flex items-center gap-2 font-semibold mb-2"><X className="w-4 h-4" /> Erro</div>
            <pre className="whitespace-pre-wrap text-xs">{result.error}</pre>
          </div>
        )}
        {result?.success && (
          <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-300 text-sm">
            <div className="flex items-center gap-2 font-semibold mb-2"><CheckCircle2 className="w-4 h-4" /> Criada!</div>
            <p className="text-xs">ID: <span className="font-mono">{result.campaign_id}</span></p>
          </div>
        )}
      </div>
    </Card>
  );
}