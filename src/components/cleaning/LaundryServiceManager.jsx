import React, { useEffect, useState } from 'react';
import { Sparkles, Pencil, Power, Plus, Save, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const input = 'w-full rounded-xl border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/60';
const button = 'rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-40';
const ghostButton = 'rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/5';

const CATEGORIES = [
  ['cleaning', 'Lavagem'],
  ['ironing', 'Passadoria'],
  ['repair', 'Reparo'],
  ['special_treatment', 'Tratamento especial'],
  ['packaging', 'Embalagem'],
  ['delivery', 'Entrega'],
  ['other', 'Outro'],
];

const emptyForm = { code: '', name: '', description: '', category: 'cleaning', base_price: '', estimated_minutes: '', requires_third_party: false, requires_customer_acceptance: false, active: true };

export default function LaundryServiceManager() {
  const [services, setServices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setBusy(true);
    try {
      const list = await base44.entities.LaundryService.list('code', 500);
      setServices(list || []);
      setNotice(null);
    } catch (error) {
      setNotice({ type: 'error', text: error?.message || 'Falha ao carregar serviços.' });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []);

  const startCreate = () => { setEditing('new'); setForm(emptyForm); };
  const startEdit = (item) => { setEditing(item.id); setForm({ code: item.code || '', name: item.name || '', description: item.description || '', category: item.category || 'cleaning', base_price: String(item.base_price ?? ''), estimated_minutes: String(item.estimated_minutes ?? ''), requires_third_party: !!item.requires_third_party, requires_customer_acceptance: !!item.requires_customer_acceptance, active: item.active !== false }); };
  const cancel = () => { setEditing(null); setForm(emptyForm); };

  const save = async () => {
    if (!form.name || !form.code || form.base_price === '') { setNotice({ type: 'error', text: 'Preencha código, nome e preço base.' }); return; }
    setBusy(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description?.trim() || undefined,
        category: form.category,
        base_price: Number(form.base_price),
        estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : undefined,
        requires_third_party: form.requires_third_party,
        requires_customer_acceptance: form.requires_customer_acceptance,
        active: form.active,
      };
      if (editing === 'new') {
        await base44.entities.LaundryService.create(payload);
      } else {
        await base44.entities.LaundryService.update(editing, payload);
      }
      setNotice({ type: 'success', text: 'Serviço salvo.' });
      cancel();
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: error?.response?.data?.error || error?.message || 'Falha ao salvar serviço.' });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (item) => {
    setBusy(true);
    try {
      await base44.entities.LaundryService.update(item.id, { active: !item.active });
      setNotice({ type: 'success', text: item.active ? 'Serviço desativado.' : 'Serviço ativado.' });
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: error?.message || 'Falha ao alternar status.' });
    } finally {
      setBusy(false);
    }
  };

  const isEditing = editing !== null;
  const categoryLabel = (value) => CATEGORIES.find(([v]) => v === value)?.[1] || value;

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-white"><Sparkles className="h-4 w-4 text-emerald-300" />Catálogo de serviços de lavanderia</h2>
        {!isEditing && <button className={button} disabled={busy} onClick={startCreate}><Plus className="mr-1 inline h-4 w-4" />Novo serviço</button>}
      </div>

      {notice && <div className={`rounded-xl border p-3 text-sm ${notice.type === 'error' ? 'border-red-400/25 bg-red-500/10 text-red-200' : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'}`}>{notice.text}</div>}

      {isEditing ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-white/50">Código *</label>
              <input className={input} placeholder="Ex: LAV010" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">Nome *</label>
              <input className={input} placeholder="Nome do serviço" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Descrição</label>
            <textarea className={`${input} min-h-20`} placeholder="Descrição operacional do serviço" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-white/50">Categoria</label>
              <select className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">Preço base (R$) *</label>
              <input className={input} type="number" step="0.01" min="0" placeholder="0.00" value={form.base_price} onChange={(e) => setForm({ ...form, base_price: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">Min. estimados</label>
              <input className={input} type="number" min="0" placeholder="0" value={form.estimated_minutes} onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.requires_third_party} onChange={(e) => setForm({ ...form, requires_third_party: e.target.checked })} />Requer terceirização</label>
            <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.requires_customer_acceptance} onChange={(e) => setForm({ ...form, requires_customer_acceptance: e.target.checked })} />Requer aceite do cliente</label>
            <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Ativo</label>
          </div>
          <div className="flex gap-2">
            <button className={button} disabled={busy} onClick={save}><Save className="mr-1 inline h-4 w-4" />Salvar</button>
            <button className={ghostButton} onClick={cancel}><X className="mr-1 inline h-4 w-4" />Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {services.length === 0 && <p className="text-sm text-white/35">Nenhum serviço cadastrado.</p>}
          {services.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/10 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 font-mono text-xs text-emerald-200">{item.code}</span>
                  <p className="truncate text-sm font-medium text-white">{item.name}</p>
                  {!item.active && <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/50">Inativo</span>}
                </div>
                <p className="mt-0.5 truncate text-xs text-white/40">{categoryLabel(item.category)} · R$ {Number(item.base_price || 0).toFixed(2)}{item.estimated_minutes ? ` · ${item.estimated_minutes} min` : ''}</p>
                {item.description && <p className="mt-1 line-clamp-2 text-xs text-white/45">{item.description}</p>}
              </div>
              <div className="flex gap-2">
                <button className={ghostButton} disabled={busy} onClick={() => startEdit(item)}><Pencil className="mr-1 inline h-3.5 w-3.5" />Editar</button>
                <button className={ghostButton} disabled={busy} onClick={() => toggleActive(item)} title={item.active ? 'Desativar' : 'Ativar'}><Power className={`inline h-3.5 w-3.5 ${item.active ? 'text-emerald-300' : 'text-white/40'}`} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}