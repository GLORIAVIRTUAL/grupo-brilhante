import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calculator, CircleDollarSign, Loader2, Plus, Power, RefreshCcw, ShieldCheck, TimerReset, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';
import useUnitAccess from '@/components/units/useUnitAccess';

const emptyRule = { name: '', unit_id: '', product_id: '', service_id: '', customer_group: '', priority: 'normal', base_price: '', additional_percent: '0', additional_amount: '0', minimum_price: '0', valid_from: '', valid_until: '', change_reason: '' };
const emptyPolicy = { name: '', unit_id: '', role: 'attendant', max_discount_percent: '0', max_discount_amount: '0', max_addition_percent: '100', max_courtesy_amount: '0', requires_reason_above_percent: '0', requires_different_approver_above_percent: '10', require_mfa_above_percent: '20', change_reason: '' };

export default function PricingRulesManager() {
  const { units, selectedUnit, isAdmin } = useUnitAccess();
  const [rules, setRules] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [products, setProducts] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [ruleForm, setRuleForm] = useState(null);
  const [policyForm, setPolicyForm] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      const [response, productList, serviceList] = await Promise.all([
        base44.functions.invoke('manage_pricing_rules', { action: 'list' }),
        base44.entities.Product.list('name', 2000),
        base44.entities.LaundryService.list('name', 2000),
      ]);
      setRules(response.data.rules || []);
      setPolicies(response.data.approval_policies || []);
      setProducts(productList.filter((item) => item.active !== false));
      setServices(serviceList.filter((item) => item.active !== false));
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível carregar regras e alçadas.');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const visibleRules = useMemo(() => rules.filter((rule) => {
    if (selectedUnit && selectedUnit !== 'all' && rule.unit_id && rule.unit_id !== selectedUnit) return false;
    if (filter !== 'all' && (rule.status || (rule.active ? 'active' : 'draft')) !== filter) return false;
    return true;
  }), [rules, selectedUnit, filter]);

  const createDraft = async () => {
    if (!ruleForm) return;
    setBusy('create');
    try {
      const response = await base44.functions.invoke('manage_pricing_rules', { action: 'create_draft', ...ruleForm, unit_id: ruleForm.unit_id || selectedUnit || units[0]?.id });
      toast.success('Rascunho criado. Simule antes de ativar.');
      setRuleForm(null);
      await load();
      setSimulation({ rule: response.data.price_rule, result: null });
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Não foi possível criar o rascunho.');
    } finally { setBusy(''); }
  };

  const simulate = async (rule) => {
    setBusy(`simulate:${rule.id}`);
    try {
      const response = await base44.functions.invoke('manage_pricing_rules', { action: 'simulate', price_rule_id: rule.id, product_id: rule.product_id || products[0]?.id, service_id: rule.service_id || services[0]?.id, quantity: 1, priority: rule.priority || 'normal', reason: rule.change_reason || 'Simulação administrativa da regra' });
      setSimulation({ rule: response.data.price_rule, result: response.data.simulation });
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'A simulação não pôde ser concluída.');
    } finally { setBusy(''); }
  };

  const activate = async (rule, retireConflicts = false) => {
    const reason = window.prompt('Informe a justificativa da ativação (mínimo 8 caracteres):', 'Regra revisada e aprovada para vigência');
    if (!reason || reason.trim().length < 8) return;
    setBusy(`activate:${rule.id}`);
    try {
      await base44.functions.invoke('manage_pricing_rules', { action: 'activate', price_rule_id: rule.id, reason, retire_conflicts: retireConflicts });
      toast.success('Regra ativada com versão e auditoria.');
      await load();
    } catch (error) {
      if (error?.response?.data?.error === 'overlapping_price_rule' && window.confirm('Existe uma regra ativa com a mesma abrangência e vigência. Deseja encerrá-la e ativar esta versão?')) return activate(rule, true);
      toast.error(error?.response?.data?.error || 'Não foi possível ativar a regra.');
    } finally { setBusy(''); }
  };

  const retire = async (rule) => {
    const reason = window.prompt('Justificativa para encerrar esta regra:', 'Regra substituída por nova condição comercial');
    if (!reason || reason.trim().length < 8) return;
    setBusy(`retire:${rule.id}`);
    try { await base44.functions.invoke('manage_pricing_rules', { action: 'retire', price_rule_id: rule.id, reason }); toast.success('Regra encerrada.'); await load(); } catch (error) { toast.error(error?.response?.data?.error || 'Não foi possível encerrar.'); } finally { setBusy(''); }
  };

  const savePolicy = async () => {
    setBusy('policy');
    try { await base44.functions.invoke('manage_pricing_rules', { action: 'save_approval_policy', ...policyForm, unit_id: policyForm.unit_id || selectedUnit || units[0]?.id }); toast.success('Nova versão da alçada ativada.'); setPolicyForm(null); await load(); } catch (error) { toast.error(error?.response?.data?.error || 'Não foi possível salvar a alçada.'); } finally { setBusy(''); }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando preços...</div>;

  return <div className="space-y-6">
    <div className="rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-500/10 via-white/[0.025] to-orange-500/5 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs uppercase tracking-[0.18em] text-emerald-300">Governança comercial</p><h2 className="mt-1 text-2xl font-bold text-white">Preços, versões e alçadas</h2><p className="mt-2 max-w-3xl text-sm text-white/45">Cada preço é simulado pelo mesmo motor dos orçamentos. Sobreposições são bloqueadas e ativações geram versão e auditoria.</p></div><div className="flex flex-wrap gap-2"><Metric label="Ativas" value={rules.filter((rule) => rule.active).length} /><Metric label="Rascunhos" value={rules.filter((rule) => !rule.active && !['retired', 'cancelled'].includes(rule.status)).length} /><Metric label="Alçadas" value={policies.filter((policy) => policy.active).length} /></div></div></div>
    <Tabs defaultValue="rules" className="space-y-4"><TabsList className="border border-white/10 bg-white/5"><TabsTrigger value="rules"><CircleDollarSign className="mr-2 h-4 w-4" />Regras</TabsTrigger><TabsTrigger value="policies"><ShieldCheck className="mr-2 h-4 w-4" />Alçadas</TabsTrigger></TabsList>
      <TabsContent value="rules" className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-48 border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os estados</SelectItem><SelectItem value="draft">Rascunho</SelectItem><SelectItem value="scheduled">Agendada</SelectItem><SelectItem value="active">Ativa</SelectItem><SelectItem value="retired">Encerrada</SelectItem></SelectContent></Select><Button onClick={() => setRuleForm({ ...emptyRule, unit_id: selectedUnit !== 'all' ? selectedUnit : units[0]?.id || '', valid_from: new Date().toISOString().slice(0, 16) })} className="bg-orange-500 hover:bg-orange-400"><Plus className="mr-2 h-4 w-4" />Nova regra</Button></div><div className="grid gap-3">{visibleRules.map((rule) => <RuleCard key={rule.id} rule={rule} product={products.find((item) => item.id === rule.product_id)} service={services.find((item) => item.id === rule.service_id)} unit={units.find((item) => item.id === rule.unit_id)} busy={busy} onSimulate={() => simulate(rule)} onActivate={() => activate(rule)} onRetire={() => retire(rule)} onDuplicate={() => setRuleForm({ ...emptyRule, ...rule, name: `${rule.name} — nova versão`, parent_rule_id: rule.id, active: undefined, status: undefined, version: undefined, change_reason: '' })} />)}{visibleRules.length === 0 && <Empty text="Nenhuma regra encontrada neste escopo." />}</div></TabsContent>
      <TabsContent value="policies"><Card className="border-white/10 bg-white/5 text-white"><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>Alçadas comerciais</CardTitle><CardDescription className="text-white/40">Limites por papel, unidade e operação sensível.</CardDescription></div><Button onClick={() => setPolicyForm({ ...emptyPolicy, unit_id: selectedUnit !== 'all' ? selectedUnit : units[0]?.id || '' })} className="bg-violet-600 hover:bg-violet-500"><Plus className="mr-2 h-4 w-4" />Nova alçada</Button></div></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{policies.filter((policy) => policy.active).map((policy) => <div key={policy.id} className="rounded-2xl border border-white/10 bg-black/15 p-4"><div className="flex items-center justify-between"><p className="font-semibold">{policy.name}</p><Badge variant="outline" className="border-emerald-500/20 text-emerald-300">v{policy.version}</Badge></div><p className="mt-1 text-xs text-white/35">{policy.role} · {units.find((unit) => unit.id === policy.unit_id)?.name || 'Todas'}</p><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><Info label="Desconto" value={`${policy.max_discount_percent || 0}%`} /><Info label="Cortesia" value={`R$ ${Number(policy.max_courtesy_amount || 0).toFixed(2)}`} /><Info label="Dupla aprovação" value={`${policy.requires_different_approver_above_percent || 0}%`} /><Info label="MFA" value={`${policy.require_mfa_above_percent || 0}%`} /></div></div>)}{policies.filter((policy) => policy.active).length === 0 && <div className="md:col-span-2 xl:col-span-3"><Empty text="Nenhuma alçada configurada. O backend mantém os limites padrão." /></div>}</CardContent></Card></TabsContent>
    </Tabs>
    {ruleForm && <RuleDialog form={ruleForm} setForm={setRuleForm} units={units} products={products} services={services} busy={busy === 'create'} onClose={() => setRuleForm(null)} onSave={createDraft} />}
    {policyForm && <PolicyDialog form={policyForm} setForm={setPolicyForm} units={units} busy={busy === 'policy'} onClose={() => setPolicyForm(null)} onSave={savePolicy} />}
    {simulation && <SimulationDialog simulation={simulation} onClose={() => setSimulation(null)} onActivate={() => { setSimulation(null); activate(simulation.rule); }} />}
  </div>;
}

