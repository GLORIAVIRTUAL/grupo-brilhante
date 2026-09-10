import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Landmark,
  MapPin,
  Network,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Warehouse,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/accessControl';
import ImplementationStageForm from '@/components/enterprise/ImplementationStageForm';

const EMPTY = {
  group: { name: '', trade_name: '', code: '', reason: '' },
  company: { group_id: '', legal_name: '', trade_name: '', tax_id: '', code: '', tax_regime: 'simples_nacional', reason: '' },
  unit: { name: '', code: '', subdomain: '', owner_email: '', unit_type: 'branch', reason: '' },
  costCenter: { name: '', code: '', cost_center_type: 'administrative', reason: '' },
  warehouse: { name: '', code: '', warehouse_type: 'central', reason: '' },
  bank: { name: '', code: '', bank_code: '001', bank_name: 'Banco do Brasil', account_type: 'checking', branch_masked: '', account_masked: '', reason: '' },
  linkUnit: { unit_id: '', code: '', unit_type: 'branch', reason: '' },
};

function unwrap(response) {
  return response?.data || response || {};
}

function errorMessage(error) {
  return error?.response?.data?.error || error?.data?.error || error?.message || 'Não foi possível concluir a operação.';
}

function Field({ label, children, hint = null }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-white/55">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-white/35">{hint}</span> : null}
    </label>
  );
}

const inputClass = 'w-full rounded-xl border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-sky-400/60 focus:bg-black/25';

function ActionButton({ children, disabled }) {
  return (
    <button type="submit" disabled={disabled} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40">
      {children}
    </button>
  );
}

function Section({ icon: Icon, title, description, children }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-xl shadow-black/10">
      <div className="mb-5 flex items-start gap-3">
        <div className="rounded-xl bg-sky-400/10 p-2.5 text-sky-300"><Icon className="h-5 w-5" /></div>
        <div>
          <h2 className="font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-white/50">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatusPill({ value }) {
  const tone = value === 'active' || value === 'live' ? 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20' : value === 'draft' || value === 'not_started' ? 'bg-amber-400/10 text-amber-200 border-amber-400/20' : 'bg-white/5 text-white/60 border-white/10';
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}>{String(value || 'não informado').replaceAll('_', ' ')}</span>;
}

