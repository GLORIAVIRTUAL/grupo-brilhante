import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Sparkles, Upload, Image as ImageIcon, Loader2, Wand2, Save, Clapperboard, Instagram, Facebook } from 'lucide-react';
import { campaignDefaultPrompt } from '@/lib/campaignDefaultPrompt';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import SavedCampaignCard from '@/components/campaigns/SavedCampaignCard';

export default function Campanhas() {
  const [prompt, setPrompt] = useState(campaignDefaultPrompt);
  const [references, setReferences] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState('');
  const [modelText, setModelText] = useState('');
  const [postingFacebook, setPostingFacebook] = useState(false);
  const [postingInstagram, setPostingInstagram] = useState(false);
  const [videoSending, setVideoSending] = useState(false);
  const [campaignName, setCampaignName] = useState('');

  const queryClient = useQueryClient();

  const { data: savedCampaigns = [] } = useQuery({
    queryKey: ['campaign-assets'],
    queryFn: () => base44.entities.CampaignAsset.list('-created_date', 24),
    initialData: [],
  });

  const saveCampaignMutation = useMutation({
    mutationFn: (campaignData) => base44.entities.CampaignAsset.create(campaignData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-assets'] });
      toast.success('Campanha salva com sucesso!');
    },
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: (campaignId) => base44.entities.CampaignAsset.delete(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-assets'] });
      toast.success('Campanha excluída com sucesso!');
    },
  });

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setUploading(true);
    try {
      const uploads = await Promise.all(files.map((file) => base44.integrations.Core.UploadFile({ file })));
      const newRefs = uploads.map((item) => item.file_url);
      setReferences((prev) => [...prev, ...newRefs].slice(0, 6));
      toast.success('Imagem(ns) enviada(s)!');
    } catch (error) {
      toast.error('Erro ao enviar imagens.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleGeneratePrompt = async () => {
    if (!campaignName.trim()) {
      toast.error('Informe o nome da campanha antes de gerar o prompt.');
      return;
    }

    setGeneratingPrompt(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Você é um diretor de criação da 5àsec.

Sua tarefa é gerar UM PROMPT de campanha publicitária baseado no TEMA/TÍTULO informado abaixo, mantendo a mesma estrutura, nível de detalhe, posicionamento visual premium e lógica de composição do prompt-base de referência.

TEMA / TÍTULO DA CAMPANHA (use isso como ponto de partida obrigatório do conceito criativo, da oferta destacada e do texto integrado na arte):
"${campaignName.trim()}"

PROMPT-BASE (use só como referência de estrutura, NÃO copie o tema dele):
${campaignDefaultPrompt}

Regras obrigatórias:
- o conceito, personagem, cena, oferta e o texto destacado na arte DEVEM refletir diretamente o tema "${campaignName.trim()}"
- manter a estrutura geral do prompt-base (personagem e ação, ambiente, iluminação, composição, diretrizes de texto)
- manter estética premium, fotografia hiper-realista e linguagem publicitária sofisticada
- manter proporção vertical 9:16
- manter a marca 5àsec e a paleta roxo + laranja
- manter a lógica de espaço negativo e hierarquia visual
- o prompt deve em algum momento citar EXPLICITAMENTE o texto principal a aparecer na arte, derivado do tema (ex: chamada da promoção)
- prompt em português do Brasil
- devolver apenas o novo prompt final, sem explicações, sem título e sem aspas`,
        response_json_schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string' }
          },
          required: ['prompt']
        }
      });

      setPrompt(result.prompt);
      toast.success('Novo prompt gerado!');
    } catch (error) {
      toast.error('Erro ao gerar novo prompt.');
    } finally {
      setGeneratingPrompt(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('Digite o texto da campanha.');
      return;
    }

    if (!references.length) {
      toast.error('Envie ao menos 1 imagem de referência.');
      return;
    }

    setGenerating(true);
    setModelText('');

    try {
      const response = await base44.functions.invoke('generateCampaignImage', {
        prompt,
        reference_image_urls: references,
      });

      const result = response?.data || response || {};
      const imageUrl = result.image_url || '';
      let captionText = result.model_text || '';

      if (!captionText.trim()) {
        const captionFallback = await base44.integrations.Core.InvokeLLM({
          prompt: `Crie uma legenda para Instagram em português do Brasil para uma campanha da 5àsec com base neste briefing: ${prompt}. A legenda deve ser elegante, comercial, pronta para postar, com 1 parágrafo curto, CTA e 4 a 8 hashtags no final.`,
          response_json_schema: {
            type: 'object',
            properties: {
              caption: { type: 'string' }
            },
            required: ['caption']
          }
        });
        captionText = captionFallback?.caption || '';
      }

      setGeneratedImage(imageUrl);
      setModelText(captionText);
      toast.success('Arte e legenda geradas!');
    } catch (error) {
      console.error('Error generating image:', error);
      const errorMessage = error?.response?.data?.error || error.message || 'Erro ao gerar imagem.';
      toast.error(errorMessage, { duration: 8000 });
    } finally {
      setGenerating(false);
    }
  };

  const handlePublishFacebook = async () => {
    if (!generatedImage || !modelText.trim()) {
      toast.error('Gere a arte e a legenda antes de postar.');
      return;
    }

    setPostingFacebook(true);
    try {
      await base44.functions.invoke('facebookPublish', {
        image_url: generatedImage,
        caption: modelText,
      });
      toast.success('Post publicado no Facebook!');
    } catch (error) {
      const errorMessage = error?.response?.data?.error || error.message || 'Erro ao publicar no Facebook.';
      toast.error(errorMessage, { duration: 8000 });
    } finally {
      setPostingFacebook(false);
    }
  };

  const handlePublishInstagram = async () => {
    if (!generatedImage || !modelText.trim()) {
      toast.error('Gere a arte e a legenda antes de postar.');
      return;
    }

    setPostingInstagram(true);
    try {
      await base44.functions.invoke('instagramPublish', {
        image_url: generatedImage,
        caption: modelText,
      });
      toast.success('Post publicado no Instagram!');
    } catch (error) {
      const errorMessage = error?.response?.data?.error || error.message || 'Erro ao publicar no Instagram.';
      toast.error(errorMessage, { duration: 8000 });
    } finally {
      setPostingInstagram(false);
    }
  };

  const handleSaveCampaign = async () => {
    if (!generatedImage) {
      toast.error('Gere a arte antes de salvar.');
      return;
    }

    if (!modelText.trim()) {
      toast.error('Gere a legenda antes de salvar.');
      return;
    }

    await saveCampaignMutation.mutateAsync({
      name: campaignName.trim() || `Campanha ${new Date().toLocaleDateString('pt-BR')}`,
      prompt,
      caption: modelText,
      image_url: generatedImage,
      reference_image_urls: references,
    });
  };

  const handleGenerateVideo = async () => {
    if (!generatedImage) {
      toast.error('Gere a arte antes de pedir o vídeo.');
      return;
    }

    if (!modelText.trim()) {
      toast.error('Gere a legenda antes de pedir o vídeo.');
      return;
    }

    setVideoSending(true);
    try {
      await base44.functions.invoke('sendCampaignVideoToMake', {
        image_url: generatedImage,
        caption: modelText,
        prompt,
        reference_image_urls: references
      });
      toast.success('Pedido de vídeo enviado para o Make!');
    } catch (error) {
      console.error('Error sending campaign video to Make:', error);
      const errorMessage = error?.response?.data?.error || error.message || 'Erro ao enviar pedido de vídeo para o Make.';
      toast.error(errorMessage, { duration: 8000 });
    } finally {
      setVideoSending(false);
    }
  };

  const handleLoadCampaign = (campaign) => {
    setCampaignName(campaign.name || '');
    setPrompt(campaign.prompt || '');
    setGeneratedImage(campaign.image_url || '');
    setModelText(campaign.caption || '');
    setReferences(campaign.reference_image_urls || []);
    toast.success('Campanha carregada novamente.');
  };

  const handleDeleteCampaign = async (campaignId) => {
    await deleteCampaignMutation.mutateAsync(campaignId);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-white">
            <Sparkles className="w-8 h-8 text-[#FF6600]" />
            Campanhas
          </h1>
          <p className="mt-1 text-gray-400">Agora a IA usa suas referências para montar a arte completa em 9:16, ideal para stories e reels.</p>
        </div>
        <Badge className="border border-[#FF6600]/30 bg-[#FF6600]/15 px-3 py-1 text-[#FF6600]">
        Qualidade HD • 9:16 • 1080x1920
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-5 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Nome da campanha</label>
            <Input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              className="border-white/10 bg-white/5"
              placeholder="Ex: Promo inverno 5àsec"
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <label className="text-sm font-medium text-gray-300">Prompt da campanha</label>
                <p className="text-xs text-gray-500">Saída padrão: arte publicitária completa 9:16 baseada nas referências enviadas.</p>
              </div>
              <Button
                type="button"
                onClick={handleGeneratePrompt}
                disabled={generatingPrompt}
                variant="outline"
                className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                {generatingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {generatingPrompt ? 'Gerando prompt...' : 'Gerar novo prompt'}
              </Button>
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[180px] border-white/10 bg-white/5"
              placeholder="Descreva a arte que deseja gerar..."
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-gray-300">Imagens de referência</label>
              <label>
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
                <span className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/15">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Subir imagens
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {references.map((url) => (
                <div key={url} className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20">
                  <img src={url} alt="Referência" className="h-32 w-full object-cover" />
                  <button
                    onClick={() => setReferences((prev) => prev.filter((item) => item !== url))}
                    className="absolute right-2 top-2 h-7 w-7 rounded-full bg-black/60 text-xs text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {references.length === 0 && (
                <div className="col-span-full rounded-xl border border-dashed border-white/10 p-6 text-center text-gray-500">
                  Envie até 6 imagens para inspirar a arte.
                </div>
              )}
            </div>
          </div>

          <Button onClick={handleGenerate} disabled={generating} className="h-12 w-full gap-2 bg-[#FF6600] text-base hover:bg-[#e55c00]">
            {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
            {generating ? 'Gerando campanha...' : 'Gerar arte com referências'}
          </Button>
        </div>

        <div className="space-y-6">
          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
            <div className="flex items-center gap-2 font-semibold text-white">
              <ImageIcon className="w-5 h-5 text-[#FF6600]" /> Arte final
            </div>

            {generatedImage ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                  <img src={generatedImage} alt="Arte gerada" className="h-auto w-full object-cover" />
                </div>
                <div className="flex flex-wrap gap-3">
                  <a href={generatedImage} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" className="bg-transparent border-white/15 text-white hover:bg-white/10">Abrir arte</Button>
                  </a>
                  <a href={generatedImage} download target="_blank" rel="noopener noreferrer">
                    <Button className="bg-[#4C12A1] text-white hover:bg-[#5b17bf]">Baixar arte</Button>
                  </a>
                  <Button onClick={handleSaveCampaign} disabled={saveCampaignMutation.isPending || !generatedImage || !modelText.trim()} className="bg-white/10 text-white hover:bg-white/15">
                    {saveCampaignMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {saveCampaignMutation.isPending ? 'Salvando...' : 'Salvar campanha'}
                  </Button>
                  <Button onClick={handleGenerateVideo} disabled={videoSending || !generatedImage || !modelText.trim()} className="bg-[#6a1cb3] text-white hover:bg-[#7b24ca]">
                    {videoSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
                    {videoSending ? 'Pedindo vídeo...' : 'Gerar vídeo'}
                  </Button>
                  <Button onClick={handlePublishFacebook} disabled={postingFacebook || !generatedImage || !modelText.trim()} className="bg-[#1877F2] text-white hover:bg-[#155ecb]">
                    {postingFacebook ? <Loader2 className="w-4 h-4 animate-spin" /> : <Facebook className="w-4 h-4" />}
                    {postingFacebook ? 'Publicando...' : 'Postar no Facebook'}
                  </Button>
                  <Button onClick={handlePublishInstagram} disabled={postingInstagram || !generatedImage || !modelText.trim()} className="bg-gradient-to-r from-[#833AB4] via-[#E1306C] to-[#F77737] text-white hover:opacity-90">
                    {postingInstagram ? <Loader2 className="w-4 h-4 animate-spin" /> : <Instagram className="w-4 h-4" />}
                    {postingInstagram ? 'Publicando...' : 'Postar no Instagram'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[420px] h-full items-center justify-center rounded-2xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                A arte final aparecerá aqui.
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
            <div className="flex items-center gap-2 font-semibold text-white">
              <Sparkles className="w-5 h-5 text-[#FF6600]" /> Texto para Instagram
            </div>

            <Textarea
              value={modelText}
              onChange={(e) => setModelText(e.target.value)}
              className="min-h-[180px] border-white/10 bg-black/20 text-sm text-gray-300"
              placeholder="O texto da campanha aparecerá aqui separado da imagem."
            />
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Campanhas salvas</h2>
            <p className="mt-1 text-sm text-gray-400">Guarde a arte com a legenda para reutilizar depois.</p>
          </div>
          <Badge className="border border-[#FF6600]/30 bg-[#FF6600]/15 px-3 py-1 text-[#FF6600]">
            {savedCampaigns.length} salvas
          </Badge>
        </div>

        {savedCampaigns.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {savedCampaigns.map((campaign) => (
              <SavedCampaignCard key={campaign.id} campaign={campaign} onLoad={handleLoadCampaign} onDelete={handleDeleteCampaign} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-gray-500">
            Suas campanhas salvas aparecerão aqui.
          </div>
        )}
      </div>
    </div>
  );
}