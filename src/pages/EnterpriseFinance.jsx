import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CalendarClock, Landmark, LineChart, Plus, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/accessControl';

const inputClass = 'w-full rounded-xl border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-sky-400/60';
function unwrap(response) { return response?.data || response || {}; }
function errorMessage(error) { return error?.response?.data?.error || error?.data?.error || error?.message || 'Falha no financeiro empresarial.'; }
function currency(value) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

export default function EnterpriseFinance() {
  const { user } = useAuth();
  const canManage = hasPermission(user, 'finance.manage');
  const canApprove = hasPermission(user, 'finance.approve');
  const canClose = hasPermission(user, 'finance.close_period');
  const [scope, setScope] = useState({ legal_entities: [], units: [] });
  const [companyId, setCompanyId] = useState('');
  const [partiesByCompany, setPartiesByCompany] = useState({});
  const [data, setData] = useState({ periods: [], intercompany_entries: [], projections: [], summary: {} });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const today = new Date();
  const [period, setPeriod] = useState({ year: today.getFullYear(), month: today.getMonth() + 1, reason: '' });
  const [projection, setProjection] = useState({ description: '', direction: 'inflow', amount: '', probability_percent: 100, projection_date: '', scenario: 'baseline', reason: '' });
  const [intercompany, setIntercompany] = useState({ destination_legal_entity_id: '', source_unit_id: '', destination_unit_id: '', source_business_party_id: '', destination_business_party_id: '', description: '', competence_date: '', due_date: '', amount: '', reason: '' });
  const [actionReason, setActionReason] = useState('');

  const sourceUnits = useMemo(() => scope.units.filter((unit) => unit.legal_entity_id === companyId), [scope.units, companyId]);
  const destinationUnits = useMemo(() => scope.units.filter((unit) => unit.legal_entity_id === intercompany.destination_legal_entity_id), [scope.units, intercompany.destination_legal_entity_id]);
  const sourceParties = partiesByCompany[companyId] || [];
  const destinationParties = partiesByCompany[intercompany.destination_legal_entity_id] || [];

  const loadParties = async (legalEntityId) => {
    if (!legalEntityId || partiesByCompany[legalEntityId]) return;
    const response = unwrap(await base44.functions.invoke('manage_business_parties', { action: 'overview', legal_entity_id: legalEntityId }));
    setPartiesByCompany((current) => ({ ...current, [legalEntityId]: response.parties || [] }));
  };

  const load = async (nextCompanyId = companyId) => {
    if (!nextCompanyId) return;
    setBusy(true);
    try {
      const response = unwrap(await base44.functions.invoke('manage_financial_core', { action: 'overview', legal_entity_id: nextCompanyId }));
      setData(response);
      await loadParties(nextCompanyId);
    } catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); } finally { setBusy(false); }
  };

  useEffect(() => {
    (async () => {
      try {
        const enterprise = unwrap(await base44.functions.invoke('manage_enterprise_core', { action: 'overview' }));
        setScope(enterprise);
        const initial = enterprise.legal_entities?.[0]?.id || '';
        setCompanyId(initial);
        setIntercompany((current) => ({ ...current, source_unit_id: enterprise.units?.find((unit) => unit.legal_entity_id === initial)?.id || '' }));
        await load(initial);
      } catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); }
    })();
  }, []);

  const run = async (operation, success) => {
    setBusy(true); setNotice(null);
    try { await operation(); setNotice({ type: 'success', text: success }); await load(); }
    catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const openPeriod = (event) => {
    event.preventDefault();
    run(async () => {
      await base44.functions.invoke('manage_financial_core', { action: 'open_period', legal_entity_id: companyId, ...period });
      setPeriod((current) => ({ ...current, reason: '' }));
    }, 'Período financeiro aberto.');
  };

  const periodAction = (item, action) => run(async () => {
    await base44.functions.invoke('manage_financial_core', { action, period_id: item.id, reason: actionReason });
    setActionReason('');
  }, action === 'close_period' ? 'Período fechado com snapshot.' : 'Período reaberto com auditoria.');

  const createProjection = (event) => {
    event.preventDefault();
    run(async () => {
      await base44.functions.invoke('manage_financial_core', { action: 'create_projection', legal_entity_id: companyId, ...projection });
      setProjection((current) => ({ ...current, description: '', amount: '', reason: '' }));
    }, 'Projeção registrada.');
  };

  const chooseDestination = async (id) => {
    setIntercompany((current) => ({ ...current, destination_legal_entity_id: id, destination_unit_id: scope.units.find((unit) => unit.legal_entity_id === id)?.id || '' }));
    try { await loadParties(id); } catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); }
  };

  const createIntercompany = (event) => {
    event.preventDefault();
    run(async () => {
      await base44.functions.invoke('manage_financial_core', { action: 'create_intercompany', source_legal_entity_id: companyId, ...intercompany, idempotency_key: crypto.randomUUID() });
      setIntercompany((current) => ({ ...current, description: '', amount: '', reason: '' }));
    }, 'Lançamento intercompany criado em rascunho.');
  };

  const intercompanyAction = (item, action) => run(async () => {
    await base44.functions.invoke('manage_financial_core', { action, intercompany_entry_id: item.id, reason: actionReason });
    setActionReason('');
  }, action === 'approve_intercompany' ? 'Lançamentos espelhados aprovados.' : 'Lançamento atualizado.');

  const summaryCards = [
    ['Contas a pagar em aberto', data.summary?.payable_open], ['Contas a receber em aberto', data.summary?.receivable_open],
    ['Entrada projetada ponderada', data.summary?.projected_inflow], ['Saída projetada ponderada', data.summary?.projected_outflow],
  ];

  return <div className="space-y-6">
    <header><div className="mb-2 flex items-center gap-2 text-sm font-medium text-sky-300"><Landmark className="h-4 w-4" /> Controle financeiro por CNPJ</div><h1 className="text-3xl font-bold text-white">Financeiro empresarial</h1><p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">Fechamento por competência, projeções e intercompany com lançamentos espelhados. Nenhuma cobrança ou transmissão bancária é executada nesta tela.</p></header>
    {notice ? <div className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'}`}>{notice.text}</div> : null}
    <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 md:flex-row"><select className={`${inputClass} md:max-w-sm`} value={companyId} onChange={(event) => { const id = event.target.value; setCompanyId(id); setIntercompany((current) => ({ ...current, source_unit_id: scope.units.find((unit) => unit.legal_entity_id === id)?.id || '' })); load(id); }}><option value="">Selecione o CNPJ</option>{scope.legal_entities.map((company) => <option key={company.id} value={company.id}>{company.trade_name}</option>)}</select><button type="button" onClick={() => load()} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/65"><RefreshCw className={`mr-2 inline h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</button></section>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{summaryCards.map(([label, value]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><p className="text-xs uppercase tracking-wide text-white/35">{label}</p><p className="mt-2 text-2xl font-bold text-white">{currency(value)}</p></div>)}</div>

    <div className="grid gap-5 xl:grid-cols-3">
      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="mb-4 flex items-center gap-2"><CalendarClock className="h-5 w-5 text-sky-300" /><h2 className="font-semibold text-white">Competências</h2></div>{canManage ? <form onSubmit={openPeriod} className="mb-4 grid grid-cols-2 gap-2"><input type="number" min="2000" max="2200" className={inputClass} value={period.year} onChange={(event) => setPeriod({ ...period, year: Number(event.target.value) })} /><input type="number" min="1" max="12" className={inputClass} value={period.month} onChange={(event) => setPeriod({ ...period, month: Number(event.target.value) })} /><input className={`${inputClass} col-span-2`} value={period.reason} onChange={(event) => setPeriod({ ...period, reason: event.target.value })} minLength={8} placeholder="Justificativa" required /><button disabled={busy} className="col-span-2 rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white"><Plus className="mr-1.5 inline h-4 w-4" />Abrir período</button></form> : null}<input className={`${inputClass} mb-3`} value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Justificativa para fechar/reabrir" /><div className="space-y-2">{data.periods?.map((item) => <div key={item.id} className="rounded-xl border border-white/8 bg-black/10 p-3"><div className="flex justify-between"><p className="text-sm font-medium text-white">{item.year}/{String(item.month).padStart(2, '0')}</p><span className="text-xs text-sky-200">{item.status}</span></div>{canClose && ['open', 'reopened'].includes(item.status) ? <button type="button" disabled={actionReason.length < 8} onClick={() => periodAction(item, 'close_period')} className="mt-3 rounded-lg bg-amber-500/20 px-2 py-1 text-xs text-amber-200 disabled:opacity-35">Fechar</button> : null}{canClose && item.status === 'closed' ? <button type="button" disabled={actionReason.length < 8} onClick={() => periodAction(item, 'reopen_period')} className="mt-3 rounded-lg bg-white/10 px-2 py-1 text-xs text-white/60 disabled:opacity-35">Reabrir</button> : null}</div>)}</div></section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="mb-4 flex items-center gap-2"><LineChart className="h-5 w-5 text-sky-300" /><h2 className="font-semibold text-white">Projeções</h2></div>{canManage ? <form onSubmit={createProjection} className="mb-4 space-y-2"><input className={inputClass} value={projection.description} onChange={(event) => setProjection({ ...projection, description: event.target.value })} placeholder="Descrição" required /><div className="grid grid-cols-2 gap-2"><select className={inputClass} value={projection.direction} onChange={(event) => setProjection({ ...projection, direction: event.target.value })}><option value="inflow">Entrada</option><option value="outflow">Saída</option></select><select className={inputClass} value={projection.scenario} onChange={(event) => setProjection({ ...projection, scenario: event.target.value })}><option value="baseline">Base</option><option value="optimistic">Otimista</option><option value="conservative">Conservador</option></select></div><div className="grid grid-cols-2 gap-2"><input type="number" min="0" step="0.01" className={inputClass} value={projection.amount} onChange={(event) => setProjection({ ...projection, amount: event.target.value })} placeholder="Valor" required /><input type="number" min="0" max="100" className={inputClass} value={projection.probability_percent} onChange={(event) => setProjection({ ...projection, probability_percent: Number(event.target.value) })} placeholder="Probabilidade %" /></div><input type="date" className={inputClass} value={projection.projection_date} onChange={(event) => setProjection({ ...projection, projection_date: event.target.value })} required /><input className={inputClass} value={projection.reason} onChange={(event) => setProjection({ ...projection, reason: event.target.value })} minLength={8} placeholder="Justificativa" required /><button disabled={busy} className="w-full rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white">Registrar projeção</button></form> : null}<div className="space-y-2">{data.projections?.slice(0, 30).map((item) => <div key={item.id} className="rounded-xl border border-white/8 bg-black/10 p-3"><div className="flex justify-between gap-2"><p className="text-sm font-medium text-white">{item.description}</p><span className={item.direction === 'inflow' ? 'text-emerald-300' : 'text-red-300'}>{currency(item.amount)}</span></div><p className="mt-1 text-xs text-white/35">{item.projection_date} · {item.probability_percent}% · {item.scenario}</p></div>)}</div></section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="mb-4 flex items-center gap-2"><ArrowLeftRight className="h-5 w-5 text-sky-300" /><h2 className="font-semibold text-white">Intercompany</h2></div>{canManage ? <form onSubmit={createIntercompany} className="mb-4 space-y-2"><select className={inputClass} value={intercompany.destination_legal_entity_id} onChange={(event) => chooseDestination(event.target.value)} required><option value="">CNPJ de destino</option>{scope.legal_entities.filter((company) => company.id !== companyId).map((company) => <option key={company.id} value={company.id}>{company.trade_name}</option>)}</select><div className="grid grid-cols-2 gap-2"><select className={inputClass} value={intercompany.source_unit_id} onChange={(event) => setIntercompany({ ...intercompany, source_unit_id: event.target.value })} required><option value="">Unidade origem</option>{sourceUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><select className={inputClass} value={intercompany.destination_unit_id} onChange={(event) => setIntercompany({ ...intercompany, destination_unit_id: event.target.value })} required><option value="">Unidade destino</option>{destinationUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></div><select className={inputClass} value={intercompany.destination_business_party_id} onChange={(event) => setIntercompany({ ...intercompany, destination_business_party_id: event.target.value })} required><option value="">Parte do destino cadastrada na origem</option>{sourceParties.map((party) => <option key={party.id} value={party.id}>{party.trade_name || party.legal_name}</option>)}</select><select className={inputClass} value={intercompany.source_business_party_id} onChange={(event) => setIntercompany({ ...intercompany, source_business_party_id: event.target.value })} required><option value="">Parte da origem cadastrada no destino</option>{destinationParties.map((party) => <option key={party.id} value={party.id}>{party.trade_name || party.legal_name}</option>)}</select><input className={inputClass} value={intercompany.description} onChange={(event) => setIntercompany({ ...intercompany, description: event.target.value })} placeholder="Descrição" required /><div className="grid grid-cols-2 gap-2"><input type="date" className={inputClass} value={intercompany.competence_date} onChange={(event) => setIntercompany({ ...intercompany, competence_date: event.target.value })} required /><input type="date" className={inputClass} value={intercompany.due_date} onChange={(event) => setIntercompany({ ...intercompany, due_date: event.target.value })} required /></div><input type="number" min="0.01" step="0.01" className={inputClass} value={intercompany.amount} onChange={(event) => setIntercompany({ ...intercompany, amount: event.target.value })} placeholder="Valor" required /><input className={inputClass} value={intercompany.reason} onChange={(event) => setIntercompany({ ...intercompany, reason: event.target.value })} minLength={8} placeholder="Justificativa" required /><button disabled={busy} className="w-full rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white">Criar intercompany</button></form> : null}<input className={`${inputClass} mb-3`} value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Justificativa para aprovação" /><div className="space-y-2">{data.intercompany_entries?.map((item) => <div key={item.id} className="rounded-xl border border-white/8 bg-black/10 p-3"><div className="flex justify-between"><p className="text-sm font-medium text-white">{item.entry_key}</p><span className="text-xs text-sky-200">{item.status}</span></div><p className="mt-1 text-xs text-white/40">{item.description} · {currency(item.amount)}</p><div className="mt-3 flex gap-2">{canManage && item.status === 'draft' ? <button type="button" disabled={actionReason.length < 8} onClick={() => intercompanyAction(item, 'submit_intercompany')} className="rounded-lg bg-amber-500/20 px-2 py-1 text-xs text-amber-200 disabled:opacity-35">Enviar à aprovação</button> : null}{canApprove && item.status === 'pending_approval' ? <button type="button" disabled={actionReason.length < 8} onClick={() => intercompanyAction(item, 'approve_intercompany')} className="rounded-lg bg-emerald-500/20 px-2 py-1 text-xs text-emerald-200 disabled:opacity-35">Aprovar espelhos</button> : null}</div></div>)}</div></section>
    </div>
  </div>;
}
