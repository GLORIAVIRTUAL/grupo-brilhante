import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Network, Upload, Send, Loader2, Image as ImageIcon, X, Download, Calendar, Clock, Save, Facebook } from 'lucide-react';
import { toast } from 'sonner';
import SavedCampaignCard from '@/components/campaigns/SavedCampaignCard';

const NETWORK_TAG = '[REDE]';

export default function CampanhasRede() {
  const [campaignName, setCampaignName] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [uploadedImageUrl, setUploadedImageUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postingFacebook, setPostingFacebook] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');

  const queryClient = useQueryClient();

  const { data: savedCampaigns = [] } = useQuery({
    queryKey: ['campaign-assets-rede'],
    queryFn: async () => {
      const all = await base44.entities.CampaignAsset.list('-created_date', 200);
      return all.filter((c) => (c.prompt || '').startsWith(NETWORK_TAG));
    },
    initialData: [],
  });

  const saveCampaignMutation = useMutation({
    mutationFn: (data) => base44.entities.CampaignAsset.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-assets-rede'] });
      toast.success('Campanha salva!');
    },
    onError: () => toast.error('Erro ao salvar campanha.'),
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: (id) => base44.entities.CampaignAsset.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-assets-rede'] });
      toast.success('Campanha excluída.');
    },
  });

  const handleSaveCampaign = async () => {
    if (!uploadedImageUrl) {
      toast.error('Carregue uma imagem antes de salvar.');
      return;
    }
    if (!caption.trim()) {
      toast.error('Cole o texto da legenda antes de salvar.');
      return;
    }
    await saveCampaignMutation.mutateAsync({
      name: campaignName.trim() || `Campanha da Rede ${new Date().toLocaleDateString('pt-BR')}`,
      prompt: `${NETWORK_TAG} ${campaignName.trim() || 'Campanha da Rede'}`,
      caption,
      image_url: uploadedImageUrl,
      reference_image_urls: [],
    });
  };

  const handleLoadCampaign = (campaign) => {
    setCampaignName((campaign.name || '').replace(/^Campanha da Rede\s*/, '').trim() || campaign.name || '');
    setUploadedImageUrl(campaign.image_url || '');
    setImagePreview(campaign.image_url || '');
    setImageFile(null);
    setCaption(campaign.caption || '');
    toast.success('Campanha carregada novamente.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteCampaign = async (id) => {
    await deleteCampaignMutation.mutateAsync(id);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem.');
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setUploadedImageUrl('');

    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadedImageUrl(file_url);
      toast.success('Imagem carregada com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao enviar a imagem.');
      setImageFile(null);
      setImagePreview('');
    } finally {
      setUploading(false);
    }
  };

  const handleClearImage = () => {
    setImageFile(null);
    setImagePreview('');
    setUploadedImageUrl('');
  };

  const handleDownload = async () => {
    if (!uploadedImageUrl) {
      toast.error('Nenhuma imagem para baixar.');
      return;
    }
    try {
      const response = await fetch(uploadedImageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${campaignName || 'campanha-rede'}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      toast.error('Erro ao baixar a imagem.');
    }
  };

  const handlePostFacebook = async () => {
    if (!uploadedImageUrl) {
      toast.error('Carregue uma imagem antes de publicar.');
      return;
    }
    if (!caption.trim()) {
      toast.error('Cole o texto da legenda antes de publicar.');
      return;
    }
    setPostingFacebook(true);
    try {
      const res = await base44.functions.invoke('facebookPublish', {
        image_url: uploadedImageUrl,
        caption,
      });
      if (res?.data?.status === 'published') {
        toast.success('Publicado na página do Facebook!');
      } else {
        toast.error(`Falha ao publicar: ${res?.data?.error || 'erro desconhecido'}`);
      }
    } catch (error) {
      toast.error(`Erro: ${error?.message || 'falha desconhecida'}`);
    } finally {
      setPostingFacebook(false);
    }
  };

  const handlePostInstagram = async () => {
    console.log('[CampanhasRede] Click Publicar', { uploadedImageUrl, caption });
    if (!uploadedImageUrl) {
      toast.error('Carregue uma imagem antes de publicar.');
      return;
    }
    if (!caption.trim()) {
      toast.error('Cole o texto da legenda antes de publicar.');
      return;
    }

    // Monta agendamento (opcional). Se data e hora forem informadas, envia ISO e local.
    let scheduled_at = null;
    let scheduled_for_local = null;
    if (scheduledDate && scheduledTime) {
      const localDateTime = `${scheduledDate}T${scheduledTime}`;
      const dateObj = new Date(localDateTime);
      if (isNaN(dateObj.getTime())) {
        toast.error('Data ou hora de agendamento inválida.');
        return;
      }
      if (dateObj.getTime() < Date.now()) {
        toast.error('A data/hora de agendamento precisa ser no futuro.');
        return;
      }
      scheduled_at = dateObj.toISOString();
      scheduled_for_local = localDateTime;
    } else if (scheduledDate || scheduledTime) {
      toast.error('Preencha a data e a hora do agendamento.');
      return;
    }

    setPosting(true);
    try {
      if (!scheduled_at) {
        const publishRes = await base44.functions.invoke('instagramPublish', {
          image_url: uploadedImageUrl,
          caption,
        });
        const publishData = publishRes?.data;
        if (publishData?.status === 'published') {
          toast.success('Publicado no Instagram!');
        } else {
          toast.error(`Falha ao publicar: ${publishData?.error || 'erro desconhecido'}`);
        }
        return;
      }

      const response = await base44.functions.invoke('sendCampaignToMake', {
        image_url: uploadedImageUrl,
        caption,
        prompt: campaignName || 'Campanha da Rede',
        reference_image_urls: [],
        scheduled_at,
        scheduled_for_local,
        timezone: 'America/Sao_Paulo',
      });
      console.log('[CampanhasRede] Resposta sendCampaignToMake:', response);
      const data = response?.data;
      if (data?.success) {
        if (scheduled_at) {
          toast.success(`Agendado para ${new Date(scheduled_at).toLocaleString('pt-BR')}!`);
        } else {
          toast.success('Enviado para o Instagram via Make!');
        }
      } else {
        toast.error(`Falha ao enviar: ${data?.error || JSON.stringify(data)}`);
      }
    } catch (error) {
      console.error('[CampanhasRede] Erro ao publicar:', error);
      toast.error(`Erro: ${error?.message || 'falha desconhecida'}`);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Network className="w-8 h-8 text-[#FF6600]" />
          Campanhas da Rede
        </h1>
        <p className="text-gray-400 mt-1">
          Faça upload da arte da rede, cole a legenda e publique direto no Instagram via Make.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload + Form */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Upload className="w-5 h-5 text-[#FF6600]" />
              Arte e legenda
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Nome da campanha (opcional)</label>
              <Input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Ex: Mês das Mães - Rede"
                className="bg-white/5 border-white/10 text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Imagem da campanha</label>
              {!imagePreview ? (
                <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-white/15 rounded-xl p-8 cursor-pointer hover:border-[#FF6600]/50 hover:bg-white/5 transition-colors">
                  <ImageIcon className="w-10 h-10 text-gray-500" />
                  <span className="text-sm text-gray-400">Clique para enviar a arte</span>
                  <span className="text-xs text-gray-600">PNG, JPG até 10MB</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black/30">
                  <img src={imagePreview} alt="Preview" className="w-full max-h-[400px] object-contain" />
                  <button
                    onClick={handleClearImage}
                    className="absolute top-2 right-2 bg-black/60 hover:bg-red-500/80 rounded-full p-1.5 text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  {uploading && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-[#FF6600] animate-spin" />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Legenda do post</label>
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Cole aqui o texto que vai junto com a imagem no Instagram..."
                className="bg-white/5 border-white/10 text-white min-h-[180px]"
              />
            </div>

            <div className="space-y-2 pt-1">
              <label className="text-sm font-medium text-gray-300">Agendamento (opcional)</label>
              <p className="text-xs text-gray-500">Deixe em branco para publicar imediatamente.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="bg-white/5 border-white/10 text-white pl-9"
                  />
                </div>
                <div className="relative">
                  <Clock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="bg-white/5 border-white/10 text-white pl-9"
                  />
                </div>
              </div>
              {scheduledDate && scheduledTime && (
                <p className="text-xs text-[#FF6600]">
                  Será publicado em {new Date(`${scheduledDate}T${scheduledTime}`).toLocaleString('pt-BR')}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              <Button
                onClick={handleDownload}
                disabled={!uploadedImageUrl}
                variant="outline"
                className="flex-1 bg-white/5 border-white/10 text-white hover:bg-white/10"
              >
                <Download className="w-4 h-4 mr-2" />
                Baixar imagem
              </Button>
              <Button
                onClick={handleSaveCampaign}
                disabled={saveCampaignMutation.isPending || !uploadedImageUrl || !caption.trim()}
                variant="outline"
                className="flex-1 bg-white/5 border-white/10 text-white hover:bg-white/10"
              >
                {saveCampaignMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Salvar campanha
              </Button>
              <Button
                onClick={handlePostInstagram}
                disabled={posting || uploading}
                className="flex-1 bg-[#FF6600] hover:bg-[#e55c00] disabled:opacity-50"
              >
                {posting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {scheduledDate && scheduledTime ? 'Agendando...' : 'Publicando...'}
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    {scheduledDate && scheduledTime ? 'Agendar publicação' : 'Publicar no Instagram'}
                  </>
                )}
              </Button>
              <Button
                onClick={handlePostFacebook}
                disabled={postingFacebook || uploading}
                className="flex-1 bg-[#1877F2] hover:bg-[#155ecb] disabled:opacity-50"
              >
                {postingFacebook ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Publicando...
                  </>
                ) : (
                  <>
                    <Facebook className="w-4 h-4 mr-2" />
                    Publicar no Facebook
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card className="bg-white/5 border-white/10" data-preview="true">
          <CardHeader>
            <CardTitle className="text-white text-lg">Pré-visualização</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl overflow-hidden border border-white/10 bg-black/30">
              {imagePreview ? (
                <img src={imagePreview} alt="Preview" className="w-full object-contain max-h-[500px]" />
              ) : (
                <div className="aspect-square flex items-center justify-center text-gray-600">
                  <ImageIcon className="w-16 h-16" />
                </div>
              )}
              {caption && (
                <div className="p-4 text-sm text-gray-200 whitespace-pre-wrap border-t border-white/10">
                  {caption}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Campanhas salvas */}
      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Campanhas salvas</h2>
            <p className="mt-1 text-sm text-gray-400">Reutilize uma campanha da rede já salva.</p>
          </div>
          <Badge className="border border-[#FF6600]/30 bg-[#FF6600]/15 px-3 py-1 text-[#FF6600]">
            {savedCampaigns.length} salvas
          </Badge>
        </div>

        {savedCampaigns.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {savedCampaigns.map((campaign) => (
              <SavedCampaignCard
                key={campaign.id}
                campaign={campaign}
                onLoad={handleLoadCampaign}
                onDelete={handleDeleteCampaign}
              />
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