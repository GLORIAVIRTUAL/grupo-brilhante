import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, DatabaseZap, FileUp, PlayCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/accessControl';
import { uploadSecureFile } from '@/lib/secureFiles';

const inputClass = 'w-full rounded-xl border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-sky-400/60';
function unwrap(response) { return response?.data || response || {}; }
function errorMessage(error) { return error?.response?.data?.error || error?.data?.error || error?.message || 'Falha na migração.'; }
function normalizeFile(file) { const ext = file.name.split('.').pop()?.toLowerCase(); const type = file.type || (ext === 'csv' ? 'text/csv' : ext === 'json' ? 'application/json' : ext === 'xml' ? 'application/xml' : 'text/plain'); return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified }); }
function splitCsvLine(line, delimiter) { const values = []; let value = ''; let quoted = false; for (let i = 0; i < line.length; i += 1) { const char = line[i]; if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i += 1; } else if (char === '"') quoted = !quoted; else if (char === delimiter && !quoted) { values.push(value.trim()); value = ''; } else value += char; } values.push(value.trim()); return values; }
function parseSource(text, filename) { if (filename.toLowerCase().endsWith('.json')) { const parsed = JSON.parse(text); if (!Array.isArray(parsed)) throw new Error('O JSON deve conter uma lista de registros.'); return parsed; } const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()); if (lines.length < 2) throw new Error('O CSV precisa ter cabeçalho e ao menos um registro.'); const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ','; const headers = splitCsvLine(lines[0], delimiter).map((header) => header.trim()); return lines.slice(1).map((line) => Object.fromEntries(splitCsvLine(line, delimiter).map((value, index) => [headers[index] || `column_${index + 1}`, value]))); }

