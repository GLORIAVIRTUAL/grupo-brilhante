import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Save, Shield, UserPlus, KeyRound, Ban, CheckCircle2, Search, RefreshCcw, LockKeyhole, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import useUnitAccess from '@/components/units/useUnitAccess';

const DEFAULT_ROLES = [
  { code: 'admin', label: 'Administrador', mfaRequired: true },
  { code: 'manager', label: 'Gerente', mfaRequired: true },
  { code: 'attendant', label: 'Atendimento', mfaRequired: false },
  { code: 'cashier', label: 'Caixa', mfaRequired: false },
  { code: 'production', label: 'Produção', mfaRequired: false },
  { code: 'driver', label: 'Motorista', mfaRequired: false },
  { code: 'inventory', label: 'Estoque', mfaRequired: false },
  { code: 'finance', label: 'Financeiro', mfaRequired: true },
  { code: 'auditor', label: 'Auditoria', mfaRequired: true },
];

const ACCESS_ERRORS = {
  access_change_reason_required: 'Informe uma justificativa com no mínimo 8 caracteres.',
  self_role_change_forbidden: 'Você não pode alterar o seu próprio papel. Peça a outro administrador.',
  invalid_unit_scope: 'Unidade inválida para este acesso.',
  invalid_role: 'Papel inválido.',
  super_admin_required: 'Somente um super administrador pode conceder este papel.',
  user_not_found_or_forbidden: 'Usuário não encontrado ou sem permissão para editar.',
  forbidden: 'Seu perfil não tem permissão para gerenciar acessos.',
};

const legacyRole = (role) => role === 'user' ? 'attendant' : ['entregador', 'coletas'].includes(role) ? 'driver' : role || 'attendant';

