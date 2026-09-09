import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Send, Search, X, Loader2, Info, Image as ImageIcon } from 'lucide-react';
import { toast } from "sonner";
import DispatchAudienceFilters from '@/components/dispatches/DispatchAudienceFilters';

const isConsentRequestMessage = (value) => {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const asksPermission = ['posso te enviar', 'posso enviar', 'podemos te enviar', 'podemos enviar', 'voce autoriza', 'quer receber', 'gostaria de receber', 'responda sim'].some(term => normalized.includes(term));
  const mentionsCampaign = ['promoc', 'novidade', 'oferta', 'mensagem', 'whatsapp'].some(term => normalized.includes(term));
  return asksPermission && mentionsCampaign;
};

const MOINHOS_CONSENT_TEMPLATE = `Olá, {nome}! Tudo bem? 😊

Temos promoções e novidades exclusivas disponíveis agora para você, que já é cliente da 5àsec do Moinhos Shopping!

Podemos enviar essas ofertas e novidades pelo WhatsApp?

Responda SIM para autorizar ou NÃO para recusar.`;

const dispatchTypes = [
  { value: 'consent_request', label: 'Solicitar consentimento', template: 'Olá {nome}! Você autoriza a 5àsec a enviar promoções e novidades pelo WhatsApp? Responda SIM para aceitar ou NÃO para recusar.' },
  { value: 'promotional', label: 'Promocional', template: 'Olá {nome}! 🎉 Aproveite nossa promoção especial da 5àsec: 20% de desconto em todos os serviços de lavagem esta semana! Traga suas peças e economize. 🧺✨' },
  { value: 'birthday', label: 'Aniversariante', template: 'Parabéns, {nome}! 🎂🎈 A 5àsec deseja um feliz aniversário! Para celebrar, preparamos um presente: 15% de desconto no seu próximo pedido. Aproveite! 🎁' },
  { value: 'satisfaction_survey', label: 'Pesquisa de Satisfação', template: 'Olá {nome}! Como foi sua última experiência com a 5àsec? De 0 a 10, qual nota você daria? Sua opinião é muito importante para nós! ⭐' },
  { value: 'inactive_customer', label: 'Reengajamento', template: 'Olá {nome}, sentimos sua falta! 😊 Faz um tempo que não nos visitou. Que tal renovar seu guarda-roupa com a 5àsec? Temos novidades esperando por você! 👔✨' },
  { value: 'order_reminder', label: 'Lembrete de Pedido', template: 'Olá {nome}! 📦 Lembramos que seu pedido na 5àsec está pronto para retirada. Estamos aguardando sua visita! 😊' },
  { value: 'follow_up', label: 'Follow-up', template: 'Olá {nome}! Passando para saber se ficou satisfeito(a) com nosso serviço. Precisa de algo mais? Estamos à disposição! 💬' },
];

