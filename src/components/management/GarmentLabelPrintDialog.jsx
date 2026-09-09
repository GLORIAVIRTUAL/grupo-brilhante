import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Printer, QrCode, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { printGarmentLabels } from '@/lib/garmentLabels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function GarmentLabelPrintDialog({ open, onOpenChange, garments = [], onPrinted }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedIds(garments.map((garment) => garment.id));
      setReason('');
    }
  }, [open, garments]);

  const selected = useMemo(() => garments.filter((garment) => selectedIds.includes(garment.id)), [garments, selectedIds]);
  const reprintCount = selected.filter((garment) => Number(garment.label_print_count || 0) > 0).length;

  const toggle = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);

  const print = async () => {
    if (selected.length === 0) return toast.error('Selecione ao menos uma peça.');
    if (reprintCount > 0 && reason.trim().length < 5) return toast.error('Informe o motivo da reimpressão.');
    const printWindow = window.open('', '_blank', 'width=840,height=680');
    if (!printWindow) return toast.error('Permita janelas pop-up para imprimir as etiquetas.');
    printWindow.document.write('<!doctype html><title>Preparando etiquetas</title><body style="font-family:Arial;padding:32px">Registrando e preparando etiquetas…</body>');
    printWindow.document.close();
    setBusy(true);
    try {
      await base44.functions.invoke('register_label_print', {
        garment_item_ids: selected.map((garment) => garment.id),
        reprint_reason: reason.trim() || undefined,
      });
      await printGarmentLabels(selected, printWindow);
      toast.success(`${selected.length} etiqueta(s) preparada(s) para impressão.`);
      onPrinted?.();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      printWindow.close();
      toast.error(error.message === 'print_window_blocked' ? 'Permita janelas pop-up para imprimir as etiquetas.' : error.response?.data?.error === 'reprint_reason_required' ? 'Informe um motivo para a reimpressão.' : 'Não foi possível preparar as etiquetas.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden border-white/10 bg-[#170c2b] p-0 text-white">
        <DialogHeader className="border-b border-white/10 px-6 py-5"><div className="flex items-center gap-3"><div className="rounded-2xl bg-orange-500/15 p-2.5 text-orange-300"><Printer className="h-5 w-5" /></div><div><DialogTitle>Imprimir etiquetas das peças</DialogTitle><DialogDescription className="text-white/50">Formato térmico 62 × 40 mm com QR e código legível.</DialogDescription></div></div></DialogHeader>

        <div className="grid min-h-0 md:grid-cols-[1fr_260px]">
          <ScrollArea className="max-h-[65vh] border-r border-white/10">
            <div className="space-y-2 p-5">
              <button type="button" onClick={() => setSelectedIds(selectedIds.length === garments.length ? [] : garments.map((garment) => garment.id))} className="mb-2 text-xs font-medium text-orange-300 hover:text-orange-200">{selectedIds.length === garments.length ? 'Limpar seleção' : 'Selecionar todas'}</button>
              {garments.map((garment) => {
                const checked = selectedIds.includes(garment.id);
                return <button key={garment.id} type="button" onClick={() => toggle(garment.id)} className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${checked ? 'border-orange-400/50 bg-orange-500/10' : 'border-white/10 bg-white/[0.03]'}`}><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${checked ? 'border-orange-300 bg-orange-400 text-slate-950' : 'border-white/15 text-transparent'}`}><Check className="h-4 w-4" /></div><QrCode className="h-5 w-5 text-white/35" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{garment.product_name}</p><p className="font-mono text-xs text-white/40">{garment.garment_code}</p></div>{Number(garment.label_print_count || 0) > 0 && <Badge variant="outline" className="border-amber-400/30 text-amber-200"><RotateCcw className="mr-1 h-3 w-3" />{garment.label_print_count}×</Badge>}</button>;
              })}
              {garments.length === 0 && <div className="py-16 text-center text-sm text-white/35">Nenhuma peça disponível para impressão.</div>}
            </div>
          </ScrollArea>

          <aside className="space-y-5 p-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><p className="text-xs text-white/40">Selecionadas</p><p className="mt-1 text-3xl font-bold">{selected.length}</p><p className="mt-2 text-xs text-white/35">As etiquetas não exibem nome ou telefone do cliente.</p></div>
            {reprintCount > 0 && <div className="space-y-2 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4"><Label className="text-amber-200">Motivo da reimpressão</Label><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: etiqueta danificada" className="border-amber-400/20 bg-black/20" /><p className="text-xs text-amber-100/50">{reprintCount} peça(s) já possuem impressão registrada.</p></div>}
            <Button onClick={print} disabled={busy || selected.length === 0} className="w-full bg-gradient-to-r from-orange-500 to-fuchsia-500">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}Registrar e imprimir</Button>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
