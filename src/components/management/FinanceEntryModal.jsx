import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';

const INCOME_CATEGORIES = ['Vendas', 'Serviços Extras', 'Outros'];
const EXPENSE_CATEGORIES = [
  'Aluguel', 'Salários', 'Pró-labore', 'Encargos/INSS', 'FGTS', 'Vale Transporte', 'Vale Alimentação',
  'Insumos', 'Produtos de Limpeza', 'Embalagens/Cabides', 'Energia', 'Água', 'Gás', 'Internet/Telefone',
  'Manutenção', 'Equipamentos', 'Marketing', 'Impostos', 'Taxas Bancárias', 'Taxas de Cartão',
  'Frete/Coleta', 'Combustível', 'Aluguel de Veículo', 'Contador', 'Software/Sistemas',
  'Material de Escritório', 'Uniformes', 'Seguros', 'Empréstimos/Financiamentos', 'Outros'
];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Dinheiro' },
  { value: 'pix', label: 'Pix' },
  { value: 'credit', label: 'Cartão Crédito' },
  { value: 'debit', label: 'Cartão Débito' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'link', label: 'Link' },
  { value: 'other', label: 'Outro' }
];

export default function FinanceEntryModal({ open, onClose, onSave, onSelectIncome, defaultType = 'expense' }) {
  const [form, setForm] = useState({
    type: defaultType,
    category: '',
    description: '',
    amount: '',
    payment_method: 'cash',
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    status: 'paid',
    notes: ''
  });
  const [saving, setSaving] = useState(false);

  const categories = form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const handleSave = async () => {
    if (!form.amount || Number(form.amount) <= 0) return;
    setSaving(true);
    await onSave({ ...form, amount: Number(form.amount) });
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="border-white/10 bg-[#1a0b36] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Lançamento Financeiro</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (onSelectIncome) {
                  onClose();
                  onSelectIncome();
                } else {
                  setForm((f) => ({ ...f, type: 'income', category: '' }));
                }
              }}
              className="border-white/20 bg-transparent text-white hover:bg-white/10"
            >
              Entrada (Pedido)
            </Button>
            <Button
              type="button"
              variant={form.type === 'expense' ? 'default' : 'outline'}
              onClick={() => setForm((f) => ({ ...f, type: 'expense', category: '' }))}
              className={form.type === 'expense' ? 'bg-red-500 hover:bg-red-500/90' : 'border-white/20 bg-transparent text-white hover:bg-white/10'}
            >
              Saída / Despesa
            </Button>
          </div>

          <div>
            <Label className="text-gray-300">Categoria</Label>
            <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
              <SelectTrigger className="border-white/10 bg-white/5 text-white"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-gray-300">Descrição</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="border-white/10 bg-white/5 text-white" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-gray-300">Valor (R$)</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="border-white/10 bg-white/5 text-white" />
            </div>
            <div>
              <Label className="text-gray-300">Data</Label>
              <Input type="date" value={form.entry_date} onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))} className="border-white/10 bg-white/5 text-white" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-gray-300">Forma de Pagamento</Label>
              <Select value={form.payment_method} onValueChange={(v) => setForm((f) => ({ ...f, payment_method: v }))}>
                <SelectTrigger className="border-white/10 bg-white/5 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-300">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="border-white/10 bg-white/5 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Pago</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-gray-300">Observações</Label>
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="border-white/10 bg-white/5 text-white" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/20 bg-transparent text-white hover:bg-white/10">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !form.amount} className="bg-[#FF6600] hover:bg-[#FF6600]/90">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}