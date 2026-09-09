import { useEffect, useState } from 'react';
import { Check, Loader2, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const DEFAULT_CHECKLIST = [
  { code: 'cleanliness', label: 'Limpeza e remoção de manchas', result: 'pass', notes: '' },
  { code: 'odor', label: 'Odor adequado', result: 'pass', notes: '' },
  { code: 'finish', label: 'Acabamento e passadoria', result: 'pass', notes: '' },
  { code: 'integrity', label: 'Integridade da peça preservada', result: 'pass', notes: '' },
  { code: 'identification', label: 'Etiqueta e identificação corretas', result: 'pass', notes: '' },
];

export default function QualityInspectionModal({ garment, open, onOpenChange, onCompleted }) {
  const [checklist, setChecklist] = useState(DEFAULT_CHECKLIST);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setChecklist(DEFAULT_CHECKLIST.map((item) => ({ ...item })));
      setNotes('');
    }
  }, [open, garment?.id]);

  const updateResult = (code, result) => setChecklist((current) => current.map((item) => item.code === code ? { ...item, result } : item));
  const failed = checklist.filter((item) => item.result === 'fail');

  const submit = async (status) => {
    if (!garment) return;
    if (status === 'rejected' && failed.length === 0) return toast.error('Marque ao menos um critério como reprovado.');
    setBusy(true);
    try {
      await base44.functions.invoke('inspect_garment_quality', {
        garment_item_id: garment.id,
        inspection_type: 'final',
        status,
        checklist,
        defect_codes: failed.map((item) => item.code),
        severity: failed.length > 1 ? 'major' : (failed.length === 1 ? 'minor' : 'none'),
        reason_code: failed[0]?.code,
        notes,
        responsible_team: 'production',
        customer_impact: status === 'rejected' ? 'delay' : 'none',
      });
      toast.success(status === 'rejected' ? 'Retrabalho aberto e peça devolvida à produção.' : 'Peça aprovada e liberada.');
      onCompleted?.();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível registrar a inspeção.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="max-w-2xl border-white/10 bg-[#170c2b] text-white">
        <DialogHeader>
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-indigo-500/20 p-2.5 text-indigo-300"><ShieldCheck className="h-5 w-5" /></div><div><DialogTitle>Controle de qualidade</DialogTitle><DialogDescription className="text-white/50">{garment?.garment_code} · {garment?.product_name}</DialogDescription></div></div>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {checklist.map((item) => (
            <div key={item.code} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium">{item.label}</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['pass', 'Aprovado', Check], ['fail', 'Reprovar', X], ['not_applicable', 'N/A', RotateCcw],
                ].map(([value, label, Icon]) => (
                  <button key={value} type="button" onClick={() => updateResult(item.code, value)} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs ${item.result === value ? (value === 'fail' ? 'border-red-400/50 bg-red-500/15 text-red-200' : 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200') : 'border-white/10 bg-white/5 text-white/45'}`}><Icon className="h-3.5 w-3.5" />{label}</button>
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-2"><Label>Observações</Label><Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Detalhes para a equipe ou para o retrabalho" className="border-white/10 bg-white/5" /></div>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => submit('rejected')} disabled={busy || failed.length === 0} className="border-red-400/30 text-red-200 hover:bg-red-500/10">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Abrir retrabalho</Button>
            <Button onClick={() => submit(failed.length ? 'approved_with_observation' : 'approved')} disabled={busy} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Aprovar peça</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
