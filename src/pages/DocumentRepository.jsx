import React, { useEffect, useMemo, useState } from 'react';
import { Archive, FileCheck2, FileLock2, Filter, RefreshCw, UploadCloud } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { uploadSecureFile } from '@/lib/secureFiles';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/accessControl';

const TYPES = [
  ['corporate_document', 'Documento societário'], ['contract', 'Contrato'], ['contract_addendum', 'Aditivo'],
  ['purchase_invoice', 'Nota de compra'], ['service_invoice', 'Nota de serviço'], ['tax_document', 'Documento fiscal'],
  ['bank_document', 'Documento bancário'], ['payment_receipt', 'Comprovante'], ['employee_document', 'Documento de colaborador'],
  ['hospital_document', 'Documento hospitalar'], ['linen_liability_term', 'Termo de enxoval'], ['cleaning_evidence', 'Evidência de limpeza'],
  ['migration_source', 'Fonte de migração'], ['other', 'Outro'],
];
const inputClass = 'w-full rounded-xl border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-sky-400/60';

function unwrap(response) { return response?.data || response || {}; }
function err(error) { return error?.response?.data?.error || error?.data?.error || error?.message || 'Falha na operação documental.'; }
function labelOf(value) { return TYPES.find(([id]) => id === value)?.[1] || value; }

