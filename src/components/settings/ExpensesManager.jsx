import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Receipt, Plus, Trash2, Loader2, RefreshCw, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import useUnitAccess, { filterRecordsByUnit, getUnitLabel } from '@/components/units/useUnitAccess';
import UnitFilterSelect from '@/components/units/UnitFilterSelect';

const EXPENSE_CATEGORIES = [
  'Aluguel', 'Salários', 'Pró-labore', 'Encargos/INSS', 'FGTS', 'Vale Transporte', 'Vale Alimentação',
  'Insumos', 'Produtos de Limpeza', 'Embalagens/Cabides', 'Energia', 'Água', 'Gás', 'Internet/Telefone',
  'Manutenção', 'Equipamentos', 'Marketing', 'Impostos', 'Taxas Bancárias', 'Taxas de Cartão',
  'Frete/Coleta', 'Combustível', 'Aluguel de Veículo', 'Contador', 'Software/Sistemas',
  'Material de Escritório', 'Uniformes', 'Seguros', 'Empréstimos/Financiamentos', 'Outros'
];

const PAYMENT_METHODS = [
  { value: 'boleto', label: 'Boleto' }, { value: 'pix', label: 'Pix' }, { value: 'transfer', label: 'Transferência' },
  { value: 'cash', label: 'Dinheiro' }, { value: 'credit', label: 'Cartão Crédito' }, { value: 'debit', label: 'Cartão Débito' },
  { value: 'other', label: 'Outro' }
];

const emptyForm = (unitId = '') => ({
  description: '', category: '', amount: '', payment_method: 'boleto',
  kind: 'recurring', day_of_month: 5, due_date: format(new Date(), 'yyyy-MM-dd'), active: true, notes: '', unit_id: unitId
});

const fmt = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