export default function NewDispatchModal({ open, onOpenChange, onSent }) {
  const [type, setType] = useState('promotional');
  const [message, setMessage] = useState(dispatchTypes.find(item => item.value === 'promotional').template);

  const handleTypeChange = (newType) => {
    setType(newType);
    const template = newType === 'consent_request' && isMoinhosUnit(selectedUnitId)
      ? MOINHOS_CONSENT_TEMPLATE
      : dispatchTypes.find(d => d.value === newType)?.template || '';
    setMessage(template);
  };
  const [sendToAll, setSendToAll] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomers, setSelectedCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [units, setUnits] = useState([]);
  const [selectedUnitId, setSelectedUnitId] = useState('all');
  const [inactivityMonths, setInactivityMonths] = useState('0');

  const isMoinhosUnit = (unitId) => {
    const unit = units.find(item => item.id === unitId);
    const identifier = `${unit?.name || ''} ${unit?.subdomain || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return identifier.includes('moinhos');
  };

  const handleUnitChange = (value) => {
    setSelectedUnitId(value);
    setSelectedCustomers([]);
    if (type === 'consent_request') {
      const defaultTemplate = dispatchTypes.find(item => item.value === 'consent_request').template;
      setMessage(isMoinhosUnit(value) ? MOINHOS_CONSENT_TEMPLATE : defaultTemplate);
    }
  };

  useEffect(() => {
    if (open) {
      loadCustomers();
    }
  }, [open]);

  const loadCustomers = async () => {
    setLoadingCustomers(true);
    const [list, unitList] = await Promise.all([
      base44.entities.Customer.filter({ status: 'active' }, '-created_date', 10000),
      base44.entities.Unit.list('name', 100)
    ]);
    setCustomers(list);
    setUnits(unitList);
    setLoadingCustomers(false);
  };

  const inactivityCutoff = new Date();
  inactivityCutoff.setMonth(inactivityCutoff.getMonth() - Number(inactivityMonths));
  const isConsentRequest = type === 'consent_request' || isConsentRequestMessage(message);
  const matchesAudienceFilters = (customer) =>
    customer.phones?.length > 0 &&
    (selectedUnitId === 'all' || customer.unit_id === selectedUnitId) &&
    (inactivityMonths === '0' || (customer.last_inbound_at && new Date(customer.last_inbound_at) <= inactivityCutoff));

  const eligibleCustomers = customers.filter(c =>
    matchesAudienceFilters(c) &&
    (isConsentRequest
      ? !['accepted', 'revoked', 'pending'].includes(c.whatsapp_consent_status)
      : c.opt_in_whatsapp === true && c.whatsapp_consent_status === 'accepted')
  );

  const selectableCustomers = isConsentRequest
    ? customers.filter(c => matchesAudienceFilters(c) && !['revoked', 'pending'].includes(c.whatsapp_consent_status))
    : eligibleCustomers;

  const filteredCustomers = selectableCustomers.filter(c =>
    !searchTerm ||
    c.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phones?.[0]?.includes(searchTerm)
  );

  const toggleCustomer = (id) => {
    setSelectedCustomers(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setImageUrl(file_url);
      toast.success('Imagem enviada com sucesso!');
    } catch (err) {
      toast.error('Erro ao subir imagem');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleSend = async () => {
    if (!message.trim()) {
      toast.error("Digite uma mensagem");
      return;
    }
    if (!sendToAll && selectedCustomers.length === 0) {
      toast.error("Selecione pelo menos um cliente ou ative 'Enviar para todos'");
      return;
    }

    const targetCount = sendToAll ? eligibleCustomers.length : selectedCustomers.length;

    if (!confirm(`Confirma o agendamento de ${targetCount} cliente(s), distribuído em horários variados durante 10 horas?`)) return;

    setSending(true);
    try {
      const { data } = await base44.functions.invoke('sendDispatch', {
        type: isConsentRequest ? 'consent_request' : type,
        message,
        image_url: imageUrl || null,
        customer_ids: sendToAll ? [] : selectedCustomers,
        send_to_all_active: sendToAll,
        unit_id: selectedUnitId,
        inactivity_months: Number(inactivityMonths),
        duration_hours: 10
      });

      toast.success(`Disparo agendado com segurança: ${data.results.scheduled} mensagens serão distribuídas em 10 horas.`);
      onSent?.();
      onOpenChange(false);
      // Reset
      setMessage('');
      setImageUrl('');
      setSelectedCustomers([]);
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
            Novo Disparo via WhatsApp
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          {/* Type */}
          <div className="space-y-2">
            <Label>Tipo de Disparo</Label>
            <Select value={type} onValueChange={handleTypeChange}>
              <SelectTrigger className="bg-white/5 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dispatchTypes.map(dt => (
                  <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Message */}
          <div className="space-y-2">
            <Label>Mensagem</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Olá {nome}, aproveite nossa promoção..."
              className="bg-white/5 border-white/10 min-h-[120px]"
            />
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Info className="w-3 h-3" />
              Use <code className="bg-white/10 px-1 rounded">{'{nome}'}</code> para personalizar com o nome do cliente.
            </div>
          </div>

          <div className="space-y-2">
            <Label>Imagem do Disparo (opcional)</Label>
            <div className="border border-dashed border-white/10 rounded-xl p-4 bg-white/5 space-y-3">
              <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <ImageIcon className="w-4 h-4 text-[#FF6600]" />
                  Suba uma imagem para enviar junto com a mensagem.
                </div>
                <label className="inline-flex">
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  <span className="cursor-pointer px-4 py-2 rounded-lg bg-[#FF6600] hover:bg-[#e55c00] text-white text-sm transition-colors">
                    {uploadingImage ? 'Enviando...' : 'Escolher imagem'}
                  </span>
                </label>
              </div>

              {imageUrl && (
                <div className="rounded-xl overflow-hidden border border-white/10 bg-black/20 p-3">
                  <img src={imageUrl} alt="Prévia do disparo" className="w-full max-h-56 object-cover rounded-lg" />
                  <div className="flex justify-end mt-3">
                    <Button type="button" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => setImageUrl('')}>
                      Remover imagem
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DispatchAudienceFilters
            units={units}
            unitId={selectedUnitId}
            onUnitChange={handleUnitChange}
            inactivity={inactivityMonths}
            onInactivityChange={(value) => { setInactivityMonths(value); setSelectedCustomers([]); }}
            eligibleCount={eligibleCustomers.length}
            isConsentRequest={isConsentRequest}
          />

          {/* Target */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Destinatários</Label>
              <div className="flex items-center gap-2">
                <Switch checked={sendToAll} onCheckedChange={setSendToAll} />
                <span className="text-sm text-gray-400">
                  Todos elegíveis ({eligibleCustomers.length})
                </span>
              </div>
            </div>

            {!sendToAll && (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <Input
                    placeholder="Buscar cliente..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 bg-white/5 border-white/10"
                  />
                </div>

                {selectedCustomers.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedCustomers.map(id => {
                      const c = customers.find(x => x.id === id);
                      return (
                        <Badge key={id} className="bg-[#FF6600]/20 text-[#FF6600] border-[#FF6600]/30 gap-1 cursor-pointer" onClick={() => toggleCustomer(id)}>
                          {c?.full_name || id}
                          <X className="w-3 h-3" />
                        </Badge>
                      );
                    })}
                  </div>
                )}

                <div className="max-h-48 overflow-y-auto space-y-1 border border-white/10 rounded-lg p-2">
                  {loadingCustomers ? (
                    <div className="text-center text-gray-400 py-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
                  ) : filteredCustomers.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-4">Nenhum cliente elegível encontrado</p>
                  ) : (
                    filteredCustomers.slice(0, 100).map(c => (
                      <button
                        key={c.id}
                        onClick={() => toggleCustomer(c.id)}
                        className={`w-full text-left p-2 rounded-lg flex items-center justify-between transition-colors ${
                          selectedCustomers.includes(c.id)
                            ? 'bg-[#FF6600]/10 border border-[#FF6600]/30'
                            : 'hover:bg-white/5'
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium text-white">{c.full_name}</p>
                          <p className="text-xs text-gray-400">{c.phones?.[0]}</p>
                        </div>
                        {selectedCustomers.includes(c.id) && (
                          <div className="w-5 h-5 rounded-full bg-[#FF6600] flex items-center justify-center">
                            <span className="text-white text-xs">✓</span>
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Send Button */}
          <Button
            onClick={handleSend}
            disabled={sending}
            className="w-full bg-[#FF6600] hover:bg-[#e55c00] gap-2 h-12 text-lg"
          >
            {sending ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Agendando...</>
            ) : (
              <><Send className="w-5 h-5" /> Agendar em 10 horas ({sendToAll ? eligibleCustomers.length : selectedCustomers.length} clientes)</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}