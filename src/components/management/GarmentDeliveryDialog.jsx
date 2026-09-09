import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Loader2, PackageCheck, Printer, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { uploadSecureFile } from '@/lib/secureFiles';
import { printDeliveryReceipt } from '@/lib/deliveryReceiptDocument';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

export default function GarmentDeliveryDialog({ open, onOpenChange, garments = [], orders = [], customers = [], onCompleted }) {
  const [recipientName, setRecipientName] = useState('');
  const [documentLast4, setDocumentLast4] = useState('');
  const [relationship, setRelationship] = useState('customer');
  const [deliveryType, setDeliveryType] = useState('counter_pickup');
  const [notes, setNotes] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [allowOutstanding, setAllowOutstanding] = useState(false);
  const [releaseReason, setReleaseReason] = useState('');
  const [printReceipt, setPrintReceipt] = useState(true);
  const [busy, setBusy] = useState(false);

  const customer = customers.find((item) => item.id === garments[0]?.customer_id);
  const orderIds = useMemo(() => [...new Set(garments.map((garment) => garment.order_id).filter(Boolean))], [garments]);
  const relatedOrders = useMemo(() => orders.filter((order) => orderIds.includes(order.id)), [orders, orderIds]);
  const outstanding = relatedOrders.reduce((sum, order) => sum + Math.max(0, Number(order.total_amount || 0) - Number(order.paid_amount || 0)), 0);
  const deliveredValue = garments.reduce((sum, garment) => sum + Number(garment.total_amount || garment.subtotal || 0), 0);
  const invalidGarments = garments.filter((garment) => !['ready', 'out_for_delivery'].includes(garment.status));
  const mixedCustomers = new Set(garments.map((garment) => garment.customer_id)).size > 1;

  useEffect(() => {
    if (open) {
      setRecipientName(customer?.full_name || '');
      setDocumentLast4('');
      setRelationship('customer');
      setDeliveryType('counter_pickup');
      setNotes('');
      setProofFile(null);
      setAllowOutstanding(false);
      setReleaseReason('');
      setPrintReceipt(true);
    }
  }, [open, customer?.full_name]);

  const complete = async () => {
    if (garments.length === 0 || invalidGarments.length > 0 || mixedCustomers) return toast.error('Selecione somente peças prontas do mesmo cliente.');
    if (recipientName.trim().length < 2) return toast.error('Informe quem recebeu as peças.');
    if (outstanding > 0 && !allowOutstanding) return toast.error('Há saldo em aberto. Registre o pagamento ou solicite liberação gerencial.');
    if (allowOutstanding && releaseReason.trim().length < 10) return toast.error('Descreva o motivo da liberação com saldo.');

    const receiptWindow = printReceipt ? window.open('', '_blank', 'width=620,height=760') : null;
    if (receiptWindow) {
      receiptWindow.document.write('<!doctype html><title>Preparando comprovante</title><body style="font-family:Arial;padding:32px">Concluindo a entrega e preparando o comprovante…</body>');
      receiptWindow.document.close();
    } else if (printReceipt) {
      toast.error('O navegador bloqueou a janela do comprovante. A entrega ainda pode ser concluída.');
    }

    setBusy(true);
    try {
      let proofAssetIds = [];
      if (proofFile) {
        const uploaded = await uploadSecureFile({
          file: proofFile,
          documentType: 'delivery_proof',
          unitId: garments[0].unit_id,
          customerId: garments[0].customer_id,
          metadata: { source: 'garment_delivery' },
        });
        proofAssetIds = [uploaded.asset.id];
      }

      const response = await base44.functions.invoke('complete_garment_delivery', {
        garment_item_ids: garments.map((garment) => garment.id),
        idempotency_key: crypto.randomUUID(),
        delivery_type: deliveryType,
        recipient_name: recipientName.trim(),
        recipient_document_last4: documentLast4,
        recipient_relationship: relationship,
        proof_asset_ids: proofAssetIds,
        allow_outstanding: allowOutstanding,
        release_reason: allowOutstanding ? releaseReason.trim() : undefined,
        notes: notes.trim() || undefined,
      });

      const receipt = response.data?.receipt;
      if (printReceipt && receipt && receiptWindow) {
        try { printDeliveryReceipt({ receipt, garments, customerName: customer?.full_name || 'Cliente' }, receiptWindow); }
        catch (error) { if (error.message === 'print_window_blocked') toast.error('A entrega foi concluída, mas o navegador bloqueou a impressão.'); }
      }
      toast.success(receipt?.delivery_scope === 'partial' ? 'Entrega parcial registrada.' : 'Entrega concluída.');
      onCompleted?.(receipt);
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      receiptWindow?.close();
      const code = error.response?.data?.error || error.code;
      const messages = {
        outstanding_balance: 'Há saldo em aberto. Registre o pagamento antes da entrega.',
        outstanding_release_forbidden: 'Somente um gerente autorizado pode liberar peças com saldo.',
        garment_not_ready: 'Uma das peças não está pronta para entrega.',
        single_customer_and_unit_required: 'Selecione peças do mesmo cliente e da mesma unidade.',
        DUPLICATE_DOCUMENT: 'Esta foto de comprovante já foi usada.',
      };
      toast.error(messages[code] || error.message || 'Não foi possível concluir a entrega.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto border-white/10 bg-[#170c2b] text-white">
        <DialogHeader><div className="flex items-center gap-3"><div className="rounded-2xl bg-emerald-500/15 p-2.5 text-emerald-300"><PackageCheck className="h-5 w-5" /></div><div><DialogTitle>Retirada e entrega de peças</DialogTitle><DialogDescription className="text-white/50">Confirme apenas as peças físicas selecionadas. As demais permanecem abertas no ticket.</DialogDescription></div></div></DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1.25fr_.9fr]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold">{customer?.full_name || 'Cliente'}</p><p className="text-xs text-white/35">{orderIds.length} ticket(s) · {garments.length} peça(s)</p></div><Badge variant="outline" className="border-emerald-400/30 text-emerald-200">{money(deliveredValue)}</Badge></div></div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">{garments.map((garment) => <div key={garment.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/15 p-3"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{garment.product_name}</p><p className="font-mono text-xs text-white/35">{garment.garment_code}</p><p className="truncate text-xs text-white/40">{(garment.services || []).map((service) => service.name).filter(Boolean).join(' + ') || 'Serviço conforme ticket'}</p></div><span className="text-sm font-semibold">{money(garment.total_amount || garment.subtotal)}</span></div>)}</div>
            {(invalidGarments.length > 0 || mixedCustomers) && <div className="flex gap-2 rounded-2xl border border-red-400/20 bg-red-500/5 p-4 text-sm text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Seleção inválida: use somente peças prontas do mesmo cliente.</div>}
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><div className="space-y-2"><Label>Tipo</Label><Select value={deliveryType} onValueChange={setDeliveryType}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="counter_pickup">Retirada no balcão</SelectItem><SelectItem value="courier_delivery">Entrega por motorista</SelectItem><SelectItem value="locker_pickup">Retirada em locker</SelectItem><SelectItem value="other">Outro</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Quem recebeu</Label><Input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} className="border-white/10 bg-black/20" /></div><div className="space-y-2"><Label>Relação com cliente</Label><Select value={relationship} onValueChange={setRelationship}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="customer">Próprio cliente</SelectItem><SelectItem value="family">Familiar</SelectItem><SelectItem value="employee">Funcionário</SelectItem><SelectItem value="courier">Motorista/portador</SelectItem><SelectItem value="other">Outro</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Últimos 4 dígitos do documento</Label><Input inputMode="numeric" maxLength={4} value={documentLast4} onChange={(event) => setDocumentLast4(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Opcional" className="border-white/10 bg-black/20" /></div></div>

            <div className="space-y-2"><Label className="flex items-center gap-2"><Camera className="h-4 w-4 text-cyan-300" />Foto de prova opcional</Label><Input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setProofFile(event.target.files?.[0] || null)} className="border-white/10 bg-black/20" /></div>
            <div className="space-y-2"><Label>Observações</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20 border-white/10 bg-black/20" /></div>

            {outstanding > 0 && <div className="space-y-3 rounded-2xl border border-amber-400/25 bg-amber-500/5 p-4"><div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><div><p className="text-sm font-semibold text-amber-200">Saldo em aberto: {money(outstanding)}</p><p className="text-xs text-amber-100/50">A liberação exige perfil gerencial e justificativa.</p></div></div><label className="flex items-center gap-2 text-sm"><Checkbox checked={allowOutstanding} onCheckedChange={(value) => setAllowOutstanding(value === true)} />Solicitar liberação gerencial</label>{allowOutstanding && <Textarea value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} placeholder="Motivo detalhado da liberação" className="border-amber-400/20 bg-black/20" />}</div>}

            <label className="flex items-center gap-2 text-sm text-white/65"><Checkbox checked={printReceipt} onCheckedChange={(value) => setPrintReceipt(value === true)} /><Printer className="h-4 w-4" />Imprimir comprovante após concluir</label>
            <Button onClick={complete} disabled={busy || garments.length === 0 || invalidGarments.length > 0 || mixedCustomers} className="w-full bg-emerald-500 text-slate-950 hover:bg-emerald-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserRoundCheck className="mr-2 h-4 w-4" />}Confirmar entrega de {garments.length} peça(s)</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
