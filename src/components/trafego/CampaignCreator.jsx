import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Rocket, AlertCircle, CheckCircle2, Upload, ImageIcon, Video } from 'lucide-react';
import { toast } from 'sonner';
import usePersistentState from '@/lib/usePersistentState';

const OBJECTIVES = [
  { value: 'OUTCOME_AWARENESS', label: 'Reconhecimento' },
  { value: 'OUTCOME_TRAFFIC', label: 'Tráfego' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engajamento' },
  { value: 'OUTCOME_LEADS', label: 'Cadastros / Leads' },
  { value: 'OUTCOME_SALES', label: 'Vendas / Conversões' },
];

const CTA_TYPES = [
  { value: 'LEARN_MORE', label: 'Saiba mais' },
  { value: 'SHOP_NOW', label: 'Comprar agora' },
  { value: 'SIGN_UP', label: 'Cadastre-se' },
  { value: 'CONTACT_US', label: 'Fale conosco' },
  { value: 'WHATSAPP_MESSAGE', label: 'Enviar WhatsApp' },
  { value: 'MESSAGE_PAGE', label: 'Enviar mensagem' },
  { value: 'BOOK_TRAVEL', label: 'Agendar' },
  { value: 'GET_QUOTE', label: 'Solicitar orçamento' },
];

export default function CampaignCreator({ prefill }) {
  // Campanha
  const [name, setName] = usePersistentState('trafego_create_name', '');
  const [objective, setObjective] = usePersistentState('trafego_create_objective', 'OUTCOME_TRAFFIC');
  const [dailyBudget, setDailyBudget] = usePersistentState('trafego_create_budget', '30');

  // Criativo
  const [pageId, setPageId] = usePersistentState('trafego_create_page_id', '');
  const [mediaType, setMediaType] = usePersistentState('trafego_create_media_type', 'image'); // 'image' | 'video'
  const [mediaUrl, setMediaUrl] = usePersistentState('trafego_create_media_url', '');
  const [uploadedHash, setUploadedHash] = usePersistentState('trafego_create_image_hash', '');
  const [uploadedVideoId, setUploadedVideoId] = usePersistentState('trafego_create_video_id', '');
  const [uploading, setUploading] = useState(false);

  // Copy
  const [headline, setHeadline] = usePersistentState('trafego_create_headline', '');
  const [primaryText, setPrimaryText] = usePersistentState('trafego_create_primary_text', '');
  const [description, setDescription] = usePersistentState('trafego_create_description', '');
  const [linkUrl, setLinkUrl] = usePersistentState('trafego_create_link_url', 'https://www.5asec.com.br');
  const [ctaType, setCtaType] = usePersistentState('trafego_create_cta', 'LEARN_MORE');

  // Público
  const [ageMin, setAgeMin] = usePersistentState('trafego_create_age_min', '18');
  const [ageMax, setAgeMax] = usePersistentState('trafego_create_age_max', '65');
  const [locations, setLocations] = usePersistentState('trafego_create_locations', '');

  // Publicação
  const [activate, setActivate] = usePersistentState('trafego_create_activate', true);
  const [publishing, setPublishing] = useState(false);
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [result, setResult] = usePersistentState('trafego_create_result', null);

  // Carrega páginas
  const { data: pages = [], isLoading: loadingPages } = useQuery({
    queryKey: ['meta-pages'],
    queryFn: async () => {
      const res = await base44.functions.invoke('meta_ads_api', { action: 'list_pages' });
      return res?.data?.pages || [];
    },
  });

  useEffect(() => {
    if (pages.length && !pageId) setPageId(pages[0].id);
  }, [pages, pageId]);

  useEffect(() => {
    if (prefill) {
      if (prefill.name) setName(prefill.name);
      if (prefill.objective) setObjective(prefill.objective);
      if (prefill.daily_budget) setDailyBudget(String(prefill.daily_budget));
      if (prefill.age_min) setAgeMin(String(prefill.age_min));
      if (prefill.age_max) setAgeMax(String(prefill.age_max));
      if (prefill.locations) setLocations(prefill.locations);
      if (prefill.headline) setHeadline(prefill.headline);
      if (prefill.primary_text) setPrimaryText(prefill.primary_text);
      if (prefill.description) setDescription(prefill.description);
      if (prefill.cta_type) setCtaType(prefill.cta_type);
      if (prefill.link_url) setLinkUrl(prefill.link_url);
    }
  }, [prefill]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setMediaUrl(file_url);

      // Enviar para Meta
      const action = mediaType === 'image' ? 'upload_image_from_url' : 'upload_video_from_url';
      const paramKey = mediaType === 'image' ? 'image_url' : 'video_url';
      const res = await base44.functions.invoke('meta_ads_api', { action, params: { [paramKey]: file_url } });
      const d = res?.data || res;
      if (mediaType === 'image') {
        setUploadedHash(d.image_hash);
        setUploadedVideoId('');
      } else {
        setUploadedVideoId(d.video_id);
        setUploadedHash('');
      }
      toast.success(`${mediaType === 'image' ? 'Imagem' : 'Vídeo'} enviado para a Meta!`);
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message || 'Erro no upload');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleGenerateCopy = async () => {
    const briefing = name.trim() || headline.trim();
    if (!briefing) {
      toast.error('Preencha o nome da campanha ou o título primeiro.');
      return;
    }
    setGeneratingCopy(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Gere copy publicitária persuasiva para um anúncio no Facebook/Instagram da lavanderia 5àsec.
Campanha/Tema: "${briefing}"
Objetivo: ${OBJECTIVES.find(o => o.value === objective)?.label}

Retorne em JSON com:
- headline: título curto e impactante (máx 40 caracteres)
- primary_text: texto principal do anúncio, persuasivo, com emoji e CTA (máx 150 caracteres)
- description: descrição complementar do link (máx 30 caracteres)

Tom: premium, prático, conveniente. Linguagem brasileira informal mas profissional.`,
        response_json_schema: {
          type: 'object',
          properties: {
            headline: { type: 'string' },
            primary_text: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['headline', 'primary_text']
        }
      });
      setHeadline(result.headline || '');
      setPrimaryText(result.primary_text || '');
      setDescription(result.description || '');
      toast.success('Copy gerada pela IA!');
    } catch (error) {
      toast.error('Erro ao gerar copy');
    } finally {
      setGeneratingCopy(false);
    }
  };

  const handlePublish = async () => {
    if (!name.trim()) return toast.error('Nome obrigatório');
    if (!pageId) return toast.error('Selecione a Página do Facebook');
    if (!uploadedHash && !uploadedVideoId) return toast.error('Faça upload da imagem ou vídeo');
    if (!primaryText.trim()) return toast.error('Preencha a copy (texto principal)');
    if (!dailyBudget || Number(dailyBudget) < 5) return toast.error('Orçamento mínimo R$ 5');

    setPublishing(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('meta_ads_api', {
        action: 'publish_complete_campaign',
        params: {
          name: name.trim(),
          objective,
          daily_budget: Math.round(Number(dailyBudget) * 100),
          page_id: pageId,
          image_hash: uploadedHash || undefined,
          video_id: uploadedVideoId || undefined,
          headline,
          primary_text: primaryText,
          description,
          link_url: linkUrl,
          cta_type: ctaType,
          age_min: Number(ageMin),
          age_max: Number(ageMax),
          locations: locations || undefined,
          activate,
        }
      });
      const data = res?.data || res;
      setResult(data);
      toast.success(activate ? '🚀 Campanha publicada e ATIVA!' : 'Campanha criada (pausada).');
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message || 'Erro ao publicar', { duration: 10000 });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Aviso de página ausente */}
      {!loadingPages && pages.length === 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-red-200 font-semibold">Nenhuma Página do Facebook conectada</p>
            <p className="text-red-300/80 mt-1">
              Para publicar anúncios você precisa de uma Página do Facebook vinculada ao System User da Meta. Acesse o Gerenciador de Negócios → Usuários → Sistema → adicione a página com permissão de "Anúncios" e "Conteúdo".
            </p>
          </div>
        </div>
      )}

      {/* 1. Dados da campanha */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl space-y-4">
        <div className="flex items-center gap-2 font-semibold text-white">
          <Rocket className="w-5 h-5 text-[#FF6600]" /> 1. Configuração da campanha
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-300">Nome da campanha</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="border-white/10 bg-white/5" placeholder="Ex: Promo Inverno - Edredons" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-300">Objetivo</label>
            <Select value={objective} onValueChange={setObjective}>
              <SelectTrigger className="border-white/10 bg-white/5"><SelectValue /></SelectTrigger>
              <SelectContent>{OBJECTIVES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-300">Orçamento diário (R$)</label>
            <Input type="number" min="5" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} className="border-white/10 bg-white/5" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-300">Página do Facebook</label>
            <Select value={pageId} onValueChange={setPageId} disabled={pages.length === 0}>
              <SelectTrigger className="border-white/10 bg-white/5">
                <SelectValue placeholder={loadingPages ? 'Carregando...' : 'Selecione uma página'} />
              </SelectTrigger>
              <SelectContent>{pages.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-300">Idade mínima</label>
            <Input type="number" min="13" max="65" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} className="border-white/10 bg-white/5" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-300">Idade máxima</label>
            <Input type="number" min="13" max="65" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} className="border-white/10 bg-white/5" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-gray-300">Localização (cidade/bairro/raio)</label>
            <Input value={locations} onChange={(e) => setLocations(e.target.value)} className="border-white/10 bg-white/5" placeholder="Ex: São Paulo - SP, raio 8km de Pinheiros" />
            <p className="text-xs text-gray-500">Informação textual usada como referência (a IA pode preencher automaticamente).</p>
          </div>
        </div>
      </div>

      {/* 2. Mídia */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl space-y-4">
        <div className="flex items-center gap-2 font-semibold text-white">
          <ImageIcon className="w-5 h-5 text-[#FF6600]" /> 2. Mídia do anúncio
        </div>

        <div className="flex gap-2">
          <Button variant={mediaType === 'image' ? 'default' : 'outline'} onClick={() => setMediaType('image')} className={mediaType === 'image' ? 'bg-[#FF6600] hover:bg-[#e55c00]' : 'bg-transparent border-white/15 text-white hover:bg-white/10'}>
            <ImageIcon className="w-4 h-4 mr-2" /> Imagem
          </Button>
          <Button variant={mediaType === 'video' ? 'default' : 'outline'} onClick={() => setMediaType('video')} className={mediaType === 'video' ? 'bg-[#FF6600] hover:bg-[#e55c00]' : 'bg-transparent border-white/15 text-white hover:bg-white/10'}>
            <Video className="w-4 h-4 mr-2" /> Vídeo
          </Button>
        </div>

        <label className="block">
          <input type="file" accept={mediaType === 'image' ? 'image/*' : 'video/*'} className="hidden" onChange={handleUpload} disabled={uploading} />
          <span className="flex items-center justify-center gap-2 cursor-pointer rounded-lg border border-dashed border-white/20 bg-white/5 hover:bg-white/10 py-8 text-white">
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
            {uploading ? 'Enviando para a Meta...' : `Selecionar ${mediaType === 'image' ? 'imagem' : 'vídeo'}`}
          </span>
        </label>

        {mediaUrl && mediaType === 'image' && uploadedHash && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
            <img src={mediaUrl} alt="" className="w-16 h-16 object-cover rounded" />
            <div className="text-sm">
              <div className="text-green-400 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Imagem enviada à Meta</div>
              <div className="text-xs text-gray-400">Hash: {uploadedHash.substring(0, 20)}...</div>
            </div>
          </div>
        )}
        {mediaUrl && mediaType === 'video' && uploadedVideoId && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-sm text-green-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Vídeo enviado à Meta (ID: {uploadedVideoId})
          </div>
        )}
      </div>

      {/* 3. Copy */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-white">
            <Rocket className="w-5 h-5 text-[#FF6600]" /> 3. Copy do anúncio
          </div>
          <Button onClick={handleGenerateCopy} disabled={generatingCopy} variant="outline" className="bg-transparent border-white/15 text-white hover:bg-white/10">
            {generatingCopy ? <Loader2 className="w-4 h-4 animate-spin" /> : '✨'} Gerar copy com IA
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-gray-300">Título (headline)</label>
          <Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={40} className="border-white/10 bg-white/5" placeholder="Ex: 30% OFF em Edredons" />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-gray-300">Texto principal (copy) *</label>
          <Textarea value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} maxLength={200} className="min-h-[100px] border-white/10 bg-white/5" placeholder="Texto persuasivo que aparece no feed..." />
          <div className="text-xs text-gray-500 text-right">{primaryText.length}/200</div>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-gray-300">Descrição do link</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={30} className="border-white/10 bg-white/5" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-300">URL de destino</label>
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="border-white/10 bg-white/5" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-300">Botão (CTA)</label>
            <Select value={ctaType} onValueChange={setCtaType}>
              <SelectTrigger className="border-white/10 bg-white/5"><SelectValue /></SelectTrigger>
              <SelectContent>{CTA_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* 4. Publicação */}
      <div className="rounded-2xl border border-[#FF6600]/30 bg-gradient-to-r from-[#4C12A1]/30 to-[#FF6600]/10 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <input type="checkbox" id="activate" checked={activate} onChange={(e) => setActivate(e.target.checked)} className="w-5 h-5 accent-[#FF6600]" />
          <label htmlFor="activate" className="text-white font-medium cursor-pointer">
            Ativar campanha imediatamente (sair online após análise da Meta)
          </label>
        </div>

        <Button onClick={handlePublish} disabled={publishing || pages.length === 0} className="w-full h-14 text-lg bg-[#FF6600] hover:bg-[#e55c00]">
          {publishing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Rocket className="w-6 h-6" />}
          {publishing ? 'Publicando na Meta...' : (activate ? '🚀 Publicar e ATIVAR online' : 'Criar campanha pausada')}
        </Button>

        {result && (
          <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 space-y-2">
            <div className="flex items-center gap-2 text-green-400 font-bold text-lg">
              <CheckCircle2 className="w-6 h-6" /> Campanha {result.status === 'ACTIVE' ? 'ATIVA online!' : 'criada!'}
            </div>
            <div className="text-sm text-gray-300 space-y-1">
              <div>Campanha: <Badge className="bg-white/10 text-white">{result.campaign_id}</Badge></div>
              <div>Conjunto: <Badge className="bg-white/10 text-white">{result.adset_id}</Badge></div>
              <div>Anúncio: <Badge className="bg-white/10 text-white">{result.ad_id}</Badge></div>
            </div>
            <a href={`https://business.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${result.campaign_id}`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="bg-transparent border-white/15 text-white hover:bg-white/10 mt-2">
                Ver no Gerenciador de Anúncios →
              </Button>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}