function RuleCard({ rule, product, service, unit, busy, onSimulate, onActivate, onRetire, onDuplicate }) { const status = rule.status || (rule.active ? 'active' : 'draft'); return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-white">{rule.name}</p><Badge variant="outline" className={status === 'active' ? 'border-emerald-500/20 text-emerald-300' : status === 'retired' ? 'border-white/10 text-white/35' : 'border-amber-500/20 text-amber-200'}>{status}</Badge><Badge variant="outline" className="border-white/10 text-white/45">v{rule.version}</Badge></div><p className="mt-1 text-sm text-white/45">{product?.name || 'Todos os produtos'} · {service?.name || 'Todos os serviços'} · {unit?.name || 'Todas as unidades'}</p><p className="mt-1 text-xs text-white/30">Grupo {rule.customer_group || 'geral'} · Prioridade {rule.priority || 'todas'} · {rule.valid_from ? `desde ${new Date(rule.valid_from).toLocaleDateString('pt-BR')}` : 'vigência imediata'}</p></div><div className="grid min-w-[300px] grid-cols-3 gap-2"><Info label="Base" value={`R$ ${Number(rule.base_price || 0).toFixed(2)}`} /><Info label="Adicional" value={`${Number(rule.additional_percent || 0).toFixed(1)}%`} /><Info label="Mínimo" value={`R$ ${Number(rule.minimum_price || 0).toFixed(2)}`} /></div><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="outline" onClick={onDuplicate} className="border-white/10 bg-white/5"><RefreshCcw className="mr-2 h-3.5 w-3.5" />Duplicar</Button>{status !== 'retired' && <Button size="sm" variant="outline" onClick={onSimulate} disabled={busy === `simulate:${rule.id}`} className="border-violet-500/20 text-violet-200">{busy === `simulate:${rule.id}` ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Calculator className="mr-2 h-3.5 w-3.5" />}Simular</Button>}{!rule.active && status !== 'retired' && <Button size="sm" onClick={onActivate} disabled={busy === `activate:${rule.id}`} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"><Power className="mr-2 h-3.5 w-3.5" />Ativar</Button>}{rule.active && <Button size="sm" variant="outline" onClick={onRetire} disabled={busy === `retire:${rule.id}`} className="border-red-500/20 text-red-200"><TimerReset className="mr-2 h-3.5 w-3.5" />Encerrar</Button>}</div></div></div>; }
function RuleDialog({ form, setForm, units, products, services, busy, onClose, onSave }) { return <Dialog open onOpenChange={(value) => !value && !busy && onClose()}><DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto border-white/10 bg-[#160a2b] text-white"><DialogHeader><DialogTitle>Nova versão de preço</DialogTitle><DialogDescription className="text-white/40">Crie o rascunho, simule no motor oficial e só então ative.</DialogDescription></DialogHeader><div className="grid gap-4 md:grid-cols-2"><Field label="Nome"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="border-white/10 bg-black/20" /></Field><Field label="Unidade"><Select value={form.unit_id || 'all'} onValueChange={(value) => setForm({ ...form, unit_id: value === 'all' ? '' : value })}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as unidades</SelectItem>{units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Produto"><Select value={form.product_id || 'none'} onValueChange={(value) => setForm({ ...form, product_id: value === 'none' ? '' : value })}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Todos</SelectItem>{products.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Serviço"><Select value={form.service_id || 'none'} onValueChange={(value) => setForm({ ...form, service_id: value === 'none' ? '' : value })}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Todos</SelectItem>{services.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Grupo/convênio"><Input value={form.customer_group || ''} onChange={(event) => setForm({ ...form, customer_group: event.target.value })} placeholder="Opcional" className="border-white/10 bg-black/20" /></Field><Field label="Prioridade"><Select value={form.priority || 'normal'} onValueChange={(value) => setForm({ ...form, priority: value })}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="urgent">Urgente</SelectItem></SelectContent></Select></Field>{[['base_price', 'Preço base'], ['additional_percent', 'Adicional %'], ['additional_amount', 'Adicional R$'], ['minimum_price', 'Preço mínimo']].map(([key, label]) => <Field key={key} label={label}><Input type="number" step="0.01" min="0" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="border-white/10 bg-black/20" /></Field>)}<Field label="Início"><Input type="datetime-local" value={form.valid_from || ''} onChange={(event) => setForm({ ...form, valid_from: event.target.value })} className="border-white/10 bg-black/20" /></Field><Field label="Fim"><Input type="datetime-local" value={form.valid_until || ''} onChange={(event) => setForm({ ...form, valid_until: event.target.value })} className="border-white/10 bg-black/20" /></Field><div className="md:col-span-2"><Field label="Justificativa"><Input value={form.change_reason || ''} onChange={(event) => setForm({ ...form, change_reason: event.target.value })} placeholder="Mínimo 8 caracteres" className="border-white/10 bg-black/20" /></Field></div></div><Button onClick={onSave} disabled={busy || !form.name || (!form.product_id && !form.service_id) || String(form.change_reason || '').trim().length < 8} className="bg-orange-500 hover:bg-orange-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Criar rascunho</Button></DialogContent></Dialog>; }
function PolicyDialog({ form, setForm, units, busy, onClose, onSave }) { const roles = ['attendant', 'cashier', 'manager', 'finance', 'admin']; return <Dialog open onOpenChange={(value) => !value && !busy && onClose()}><DialogContent className="max-w-3xl border-white/10 bg-[#160a2b] text-white"><DialogHeader><DialogTitle>Nova versão de alçada</DialogTitle><DialogDescription className="text-white/40">A versão anterior será encerrada automaticamente para o mesmo papel e unidade.</DialogDescription></DialogHeader><div className="grid gap-4 md:grid-cols-2"><Field label="Nome"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="border-white/10 bg-black/20" /></Field><Field label="Unidade"><Select value={form.unit_id} onValueChange={(value) => setForm({ ...form, unit_id: value })}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent>{units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Papel"><Select value={form.role} onValueChange={(value) => setForm({ ...form, role: value })}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue /></SelectTrigger><SelectContent>{roles.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent></Select></Field>{[['max_discount_percent', 'Desconto máximo %'], ['max_discount_amount', 'Desconto máximo R$'], ['max_addition_percent', 'Acréscimo máximo %'], ['max_courtesy_amount', 'Cortesia máxima R$'], ['requires_different_approver_above_percent', 'Dupla aprovação acima de %'], ['require_mfa_above_percent', 'MFA acima de %']].map(([key, label]) => <Field key={key} label={label}><Input type="number" min="0" step="0.01" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="border-white/10 bg-black/20" /></Field>)}<div className="md:col-span-2"><Field label="Justificativa"><Input value={form.change_reason} onChange={(event) => setForm({ ...form, change_reason: event.target.value })} className="border-white/10 bg-black/20" /></Field></div></div><Button onClick={onSave} disabled={busy || !form.name || !form.unit_id || form.change_reason.trim().length < 8} className="bg-violet-600 hover:bg-violet-500">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ativar nova versão</Button></DialogContent></Dialog>; }
function SimulationDialog({ simulation, onClose, onActivate }) { const item = simulation.result?.items?.[0]; return <Dialog open onOpenChange={(value) => !value && onClose()}><DialogContent className="max-w-xl border-white/10 bg-[#160a2b] text-white"><DialogHeader><DialogTitle className="flex items-center gap-2"><WandSparkles className="h-5 w-5 text-violet-300" />Resultado da simulação</DialogTitle><DialogDescription className="text-white/40">Calculado pelo mesmo motor server-side usado na aprovação do orçamento.</DialogDescription></DialogHeader>{simulation.result ? <div className="grid grid-cols-2 gap-3"><Info label="Peça" value={item?.garment_type || '—'} /><Info label="Serviço" value={item?.services?.[0]?.name || '—'} /><Info label="Preço unitário" value={`R$ ${Number(item?.unit_price || 0).toFixed(2)}`} /><Info label="Total" value={`R$ ${Number(simulation.result.subtotal || 0).toFixed(2)}`} /><Info label="Origem" value={item?.services?.[0]?.price_source || '—'} /><Info label="Regra" value={item?.services?.[0]?.price_rule_id || 'catálogo'} /></div> : <Empty text="Rascunho criado. Clique em Simular no cartão para gerar o resultado." />}<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} className="border-white/10">Fechar</Button>{simulation.result && <Button onClick={onActivate} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"><Power className="mr-2 h-4 w-4" />Ativar</Button>}</div></DialogContent></Dialog>; }
function Field({ label, children }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function Metric({ label, value }) { return <div className="min-w-24 rounded-2xl border border-white/10 bg-black/15 px-4 py-3"><p className="text-xs text-white/35">{label}</p><p className="mt-1 text-xl font-bold text-white">{value}</p></div>; }
function Info({ label, value }) { return <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3"><p className="text-xs text-white/35">{label}</p><p className="mt-1 break-words text-sm text-white/75">{value}</p></div>; }
function Empty({ text }) { return <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">{text}</div>; }
