import { useEffect, useState } from 'react';
import { CircleDollarSign, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

export default function CustomerCreditDialog({ open, onOpenChange, customer, onProcessed }) {
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState('grant');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  useEffect(() => { if (open) { setAction('grant'); setAmount(''); setReason(''); setExpiresAt(''); } }, [open, customer?.id]);

  const submit = async () => {
    if (!customer || Number(amount) <= 0 || reason.trim().length < 8) return toast.error('Informe valor e justificativa detalhada.');
    setBusy(true);
    try {
      const response = await base44.functions.invoke('manage_customer_credit', {
        action, customer_id: customer.id, amount: Number(amount), reason,
        expires_at: action === 'grant' && expiresAt ? new Date(expiresAt).toISOString() : undefined,
        idempotency_key: crypto.randomUUID(), source: 'financial_operations',
      });
      toast.success('Crédito do cliente atualizado.');
      onProcessed?.(response.data);
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.error === 'insufficient_customer_balance' ? 'O ajuste excede o saldo disponível.' : 'Não foi possível atualizar o crédito.');
    } finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}><DialogContent className="max-w-lg border-white/10 bg-[#170c2b] text-white"><DialogHeader><div className="flex items-center gap-3"><div className="rounded-2xl bg-fuchsia-500/15 p-2.5 text-fuchsia-300"><CircleDollarSign className="h-5 w-5" /></div><div><DialogTitle>Crédito do cliente</DialogTitle><DialogDescription className="text-white/50">Cada alteração gera um lançamento imutável no razão.</DialogDescription></div></div></DialogHeader><div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4"><p className="text-sm text-white/45">{customer?.full_name}</p><p className="mt-2 text-2xl font-bold text-white">{money(customer?.credit_balance)}</p><p className="text-xs text-white/30">Saldo disponível atual</p></div><div className="space-y-2"><Label>Operação</Label><select value={action} onChange={(event) => setAction(event.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 text-sm text-white"><option value="grant">Conceder crédito</option><option value="adjustment_in">Ajuste de entrada</option><option value="adjustment_out">Ajuste de saída</option><option value="expiration">Expirar saldo</option></select></div><div className="space-y-2"><Label>Valor</Label><Input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="border-white/10 bg-black/20" /></div>{action === 'grant' && <div className="space-y-2"><Label>Validade opcional</Label><Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="border-white/10 bg-black/20" /></div>}<div className="space-y-2"><Label>Justificativa</Label><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Origem ou motivo do crédito" className="border-white/10 bg-black/20" /></div><Button onClick={submit} disabled={busy || Number(amount) <= 0 || reason.trim().length < 8} className="bg-fuchsia-500 hover:bg-fuchsia-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Registrar no razão</Button></DialogContent></Dialog>;
}
