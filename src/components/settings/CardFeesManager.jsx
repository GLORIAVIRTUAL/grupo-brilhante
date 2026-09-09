import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CreditCard, Plus, Trash2, Loader2, Percent } from 'lucide-react';

const emptyForm = { brand: '', card_type: 'credit', debit_fee: '', credit_fees: {}, active: true };

export default function CardFeesManager() {
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [maxInstallments, setMaxInstallments] = useState(12);

  const load = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.CardFee.list('-created_date', 200);
      setFees(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setMaxInstallments(12);
    setDialogOpen(true);
  };

  const openEdit = (fee) => {
    setEditing(fee);
    setForm({
      brand: fee.brand || '',
      card_type: fee.card_type || 'credit',
      debit_fee: fee.debit_fee ?? '',
      credit_fees: fee.credit_fees || {},
      active: fee.active !== false
    });
    const keys = Object.keys(fee.credit_fees || {}).map(Number);
    setMaxInstallments(keys.length ? Math.max(...keys, 12) : 12);
    setDialogOpen(true);
  };

  const setInstallmentFee = (n, value) => {
    setForm((prev) => ({ ...prev, credit_fees: { ...prev.credit_fees, [n]: value } }));
  };

  const handleSave = async () => {
    if (!form.brand) return;
    const payload = {
      brand: form.brand,
      card_type: form.card_type,
      active: form.active
    };
    if (form.card_type === 'debit') {
      payload.debit_fee = parseFloat(form.debit_fee) || 0;
      payload.credit_fees = {};
    } else {
      const cleaned = {};
      Object.entries(form.credit_fees).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) cleaned[k] = parseFloat(v) || 0;
      });
      payload.credit_fees = cleaned;
      payload.debit_fee = 0;
    }
    try {
      if (editing) await base44.entities.CardFee.update(editing.id, payload);
      else await base44.entities.CardFee.create(payload);
      setDialogOpen(false);
      load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remover esta configuração de taxa?')) return;
    await base44.entities.CardFee.delete(id);
    load();
  };

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-teal-400" /> Taxas de Cartões
          </CardTitle>
          <CardDescription className="text-gray-400">
            Cadastre as bandeiras e suas taxas. Essas taxas são descontadas no lucro líquido dos relatórios.
          </CardDescription>
        </div>
        <Button onClick={openNew} className="bg-teal-600 hover:bg-teal-700">
          <Plus className="w-4 h-4 mr-2" /> Nova Bandeira
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin text-teal-400" /></div>
        ) : fees.length === 0 ? (
          <div className="text-center py-10 text-gray-500">Nenhuma taxa cadastrada.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fees.map((fee) => (
              <div key={fee.id} className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{fee.brand}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${fee.card_type === 'debit' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'}`}>
                      {fee.card_type === 'debit' ? 'Débito' : 'Crédito'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(fee)} className="text-xs text-blue-400 hover:underline">Editar</button>
                    <button onClick={() => handleDelete(fee.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                {fee.card_type === 'debit' ? (
                  <div className="text-sm text-gray-300">Taxa: <span className="text-teal-400 font-medium">{Number(fee.debit_fee || 0).toFixed(2)}%</span></div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(fee.credit_fees || {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([n, v]) => (
                      <span key={n} className="text-xs bg-black/30 rounded px-2 py-1 text-gray-300">{n}x: <span className="text-teal-400">{Number(v).toFixed(2)}%</span></span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-[#1a0b36] border border-white/10 text-white max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Bandeira' : 'Nova Bandeira'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Bandeira do Cartão</Label>
              <Input
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                placeholder="Ex: Visa, Mastercard, Elo"
                className="bg-white/5 border-white/10"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={form.card_type} onValueChange={(v) => setForm({ ...form, card_type: v })}>
                <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="debit">Débito</SelectItem>
                  <SelectItem value="credit">Crédito</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.card_type === 'debit' ? (
              <div className="space-y-2">
                <Label>Taxa de Débito (%)</Label>
                <div className="relative">
                  <Percent className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <Input
                    type="number" step="0.01"
                    value={form.debit_fee}
                    onChange={(e) => setForm({ ...form, debit_fee: e.target.value })}
                    placeholder="Ex: 1.99"
                    className="bg-white/5 border-white/10 pl-9"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Taxas por Parcela (%)</Label>
                  <Select value={String(maxInstallments)} onValueChange={(v) => setMaxInstallments(Number(v))}>
                    <SelectTrigger className="bg-white/5 border-white/10 h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[6, 12, 18, 24].map((n) => <SelectItem key={n} value={String(n)}>Até {n}x</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Array.from({ length: maxInstallments }, (_, i) => i + 1).map((n) => (
                    <div key={n} className="space-y-1">
                      <Label className="text-xs text-gray-400">{n}x{n === 1 ? ' (à vista)' : ''}</Label>
                      <Input
                        type="number" step="0.01"
                        value={form.credit_fees[n] ?? ''}
                        onChange={(e) => setInstallmentFee(n, e.target.value)}
                        placeholder="0.00"
                        className="bg-white/5 border-white/10 h-9 text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button onClick={handleSave} className="w-full bg-teal-600 hover:bg-teal-700 mt-2">Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}