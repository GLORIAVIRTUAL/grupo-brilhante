import React, { useEffect, useMemo, useState } from 'react';
import { FileCheck2, RefreshCw, ShieldAlert } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import FiscalReadinessPanel from '@/components/management/FiscalReadinessPanel';

function unwrap(response) { return response?.data || response || {}; }
function errorMessage(error) { return error?.response?.data?.error || error?.data?.error || error?.message || 'Falha ao carregar o fiscal empresarial.'; }
const inputClass = 'rounded-xl border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400/60';

export default function EnterpriseFiscal() {
  const [enterprise, setEnterprise] = useState({ legal_entities: [], units: [] });
  const [companyId, setCompanyId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [data, setData] = useState({ profiles: [], documents: [], events: [], jobs: [], orders: [], statements: [] });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const units = useMemo(() => enterprise.units.filter((unit) => unit.legal_entity_id === companyId), [enterprise.units, companyId]);
  const company = enterprise.legal_entities.find((item) => item.id === companyId);
  const profile = data.profiles.find((item) => item.legal_entity_id === companyId);
  const pendingJobs = data.jobs.filter((item) => ['pending', 'processing', 'retry_scheduled', 'repair_required'].includes(item.status));

  const loadFiscal = async (legalEntityId = companyId) => {
    if (!legalEntityId) return;
    setBusy(true);
    try { setData(unwrap(await base44.functions.invoke('manage_fiscal_document', { action: 'overview', legal_entity_id: legalEntityId }))); setNotice(null); }
    catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  useEffect(() => { (async () => { setBusy(true); try { const scope = unwrap(await base44.functions.invoke('manage_enterprise_core', { action: 'overview' })); setEnterprise(scope); const initialCompany = scope.legal_entities?.[0]?.id || ''; const initialUnit = scope.units?.find((item) => item.legal_entity_id === initialCompany)?.id || ''; setCompanyId(initialCompany); setUnitId(initialUnit); if (initialCompany) setData(unwrap(await base44.functions.invoke('manage_fiscal_document', { action: 'overview', legal_entity_id: initialCompany }))); } catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); } finally { setBusy(false); } })(); }, []);

  return <div className="space-y-6">
    <header><div className="mb-2 flex items-center gap-2 text-sm font-medium text-sky-300"><FileCheck2 className="h-4 w-4" /> Fiscal empresarial</div><h1 className="text-3xl font-bold text-white">RPS e NFS-e por CNPJ</h1><p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">Perfis fiscais, sequência de RPS, filas Focus NFe e eventos assíncronos segregados pela empresa legal.</p></header>
    {notice ? <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{notice.text}</div> : null}
    <section className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 md:grid-cols-[1fr_1fr_auto]"><select className={inputClass} value={companyId} onChange={(event) => { const id = event.target.value; setCompanyId(id); const initialUnit = enterprise.units.find((item) => item.legal_entity_id === id)?.id || ''; setUnitId(initialUnit); loadFiscal(id); }}><option value="">Selecione o CNPJ</option>{enterprise.legal_entities.map((item) => <option key={item.id} value={item.id}>{item.trade_name || item.legal_name}</option>)}</select><select className={inputClass} value={unitId} onChange={(event) => setUnitId(event.target.value)}><option value="">Selecione a unidade</option>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" onClick={() => loadFiscal()} disabled={busy} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/65"><RefreshCw className={`mr-2 inline h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</button></section>
    <section className="grid gap-3 md:grid-cols-4">{[
      ['CNPJ', company?.tax_id ? `••••${String(company.tax_id).replace(/\D/g, '').slice(-4)}` : 'não selecionado'],
      ['Ambiente', profile?.environment || 'disabled'],
      ['Chamadas externas', profile?.external_requests_enabled ? 'habilitadas no perfil' : 'bloqueadas'],
      ['Jobs pendentes', pendingJobs.length],
    ].map(([label, value]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs uppercase tracking-wide text-white/35">{label}</p><p className="mt-2 text-lg font-semibold text-white">{value}</p></div>)}</section>
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100"><ShieldAlert className="mr-2 inline h-4 w-4" />Esta tela não ativa produção. Habilitação externa exige perfil completo, MFA, webhook configurado, homologação aprovada e gates no ambiente.</div>
    {unitId ? <FiscalReadinessPanel profiles={data.profiles} documents={data.documents} orders={data.orders} statements={data.statements} selectedUnitId={unitId} defaultUnitId={unitId} onRefresh={() => loadFiscal()} /> : <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-white/40">Cadastre e selecione um CNPJ e uma unidade antes de configurar o fiscal.</div>}
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="font-semibold text-white">Fila e reparos</h2><div className="mt-3 space-y-2">{pendingJobs.slice(0, 100).map((job) => <div key={job.id} className="flex flex-col justify-between gap-2 rounded-xl border border-white/8 bg-black/10 p-3 sm:flex-row"><div><p className="text-sm text-white">{job.operation}</p><p className="text-xs text-white/35">{job.entity_id}</p></div><span className={`text-xs ${job.status === 'repair_required' ? 'text-red-300' : 'text-amber-200'}`}>{job.status} · tentativa {job.attempt_count || 0}/{job.max_attempts || 5}</span></div>)}{!pendingJobs.length ? <p className="text-sm text-white/35">Nenhum job fiscal pendente.</p> : null}</div></section>
  </div>;
}
