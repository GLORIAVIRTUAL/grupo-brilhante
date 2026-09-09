import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Send, Loader2, Info, Image as ImageIcon, MessageCircle, Mail } from 'lucide-react';
import { toast } from "sonner";

export default function ProspectDispatchModal({ open, onOpenChange, prospects, selectedIds }) {
  const [message, setMessage] = useState('Olá {empresa}! Somos da 5àsec e gostaríamos de apresentar nossos serviços corporativos. Podemos conversar? 👔✨');
  const [sendToAll, setSendToAll] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendWhatsapp, setSendWhatsapp] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);
  const [emailSubject, setEmailSubject] = useState('Serviços corporativos 5àsec');

  const isEligible = (p) => (sendWhatsapp && p.phone) || (sendEmail && p.email);
  const eligible = prospects.filter(isEligible);
  const targetCount = sendToAll
    ? eligible.length
    : prospects.filter(p => selectedIds.includes(p.id) && isEligible(p)).length;

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setImageUrl(file_url);
      toast.success('Imagem enviada!');
    } catch {
      toast.error('Erro ao subir imagem');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleSend = async () => {
    if (!message.trim() && !imageUrl) {
      toast.error("Digite uma mensagem ou envie uma imagem");
      return;
    }
    if (!sendToAll && selectedIds.length === 0) {
      toast.error("Selecione pelo menos uma empresa ou ative 'Enviar para todas'");
      return;
    }
    if (!sendWhatsapp && !sendEmail) {
      toast.error("Escolha pelo menos um canal de envio");
      return;
    }
    if (!confirm(`Confirma o envio para ${targetCount} empresa(s)?`)) return;

    setSending(true);
    try {
      const { data } = await base44.functions.invoke('sendProspectDispatch', {
        message,
        image_url: imageUrl || null,
        prospect_ids: sendToAll ? [] : selectedIds,
        send_to_all: sendToAll,
        channels: [sendWhatsapp && 'whatsapp', sendEmail && 'email'].filter(Boolean),
        email_subject: emailSubject
      });
      const r = data.results;
      toast.success(`Disparo concluído! WhatsApp: ${r.sent} enviados / ${r.failed} falhas. E-mail: ${r.emails_sent || 0} enviados / ${r.emails_failed || 0} falhas.`);
      onOpenChange(false);
      setImageUrl('');
      setSendToAll(false);
    } catch (err) {
      toast.error("Erro ao enviar: " + (err?.response?.data?.error || err.message));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1a0b36] border-white/10 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Send className="w-5 h-5 text-[#FF6600]" />
            Disparo para Prospecção
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
            <Label>Canais de envio</Label>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <MessageCircle className="w-4 h-4 text-[#25D366]" /> WhatsApp
              </div>
              <Switch checked={sendWhatsapp} onCheckedChange={setSendWhatsapp} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <Mail className="w-4 h-4 text-[#FF6600]" /> E-mail
              </div>
              <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
            </div>
            {sendEmail && (
              <div className="space-y-2 pt-2">
                <Label>Assunto do e-mail</Label>
                <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="bg-white/5 border-white/10" />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Mensagem</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="bg-white/5 border-white/10 min-h-[120px]"
            />
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Info className="w-3 h-3" />
              Use <code className="bg-white/10 px-1 rounded">{'{empresa}'}</code> e <code className="bg-white/10 px-1 rounded">{'{contato}'}</code> para personalizar.
            </div>
          </div>

          <div className="space-y-2">
            <Label>Imagem (opcional)</Label>
            <div className="border border-dashed border-white/10 rounded-xl p-4 bg-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <ImageIcon className="w-4 h-4 text-[#FF6600]" />
                  Enviar imagem junto com a mensagem.
                </div>
                <label className="inline-flex">
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  <span className="cursor-pointer px-4 py-2 rounded-lg bg-[#FF6600] hover:bg-[#e55c00] text-white text-sm">
                    {uploadingImage ? 'Enviando...' : 'Escolher imagem'}
                  </span>
                </label>
              </div>
              {imageUrl && (
                <div className="rounded-xl overflow-hidden border border-white/10 bg-black/20 p-3">
                  <img src={imageUrl} alt="Prévia" className="w-full max-h-56 object-cover rounded-lg" />
                  <div className="flex justify-end mt-3">
                    <Button type="button" variant="ghost" className="text-red-400 hover:bg-red-500/10" onClick={() => setImageUrl('')}>
                      Remover
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label>Enviar para todas as empresas</Label>
            <div className="flex items-center gap-2">
              <Switch checked={sendToAll} onCheckedChange={setSendToAll} />
              <span className="text-sm text-gray-400">{eligible.length} elegíveis</span>
            </div>
          </div>

          <Button onClick={handleSend} disabled={sending} className="w-full bg-[#FF6600] hover:bg-[#e55c00] gap-2 h-12 text-lg">
            {sending ? <><Loader2 className="w-5 h-5 animate-spin" /> Enviando...</> : <><Send className="w-5 h-5" /> Enviar Disparo ({targetCount})</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}