export default function DocumentRepository() {
  const { user } = useAuth();
  const canManage = hasPermission(user, 'documents.manage');
  const [scope, setScope] = useState({ legal_entities: [], units: [] });
  const [assets, setAssets] = useState([]);
  const [filters, setFilters] = useState({ legal_entity_id: '', unit_id: '', document_type: '', status: 'active' });
  const [form, setForm] = useState({ legal_entity_id: '', unit_id: '', document_type: 'corporate_document', classification: 'internal', reason: '' });
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [retire, setRetire] = useState({ asset_id: '', reason: '' });

  const filteredUnits = useMemo(() => scope.units.filter((unit) => !form.legal_entity_id || unit.legal_entity_id === form.legal_entity_id), [scope.units, form.legal_entity_id]);
  const filterUnits = useMemo(() => scope.units.filter((unit) => !filters.legal_entity_id || unit.legal_entity_id === filters.legal_entity_id), [scope.units, filters.legal_entity_id]);

  const loadScope = async () => {
    const overview = unwrap(await base44.functions.invoke('manage_enterprise_core', { action: 'overview' }));
    setScope(overview);
    const firstCompany = overview.legal_entities?.[0]?.id || '';
    const firstUnit = overview.units?.find((unit) => unit.legal_entity_id === firstCompany)?.id || '';
    setForm((current) => ({ ...current, legal_entity_id: current.legal_entity_id || firstCompany, unit_id: current.unit_id || firstUnit }));
  };

  const loadAssets = async (nextFilters = filters) => {
    setLoading(true);
    setNotice(null);
    try {
      const response = unwrap(await base44.functions.invoke('manage_document_assets', { action: 'list', ...nextFilters }));
      setAssets(response.assets || []);
    } catch (error) {
      setNotice({ type: 'error', text: err(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([loadScope(), loadAssets()]).catch((error) => setNotice({ type: 'error', text: err(error) }));
  }, []);

  const upload = async (event) => {
    event.preventDefault();
    if (!file) return setNotice({ type: 'error', text: 'Selecione um arquivo.' });
    setBusy(true);
    setNotice(null);
    try {
      await uploadSecureFile({
        file,
        documentType: form.document_type,
        unitId: form.unit_id,
        legalEntityId: form.legal_entity_id,
        classification: form.classification,
        reason: form.reason,
        metadata: { source: 'document_repository' },
      });
      setFile(null);
      setForm((current) => ({ ...current, reason: '' }));
      setNotice({ type: 'success', text: 'Documento armazenado e registrado para validação.' });
      await loadAssets({ ...filters, legal_entity_id: filters.legal_entity_id || form.legal_entity_id });
    } catch (error) {
      setNotice({ type: 'error', text: err(error) });
    } finally {
      setBusy(false);
    }
  };

  const retireAsset = async () => {
    if (retire.reason.trim().length < 8) return setNotice({ type: 'error', text: 'Informe uma justificativa de pelo menos 8 caracteres.' });
    setBusy(true);
    try {
      await base44.functions.invoke('manage_document_assets', { action: 'retire', asset_id: retire.asset_id, reason: retire.reason });
      setRetire({ asset_id: '', reason: '' });
      setNotice({ type: 'success', text: 'Documento aposentado sem exclusão física.' });
      await loadAssets();
    } catch (error) {
      setNotice({ type: 'error', text: err(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-sky-300"><FileLock2 className="h-4 w-4" /> Documentos privados por empresa</div>
        <h1 className="text-3xl font-bold text-white">Central de documentos</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">Organize contratos, notas, comprovantes e evidências com hash, classificação, retenção e trilha de auditoria. Arquivos não são excluídos fisicamente pela interface.</p>
      </header>

      {notice ? <div className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'}`}>{notice.text}</div> : null}

      {canManage ? <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-sky-400/10 p-2.5 text-sky-300"><UploadCloud className="h-5 w-5" /></div><div><h2 className="font-semibold text-white">Novo documento</h2><p className="text-sm text-white/45">O registro permanece pendente de validação até a conferência ou processamento do módulo responsável.</p></div></div>
        <form onSubmit={upload} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1.5"><span className="text-xs uppercase tracking-wide text-white/45">CNPJ</span><select className={inputClass} value={form.legal_entity_id} onChange={(event) => { const legalEntityId = event.target.value; setForm((current) => ({ ...current, legal_entity_id: legalEntityId, unit_id: scope.units.find((unit) => unit.legal_entity_id === legalEntityId)?.id || '' })); }} required><option value="">Selecione</option>{scope.legal_entities?.map((company) => <option key={company.id} value={company.id}>{company.trade_name}</option>)}</select></label>
          <label className="space-y-1.5"><span className="text-xs uppercase tracking-wide text-white/45">Unidade</span><select className={inputClass} value={form.unit_id} onChange={(event) => setForm((current) => ({ ...current, unit_id: event.target.value }))} required><option value="">Selecione</option>{filteredUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          <label className="space-y-1.5"><span className="text-xs uppercase tracking-wide text-white/45">Tipo</span><select className={inputClass} value={form.document_type} onChange={(event) => setForm((current) => ({ ...current, document_type: event.target.value }))}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="space-y-1.5"><span className="text-xs uppercase tracking-wide text-white/45">Classificação</span><select className={inputClass} value={form.classification} onChange={(event) => setForm((current) => ({ ...current, classification: event.target.value }))}><option value="internal">Interno</option><option value="confidential">Confidencial</option><option value="restricted">Restrito</option><option value="public">Público</option></select></label>
          <label className="space-y-1.5 md:col-span-2"><span className="text-xs uppercase tracking-wide text-white/45">Arquivo</span><input type="file" className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500/15 file:px-3 file:py-1 file:text-xs file:text-sky-200`} onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label>
          <label className="space-y-1.5"><span className="text-xs uppercase tracking-wide text-white/45">Justificativa</span><input className={inputClass} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} minLength={8} placeholder="Motivo do armazenamento" required /></label>
          <button disabled={busy} className="self-end rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-40"><UploadCloud className="mr-2 inline h-4 w-4" />Enviar com segurança</button>
        </form>
      </section> : null}

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-3"><Filter className="h-5 w-5 text-sky-300" /><div><h2 className="font-semibold text-white">Acervo no seu escopo</h2><p className="text-xs text-white/40">{assets.length} documento(s) retornado(s)</p></div></div><button type="button" onClick={() => loadAssets()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60 hover:bg-white/10"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Atualizar</button></div>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <select className={inputClass} value={filters.legal_entity_id} onChange={(event) => { const next = { ...filters, legal_entity_id: event.target.value, unit_id: '' }; setFilters(next); loadAssets(next); }}><option value="">Todos os CNPJs</option>{scope.legal_entities?.map((company) => <option key={company.id} value={company.id}>{company.trade_name}</option>)}</select>
          <select className={inputClass} value={filters.unit_id} onChange={(event) => { const next = { ...filters, unit_id: event.target.value }; setFilters(next); loadAssets(next); }}><option value="">Todas as unidades</option>{filterUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>
          <select className={inputClass} value={filters.document_type} onChange={(event) => { const next = { ...filters, document_type: event.target.value }; setFilters(next); loadAssets(next); }}><option value="">Todos os tipos</option>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select className={inputClass} value={filters.status} onChange={(event) => { const next = { ...filters, status: event.target.value }; setFilters(next); loadAssets(next); }}><option value="active">Ativos</option><option value="quarantined">Quarentena</option><option value="retired">Aposentados</option><option value="">Todos</option></select>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/10">
          <div className="hidden grid-cols-[1.6fr_1fr_1fr_.7fr_auto] gap-3 bg-white/5 px-4 py-3 text-xs uppercase tracking-wide text-white/35 md:grid"><span>Documento</span><span>Tipo</span><span>Classificação</span><span>Validação</span><span>Ação</span></div>
          {assets.map((asset) => <div key={asset.id} className="grid gap-2 border-t border-white/8 px-4 py-3 first:border-t-0 md:grid-cols-[1.6fr_1fr_1fr_.7fr_auto] md:items-center md:gap-3"><div><p className="truncate text-sm font-medium text-white">{asset.original_filename || asset.safe_filename || asset.id}</p><p className="mt-1 text-xs text-white/35">{Math.max(1, Math.round(Number(asset.size_bytes || 0) / 1024))} KB · retenção {asset.retention_class || 'standard'}</p></div><span className="text-sm text-white/60">{labelOf(asset.document_type)}</span><span className="text-sm text-white/60">{asset.classification || 'internal'}</span><span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/55"><FileCheck2 className="h-3.5 w-3.5" />{asset.validation_status || 'pending'}</span>{canManage && (asset.status || 'active') !== 'retired' ? <button type="button" onClick={() => setRetire({ asset_id: asset.id, reason: '' })} className="inline-flex items-center gap-1.5 text-xs text-amber-200 hover:text-amber-100"><Archive className="h-3.5 w-3.5" />Aposentar</button> : <span className="text-xs text-white/30">{asset.status || 'active'}</span>}</div>)}
          {!loading && !assets.length ? <div className="px-4 py-12 text-center text-sm text-white/40">Nenhum documento encontrado para os filtros atuais.</div> : null}
        </div>
      </section>

      {retire.asset_id ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#17364F] p-5 shadow-2xl"><h3 className="font-semibold text-white">Aposentar documento</h3><p className="mt-2 text-sm text-white/50">O arquivo será preservado para auditoria e retenção.</p><textarea className={`${inputClass} mt-4 min-h-24`} value={retire.reason} onChange={(event) => setRetire((current) => ({ ...current, reason: event.target.value }))} placeholder="Justificativa obrigatória" /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setRetire({ asset_id: '', reason: '' })} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/60">Cancelar</button><button type="button" disabled={busy} onClick={retireAsset} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Confirmar aposentadoria</button></div></div></div> : null}
    </div>
  );
}
