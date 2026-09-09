import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Boxes, Loader2, PackageMinus, PackagePlus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const ACTIONS = [
  { value: 'adjust_in', label: 'Entrada manual', icon: PackagePlus },
  { value: 'adjust_out', label: 'Saída manual', icon: PackageMinus },
  { value: 'loss', label: 'Perda ou desperdício', icon: PackageMinus },
  { value: 'transfer', label: 'Transferir unidade', icon: ArrowLeftRight },
  { value: 'create_item', label: 'Novo insumo', icon: Plus },
];
const BASE_UNITS = ['unit', 'ml', 'liter', 'gram', 'kg', 'meter', 'package', 'box', 'gallon'];

export default function StockOperationDialog({ open, onOpenChange, stockItems = [], units = [], selectedUnitId, batches = [], initialAction = 'adjust_in', initialItemId = '', onCompleted }) {
  const [action, setAction] = useState(initialAction);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ stock_item_id: initialItemId, quantity: '', unit_cost: '', reason: '', lot_number: '', expiry_date: '', destination_unit_id: '', production_batch_id: '', sku: '', name: '', category: '', base_unit: 'unit', minimum_quantity: '', reorder_quantity: '', storage_location: '', batch_control: false, expiry_control: false });
  useEffect(() => { if (open) { setAction(initialAction); setForm((value) => ({ ...value, stock_item_id: initialItemId || value.stock_item_id })); } }, [open, initialAction, initialItemId]);
  const scoped = useMemo(() => stockItems.filter((item) => !selectedUnitId || selectedUnitId === 'all' || item.unit_id === selectedUnitId), [stockItems, selectedUnitId]);
  const selected = scoped.find((item) => item.id === form.stock_item_id);
  const destinationUnits = units.filter((unit) => unit.id !== selected?.unit_id && unit.id !== selectedUnitId);
  const patch = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    const unitId = selectedUnitId === 'all' ? selected?.unit_id : selectedUnitId;
    if (action === 'create_item' && (!unitId || !form.sku.trim() || !form.name.trim())) return toast.error('Informe unidade, SKU e nome.');
    if (action !== 'create_item' && (!form.stock_item_id || Number(form.quantity) <= 0)) return toast.error('Selecione o insumo e informe uma quantidade positiva.');
    if (['adjust_out', 'loss', 'transfer'].includes(action) && form.reason.trim().length < 5) return toast.error('Informe uma justificativa com pelo menos 5 caracteres.');
    if (action === 'transfer' && !form.destination_unit_id) return toast.error('Selecione a unidade de destino.');
    setBusy(true);
    try {
      await base44.functions.invoke('manage_stock_operation', {
        action,
        unit_id: unitId,
        stock_item_id: form.stock_item_id || undefined,
        quantity: form.quantity === '' ? undefined : Number(form.quantity),
        unit_cost: form.unit_cost === '' ? undefined : Number(form.unit_cost),
        reason: form.reason,
        lot_number: form.lot_number || undefined,
        expiry_date: form.expiry_date ? new Date(`${form.expiry_date}T23:59:59`).toISOString() : undefined,
        destination_unit_id: form.destination_unit_id || undefined,
        production_batch_id: form.production_batch_id || undefined,
        sku: form.sku.trim() || undefined,
        name: form.name.trim() || undefined,
        category: form.category || undefined,
        base_unit: form.base_unit,
        purchase_unit: form.base_unit,
        minimum_quantity: Number(form.minimum_quantity || 0),
        reorder_quantity: Number(form.reorder_quantity || 0),
        storage_location: form.storage_location || undefined,
        batch_control: form.batch_control,
        expiry_control: form.expiry_control,
        idempotency_key: crypto.randomUUID(),
      });
      toast.success(action === 'create_item' ? 'Insumo cadastrado.' : 'Movimentação registrada.');
      onOpenChange(false);
      onCompleted?.();
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível concluir. Verifique saldo, inventário aberto e permissões.');
    } finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl border-white/10 bg-[#160d29] text-white"><DialogHeader><DialogTitle>Operação de estoque</DialogTitle><DialogDescription className="text-white/45">Saldos e custos são alterados somente pelo servidor e ficam auditados.</DialogDescription></DialogHeader>
    <div className="grid gap-2 sm:grid-cols-5">{ACTIONS.map(({ value, label, icon: Icon }) => <button key={value} type="button" onClick={() => setAction(value)} className={`rounded-2xl border p-3 text-left text-xs transition ${action === value ? 'border-violet-400 bg-violet-500/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/[0.06]'}`}><Icon className="mb-2 h-4 w-4" />{label}</button>)}</div>
    {action === 'create_item' ? <div className="grid gap-4 sm:grid-cols-2">
      <div><Label>SKU</Label><Input value={form.sku} onChange={(e) => patch('sku', e.target.value)} className="mt-1 border-white/10 bg-white/5" /></div><div><Label>Nome</Label><Input value={form.name} onChange={(e) => patch('name', e.target.value)} className="mt-1 border-white/10 bg-white/5" /></div>
      <div><Label>Categoria</Label><Input value={form.category} onChange={(e) => patch('category', e.target.value)} className="mt-1 border-white/10 bg-white/5" /></div><div><Label>Unidade base</Label><select value={form.base_unit} onChange={(e) => patch('base_unit', e.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#201334] px-3 text-sm">{BASE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></div>
      <div><Label>Estoque mínimo</Label><Input type="number" min="0" value={form.minimum_quantity} onChange={(e) => patch('minimum_quantity', e.target.value)} className="mt-1 border-white/10 bg-white/5" /></div><div><Label>Quantidade de reposição</Label><Input type="number" min="0" value={form.reorder_quantity} onChange={(e) => patch('reorder_quantity', e.target.value)} className="mt-1 border-white/10 bg-white/5" /></div>
      <div className="sm:col-span-2"><Label>Local de armazenagem</Label><Input value={form.storage_location} onChange={(e) => patch('storage_location', e.target.value)} className="mt-1 border-white/10 bg-white/5" /></div>
      <label className="flex items-center gap-2 text-sm text-white/60"><input type="checkbox" checked={form.batch_control} onChange={(e) => patch('batch_control', e.target.checked)} />Controlar lotes</label><label className="flex items-center gap-2 text-sm text-white/60"><input type="checkbox" checked={form.expiry_control} onChange={(e) => patch('expiry_control', e.target.checked)} />Controlar validade</label>
    </div> : <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><Label>Insumo</Label><select value={form.stock_item_id} onChange={(e) => patch('stock_item_id', e.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#201334] px-3 text-sm"><option value="">Selecione</option>{scoped.map((item) => <option key={item.id} value={item.id}>{item.name} · {Number(item.current_quantity || 0).toLocaleString('pt-BR')} {item.base_unit}</option>)}</select></div>
      <div><Label>Quantidade</Label><Input type="number" min="0" step="any" value={form.quantity} onChange={(e) => patch('quantity', e.target.value)} className="mt-1 border-white/10 bg-white/5" /></div>{action === 'adjust_in' && <div><Label>Custo unitário</Label><Input type="number" min="0" step="0.0001" value={form.unit_cost} onChange={(e) => patch('unit_cost', e.target.value)} className="mt-1 border-white/10 bg-white/5" /></div>}
      {(action === 'adjust_in' || selected?.batch_control) && <div><Label>Lote</Label><Input value={form.lot_number} onChange={(e) => patch('lot_number', e.target.value)} className="mt-1 border-white/10 bg-white/5" /></div>}{(action === 'adjust_in' || selected?.expiry_control) && <div><Label>Validade</Label><Input type="date" value={form.expiry_date} onChange={(e) => patch('expiry_date', e.target.value)} className="mt-1 border-white/10 bg-white/5" /></div>}
      {action === 'transfer' && <div className="sm:col-span-2"><Label>Unidade de destino</Label><select value={form.destination_unit_id} onChange={(e) => patch('destination_unit_id', e.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#201334] px-3 text-sm"><option value="">Selecione</option>{destinationUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name || unit.trade_name || unit.id}</option>)}</select></div>}
      {action === 'loss' && <div className="sm:col-span-2"><Label>Lote de produção relacionado (opcional)</Label><select value={form.production_batch_id} onChange={(e) => patch('production_batch_id', e.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#201334] px-3 text-sm"><option value="">Sem vínculo</option>{batches.filter((batch) => ['processing', 'paused'].includes(batch.status)).map((batch) => <option key={batch.id} value={batch.id}>{batch.code}</option>)}</select></div>}
      <div className="sm:col-span-2"><Label>Justificativa</Label><Input value={form.reason} onChange={(e) => patch('reason', e.target.value)} placeholder="Obrigatória para saídas, perdas e transferências" className="mt-1 border-white/10 bg-white/5" /></div>
    </div>}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)} className="border-white/10">Cancelar</Button><Button onClick={submit} disabled={busy} className="bg-gradient-to-r from-violet-500 to-fuchsia-500">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Boxes className="mr-2 h-4 w-4" />}Confirmar</Button></div>
  </DialogContent></Dialog>;
}