export default function UnitAccessManager() {
  const { isAdmin, units, loading: loadingUnits } = useUnitAccess();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState(DEFAULT_ROLES);
  const [permissions, setPermissions] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [form, setForm] = useState({ email: '', role: 'attendant', primary_unit_id: '' });

  const load = async () => {
    if (!isAdmin) { setLoading(false); return; }
    setLoading(true);
    try {
      const [userList, catalogResponse] = await Promise.all([
        base44.entities.User.list('-created_date', 1000),
        base44.functions.invoke('manage_access_control', { action: 'catalog' }),
      ]);
      setUsers(userList);
      setRoles(catalogResponse.data.roles || DEFAULT_ROLES);
      setPermissions(catalogResponse.data.permissions || []);
      setPolicies(catalogResponse.data.active_policies || []);
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível carregar a governança de acesso.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [isAdmin]);
  useEffect(() => {
    if (!form.primary_unit_id && units.length) setForm((current) => ({ ...current, primary_unit_id: units[0].id }));
  }, [units, form.primary_unit_id]);

  const invite = async () => {
    if (!form.email || !form.primary_unit_id) return;
    setBusy('invite');
    try {
      const platformRole = ['admin', 'super_admin'].includes(form.role) ? 'admin' : 'user';
      await base44.auth.inviteUser(form.email.trim(), platformRole);
      const refreshed = await base44.entities.User.list('-created_date', 1000);
      const invited = refreshed.find((user) => user.email?.toLowerCase() === form.email.trim().toLowerCase());
      if (invited) {
        await base44.functions.invoke('manage_access_control', {
          action: 'update_user', user_id: invited.id, role: form.role, primary_unit_id: form.primary_unit_id,
          allowed_unit_ids: [], permissions: [], require_mfa: roles.find((role) => role.code === form.role)?.mfaRequired === true,
          reason: 'Configuração inicial do acesso após convite',
        });
      }
      toast.success('Convite enviado e perfil da aplicação configurado.');
      setForm({ email: '', role: 'attendant', primary_unit_id: units[0]?.id || '' });
      await load();
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || 'Não foi possível convidar o usuário.');
    } finally { setBusy(''); }
  };

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => [user.full_name, user.display_name, user.email, user.job_title, legacyRole(user.role)].some((value) => String(value || '').toLowerCase().includes(term)));
  }, [users, search]);

  if (loadingUnits || loading) return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando governança...</div>;
  if (!isAdmin) return <Restricted />;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 via-white/[0.025] to-orange-500/5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="text-xs uppercase tracking-[0.18em] text-violet-300">Governança de acesso</p><h2 className="mt-1 text-2xl font-bold text-white">Pessoas, papéis e autenticação</h2><p className="mt-2 max-w-3xl text-sm text-white/45">Controle unidades, permissões excepcionais, suspensão e exigência de MFA. A aplicação registra cada mudança; o fator de autenticação continua sob responsabilidade do provedor de identidade.</p></div>
          <div className="flex flex-wrap gap-2"><Metric label="Usuários" value={users.length} /><Metric label="MFA exigido" value={users.filter((user) => user.require_mfa).length} /><Metric label="Políticas ativas" value={policies.length} /></div>
        </div>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="border border-white/10 bg-white/5"><TabsTrigger value="users"><UsersRound className="mr-2 h-4 w-4" />Usuários</TabsTrigger><TabsTrigger value="invite"><UserPlus className="mr-2 h-4 w-4" />Convidar</TabsTrigger><TabsTrigger value="policies"><Shield className="mr-2 h-4 w-4" />Políticas</TabsTrigger></TabsList>
        <TabsContent value="users" className="space-y-4">
          <div className="relative max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-white/30" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, e-mail, papel ou cargo" className="border-white/10 bg-black/20 pl-9" /></div>
          <div className="grid gap-3">
            {filteredUsers.map((user) => <UserRow key={user.id} user={user} units={units} roles={roles} onEdit={() => setEditing(buildEditor(user))} onStatus={() => setStatusTarget(user)} />)}
            {filteredUsers.length === 0 && <Empty text="Nenhum usuário corresponde à busca." />}
          </div>
        </TabsContent>
        <TabsContent value="invite">
          <Card className="border-white/10 bg-white/5 text-white"><CardHeader><CardTitle>Convidar novo acesso</CardTitle><CardDescription className="text-white/40">O login é criado pelo provedor Base44; o papel operacional e as unidades são configurados logo após o convite.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><Field label="E-mail"><Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="usuario@empresa.com" className="border-white/10 bg-black/20" /></Field><Field label="Papel"><Select value={form.role} onValueChange={(value) => setForm((current) => ({ ...current, role: value }))}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent>{roles.filter((role) => role.code !== 'super_admin').map((role) => <SelectItem key={role.code} value={role.code}>{role.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Unidade principal"><Select value={form.primary_unit_id} onValueChange={(value) => setForm((current) => ({ ...current, primary_unit_id: value }))}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent>{units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent></Select></Field><div className="md:col-span-3 flex justify-end"><Button onClick={invite} disabled={busy === 'invite' || !form.email || !form.primary_unit_id} className="bg-orange-500 hover:bg-orange-400">{busy === 'invite' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}Enviar convite</Button></div></CardContent></Card>
        </TabsContent>
        <TabsContent value="policies"><PolicySummary policies={policies} roles={roles} /></TabsContent>
      </Tabs>

      {editing && <UserAccessDialog state={editing} units={units} roles={roles} permissions={permissions} busy={busy === editing.user.id} onClose={() => setEditing(null)} onSave={async (payload) => { setBusy(editing.user.id); try { await base44.functions.invoke('manage_access_control', { action: 'update_user', user_id: editing.user.id, ...payload }); toast.success('Acesso atualizado e auditado.'); setEditing(null); await load(); } catch (error) { console.error(error); toast.error(ACCESS_ERRORS[error?.response?.data?.error] || 'Não foi possível atualizar o acesso.'); } finally { setBusy(''); } }} onMfa={async (payload) => { setBusy(editing.user.id); try { await base44.functions.invoke('manage_access_control', { action: 'record_mfa_status', user_id: editing.user.id, ...payload }); toast.success('Estado de MFA registrado.'); setEditing(null); await load(); } catch (error) { toast.error(error?.response?.data?.error || 'Não foi possível registrar MFA.'); } finally { setBusy(''); } }} />}
      {statusTarget && <StatusDialog user={statusTarget} busy={busy === statusTarget.id} onClose={() => setStatusTarget(null)} onConfirm={async (status, reason) => { setBusy(statusTarget.id); try { await base44.functions.invoke('manage_access_control', { action: 'set_status', user_id: statusTarget.id, status, reason }); toast.success(status === 'active' ? 'Acesso reativado.' : 'Acesso bloqueado e sessões marcadas para revogação.'); setStatusTarget(null); await load(); } catch (error) { toast.error(error?.response?.data?.error || 'Não foi possível alterar o status.'); } finally { setBusy(''); } }} />}
    </div>
  );
}

function buildEditor(user) { return { user, role: legacyRole(user.role), primary_unit_id: user.primary_unit_id || '', allowed_unit_ids: user.allowed_unit_ids || [], permissions: user.permissions || [], require_mfa: user.require_mfa === true, display_name: user.display_name || user.full_name || '', job_title: user.job_title || '', employment_identifier: user.employment_identifier || '', reason: '' }; }

function UserRow({ user, units, roles, onEdit, onStatus }) {
  const role = roles.find((entry) => entry.code === legacyRole(user.role));
  const unitNames = [user.primary_unit_id, ...(user.allowed_unit_ids || [])].filter(Boolean).map((id) => units.find((unit) => unit.id === id)?.name || id);
  return <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 lg:grid-cols-[1.3fr_0.8fr_1.4fr_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-white">{user.display_name || user.full_name || user.email}</p><Badge variant="outline" className={user.status === 'active' || !user.status ? 'border-emerald-500/25 text-emerald-300' : 'border-red-500/25 text-red-200'}>{user.status || 'active'}</Badge>{user.require_mfa && <Badge variant="outline" className="border-violet-500/25 text-violet-200"><KeyRound className="mr-1 h-3 w-3" />{user.mfa_status || 'required'}</Badge>}</div><p className="mt-1 text-sm text-white/35">{user.email}</p></div><div><p className="text-xs text-white/35">Papel</p><p className="mt-1 text-sm text-white/70">{role?.label || legacyRole(user.role)}</p></div><div><p className="text-xs text-white/35">Unidades</p><p className="mt-1 text-sm text-white/65">{unitNames.join(' · ') || 'Não configurada'}</p></div><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={onEdit} className="border-white/10 bg-white/5"><Shield className="mr-2 h-3.5 w-3.5" />Revisar</Button><Button size="icon" variant="outline" onClick={onStatus} className={user.status === 'suspended' || user.status === 'disabled' ? 'border-emerald-500/20 text-emerald-300' : 'border-red-500/20 text-red-200'}>{user.status === 'suspended' || user.status === 'disabled' ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}</Button></div></div>;
}

function UserAccessDialog({ state, units, roles, permissions, busy, onClose, onSave, onMfa }) {
  const [form, setForm] = useState(state);
  const grouped = useMemo(() => permissions.reduce((map, item) => ({ ...map, [item.domain]: [...(map[item.domain] || []), item] }), {}), [permissions]);
  const toggleUnit = (id) => setForm((current) => ({ ...current, allowed_unit_ids: current.allowed_unit_ids.includes(id) ? current.allowed_unit_ids.filter((entry) => entry !== id) : [...current.allowed_unit_ids, id] }));
  const togglePermission = (code) => setForm((current) => ({ ...current, permissions: current.permissions.includes(code) ? current.permissions.filter((entry) => entry !== code) : [...current.permissions, code] }));
  return <Dialog open onOpenChange={(value) => !value && !busy && onClose()}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto border-white/10 bg-[#160a2b] text-white"><DialogHeader><DialogTitle>Revisar acesso de {state.user.display_name || state.user.full_name || state.user.email}</DialogTitle><DialogDescription className="text-white/40">Altere o papel, unidades e exceções. Toda mudança exige justificativa e gera auditoria.</DialogDescription></DialogHeader><div className="grid gap-4 md:grid-cols-2"><Field label="Nome de exibição"><Input value={form.display_name} onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))} className="border-white/10 bg-black/20" /></Field><Field label="Matrícula"><Input value={form.employment_identifier} onChange={(event) => setForm((current) => ({ ...current, employment_identifier: event.target.value }))} className="border-white/10 bg-black/20" /></Field><Field label="Cargo"><Input value={form.job_title} onChange={(event) => setForm((current) => ({ ...current, job_title: event.target.value }))} className="border-white/10 bg-black/20" /></Field><Field label="Papel"><Select value={form.role} onValueChange={(value) => setForm((current) => ({ ...current, role: value, require_mfa: current.require_mfa || roles.find((role) => role.code === value)?.mfaRequired === true }))}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent>{roles.map((role) => <SelectItem key={role.code} value={role.code}>{role.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Unidade principal"><Select value={form.primary_unit_id} onValueChange={(value) => setForm((current) => ({ ...current, primary_unit_id: value, allowed_unit_ids: current.allowed_unit_ids.filter((id) => id !== value) }))}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent>{units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent></Select></Field><div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3"><div><p className="text-sm font-medium">Exigir MFA</p><p className="text-xs text-white/35">A adesão real ocorre no provedor de identidade.</p></div><Switch checked={form.require_mfa} onCheckedChange={(checked) => setForm((current) => ({ ...current, require_mfa: checked }))} /></div></div><section className="space-y-2"><Label>Unidades adicionais</Label><div className="flex flex-wrap gap-2">{units.filter((unit) => unit.id !== form.primary_unit_id).map((unit) => <button key={unit.id} type="button" onClick={() => toggleUnit(unit.id)} className={`rounded-xl border px-3 py-2 text-sm ${form.allowed_unit_ids.includes(unit.id) ? 'border-orange-400/50 bg-orange-500/15 text-orange-100' : 'border-white/10 bg-white/5 text-white/45'}`}>{unit.name}</button>)}</div></section><section className="space-y-3"><div><Label>Permissões excepcionais</Label><p className="text-xs text-white/35">O papel já concede um conjunto padrão. Marque apenas exceções necessárias.</p></div><div className="grid gap-3 md:grid-cols-2">{Object.entries(grouped).map(([domain, entries]) => <div key={domain} className="rounded-2xl border border-white/10 bg-black/15 p-3"><p className="mb-2 text-xs uppercase tracking-wide text-white/30">{domain}</p>{entries.map((permission) => <label key={permission.code} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-white/5"><input type="checkbox" checked={form.permissions.includes(permission.code)} onChange={() => togglePermission(permission.code)} className="mt-1 accent-orange-500" /><span><span className="block text-sm text-white/75">{permission.label}</span><span className="text-[11px] text-white/30">{permission.code}{permission.critical ? ' · crítica' : ''}</span></span></label>)}</div>)}</div></section><Field label="Justificativa da revisão"><Input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Mínimo 8 caracteres" className="border-white/10 bg-black/20" /><p className={`text-xs ${form.reason.trim().length < 8 ? 'text-amber-300' : 'text-emerald-300'}`}>{form.reason.trim().length < 8 ? `Escreva pelo menos 8 caracteres para liberar o salvamento (${form.reason.trim().length}/8).` : 'Justificativa válida.'}</p>{!form.primary_unit_id && <p className="text-xs text-amber-300">Selecione a unidade principal para salvar.</p>}</Field><div className="flex flex-wrap justify-between gap-3"><div className="flex gap-2"><Button variant="outline" disabled={busy || form.reason.trim().length < 8} onClick={() => onMfa({ mfa_status: 'enrolled', mfa_provider: 'base44', reason: form.reason })} className="border-violet-500/25 text-violet-200"><KeyRound className="mr-2 h-4 w-4" />Registrar adesão MFA</Button><Button variant="outline" disabled={busy || form.reason.trim().length < 8} onClick={() => onMfa({ mfa_status: 'recovery_required', mfa_provider: state.user.mfa_provider || 'not_configured', reason: form.reason })} className="border-amber-500/25 text-amber-200"><RefreshCcw className="mr-2 h-4 w-4" />Exigir recuperação</Button></div><Button disabled={busy || form.reason.trim().length < 8 || !form.primary_unit_id} onClick={() => onSave({ role: form.role, primary_unit_id: form.primary_unit_id, allowed_unit_ids: form.allowed_unit_ids, permissions: form.permissions, require_mfa: form.require_mfa, display_name: form.display_name, employment_identifier: form.employment_identifier, job_title: form.job_title, reason: form.reason })} className="bg-orange-500 hover:bg-orange-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar revisão</Button></div></DialogContent></Dialog>;
}

function StatusDialog({ user, busy, onClose, onConfirm }) { const blocked = ['suspended', 'disabled'].includes(user.status); const [status, setStatus] = useState(blocked ? 'active' : 'suspended'); const [reason, setReason] = useState(''); return <Dialog open onOpenChange={(value) => !value && !busy && onClose()}><DialogContent className="max-w-lg border-white/10 bg-[#160a2b] text-white"><DialogHeader><DialogTitle>{blocked ? 'Reativar acesso' : 'Bloquear acesso'}</DialogTitle><DialogDescription className="text-white/40">{blocked ? 'O usuário voltará a acessar a aplicação.' : 'A conta será bloqueada e as sessões serão marcadas para nova autenticação.'}</DialogDescription></DialogHeader><Field label="Novo status"><Select value={status} onValueChange={setStatus}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Ativo</SelectItem><SelectItem value="suspended">Suspenso</SelectItem><SelectItem value="disabled">Desativado</SelectItem></SelectContent></Select></Field><Field label="Justificativa"><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mínimo 8 caracteres" className="border-white/10 bg-black/20" /></Field><Button disabled={busy || reason.trim().length < 8} onClick={() => onConfirm(status, reason)} className={status === 'active' ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-red-500 hover:bg-red-400'}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{status === 'active' ? 'Reativar' : 'Bloquear e revogar'}</Button></DialogContent></Dialog>; }

function PolicySummary({ policies, roles }) { return <Card className="border-white/10 bg-white/5 text-white"><CardHeader><CardTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-violet-300" />Políticas ativas</CardTitle><CardDescription className="text-white/40">As políticas complementam os papéis e podem exigir MFA, horário e segregação por unidade.</CardDescription></CardHeader><CardContent className="space-y-3">{policies.map((policy) => <div key={policy.id} className="rounded-2xl border border-white/10 bg-black/15 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{policy.name}</p><p className="text-xs text-white/35">{roles.find((role) => role.code === policy.role)?.label || policy.role} · v{policy.version} · {policy.unit_id || 'todas as unidades'}</p></div><div className="flex gap-2">{policy.require_mfa && <Badge variant="outline" className="border-violet-500/25 text-violet-200">MFA</Badge>}<Badge variant="outline" className="border-emerald-500/25 text-emerald-300">ativa</Badge></div></div><p className="mt-3 text-xs text-white/45">{(policy.permissions || []).length} concessões · {(policy.denied_permissions || []).length} negações · sessão de {policy.session_max_age_minutes || 720} min</p></div>)}{policies.length === 0 && <Empty text="Nenhuma política complementar ativa. Os papéis canônicos continuam válidos." />}</CardContent></Card>; }
function Restricted() { return <Card className="border-white/10 bg-white/5 text-white"><CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-orange-400" />Acesso restrito</CardTitle><CardDescription className="text-white/40">Somente administradores podem gerenciar usuários, unidades e MFA.</CardDescription></CardHeader></Card>; }
function Field({ label, children }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function Metric({ label, value }) { return <div className="min-w-24 rounded-2xl border border-white/10 bg-black/15 px-4 py-3"><p className="text-xs text-white/35">{label}</p><p className="mt-1 text-xl font-bold text-white">{value}</p></div>; }
function Empty({ text }) { return <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">{text}</div>; }