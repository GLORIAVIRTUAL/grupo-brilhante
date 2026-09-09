import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Send, Loader2, CheckCircle2, X, Youtube, ExternalLink, Save } from 'lucide-react';
import { toast } from 'sonner';
import usePersistentState from '@/lib/usePersistentState';

const BRASIL_GEO_ID = 2076;
const CHANNEL_STORAGE_KEY = 'google_ads_youtube_channel';

function extractYouTubeId(input) {
  if (!input) return '';
  const m = input.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : input.trim();
}

export default function VideoCampaignForm() {
  const [name, setName] = usePersistentState('gads_video_name', '');
  const [budget, setBudget] = usePersistentState('gads_video_budget', 20);
  const [finalUrl, setFinalUrl] = usePersistentState('gads_video_final_url', '');
  const [youtubeInput, setYoutubeInput] = usePersistentState('gads_video_youtube', '');
  const [startPaused, setStartPaused] = usePersistentState('gads_video_start_paused', true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = usePersistentState('gads_video_result', null);

  // Canal do YouTube (referência) — salvo localmente
  const [channelUrl, setChannelUrl] = useState('');
  const [channelSaved, setChannelSaved] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (saved) {
      setChannelUrl(saved);
      setChannelSaved(true);
    }
  }, []);

  const saveChannel = () => {
    if (!channelUrl.trim()) {
      localStorage.removeItem(CHANNEL_STORAGE_KEY);
      setChannelSaved(false);
      toast.success('Canal removido');
      return;
    }
    localStorage.setItem(CHANNEL_STORAGE_KEY, channelUrl.trim());
    setChannelSaved(true);
    toast.success('Canal salvo');
  };

  const videoId = extractYouTubeId(youtubeInput);

  const handleCreate = async () => {
    if (!name || !finalUrl || !videoId) {
      toast.error('Nome, URL de destino e vídeo do YouTube são obrigatórios');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('google_ads_api', {
        action: 'create_video_campaign',
        name,
        daily_budget_brl: Number(budget),
        final_url: finalUrl,
        youtube_video_id: videoId,
        location_ids: [BRASIL_GEO_ID],
        start_paused: startPaused,
      });
      setResult(res.data);
      toast.success('Campanha de Vídeo criada!');
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
        <Youtube className="w-5 h-5 text-red-400" /> Campanha de Vídeo (YouTube)
      </h3>
      <p className="text-xs text-gray-400 mb-4">Seu vídeo aparece antes ou durante vídeos do YouTube.</p>

      {/* Canal do YouTube — referência */}
      <div className="mb-5 p-4 rounded-lg bg-purple-500/10 border border-purple-500/30">
        <div className="flex items-center gap-2 mb-2">
          <Youtube className="w-4 h-4 text-purple-300" />
          <Label className="text-purple-100 font-semibold text-sm">Seu canal do YouTube</Label>
          {channelSaved && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">Salvo</span>}
        </div>
        <p className="text-xs text-purple-200/70 mb-2">
          A API <strong>não</strong> precisa de acesso ao canal — o Google Ads veicula qualquer vídeo público pelo ID.
          Salve aqui o link do seu canal apenas como referência rápida pra subir novos vídeos.
        </p>
        <div className="flex gap-2">
          <Input
            value={channelUrl}
            onChange={e => { setChannelUrl(e.target.value); setChannelSaved(false); }}
            placeholder="https://youtube.com/@5asec-suaunidade"
            className="bg-white/5 border-white/10 text-white text-sm"
          />
          <Button onClick={saveChannel} type="button" variant="outline" className="border-white/10 shrink-0">
            <Save className="w-4 h-4" />
          </Button>
          {channelUrl && (
            <a href={channelUrl} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="outline" className="border-white/10 shrink-0">
                <ExternalLink className="w-4 h-4" />
              </Button>
            </a>
          )}
        </div>
        {!channelUrl && (
          <a href="https://www.youtube.com/create_channel" target="_blank" rel="noopener noreferrer" className="text-xs text-[#FF6600] hover:underline mt-2 inline-flex items-center gap-1">
            Não tem canal? Criar grátis → <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

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
          <Label className="text-gray-300">Vídeo do YouTube <span className="text-xs text-gray-500">(URL completa ou ID)</span></Label>
          <Input
            value={youtubeInput}
            onChange={e => setYoutubeInput(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="bg-white/5 border-white/10 text-white"
          />
          {videoId && (
            <div className="mt-2 rounded-lg overflow-hidden border border-white/10 aspect-video bg-black/30">
              <iframe
                src={`https://www.youtube.com/embed/${videoId}`}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
          <div className="mt-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200 space-y-1.5">
            <p className="font-semibold text-blue-100">📺 Como funciona o vídeo no Google Ads</p>
            <p>
              O Google Ads <strong>não hospeda vídeos</strong> — ele apenas veicula vídeos que já estão no YouTube.
              Por isso você precisa:
            </p>
            <ol className="list-decimal list-inside space-y-0.5 ml-1">
              <li>Ter um <strong>canal no YouTube</strong> (pode ser da unidade, criado com qualquer conta Google).
                {' '}<a href="https://www.youtube.com/create_channel" target="_blank" rel="noopener noreferrer" className="text-[#FF6600] underline">Criar canal grátis →</a>
              </li>
              <li>Fazer <strong>upload do vídeo</strong> lá (pode marcar como "não listado" pra não aparecer nas buscas).</li>
              <li>Copiar a URL do vídeo e colar acima.</li>
            </ol>
            <p className="pt-1 text-blue-300/80">
              💡 O canal <strong>não precisa</strong> ser da mesma conta Google Ads — qualquer canal serve.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
          <div>
            <Label className="text-white">Criar pausada</Label>
            <p className="text-xs text-gray-400">Recomendado: revise antes de ativar</p>
          </div>
          <Switch checked={startPaused} onCheckedChange={setStartPaused} />
        </div>

        <Button onClick={handleCreate} disabled={loading || !videoId} className="w-full bg-[#FF6600] hover:bg-[#FF6600]/90">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4 mr-2" /> Criar Campanha de Vídeo</>}
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