export default function ExpensesManager() {
  const {
    isAdmin,
    accessibleUnits,
    selectedUnitId,
    setSelectedUnitId,
    defaultUnitId
  } = useUnitAccess();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());

  const load = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.RecurringExpense.list('-created_date', 300);
      setExpenses(list);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    const preUnit = selectedUnitId && selectedUnitId !== 'all' ? selectedUnitId : (defaultUnitId || '');
    setForm(emptyForm(preUnit));
    setDialogOpen(true);
  };
  const openEdit = (exp) => {
    setEditing(exp);
    setForm({
      description: exp.description || '', category: exp.category || '', amount: exp.amount ?? '',
      payment_method: exp.payment_method || 'boleto', kind: exp.kind || 'recurring',
      day_of_month: exp.day_of_month ?? 5, due_date: exp.due_date || format(new Date(), 'yyyy-MM-dd'),
      active: exp.active !== false, notes: exp.notes || '', unit_id: exp.unit_id || ''
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.description || !form.category || !form.amount) return;
    const payload = {
      description: form.description, category: form.category, amount: parseFloat(form.amount) || 0,
      payment_method: form.payment_method, kind: form.kind, active: form.active, notes: form.notes,
      unit_id: form.unit_id || undefined
    };
    if (form.kind === 'recurring') payload.day_of_month = Number(form.day_of_month) || 1;
    else payload.due_date = form.due_date;
    try {
      if (editing) await base44.entities.RecurringExpense.update(editing.id, payload);
      else await base44.entities.RecurringExpense.create(payload);
      setDialogOpen(false);
      load();
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remover esta despesa?')) return;
    await base44.entities.RecurringExpense.delete(id);
    load();
  };

  const scopedExpenses = filterRecordsByUnit(expenses, selectedUnitId, defaultUnitId);
  const recurring = scopedExpenses.filter((e) => e.kind === 'recurring');
  const oneTime = scopedExpenses.filter((e) => e.kind === 'one_time');
  const unitNameById = (id) => accessibleUnits.find((u) => u.id === id)?.name || null;

  const Row = ({ exp }) => (
    <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white truncate">{exp.description}</span>
          {exp.active === false && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400">Inativa</span>}
        </div>
        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>{exp.category}</span>
          {unitNameById(exp.unit_id) && (
            <span className="px-2 py-0.5 rounded-full bg-[#FF6600]/15 text-[#FF6600]">{unitNameById(exp.unit_id)}</span>
          )}
          {exp.kind === 'recurring' ? (
            <span className="flex items-center gap-1 text-teal-400"><RefreshCw className="w-3 h-3" /> Todo dia {exp.day_of_month}</span>
          ) : (
            <span className="flex items-center gap-1 text-amber-400"><Calendar className="w-3 h-3" /> {exp.due_date ? format(new Date(`${exp.due_date}T00:00:00`), 'dd/MM/yyyy') : '—'}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-bold text-red-400">{fmt(exp.amount)}</span>
        <button onClick={() => openEdit(exp)} className="text-xs text-blue-400 hover:underline">Editar</button>
        <button onClick={() => handleDelete(exp.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
  );

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-red-400" /> Despesas</CardTitle>
          <CardDescription className="text-gray-400">
            Cadastre despesas recorrentes (lançadas automaticamente todo mês na data programada) e avulsas.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <UnitFilterSelect
            isAdmin={isAdmin}
            units={accessibleUnits}
            value={selectedUnitId}
            onChange={setSelectedUnitId}
          />
          <Button onClick={openNew} className="bg-red-500 hover:bg-red-600"><Plus className="w-4 h-4 mr-2" /> Nova Despesa</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin text-red-400" /></div>
        ) : (
          <>
            <div>
              <h3 className="text-sm font-semibold text-teal-400 mb-2 flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Recorrentes (mensais)</h3>
              {recurring.length === 0 ? <p className="text-sm text-gray-500">Nenhuma despesa recorrente.</p> : (
                <div className="space-y-2">{recurring.map((e) => <Row key={e.id} exp={e} />)}</div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2"><Calendar className="w-4 h-4" /> Avulsas</h3>
              {oneTime.length === 0 ? <p className="text-sm text-gray-500">Nenhuma despesa avulsa.</p> : (
                <div className="space-y-2">{oneTime.map((e) => <Row key={e.id} exp={e} />)}</div>
              )}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-[#1a0b36] border border-white/10 text-white max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Editar Despesa' : 'Nova Despesa'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={form.kind === 'recurring' ? 'default' : 'outline'}
                onClick={() => setForm({ ...form, kind: 'recurring' })}
                className={form.kind === 'recurring' ? 'bg-teal-600 hover:bg-teal-700' : 'border-white/20 bg-transparent text-white hover:bg-white/10'}>
                Recorrente
              </Button>
              <Button type="button" variant={form.kind === 'one_time' ? 'default' : 'outline'}
                onClick={() => setForm({ ...form, kind: 'one_time' })}
                className={form.kind === 'one_time' ? 'bg-amber-600 hover:bg-amber-700' : 'border-white/20 bg-transparent text-white hover:bg-white/10'}>
                Avulsa
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Unidade</Label>
              <Select value={form.unit_id || ''} onValueChange={(v) => setForm({ ...form, unit_id: v })}>
                <SelectTrigger className="bg-white/5 border-white/10"><SelectValue placeholder="Selecione a unidade" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {accessibleUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex: Aluguel da loja" className="bg-white/5 border-white/10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="bg-white/5 border-white/10"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent className="max-h-72">{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Valor (R$)</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" className="bg-white/5 border-white/10" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Forma de Pagamento</Label>
                <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                  <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.kind === 'recurring' ? (
                <div className="space-y-2">
                  <Label>Dia do Mês</Label>
                  <Select value={String(form.day_of_month)} onValueChange={(v) => setForm({ ...form, day_of_month: Number(v) })}>
                    <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <SelectItem key={d} value={String(d)}>Dia {d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Data Programada</Label>
                  <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="bg-white/5 border-white/10" />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-white/5 border-white/10" />
            </div>
            <Button onClick={handleSave} className="w-full bg-red-500 hover:bg-red-600 mt-2">Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}