import React, { useEffect, useMemo, useState } from 'react';
import { Building2, MapPin, Phone, Plus, RefreshCw, Search, UserRoundCog } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/accessControl';

const inputClass = 'w-full rounded-xl border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-sky-400/60';
const SEGMENTS = [['hospital', 'Hospital'], ['hotel', 'Hotel'], ['restaurant', 'Restaurante'], ['industry', 'Indústria'], ['retail', 'Varejo'], ['condominium', 'Condomínio'], ['office', 'Escritório'], ['public_sector', 'Setor público'], ['partner', 'Parceiro'], ['individual', 'Pessoa física'], ['other', 'Outro']];
const ROLES = [['customer', 'Cliente'], ['supplier', 'Fornecedor'], ['service_recipient', 'Tomador'], ['service_provider', 'Prestador'], ['carrier', 'Transportador'], ['hospital', 'Hospital'], ['partner', 'Parceiro'], ['employee', 'Colaborador'], ['other', 'Outro']];
function unwrap(response) { return response?.data || response || {}; }
function message(error) { return error?.response?.data?.error || error?.data?.error || error?.message || 'Falha no cadastro unificado.'; }

export default function BusinessRegistry() {
  const { user } = useAuth();
  const canManage = hasPermission(user, 'parties.manage');
  const [scope, setScope] = useState({ legal_entities: [], units: [] });
  const [legalEntityId, setLegalEntityId] = useState('');
  const [search, setSearch] = useState('');
  const [parties, setParties] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ party_type: 'company', legal_name: '', trade_name: '', tax_id: '', segment: 'other', role_type: 'customer', unit_id: '', reason: autoReason('Cadastro unificado') });
  const [contact, setContact] = useState({ contact_type: 'whatsapp', contact_name: '', value: '', is_primary: true, allows_marketing: false, reason: autoReason('Contato') });
  const [address, setAddress] = useState({ address_type: 'operational', postal_code: '', street: '', number: '', neighborhood: '', city: '', state: '', reason: autoReason('Endereço') });

  const units = useMemo(() => scope.units.filter((row) => row.legal_entity_id === legalEntityId), [scope.units, legalEntityId]);
  const roleMap = useMemo(() => roles.reduce((map, role) => { (map[role.business_party_id] ||= []).push(role.role_type); return map; }, {}), [roles]);

  const loadScope = async () => {
    const data = unwrap(await base44.functions.invoke('manage_enterprise_core', { action: 'overview' }));
    setScope(data);
    const initial = legalEntityId || data.legal_entities?.[0]?.id || '';
    setLegalEntityId(initial);
    setForm((current) => ({ ...current, unit_id: current.unit_id || data.units?.find((unit) => unit.legal_entity_id === initial)?.id || '' }));
    return initial;
  };

  const loadParties = async (companyId = legalEntityId, query = search) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const data = unwrap(await base44.functions.invoke('manage_business_parties', { action: 'overview', legal_entity_id: companyId, search: query }));
      setParties(data.parties || []);
      setRoles(data.roles || []);
    } catch (error) {
      setNotice({ type: 'error', text: message(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadScope().then((id) => loadParties(id)).catch((error) => setNotice({ type: 'error', text: message(error) })); }, []);

  const chooseCompany = (id) => {
    setLegalEntityId(id);
    setSelected(null);
    setDetail(null);
    setForm((current) => ({ ...current, unit_id: scope.units.find((unit) => unit.legal_entity_id === id)?.id || '' }));
    loadParties(id);
  };

  const openDetail = async (party) => {
    setSelected(party);
    try {
      const data = unwrap(await base44.functions.invoke('manage_business_parties', { action: 'detail', party_id: party.id, legal_entity_id: legalEntityId }));
      setDetail(data);
    } catch (error) {
      setNotice({ type: 'error', text: message(error) });
    }
  };

  const createParty = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const data = unwrap(await base44.functions.invoke('manage_business_parties', { action: 'create', legal_entity_id: legalEntityId, ...form }));
      setForm((current) => ({ ...current, legal_name: '', trade_name: '', tax_id: '' }));
      setNotice({ type: 'success', text: 'Cadastro unificado criado com trilha de auditoria.' });
      await loadParties();
      await openDetail(data.party);
    } catch (error) {
      setNotice({ type: 'error', text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const addContact = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await base44.functions.invoke('manage_business_parties', { action: 'add_contact', party_id: selected.id, legal_entity_id: legalEntityId, ...contact });
      setContact((current) => ({ ...current, contact_name: '', value: '', reason: '' }));
      setNotice({ type: 'success', text: 'Contato adicionado.' });
      await openDetail(selected);
    } catch (error) { setNotice({ type: 'error', text: message(error) }); } finally { setBusy(false); }
  };

  const addAddress = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await base44.functions.invoke('manage_business_parties', { action: 'add_address', party_id: selected.id, legal_entity_id: legalEntityId, ...address });
      setAddress((current) => ({ ...current, postal_code: '', street: '', number: '', neighborhood: '', city: '', state: '', reason: '' }));
      setNotice({ type: 'success', text: 'Endereço adicionado.' });
      await openDetail(selected);
    } catch (error) { setNotice({ type: 'error', text: message(error) }); } finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <header><div className="mb-2 flex items-center gap-2 text-sm font-medium text-sky-300"><UserRoundCog className="h-4 w-4" /> Fonte canônica de clientes, fornecedores e parceiros</div><h1 className="text-3xl font-bold text-white">Cadastro unificado</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">Uma pessoa ou empresa pode assumir múltiplos papéis, contatos e endereços sem duplicação de CPF/CNPJ.</p></header>
    {notice ? <div className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'}`}>{notice.text}</div> : null}

    <section className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5 lg:grid-cols-[1fr_1.2fr_auto]">
      <select className={inputClass} value={legalEntityId} onChange={(event) => chooseCompany(event.target.value)}><option value="">Selecione o CNPJ</option>{scope.legal_entities.map((company) => <option key={company.id} value={company.id}>{company.trade_name}</option>)}</select>
      <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-white/30" /><input className={`${inputClass} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && loadParties()} placeholder="Nome, razão social ou documento" /></div>
      <button type="button" onClick={() => loadParties()} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"><RefreshCw className={`mr-2 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Atualizar</button>
    </section>

    {canManage ? <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="mb-4 flex items-center gap-2"><Plus className="h-5 w-5 text-sky-300" /><h2 className="font-semibold text-white">Nova pessoa ou empresa</h2></div><form onSubmit={createParty} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><select className={inputClass} value={form.party_type} onChange={(event) => setForm({ ...form, party_type: event.target.value })}><option value="company">Pessoa jurídica</option><option value="person">Pessoa física</option></select><input className={inputClass} value={form.legal_name} onChange={(event) => setForm({ ...form, legal_name: event.target.value })} placeholder="Razão social / nome" required /><input className={inputClass} value={form.trade_name} onChange={(event) => setForm({ ...form, trade_name: event.target.value })} placeholder="Nome fantasia" /><input className={inputClass} value={form.tax_id} onChange={(event) => setForm({ ...form, tax_id: event.target.value })} placeholder="CPF/CNPJ" required /><select className={inputClass} value={form.segment} onChange={(event) => setForm({ ...form, segment: event.target.value })}>{SEGMENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className={inputClass} value={form.role_type} onChange={(event) => setForm({ ...form, role_type: event.target.value })}>{ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className={inputClass} value={form.unit_id} onChange={(event) => setForm({ ...form, unit_id: event.target.value })}><option value="">Sem unidade padrão</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><button disabled={busy || !legalEntityId} className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-40 xl:col-start-4"><Plus className="mr-2 inline h-4 w-4" />Cadastrar</button></form></section> : null}

    <div className="grid gap-5 xl:grid-cols-[.9fr_1.4fr]">
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-semibold text-white">Cadastros no CNPJ</h2><p className="text-xs text-white/40">{parties.length} registro(s)</p></div>{parties.map((party) => <button type="button" key={party.id} onClick={() => openDetail(party)} className={`block w-full border-b border-white/8 px-5 py-4 text-left transition last:border-0 ${selected?.id === party.id ? 'bg-sky-400/10' : 'hover:bg-white/5'}`}><div className="flex items-center justify-between gap-3"><div><p className="font-medium text-white">{party.trade_name || party.legal_name}</p><p className="mt-1 text-xs text-white/40">{party.tax_id} · {party.segment}</p></div><span className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/45">{(roleMap[party.id] || []).join(', ') || 'sem papel'}</span></div></button>)}{!loading && !parties.length ? <p className="p-8 text-center text-sm text-white/35">Nenhum cadastro encontrado.</p> : null}</section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">{selected && detail ? <div className="space-y-6"><div><h2 className="text-xl font-semibold text-white">{selected.trade_name || selected.legal_name}</h2><p className="mt-1 text-sm text-white/45">{selected.legal_name} · risco {selected.risk_rating}</p></div><div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-white/10 bg-black/10 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-medium text-white"><Phone className="h-4 w-4 text-sky-300" />Contatos</div>{detail.contacts?.map((item) => <p key={item.id} className="mb-2 text-sm text-white/55">{item.contact_type}: {item.value}</p>)}{!detail.contacts?.length ? <p className="text-sm text-white/30">Sem contatos.</p> : null}</div><div className="rounded-xl border border-white/10 bg-black/10 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-medium text-white"><MapPin className="h-4 w-4 text-sky-300" />Endereços</div>{detail.addresses?.map((item) => <p key={item.id} className="mb-2 text-sm text-white/55">{item.address_type}: {item.street}, {item.number} — {item.city}/{item.state}</p>)}{!detail.addresses?.length ? <p className="text-sm text-white/30">Sem endereços.</p> : null}</div></div>
        {canManage ? <div className="grid gap-4 lg:grid-cols-2"><form onSubmit={addContact} className="space-y-3 rounded-xl border border-white/10 p-4"><h3 className="text-sm font-semibold text-white">Adicionar contato</h3><div className="grid grid-cols-2 gap-2"><select className={inputClass} value={contact.contact_type} onChange={(event) => setContact({ ...contact, contact_type: event.target.value })}><option value="whatsapp">WhatsApp</option><option value="mobile">Celular</option><option value="phone">Telefone</option><option value="email">E-mail</option></select><input className={inputClass} value={contact.contact_name} onChange={(event) => setContact({ ...contact, contact_name: event.target.value })} placeholder="Nome" /></div><input className={inputClass} value={contact.value} onChange={(event) => setContact({ ...contact, value: event.target.value })} placeholder="Contato" required /><button disabled={busy} className="w-full rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white">Adicionar contato</button></form><form onSubmit={addAddress} className="space-y-3 rounded-xl border border-white/10 p-4"><h3 className="text-sm font-semibold text-white">Adicionar endereço</h3><div className="grid grid-cols-2 gap-2"><select className={inputClass} value={address.address_type} onChange={(event) => setAddress({ ...address, address_type: event.target.value })}><option value="operational">Operacional</option><option value="billing">Cobrança</option><option value="pickup">Coleta</option><option value="delivery">Entrega</option><option value="fiscal">Fiscal</option></select><input className={inputClass} value={address.postal_code} onChange={(event) => setAddress({ ...address, postal_code: event.target.value })} placeholder="CEP" /></div><input className={inputClass} value={address.street} onChange={(event) => setAddress({ ...address, street: event.target.value })} placeholder="Rua" required /><div className="grid grid-cols-3 gap-2"><input className={inputClass} value={address.number} onChange={(event) => setAddress({ ...address, number: event.target.value })} placeholder="Nº" required /><input className={`${inputClass} col-span-2`} value={address.neighborhood} onChange={(event) => setAddress({ ...address, neighborhood: event.target.value })} placeholder="Bairro" /></div><div className="grid grid-cols-[1fr_70px] gap-2"><input className={inputClass} value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} placeholder="Cidade" required /><input className={inputClass} value={address.state} maxLength={2} onChange={(event) => setAddress({ ...address, state: event.target.value.toUpperCase() })} placeholder="UF" required /></div><button disabled={busy} className="w-full rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white">Adicionar endereço</button></form></div> : null}
      </div> : <div className="flex min-h-80 flex-col items-center justify-center text-center"><Building2 className="mb-3 h-10 w-10 text-white/15" /><p className="text-sm text-white/40">Selecione um cadastro para ver contatos, endereços, contratos e oportunidades.</p></div>}</section>
    </div>
  </div>;
}