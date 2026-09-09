import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Building2, Plus, Pencil, Trash2, Send, Search, Loader2, Phone, Upload, Users, Trash } from 'lucide-react';
import { toast } from 'sonner';
import ProspectDispatchModal from './ProspectDispatchModal';
import ProspectImportModal from './ProspectImportModal';

const STATUS_LABELS = {
  novo: { label: 'Novo', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  contatado: { label: 'Contatado', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  negociando: { label: 'Negociando', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  convertido: { label: 'Convertido', color: 'bg-green-500/20 text-green-300 border-green-500/30' },
  descartado: { label: 'Descartado', color: 'bg-red-500/20 text-red-300 border-red-500/30' },
};

const emptyForm = { company_name: '', phone: '', contact_name: '', email: '', segment: '', status: 'novo', notes: '' };

export default function ProspectionManager() {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDispatchOpen, setIsDispatchOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadProspects = async () => {
    setLoading(true);
    const list = await base44.entities.Prospect.list('-created_date', 5000);
    setProspects(list);
    setLoading(false);
  };

  useEffect(() => { loadProspects(); }, []);

  const openNew = () => { setEditing(null); setForm(emptyForm); setIsFormOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ ...emptyForm, ...p }); setIsFormOpen(true); };

  const handleSave = async () => {
    if (!form.company_name.trim() || !form.phone.trim()) {
      toast.error('Nome da empresa e telefone são obrigatórios');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        company_name: form.company_name,
        phone: form.phone,
        contact_name: form.contact_name,
        email: form.email,
        segment: form.segment,
        status: form.status,
        notes: form.notes,
      };
      if (editing) {
        await base44.entities.Prospect.update(editing.id, payload);
        toast.success('Empresa atualizada');
      } else {
        await base44.entities.Prospect.create(payload);
        toast.success('Empresa cadastrada');
      }
      setIsFormOpen(false);
      loadProspects();
    } catch (err) {
      toast.error('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Excluir esta empresa da prospecção?')) return;
    await base44.entities.Prospect.delete(id);
    setSelectedIds(prev => prev.filter(x => x !== id));
    loadProspects();
  };

  const [deletingAll, setDeletingAll] = useState(false);
  const handleDeleteAll = async () => {
    if (prospects.length === 0) return;
    if (!confirm(`Apagar TODAS as ${prospects.length} empresas da prospecção? Esta ação não pode ser desfeita.`)) return;
    setDeletingAll(true);
    try {
      for (const p of prospects) {
        await base44.entities.Prospect.delete(p.id);
      }
      setSelectedIds([]);
      toast.success('Todas as empresas foram apagadas');
      loadProspects();
    } catch (err) {
      toast.error('Erro ao apagar: ' + err.message);
    } finally {
      setDeletingAll(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const filtered = prospects.filter(p =>
    !search ||
    p.company_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.contact_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.phone?.includes(search)
  );

  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <Building2 className="h-5 w-5 text-[#FF6600]" /> Prospecção de Empresas
            </CardTitle>
            <p className="mt-1 text-sm text-gray-400">Cadastre empresas e envie disparos via WhatsApp.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setIsImportOpen(true)} variant="outline" className="gap-2 border-white/20 bg-transparent text-white hover:bg-white/10">
              <Upload className="h-4 w-4" /> Importar Planilha
            </Button>
            <Button onClick={handleDeleteAll} disabled={deletingAll || prospects.length === 0} variant="outline" className="gap-2 border-red-500/40 bg-transparent text-red-300 hover:bg-red-500/20">
              {deletingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash className="h-4 w-4" />} Apagar Todos
            </Button>
            <Button onClick={() => setIsDispatchOpen(true)} variant="outline" className="gap-2 border-[#25D366] bg-transparent text-white hover:bg-[#25D366]/20">
              <Send className="h-4 w-4" /> Disparar {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
            </Button>
            <Button onClick={openNew} className="gap-2 bg-[#FF6600] hover:bg-[#e55c00]">
              <Plus className="h-4 w-4" /> Nova Empresa
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <Input
              placeholder="Buscar por empresa, contato ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-white/5 border-white/10 text-white"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-[#FF6600]" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-gray-500">Nenhuma empresa cadastrada.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    selectedIds.includes(p.id) ? 'border-[#FF6600]/40 bg-[#FF6600]/10' : 'border-white/10 bg-white/5'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    className="h-4 w-4 accent-[#FF6600]"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-white">{p.company_name}</span>
                      <Badge variant="outline" className={STATUS_LABELS[p.status]?.color}>{STATUS_LABELS[p.status]?.label || p.status}</Badge>
                      {p.segment && <span className="text-xs text-gray-500">{p.segment}</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {p.phones?.length > 1 ? p.phones.join(' · ') : p.phone}</span>
                      {p.contact_name && <span>👤 {p.contact_name}</span>}
                      {p.email && <span>✉ {p.email}</span>}
                    </div>
                    {p.partners?.length > 0 && (
                      <div className="mt-1 flex items-start gap-1 text-xs text-gray-500">
                        <Users className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="truncate">{p.partners.map(s => s.name + (s.role ? ` — ${s.role.split(' desde')[0]}` : '')).join(' | ')}</span>
                      </div>
                    )}
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(p)} className="text-gray-400 hover:text-white">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(p.id)} className="text-red-400 hover:bg-red-500/10">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="bg-[#1a0b36] border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Empresa' : 'Nova Empresa'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Nome da Empresa *</Label>
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="bg-white/5 border-white/10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Telefone *</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="5587999999999" className="bg-white/5 border-white/10" />
              </div>
              <div className="space-y-1">
                <Label>Contato</Label>
                <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="bg-white/5 border-white/10" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-white/5 border-white/10" />
              </div>
              <div className="space-y-1">
                <Label>Segmento</Label>
                <Input value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} className="bg-white/5 border-white/10" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-white/5 border-white/10" />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full bg-[#FF6600] hover:bg-[#e55c00]">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editing ? 'Salvar Alterações' : 'Cadastrar')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ProspectDispatchModal
        open={isDispatchOpen}
        onOpenChange={setIsDispatchOpen}
        prospects={prospects}
        selectedIds={selectedIds}
      />

      <ProspectImportModal
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onImported={loadProspects}
      />
    </div>
  );
}