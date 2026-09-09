import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import TimeField from '@/components/management/TimeField';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendente' },
  { value: 'processing', label: 'Em Processo' },
  { value: 'ready', label: 'Pronto' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'finished', label: 'Finalizado' },
  { value: 'cancelled', label: 'Cancelado' }
];

const toLocalInput = (d) => {
  if (!d) return '';
  const date = new Date(d);
  const off = date.getTimezoneOffset();
  return new Date(date.getTime() - off * 60000).toISOString().slice(0, 16);
};

export default function EditTicketModal({ ticket, open, onClose, onSave }) {
  const [form, setForm] = useState({ status: 'pending', expected_finish_at: '', total_amount: 0, wash_time: '', dry_time: '', dry_clean_time: '', iron_time: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (ticket) {
      setForm({
        status: ticket.status || 'pending',
        expected_finish_at: toLocalInput(ticket.expected_finish_at),
        total_amount: ticket.total_amount || 0,
        wash_time: ticket.wash_time ?? '',
        dry_time: ticket.dry_time ?? '',
        dry_clean_time: ticket.dry_clean_time ?? '',
        iron_time: ticket.iron_time ?? ''
      });
    }
  }, [ticket]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(ticket.id, {
      status: form.status,
      expected_finish_at: form.expected_finish_at ? new Date(form.expected_finish_at).toISOString() : null,
      total_amount: Number(form.total_amount) || 0,
      wash_time: form.wash_time === '' ? null : Number(form.wash_time),
      dry_time: form.dry_time === '' ? null : Number(form.dry_time),
      dry_clean_time: form.dry_clean_time === '' ? null : Number(form.dry_clean_time),
      iron_time: form.iron_time === '' ? null : Number(form.iron_time)
    });
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#1a0b36] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle>Editar Ticket #{ticket?.ticket_number || ticket?.id?.slice(-6)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Previsão de Entrega</Label>
            <Input
              type="datetime-local"
              value={form.expected_finish_at}
              onChange={(e) => setForm({ ...form, expected_finish_at: e.target.value })}
              className="bg-white/5 border-white/10"
            />
          </div>
          <div className="space-y-2">
            <Label>Valor (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.total_amount}
              onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
              className="bg-white/5 border-white/10"
            />
          </div>

          <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-[#FF6600]">Tempos de Processo</p>
            <TimeField label="Tempo de Lavagem" value={form.wash_time} onChange={(v) => setForm({ ...form, wash_time: v })} />
            <TimeField label="Tempo de Secagem" value={form.dry_time} onChange={(v) => setForm({ ...form, dry_time: v })} />
            <TimeField label="Tempo de Lavagem a Seco" value={form.dry_clean_time} onChange={(v) => setForm({ ...form, dry_clean_time: v })} />
            <TimeField label="Tempo de Passar" value={form.iron_time} onChange={(v) => setForm({ ...form, iron_time: v })} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} className="text-gray-300 hover:bg-white/10">Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={saving} className="gap-2 bg-[#FF6600] hover:bg-[#FF6600]/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}