export default function ContaAzulMigration() {
  const { user } = useAuth();
  const canStage = hasPermission(user, 'migration.execute');
  const canApprove = hasPermission(user, 'migration.approve');
  const [scope, setScope] = useState({ legal_entities: [], units: [], bank_accounts: [] });
  const [companyId, setCompanyId] = useState('');
  const [parties, setParties] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [records, setRecords] = useState([]);
  const [executionEnabled, setExecutionEnabled] = useState(false);
  const [file, setFile] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionReason, setActionReason] = useState('');
  const [form, setForm] = useState({ batch_type: 'parties', unit_id: '', bank_account_id: '', default_business_party_id: '', reason: '' });
  const units = useMemo(() => scope.units.filter((unit) => unit.legal_entity_id === companyId), [scope.units, companyId]);
  const bankAccounts = useMemo(() => (scope.bank_accounts || []).filter((account) => account.legal_entity_id === companyId), [scope.bank_accounts, companyId]);

  const load = async (nextCompanyId = companyId) => {
    if (!nextCompanyId) return;
    setBusy(true);
    try {
      const [migration, partyResponse] = await Promise.all([
        base44.functions.invoke('manage_conta_azul_migration', { action: 'overview', legal_entity_id: nextCompanyId }),
        base44.functions.invoke('manage_business_parties', { action: 'overview', legal_entity_id: nextCompanyId }),
      ]);
      const data = unwrap(migration);
      setBatches(data.batches || []); setExecutionEnabled(data.execution_enabled === true); setParties(unwrap(partyResponse).parties || []);
    } catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); } finally { setBusy(false); }
  };

  useEffect(() => { (async () => { try { const enterprise = unwrap(await base44.functions.invoke('manage_enterprise_core', { action: 'overview' })); setScope(enterprise); const initial = enterprise.legal_entities?.[0]?.id || ''; setCompanyId(initial); setForm((current) => ({ ...current, unit_id: enterprise.units?.find((unit) => unit.legal_entity_id === initial)?.id || '' })); await load(initial); } catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); } })(); }, []);

  const openBatch = async (batch) => { setSelected(batch); try { const data = unwrap(await base44.functions.invoke('manage_conta_azul_migration', { action: 'detail', batch_id: batch.id })); setSelected(data.batch); setRecords(data.records || []); setExecutionEnabled(data.execution_enabled === true); } catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); } };

  const uploadAndStage = async (event) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setNotice(null);
    try {
      const safeFile = normalizeFile(file);
      const rows = parseSource(await safeFile.text(), safeFile.name);
      if (!rows.length || rows.length > 20000) throw new Error('O arquivo deve conter entre 1 e 20.000 registros.');
      const { asset } = await uploadSecureFile({ file: safeFile, documentType: 'migration_source', unitId: form.unit_id, legalEntityId: companyId, classification: 'restricted', retentionClass: 'financial', reason: form.reason, metadata: { source_system: 'conta_azul', batch_type: form.batch_type, record_count: rows.length } });
      const created = unwrap(await base44.functions.invoke('manage_conta_azul_migration', { action: 'create_batch', legal_entity_id: companyId, document_asset_id: asset.id, batch_type: form.batch_type, unit_id: form.unit_id, bank_account_id: form.bank_account_id || undefined, default_business_party_id: form.default_business_party_id || undefined, default_customer_id: form.default_business_party_id || undefined, reason: form.reason, idempotency_key: crypto.randomUUID() }));
      for (let index = 0; index < rows.length; index += 500) await base44.functions.invoke('manage_conta_azul_migration', { action: 'stage_records', batch_id: created.batch.id, records: rows.slice(index, index + 500), reason: `Staging autorizado: ${form.reason}` });
      setFile(null); setForm((current) => ({ ...current, reason: '' })); setNotice({ type: 'success', text: `${rows.length} registro(s) enviados para staging. Nenhum dado definitivo foi importado.` });
      await load(); await openBatch(created.batch);
    } catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); } finally { setBusy(false); }
  };

  const runAction = async (action, success) => {
    if (!selected) return;
    setBusy(true); setNotice(null);
    try { const data = unwrap(await base44.functions.invoke('manage_conta_azul_migration', { action, batch_id: selected.id, reason: actionReason })); setActionReason(''); setNotice({ type: 'success', text: success }); await load(); await openBatch(data.batch || selected); }
    catch (error) { setNotice({ type: 'error', text: errorMessage(error) }); } finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <header><div className="mb-2 flex items-center gap-2 text-sm font-medium text-sky-300"><DatabaseZap className="h-4 w-4" /> Migração controlada</div><h1 className="text-3xl font-bold text-white">Conta Azul: staging e dry-run</h1><p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">O arquivo é preservado no repositório documental, validado e reconciliado antes de qualquer importação definitiva. A execução permanece desativada até homologação explícita.</p></header>
    <div className={`rounded-xl border px-4 py-3 text-sm ${executionEnabled ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'}`}><ShieldAlert className="mr-2 inline h-4 w-4" />{executionEnabled ? 'A execução definitiva está habilitada no ambiente. Use somente após aprovação formal.' : 'Execução definitiva desabilitada. Staging e dry-run não criam lançamentos financeiros.'}</div>
    {notice ? <div className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'}`}>{notice.text}</div> : null}
    <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 md:flex-row"><select className={`${inputClass} md:max-w-sm`} value={companyId} onChange={(event) => { const id = event.target.value; setCompanyId(id); setSelected(null); setRecords([]); setForm((current) => ({ ...current, unit_id: scope.units.find((unit) => unit.legal_entity_id === id)?.id || '' })); load(id); }}><option value="">Selecione o CNPJ</option>{scope.legal_entities.map((company) => <option key={company.id} value={company.id}>{company.trade_name}</option>)}</select><button type="button" onClick={() => load()} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/65"><RefreshCw className={`mr-2 inline h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Atualizar</button></section>

    {canStage ? <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="mb-4 flex items-center gap-2"><FileUp className="h-5 w-5 text-sky-300" /><h2 className="font-semibold text-white">Novo lote de staging</h2></div><form onSubmit={uploadAndStage} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><select className={inputClass} value={form.batch_type} onChange={(event) => setForm({ ...form, batch_type: event.target.value })}><option value="parties">Pessoas e empresas</option><option value="accounts_payable">Contas a pagar</option><option value="accounts_receivable">Contas a receber</option><option value="bank_transactions">Transações bancárias</option></select><select className={inputClass} value={form.unit_id} onChange={(event) => setForm({ ...form, unit_id: event.target.value })} required><option value="">Unidade de destino</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>{form.batch_type === 'bank_transactions' ? <select className={inputClass} value={form.bank_account_id} onChange={(event) => setForm({ ...form, bank_account_id: event.target.value })} required><option value="">Conta bancária</option>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select> : <select className={inputClass} value={form.default_business_party_id} onChange={(event) => setForm({ ...form, default_business_party_id: event.target.value })}><option value="">Contraparte padrão opcional</option>{parties.map((party) => <option key={party.id} value={party.id}>{party.trade_name || party.legal_name}</option>)}</select>}<input className={inputClass} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} minLength={8} placeholder="Justificativa" required /><input type="file" accept=".csv,.json,.txt" onChange={(event) => setFile(event.target.files?.[0] || null)} className={`${inputClass} md:col-span-2 xl:col-span-3`} required /><button disabled={busy || !companyId} className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><FileUp className="mr-2 inline h-4 w-4" />Enviar ao staging</button></form></section> : null}

    <div className="grid gap-5 xl:grid-cols-[.8fr_1.5fr]">
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-semibold text-white">Lotes de migração</h2><p className="text-xs text-white/35">{batches.length} lote(s)</p></div>{batches.map((batch) => <button type="button" key={batch.id} onClick={() => openBatch(batch)} className={`block w-full border-b border-white/8 px-5 py-4 text-left last:border-0 ${selected?.id === batch.id ? 'bg-sky-400/10' : 'hover:bg-white/5'}`}><div className="flex justify-between gap-2"><p className="text-sm font-medium text-white">{batch.batch_type}</p><span className="text-xs text-sky-200">{batch.status}</span></div><p className="mt-2 text-xs text-white/35">{batch.total_records || 0} registros · {batch.error_records || 0} erros</p></button>)}</section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">{selected ? <div className="space-y-5"><div><p className="text-xs uppercase tracking-wide text-sky-300">Lote selecionado</p><h2 className="mt-1 text-xl font-semibold text-white">{selected.batch_type} · {selected.status}</h2><p className="mt-1 text-sm text-white/40">{selected.valid_records || 0} válidos, {selected.warning_records || 0} avisos e {selected.error_records || 0} erros.</p></div><input className={inputClass} value={actionReason} onChange={(event) => setActionReason(event.target.value)} minLength={8} placeholder="Justificativa para a próxima etapa" /><div className="flex flex-wrap gap-2">{canStage && ['validated', 'dry_run'].includes(selected.status) ? <button type="button" disabled={busy || actionReason.length < 8} onClick={() => runAction('dry_run', 'Dry-run concluído sem importação definitiva.')} className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-35"><PlayCircle className="mr-1.5 inline h-4 w-4" />Executar dry-run</button> : null}{canStage && selected.status === 'dry_run' ? <button type="button" disabled={busy || actionReason.length < 8} onClick={() => runAction('request_approval', 'Lote encaminhado para aprovação.')} className="rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-35">Solicitar aprovação</button> : null}{canApprove && selected.status === 'pending_approval' ? <button type="button" disabled={busy || actionReason.length < 8} onClick={() => runAction('approve_batch', 'Lote aprovado, ainda sem execução.')} className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-35"><CheckCircle2 className="mr-1.5 inline h-4 w-4" />Aprovar lote</button> : null}{canApprove && selected.status === 'approved' ? <button type="button" disabled={busy || !executionEnabled || actionReason.length < 8} onClick={() => runAction('execute_batch', 'Importação executada conforme aprovação.')} className="rounded-xl bg-red-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-30">Executar importação</button> : null}</div>{selected.reconciliation_summary ? <pre className="overflow-auto rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-white/55">{JSON.stringify(selected.reconciliation_summary, null, 2)}</pre> : null}<div className="overflow-auto rounded-xl border border-white/10"><table className="min-w-full text-left text-xs"><thead className="bg-white/5 text-white/45"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Origem</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Mensagens</th></tr></thead><tbody>{records.slice(0, 200).map((record) => <tr key={record.id} className="border-t border-white/8"><td className="px-3 py-2 text-white/35">{record.source_sequence}</td><td className="px-3 py-2 text-white/60">{record.source_record_id}</td><td className="px-3 py-2 text-sky-200">{record.status}</td><td className="px-3 py-2 text-white/35">{(record.validation_messages || []).join(', ') || '—'}</td></tr>)}</tbody></table></div></div> : <div className="flex min-h-80 items-center justify-center text-sm text-white/35">Selecione um lote para consultar validações e avançar pelos gates.</div>}</section>
    </div>
  </div>;
}
