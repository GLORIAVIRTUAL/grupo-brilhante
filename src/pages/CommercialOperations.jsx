import React, { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, BriefcaseBusiness, ClipboardCheck, FileSignature, Plus, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/accessControl';

const inputClass = 'w-full rounded-xl border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-sky-400/60';
function unwrap(response) { return response?.data || response || {}; }
function errorMessage(error) { return error?.response?.data?.error || error?.data?.error || error?.message || 'Falha na operação comercial.'; }
function currency(value) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

const CONTRACT_TYPES = [['laundry_piece', 'Lavanderia por peça'], ['laundry_weight', 'Lavanderia por peso'], ['hospital_laundry', 'Lavanderia hospitalar'], ['linen_rental', 'Aluguel de enxovais'], ['corporate_cleaning', 'Limpeza empresarial'], ['outsourcing', 'Terceirização'], ['mixed', 'Contrato misto'], ['other', 'Outro']];
const SERVICE_TYPES = [['laundry_piece', 'Lavanderia por peça'], ['laundry_weight', 'Lavanderia por peso'], ['hospital_pickup', 'Coleta hospitalar'], ['hospital_processing', 'Processamento hospitalar'], ['linen_delivery', 'Entrega de enxoval'], ['linen_collection', 'Coleta de enxoval'], ['corporate_cleaning', 'Limpeza empresarial'], ['inspection', 'Inspeção'], ['outsourcing', 'Terceirização'], ['other', 'Outro']];

export default function CommercialOperations() {
  const { user } = useAuth();
  const canCrm = hasPermission(user, 'crm.manage');
  const canManageContracts = hasPermission(user, 'contracts.manage');
  const canApproveContracts = hasPermission(user, 'contracts.approve');
  const canExecuteOrders = hasPermission(user, 'service_orders.execute');
  const canApproveOrders = hasPermission(user, 'service_orders.approve');
  const [scope, setScope] = useState({ legal_entities: [], units: [] });
  const [companyId, setCompanyId] = useState('');
  const [partyData, setPartyData] = useState({ parties: [], roles: [] });
  const [data, setData] = useState({ opportunities: [], contracts: [], activities: [] });
  const [orders, setOrders] = useState([]);
  const [selectedContract, setSelectedContract] = useState(null);
  const [contractDetail, setContractDetail] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [opportunity, setOpportunity] = useState({ business_party_id: '', title: '', source: 'prospecting', temperature: 'warm', estimated_value: '', probability_percent: 20, reason: '' });
  const [contract, setContract] = useState({ business_party_id: '', opportunity_id: '', title: '', contract_type: 'corporate_cleaning', starts_on: '', billing_cycle: 'monthly', payment_terms_days: 30, minimum_monthly_amount: '', reason: '' });
  const [price, setPrice] = useState({ description: '', billing_unit: 'fixed_monthly', unit_price: '', included_quantity: 0, excess_unit_price: '', reason: '' });
  const [serviceOrder, setServiceOrder] = useState({ business_party_id: '', contract_id: '', title: '', service_type: 'corporate_cleaning', priority: 'normal', scheduled_start_at: '', reason: '' });
  const [transitionReason, setTransitionReason] = useState('');

  const units = useMemo(() => scope.units.filter((row) => row.legal_entity_id === companyId), [scope.units, companyId]);
  const partyName = (id) => partyData.parties.find((party) => party.id === id)?.trade_name || partyData.parties.find((party) => party.id === id)?.legal_name || 'Cadastro';
  const selectedUnitId = units[0]?.id || '';

  const load = async (nextCompanyId = companyId) => {
    if (!nextCompanyId) return;
    setBusy(true);
    try {
      const [commercial, parties, serviceOrders] = await Promise.all([
        base44.functions.invoke('manage_business_contracts', { action: 'overview', legal_entity_id: nextCompanyId }),
        base44.functions.invoke('manage_business_parties', { action: 'overview', legal_entity_id: nextCompanyId }),
        base44.functions.invoke('manage_service_orders', { action: 'list', legal_entity_id: nextCompanyId }),
      ]);
      setData(unwrap(commercial));
      setPartyData(unwrap(parties));
      setOrders(unwrap(serviceOrders).service_orders || []);
    } catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); } finally { setBusy(false); }
  };

  useEffect(() => {
    (async () => {
      try {
        const enterprise = unwrap(await base44.functions.invoke('manage_enterprise_core', { action: 'overview' }));
        setScope(enterprise);
        const initial = enterprise.legal_entities?.[0]?.id || '';
        setCompanyId(initial);
        await load(initial);
      } catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); }
    })();
  }, []);

  const run = async (callback, success) => {
    setBusy(true); setNotice(null);
    try { await callback(); setNotice({ type: 'success', text: success }); await load(); }
    catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const createOpportunity = (event) => {
    event.preventDefault();
    run(async () => {
      await base44.functions.invoke('manage_business_contracts', { action: 'create_opportunity', legal_entity_id: companyId, unit_id: selectedUnitId || undefined, ...opportunity });
      setOpportunity((current) => ({ ...current, title: '', estimated_value: '', reason: '' }));
    }, 'Oportunidade criada.');
  };

  const createContract = (event) => {
    event.preventDefault();
    run(async () => {
      await base44.functions.invoke('manage_business_contracts', { action: 'create_contract', legal_entity_id: companyId, unit_id: selectedUnitId || undefined, ...contract, idempotency_key: crypto.randomUUID() });
      setContract((current) => ({ ...current, title: '', minimum_monthly_amount: '', reason: '' }));
    }, 'Contrato criado em rascunho.');
  };

  const openContract = async (item) => {
    setSelectedContract(item);
    try { setContractDetail(unwrap(await base44.functions.invoke('manage_business_contracts', { action: 'contract_detail', contract_id: item.id }))); }
    catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); }
  };

  const addPrice = (event) => {
    event.preventDefault();
    run(async () => {
      await base44.functions.invoke('manage_business_contracts', { action: 'add_price_item', contract_id: selectedContract.id, ...price });
      setPrice((current) => ({ ...current, description: '', unit_price: '', excess_unit_price: '', reason: '' }));
      await openContract(selectedContract);
    }, 'Item de preço adicionado.');
  };

  const contractAction = (action, success) => run(async () => {
    await base44.functions.invoke('manage_business_contracts', { action, contract_id: selectedContract.id, reason: transitionReason, change_summary: transitionReason });
    setTransitionReason('');
    await openContract({ ...selectedContract });
  }, success);

  const createServiceOrder = (event) => {
    event.preventDefault();
    run(async () => {
      await base44.functions.invoke('manage_service_orders', { action: 'create', legal_entity_id: companyId, unit_id: selectedUnitId || undefined, ...serviceOrder, idempotency_key: crypto.randomUUID() });
      setServiceOrder((current) => ({ ...current, title: '', scheduled_start_at: '', reason: '' }));
    }, 'Ordem de serviço criada.');
  };

  const orderAction = (item, action) => run(async () => {
    await base44.functions.invoke('manage_service_orders', { action, service_order_id: item.id, reason: transitionReason, quality_score: 100, scheduled_start_at: action === 'schedule' ? new Date().toISOString() : undefined });
    setTransitionReason('');
  }, 'Ordem de serviço atualizada.');

  return <div className="space-y-6">
    <header><div className="mb-2 flex items-center gap-2 text-sm font-medium text-sky-300"><BriefcaseBusiness className="h-4 w-4" /> Operação comercial contratual</div><h1 className="text-3xl font-bold text-white">CRM B2B, contratos e ordens de serviço</h1><p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">Controle oportunidades, versões, preços e execução operacional por CNPJ. Aprovações críticas exigem MFA e justificativa.</p></header>
    {notice ? <div className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'}`}>{notice.text}</div> : null}
    <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 md:flex-row md:items-center"><select className={`${inputClass} md:max-w-sm`} value={companyId} onChange={(event) => { setCompanyId(event.target.value); setSelectedContract(null); setContractDetail(null); load(event.target.value); }}><option value="">Selecione o CNPJ</option>{scope.legal_entities.map((company) => <option key={company.id} value={company.id}>{company.trade_name}</option>)}</select><button type="button" onClick={() => load()} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/65 hover:bg-white/10"><RefreshCw className={`mr-2 inline h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</button><div className="ml-auto grid grid-cols-3 gap-4 text-center"><div><p className="text-xl font-bold text-white">{data.opportunities?.length || 0}</p><p className="text-[10px] uppercase text-white/35">Oportunidades</p></div><div><p className="text-xl font-bold text-white">{data.contracts?.length || 0}</p><p className="text-[10px] uppercase text-white/35">Contratos</p></div><div><p className="text-xl font-bold text-white">{orders.length}</p><p className="text-[10px] uppercase text-white/35">OS</p></div></div></section>

    <div className="grid gap-5 xl:grid-cols-3">
      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="mb-4 flex items-center gap-2"><BadgeDollarSign className="h-5 w-5 text-sky-300" /><h2 className="font-semibold text-white">Oportunidades</h2></div>{canCrm ? <form onSubmit={createOpportunity} className="mb-5 space-y-2"><select className={inputClass} value={opportunity.business_party_id} onChange={(event) => setOpportunity({ ...opportunity, business_party_id: event.target.value })} required><option value="">Selecione o cliente</option>{partyData.parties.map((party) => <option key={party.id} value={party.id}>{party.trade_name || party.legal_name}</option>)}</select><input className={inputClass} value={opportunity.title} onChange={(event) => setOpportunity({ ...opportunity, title: event.target.value })} placeholder="Oportunidade" required /><div className="grid grid-cols-2 gap-2"><input type="number" min="0" step="0.01" className={inputClass} value={opportunity.estimated_value} onChange={(event) => setOpportunity({ ...opportunity, estimated_value: event.target.value })} placeholder="Valor estimado" /><select className={inputClass} value={opportunity.temperature} onChange={(event) => setOpportunity({ ...opportunity, temperature: event.target.value })}><option value="cold">Fria</option><option value="warm">Morna</option><option value="hot">Quente</option></select></div><input className={inputClass} value={opportunity.reason} onChange={(event) => setOpportunity({ ...opportunity, reason: event.target.value })} minLength={8} placeholder="Justificativa" required /><button disabled={busy} className="w-full rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><Plus className="mr-1.5 inline h-4 w-4" />Nova oportunidade</button></form> : null}<div className="space-y-2">{data.opportunities?.map((item) => <div key={item.id} className="rounded-xl border border-white/8 bg-black/10 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium text-white">{item.title}</p><p className="mt-1 text-xs text-white/35">{partyName(item.business_party_id)}</p></div><span className="rounded-full bg-sky-400/10 px-2 py-1 text-xs text-sky-200">{item.stage}</span></div><div className="mt-3 flex justify-between text-xs text-white/45"><span>Score {item.score || 0}</span><span>{currency(item.estimated_value)}</span></div></div>)}</div></section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="mb-4 flex items-center gap-2"><FileSignature className="h-5 w-5 text-sky-300" /><h2 className="font-semibold text-white">Contratos</h2></div>{canManageContracts ? <form onSubmit={createContract} className="mb-5 space-y-2"><select className={inputClass} value={contract.business_party_id} onChange={(event) => setContract({ ...contract, business_party_id: event.target.value })} required><option value="">Selecione o cliente</option>{partyData.parties.map((party) => <option key={party.id} value={party.id}>{party.trade_name || party.legal_name}</option>)}</select><input className={inputClass} value={contract.title} onChange={(event) => setContract({ ...contract, title: event.target.value })} placeholder="Objeto do contrato" required /><div className="grid grid-cols-2 gap-2"><select className={inputClass} value={contract.contract_type} onChange={(event) => setContract({ ...contract, contract_type: event.target.value })}>{CONTRACT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input type="date" className={inputClass} value={contract.starts_on} onChange={(event) => setContract({ ...contract, starts_on: event.target.value })} required /></div><input className={inputClass} value={contract.reason} onChange={(event) => setContract({ ...contract, reason: event.target.value })} minLength={8} placeholder="Justificativa" required /><button disabled={busy} className="w-full rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><Plus className="mr-1.5 inline h-4 w-4" />Novo contrato</button></form> : null}<div className="space-y-2">{data.contracts?.map((item) => <button type="button" key={item.id} onClick={() => openContract(item)} className={`block w-full rounded-xl border p-3 text-left ${selectedContract?.id === item.id ? 'border-sky-400/40 bg-sky-400/10' : 'border-white/8 bg-black/10 hover:bg-white/5'}`}><div className="flex justify-between gap-2"><p className="text-sm font-medium text-white">{item.contract_number}</p><span className="text-xs text-sky-200">{item.status}</span></div><p className="mt-1 text-xs text-white/45">{item.title}</p><p className="mt-2 text-xs text-white/35">{partyName(item.business_party_id)}</p></button>)}</div></section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="mb-4 flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-sky-300" /><h2 className="font-semibold text-white">Ordens de serviço</h2></div>{canExecuteOrders ? <form onSubmit={createServiceOrder} className="mb-5 space-y-2"><select className={inputClass} value={serviceOrder.business_party_id} onChange={(event) => setServiceOrder({ ...serviceOrder, business_party_id: event.target.value })} required><option value="">Selecione o cliente</option>{partyData.parties.map((party) => <option key={party.id} value={party.id}>{party.trade_name || party.legal_name}</option>)}</select><select className={inputClass} value={serviceOrder.contract_id} onChange={(event) => setServiceOrder({ ...serviceOrder, contract_id: event.target.value })}><option value="">Sem contrato</option>{data.contracts?.filter((item) => item.status === 'active' && (!serviceOrder.business_party_id || item.business_party_id === serviceOrder.business_party_id)).map((item) => <option key={item.id} value={item.id}>{item.contract_number}</option>)}</select><input className={inputClass} value={serviceOrder.title} onChange={(event) => setServiceOrder({ ...serviceOrder, title: event.target.value })} placeholder="Serviço a executar" required /><div className="grid grid-cols-2 gap-2"><select className={inputClass} value={serviceOrder.service_type} onChange={(event) => setServiceOrder({ ...serviceOrder, service_type: event.target.value })}>{SERVICE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input type="datetime-local" className={inputClass} value={serviceOrder.scheduled_start_at} onChange={(event) => setServiceOrder({ ...serviceOrder, scheduled_start_at: event.target.value })} /></div><input className={inputClass} value={serviceOrder.reason} onChange={(event) => setServiceOrder({ ...serviceOrder, reason: event.target.value })} minLength={8} placeholder="Justificativa" required /><button disabled={busy} className="w-full rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><Plus className="mr-1.5 inline h-4 w-4" />Nova OS</button></form> : null}<input className={`${inputClass} mb-3`} value={transitionReason} onChange={(event) => setTransitionReason(event.target.value)} placeholder="Justificativa para ações" /><div className="space-y-2">{orders.map((item) => <div key={item.id} className="rounded-xl border border-white/8 bg-black/10 p-3"><div className="flex justify-between gap-2"><div><p className="text-sm font-medium text-white">{item.service_order_number}</p><p className="mt-1 text-xs text-white/35">{item.title}</p></div><span className="text-xs text-sky-200">{item.status}</span></div><div className="mt-3 flex flex-wrap gap-1.5">{canExecuteOrders && item.status === 'draft' ? <button type="button" onClick={() => orderAction(item, 'schedule')} className="rounded-lg bg-white/8 px-2 py-1 text-xs text-white/60">Agendar agora</button> : null}{canExecuteOrders && item.status === 'scheduled' ? <button type="button" onClick={() => orderAction(item, 'start')} className="rounded-lg bg-sky-500/20 px-2 py-1 text-xs text-sky-200">Iniciar</button> : null}{canExecuteOrders && item.status === 'in_progress' ? <button type="button" onClick={() => orderAction(item, 'submit_quality')} className="rounded-lg bg-amber-500/20 px-2 py-1 text-xs text-amber-200">Enviar à qualidade</button> : null}{canApproveOrders && item.status === 'quality_review' ? <button type="button" onClick={() => orderAction(item, 'approve_completion')} className="rounded-lg bg-emerald-500/20 px-2 py-1 text-xs text-emerald-200">Concluir</button> : null}</div></div>)}</div></section>
    </div>

    {selectedContract && contractDetail ? <section className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.04] p-5"><div className="mb-4 flex flex-col justify-between gap-3 md:flex-row"><div><p className="text-xs uppercase tracking-wide text-sky-300">Contrato selecionado</p><h2 className="mt-1 text-xl font-semibold text-white">{selectedContract.contract_number} · {selectedContract.title}</h2><p className="mt-1 text-sm text-white/40">Versão {selectedContract.current_version_number || 0} · {selectedContract.status}</p></div><div className="flex flex-wrap items-start gap-2"><input className={`${inputClass} min-w-64`} value={transitionReason} onChange={(event) => setTransitionReason(event.target.value)} placeholder="Justificativa da mudança" />{canManageContracts && selectedContract.status === 'draft' ? <button type="button" disabled={transitionReason.length < 8} onClick={() => contractAction('submit_contract', 'Contrato enviado para aprovação.')} className="rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Enviar à aprovação</button> : null}{canApproveContracts && selectedContract.status === 'pending_approval' ? <button type="button" disabled={transitionReason.length < 8} onClick={() => contractAction('approve_contract', 'Contrato aprovado e ativado.')} className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Aprovar</button> : null}</div></div>
      {canManageContracts && selectedContract.status === 'draft' ? <form onSubmit={addPrice} className="grid gap-2 rounded-xl border border-white/10 bg-black/10 p-4 md:grid-cols-2 xl:grid-cols-6"><input className={`${inputClass} xl:col-span-2`} value={price.description} onChange={(event) => setPrice({ ...price, description: event.target.value })} placeholder="Item de preço" required /><select className={inputClass} value={price.billing_unit} onChange={(event) => setPrice({ ...price, billing_unit: event.target.value })}><option value="fixed_monthly">Mensal fixo</option><option value="kg">Kg</option><option value="piece">Peça</option><option value="hour">Hora</option><option value="work_post">Posto</option><option value="visit">Visita</option><option value="square_meter">m²</option></select><input type="number" min="0" step="0.01" className={inputClass} value={price.unit_price} onChange={(event) => setPrice({ ...price, unit_price: event.target.value })} placeholder="Preço" required /><input className={inputClass} value={price.reason} onChange={(event) => setPrice({ ...price, reason: event.target.value })} minLength={8} placeholder="Justificativa" required /><button disabled={busy} className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white">Adicionar preço</button></form> : null}
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{contractDetail.prices?.map((item) => <div key={item.id} className="rounded-xl border border-white/8 bg-black/10 p-3"><p className="text-sm font-medium text-white">{item.description}</p><p className="mt-1 text-xs text-white/40">{item.billing_unit} · {currency(item.unit_price)} · {item.status}</p></div>)}</div>
    </section> : null}
  </div>;
}