export default function EnterpriseStructure() {
  const { user } = useAuth();
  const [data, setData] = useState({ groups: [], legal_entities: [], units: [], unlinked_units: [], cost_centers: [], bank_accounts: [], warehouses: [], company_grants: [], scope: {} });
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [forms, setForms] = useState(EMPTY);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  const canManage = hasPermission(user, 'companies.manage');
  const selectedCompany = useMemo(() => data.legal_entities.find((item) => item.id === selectedCompanyId) || null, [data.legal_entities, selectedCompanyId]);
  const companyUnits = useMemo(() => data.units.filter((item) => item.legal_entity_id === selectedCompanyId), [data.units, selectedCompanyId]);
  const companyCostCenters = useMemo(() => data.cost_centers.filter((item) => item.legal_entity_id === selectedCompanyId), [data.cost_centers, selectedCompanyId]);
  const companyWarehouses = useMemo(() => data.warehouses.filter((item) => item.legal_entity_id === selectedCompanyId), [data.warehouses, selectedCompanyId]);
  const companyBanks = useMemo(() => data.bank_accounts.filter((item) => item.legal_entity_id === selectedCompanyId), [data.bank_accounts, selectedCompanyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const response = await base44.functions.invoke('manage_enterprise_core', { action: 'overview' });
      const next = unwrap(response);
      setData((current) => ({ ...current, ...next }));
      setSelectedCompanyId((current) => current || next.legal_entities?.[0]?.id || '');
      if (!forms.company.group_id && next.groups?.[0]?.id) setForms((current) => ({ ...current, company: { ...current.company, group_id: next.groups[0].id } }));
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [forms.company.group_id]);

  useEffect(() => { load(); }, []);

  const patchForm = (name, patch) => setForms((current) => ({ ...current, [name]: { ...current[name], ...patch } }));

  const run = async (key, payload, onSuccess) => {
    setBusy(key);
    setNotice(null);
    try {
      const response = unwrap(await base44.functions.invoke('manage_enterprise_core', payload));
      if (onSuccess) onSuccess(response);
      await load();
      setNotice({ type: 'success', text: 'Operação registrada e auditada com sucesso.' });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy('');
    }
  };

  const createUnit = async (event) => {
    event.preventDefault();
    setBusy('unit');
    setNotice(null);
    try {
      await base44.functions.invoke('manage_unit', { action: 'create', legal_entity_id: selectedCompanyId, ...forms.unit });
      patchForm('unit', EMPTY.unit);
      await load();
      setNotice({ type: 'success', text: 'Unidade criada como pendente e vinculada à empresa.' });
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-sky-300"><ShieldCheck className="h-4 w-4" /> Núcleo empresarial auditado</div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Estrutura do Grupo Brilhante</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">Organize grupo econômico, CNPJs, unidades, centros de custo, depósitos e contas bancárias antes de ativar módulos financeiros, fiscais ou operacionais.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/70 hover:bg-white/10 disabled:opacity-40">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </header>

      {notice ? <div className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'}`}>{notice.text}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'CNPJs no escopo', value: data.legal_entities.length, Icon: Building2 },
          { label: 'Unidades vinculadas', value: data.units.length, Icon: MapPin },
          { label: 'Centros de custo', value: data.cost_centers.length, Icon: Network },
          { label: 'Depósitos', value: data.warehouses.length, Icon: Warehouse },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-4">
            <Icon className="mb-3 h-5 w-5 text-sky-300" />
            <div className="text-2xl font-semibold text-white">{value}</div>
            <div className="mt-1 text-xs text-white/45">{label}</div>
          </div>
        ))}
      </div>

      {canManage ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Section icon={Network} title="1. Grupo econômico" description="Crie a raiz organizacional antes dos CNPJs.">
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); run('group', { action: 'create_group', ...forms.group }, () => patchForm('group', EMPTY.group)); }}>
              <Field label="Nome"><input className={inputClass} value={forms.group.name} onChange={(event) => patchForm('group', { name: event.target.value })} required /></Field>
              <Field label="Código"><input className={inputClass} value={forms.group.code} onChange={(event) => patchForm('group', { code: event.target.value })} placeholder="GRUPO-BRILHANTE" /></Field>
              <Field label="Nome de exibição"><input className={inputClass} value={forms.group.trade_name} onChange={(event) => patchForm('group', { trade_name: event.target.value })} /></Field>
              <Field label="Justificativa"><input className={inputClass} value={forms.group.reason} onChange={(event) => patchForm('group', { reason: event.target.value })} minLength={8} required /></Field>
              <div className="sm:col-span-2"><ActionButton disabled={busy === 'group'}><Plus className="h-4 w-4" /> Criar grupo</ActionButton></div>
            </form>
            <div className="mt-4 space-y-2">{data.groups.map((group) => <div key={group.id} className="flex items-center justify-between rounded-xl border border-white/8 bg-black/10 px-3 py-2"><div><p className="text-sm font-medium text-white">{group.name}</p><p className="text-xs text-white/35">{group.code}</p></div><StatusPill value={group.status} /></div>)}</div>
          </Section>

          <Section icon={Building2} title="2. Empresa legal" description="Cada CNPJ mantém regime, endereço, banco e fiscal próprios.">
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); run('company', { action: 'create_legal_entity', ...forms.company }, (response) => { patchForm('company', { ...EMPTY.company, group_id: forms.company.group_id }); setSelectedCompanyId(response.legal_entity?.id || ''); }); }}>
              <Field label="Grupo"><select className={inputClass} value={forms.company.group_id} onChange={(event) => patchForm('company', { group_id: event.target.value })} required><option value="">Selecione</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
              <Field label="CNPJ"><input className={inputClass} value={forms.company.tax_id} onChange={(event) => patchForm('company', { tax_id: event.target.value })} placeholder="00.000.000/0000-00" required /></Field>
              <Field label="Razão social"><input className={inputClass} value={forms.company.legal_name} onChange={(event) => patchForm('company', { legal_name: event.target.value })} required /></Field>
              <Field label="Nome fantasia"><input className={inputClass} value={forms.company.trade_name} onChange={(event) => patchForm('company', { trade_name: event.target.value })} required /></Field>
              <Field label="Código"><input className={inputClass} value={forms.company.code} onChange={(event) => patchForm('company', { code: event.target.value })} /></Field>
              <Field label="Regime tributário"><select className={inputClass} value={forms.company.tax_regime} onChange={(event) => patchForm('company', { tax_regime: event.target.value })}><option value="simples_nacional">Simples Nacional</option><option value="lucro_presumido">Lucro Presumido</option><option value="lucro_real">Lucro Real</option><option value="other">Outro</option></select></Field>
              <Field label="Justificativa"><input className={inputClass} value={forms.company.reason} onChange={(event) => patchForm('company', { reason: event.target.value })} minLength={8} required /></Field>
              <div className="self-end"><ActionButton disabled={busy === 'company' || !data.groups.length}><Plus className="h-4 w-4" /> Criar empresa</ActionButton></div>
            </form>
          </Section>
        </div>
      ) : null}

      <Section icon={Building2} title="Empresas no seu escopo" description="Selecione um CNPJ para administrar sua estrutura operacional.">
        {data.legal_entities.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.legal_entities.map((company) => <button key={company.id} type="button" onClick={() => setSelectedCompanyId(company.id)} className={`rounded-2xl border p-4 text-left transition ${selectedCompanyId === company.id ? 'border-sky-400/50 bg-sky-400/10' : 'border-white/10 bg-black/10 hover:bg-white/5'}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-white">{company.trade_name}</p><p className="mt-1 text-xs text-white/40">{company.legal_name}</p><p className="mt-2 text-xs font-mono text-white/55">{company.tax_id}</p></div><StatusPill value={company.implementation_status} /></div></button>)}</div> : <p className="text-sm text-white/45">Nenhuma empresa legal cadastrada no seu escopo.</p>}
      </Section>

      {selectedCompany ? (
        <>
          <div className="rounded-2xl border border-sky-400/20 bg-gradient-to-r from-sky-400/10 to-transparent p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-sky-300">CNPJ selecionado</p><h2 className="mt-1 text-xl font-semibold text-white">{selectedCompany.trade_name}</h2><p className="text-sm text-white/45">{selectedCompany.code} · {selectedCompany.tax_id}</p></div><div className="flex gap-2"><StatusPill value={selectedCompany.status} /><StatusPill value={selectedCompany.implementation_status} /></div></div>
          </div>

          {canManage ? <Section icon={ShieldCheck} title="Etapa de implantação" description="As empresas já estão ativas; avance aqui o estágio de implantação do CNPJ selecionado.">
            <ImplementationStageForm
              key={selectedCompany.id + selectedCompany.implementation_status}
              company={selectedCompany}
              busy={busy === 'stage'}
              onSubmit={(patch) => run('stage', { action: 'update_legal_entity', id: selectedCompany.id, ...patch })}
            />
          </Section> : null}

          {canManage ? <div className="grid gap-6 xl:grid-cols-2">
            <Section icon={MapPin} title="Unidades" description="Crie unidades já vinculadas ao CNPJ selecionado.">
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={createUnit}>
                <Field label="Nome"><input className={inputClass} value={forms.unit.name} onChange={(event) => patchForm('unit', { name: event.target.value })} required /></Field>
                <Field label="Código"><input className={inputClass} value={forms.unit.code} onChange={(event) => patchForm('unit', { code: event.target.value })} /></Field>
                <Field label="Subdomínio"><input className={inputClass} value={forms.unit.subdomain} onChange={(event) => patchForm('unit', { subdomain: event.target.value })} required /></Field>
                <Field label="E-mail responsável"><input type="email" className={inputClass} value={forms.unit.owner_email} onChange={(event) => patchForm('unit', { owner_email: event.target.value })} required /></Field>
                <Field label="Tipo"><select className={inputClass} value={forms.unit.unit_type} onChange={(event) => patchForm('unit', { unit_type: event.target.value })}><option value="headquarters">Matriz</option><option value="branch">Filial</option><option value="industrial_plant">Planta industrial</option><option value="service_hub">Hub de serviços</option><option value="warehouse">Depósito</option></select></Field>
                <Field label="Justificativa"><input className={inputClass} value={forms.unit.reason} onChange={(event) => patchForm('unit', { reason: event.target.value })} minLength={8} required /></Field>
                <div className="sm:col-span-2"><ActionButton disabled={busy === 'unit'}><Plus className="h-4 w-4" /> Criar unidade pendente</ActionButton></div>
              </form>
              <div className="mt-4 space-y-2">{companyUnits.map((unit) => <div key={unit.id} className="flex items-center justify-between rounded-xl border border-white/8 bg-black/10 px-3 py-2"><div><p className="text-sm font-medium text-white">{unit.name}</p><p className="text-xs text-white/35">{unit.code || 'sem código'} · {unit.unit_type || 'unidade'}</p></div><StatusPill value={unit.status} /></div>)}</div>
            </Section>

            <Section icon={Network} title="Centros de custo" description="Classifique custos por operação, unidade ou contrato.">
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); run('costCenter', { action: 'save_cost_center', legal_entity_id: selectedCompanyId, ...forms.costCenter }, () => patchForm('costCenter', EMPTY.costCenter)); }}>
                <Field label="Nome"><input className={inputClass} value={forms.costCenter.name} onChange={(event) => patchForm('costCenter', { name: event.target.value })} required /></Field>
                <Field label="Código"><input className={inputClass} value={forms.costCenter.code} onChange={(event) => patchForm('costCenter', { code: event.target.value })} /></Field>
                <Field label="Tipo"><select className={inputClass} value={forms.costCenter.cost_center_type} onChange={(event) => patchForm('costCenter', { cost_center_type: event.target.value })}><option value="administrative">Administrativo</option><option value="commercial">Comercial</option><option value="production">Produção</option><option value="logistics">Logística</option><option value="hospital">Hospitalar</option><option value="linen">Enxovais</option><option value="cleaning">Limpeza</option><option value="shared">Compartilhado</option></select></Field>
                <Field label="Justificativa"><input className={inputClass} value={forms.costCenter.reason} onChange={(event) => patchForm('costCenter', { reason: event.target.value })} minLength={8} required /></Field>
                <div className="sm:col-span-2"><ActionButton disabled={busy === 'costCenter'}><Save className="h-4 w-4" /> Salvar centro</ActionButton></div>
              </form>
              <div className="mt-4 flex flex-wrap gap-2">{companyCostCenters.map((item) => <span key={item.id} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/65">{item.code} · {item.name}</span>)}</div>
            </Section>

            <Section icon={Warehouse} title="Depósitos" description="Defina depósitos centrais, industriais, de enxoval ou quarentena.">
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); run('warehouse', { action: 'save_warehouse', legal_entity_id: selectedCompanyId, ...forms.warehouse }, () => patchForm('warehouse', EMPTY.warehouse)); }}>
                <Field label="Nome"><input className={inputClass} value={forms.warehouse.name} onChange={(event) => patchForm('warehouse', { name: event.target.value })} required /></Field>
                <Field label="Código"><input className={inputClass} value={forms.warehouse.code} onChange={(event) => patchForm('warehouse', { code: event.target.value })} /></Field>
                <Field label="Tipo"><select className={inputClass} value={forms.warehouse.warehouse_type} onChange={(event) => patchForm('warehouse', { warehouse_type: event.target.value })}><option value="central">Central</option><option value="production">Produção</option><option value="consumables">Insumos</option><option value="linen">Enxovais</option><option value="quarantine">Quarentena</option><option value="third_party">Terceiro</option></select></Field>
                <Field label="Justificativa"><input className={inputClass} value={forms.warehouse.reason} onChange={(event) => patchForm('warehouse', { reason: event.target.value })} minLength={8} required /></Field>
                <div className="sm:col-span-2"><ActionButton disabled={busy === 'warehouse'}><Save className="h-4 w-4" /> Salvar depósito</ActionButton></div>
              </form>
              <div className="mt-4 flex flex-wrap gap-2">{companyWarehouses.map((item) => <span key={item.id} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/65">{item.code} · {item.name}</span>)}</div>
            </Section>

            <Section icon={Landmark} title="Contas bancárias" description="Cadastre somente dados mascarados; credenciais permanecem nos secrets do ambiente.">
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); run('bank', { action: 'save_bank_account', legal_entity_id: selectedCompanyId, integration_status: 'disabled', status: 'draft', ...forms.bank }, () => patchForm('bank', EMPTY.bank)); }}>
                <Field label="Nome"><input className={inputClass} value={forms.bank.name} onChange={(event) => patchForm('bank', { name: event.target.value })} placeholder="Conta corrente operacional" required /></Field>
                <Field label="Código interno"><input className={inputClass} value={forms.bank.code} onChange={(event) => patchForm('bank', { code: event.target.value })} /></Field>
                <Field label="Banco"><input className={inputClass} value={forms.bank.bank_name} onChange={(event) => patchForm('bank', { bank_name: event.target.value })} /></Field>
                <Field label="Código bancário"><input className={inputClass} value={forms.bank.bank_code} onChange={(event) => patchForm('bank', { bank_code: event.target.value })} /></Field>
                <Field label="Agência mascarada"><input className={inputClass} value={forms.bank.branch_masked} onChange={(event) => patchForm('bank', { branch_masked: event.target.value })} placeholder="****-X" /></Field>
                <Field label="Conta mascarada"><input className={inputClass} value={forms.bank.account_masked} onChange={(event) => patchForm('bank', { account_masked: event.target.value })} placeholder="*****-X" /></Field>
                <Field label="Justificativa"><input className={inputClass} value={forms.bank.reason} onChange={(event) => patchForm('bank', { reason: event.target.value })} minLength={8} required /></Field>
                <div className="self-end"><ActionButton disabled={busy === 'bank'}><Save className="h-4 w-4" /> Salvar conta desativada</ActionButton></div>
              </form>
              <div className="mt-4 space-y-2">{companyBanks.map((item) => <div key={item.id} className="flex items-center justify-between rounded-xl border border-white/8 bg-black/10 px-3 py-2"><div><p className="text-sm font-medium text-white">{item.name}</p><p className="text-xs text-white/35">{item.bank_code} · {item.branch_masked || 'agência protegida'} · {item.account_masked || 'conta protegida'}</p></div><StatusPill value={item.integration_status} /></div>)}</div>
            </Section>
          </div> : null}

          {canManage && data.unlinked_units.length ? <Section icon={MapPin} title="Vincular unidades legadas" description="Nenhuma unidade antiga é atribuída automaticamente ao primeiro CNPJ.">
            <form className="grid gap-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); run('linkUnit', { action: 'link_unit', legal_entity_id: selectedCompanyId, ...forms.linkUnit }, () => patchForm('linkUnit', EMPTY.linkUnit)); }}>
              <Field label="Unidade"><select className={inputClass} value={forms.linkUnit.unit_id} onChange={(event) => patchForm('linkUnit', { unit_id: event.target.value })} required><option value="">Selecione</option>{data.unlinked_units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></Field>
              <Field label="Código"><input className={inputClass} value={forms.linkUnit.code} onChange={(event) => patchForm('linkUnit', { code: event.target.value })} /></Field>
              <Field label="Justificativa"><input className={inputClass} value={forms.linkUnit.reason} onChange={(event) => patchForm('linkUnit', { reason: event.target.value })} minLength={8} required /></Field>
              <div className="self-end"><ActionButton disabled={busy === 'linkUnit'}><Save className="h-4 w-4" /> Vincular ao CNPJ</ActionButton></div>
            </form>
          </Section> : null}
        </>
      ) : null}
    </div>
  );
}