import { useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, FileCheck2, Landmark, Loader2, Save, ShieldCheck, Send, RefreshCw, XCircle, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const STATUS_LABELS = {
  draft: 'Rascunho',
  ready: 'Pronto',
  processing: 'Processando',
  authorized: 'Autorizada',
  rejected: 'Rejeitada',
  cancel_requested: 'Cancelamento solicitado',
  cancelled: 'Cancelada',
  error: 'Erro',
};

const STATUS_COLORS = {
  draft: 'border-white/10 text-white/50',
  ready: 'border-emerald-500/30 text-emerald-300',
  processing: 'border-amber-500/30 text-amber-300',
  authorized: 'border-emerald-500/30 text-emerald-300',
  rejected: 'border-red-500/30 text-red-300',
  cancelled: 'border-white/10 text-white/40',
  error: 'border-red-500/30 text-red-300',
};

export default function FiscalReadinessPanel({ profiles = [], documents = [], orders = [], statements = [], selectedUnitId, defaultUnitId, onRefresh }) {
  const unitId = selectedUnitId === 'all' ? defaultUnitId : selectedUnitId;
  const profile = profiles.find((item) => item.unit_id === unitId) || null;
  const scopedDocuments = documents.filter((item) => selectedUnitId === 'all' || item.unit_id === selectedUnitId);
  const eligibleOrders = orders.filter((order) => order.unit_id === unitId && order.status !== 'cancelled' && (order.fiscal_document_ids || []).length === 0 && Number(order.total_amount || 0) > 0);
  const eligibleStatements = statements.filter((statement) => statement.unit_id === unitId && ['review', 'issued', 'partially_paid', 'paid'].includes(statement.status) && !statement.fiscal_document_id);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [refInput, setRefInput] = useState('');
  const [form, setForm] = useState({
    legal_name: profile?.legal_name || '', trade_name: profile?.trade_name || '', tax_id: profile?.tax_id || '',
    municipal_registration: profile?.municipal_registration || '', service_code: profile?.service_code || '',
    service_description: profile?.service_description || 'Serviços de lavanderia', municipal_tax_code: profile?.municipal_tax_code || '',
    iss_rate: profile?.iss_rate ?? '', rps_series: profile?.rps_series || '1', next_rps_number: profile?.next_rps_number || 1,
    provider: profile?.provider || 'focusnfe', environment: profile?.environment || 'homologation',
  });

  useEffect(() => {
    if (!profile) return;
    setForm({
      legal_name: profile.legal_name || '', trade_name: profile.trade_name || '', tax_id: profile.tax_id || '',
      municipal_registration: profile.municipal_registration || '', service_code: profile.service_code || '',
      service_description: profile.service_description || 'Serviços de lavanderia', municipal_tax_code: profile.municipal_tax_code || '',
      iss_rate: profile.iss_rate ?? '', rps_series: profile.rps_series || '1', next_rps_number: profile.next_rps_number || 1,
      provider: profile.provider || 'focusnfe', environment: profile.environment || 'homologation',
    });
  }, [profile?.id]);

  const readiness = useMemo(() => {
    const missing = [];
    if (!form.legal_name.trim()) missing.push('Razão social');
    if (![11, 14].includes(form.tax_id.replace(/\D/g, '').length)) missing.push('CPF/CNPJ');
    if (!form.municipal_registration.trim()) missing.push('Inscrição municipal');
    if (!form.service_code.trim()) missing.push('Código do serviço');
    if (!form.service_description.trim()) missing.push('Descrição do serviço');
    if (!form.rps_series.trim()) missing.push('Série do RPS');
    return { missing, ready: missing.length === 0 };
  }, [form]);

  const isFocusNfe = form.provider === 'focusnfe';
  const environmentLabel = form.environment === 'production' ? 'Produção' : 'Homologação';

  const execute = async (payload, success) => {
    setBusy(true);
    try {
      const response = await base44.functions.invoke('manage_fiscal_document', payload);
      toast.success(success);
      onRefresh?.();
      return response.data;
    } catch (error) {
      console.error(error);
      const code = error.response?.data?.error;
      const messages = {
        fiscal_profile_incomplete: 'Complete o perfil fiscal antes de preparar o RPS.',
        fiscal_recipient_incomplete: 'Complete os dados fiscais e o e-mail do tomador.',
        focusnfe_token_not_configured: 'Token da Focus NFe não configurado. Defina o secret FOCUSNFE_TOKEN.',
        provider_not_focusnfe: 'O provedor fiscal selecionado não suporta transmissão.',
        fiscal_not_ready: 'O documento não está pronto para transmissão.',
        focusnfe_rejected: 'A Focus NFe rejeitou a emissão. Verifique os dados do perfil e do tomador.',
        focusnfe_request_failed: 'Falha na comunicação com a Focus NFe. Tente novamente.',
        focusnfe_not_found: 'Documento não encontrado na Focus NFe.',
        focusnfe_cancel_rejected: 'A Focus NFe rejeitou o cancelamento.',
        focusnfe_ref_required: 'Informe a referência da nota na Focus NFe.',
        authorized_document_must_be_cancelled_first: 'Cancele a NFSe autorizada antes de excluir o registro.',
        manager_approval_required: 'Apenas gestores podem excluir ou cancelar notas.',
      };
      toast.error(messages[code] || 'Não foi possível concluir a operação fiscal.');
      throw error;
    } finally { setBusy(false); }
  };

  const saveProfile = () => execute({
    action: 'save_profile', unit_id: unitId, fiscal_profile_id: profile?.id,
    provider: form.provider, environment: form.environment,
    municipality_code: '4314902', municipality_name: 'Porto Alegre',
    ...form, iss_rate: Number(form.iss_rate || 0), next_rps_number: Number(form.next_rps_number || 1),
  }, isFocusNfe ? `Perfil salvo — Focus NFe (${environmentLabel}).` : 'Perfil fiscal salvo.');

  const prepare = async () => {
    if (!source) return toast.error('Selecione um pedido ou faturamento.');
    const [type, id] = source.split(':');
    await execute({
      action: 'prepare', unit_id: unitId, fiscal_profile_id: profile?.id,
      order_ids: type === 'order' ? [id] : [], billing_statement_id: type === 'statement' ? id : undefined,
      competence_date: new Date().toISOString().slice(0, 10), idempotency_key: crypto.randomUUID(),
    }, 'RPS preparado localmente.');
    setSource('');
  };

  const transmit = (docId) => execute({ action: 'transmit', fiscal_document_id: docId }, 'NFSe enviada à Focus NFe. Consulte o status em instantes.');
  const consult = (docId) => execute({ action: 'consult', fiscal_document_id: docId }, 'Status da NFSe atualizado.');
  const cancelDraft = (docId) => execute({ action: 'cancel_draft', fiscal_document_id: docId, reason: 'Cancelamento local do RPS antes da transmissão.' }, 'RPS cancelado localmente.');
  const importRef = async () => {
    const ref = refInput.trim();
    if (!ref) return toast.error('Informe a referência da nota na Focus NFe.');
    await execute({ action: 'import_ref', unit_id: unitId, ref }, 'Nota importada da Focus NFe.');
    setRefInput('');
  };
  const deleteDocument = async (docId) => {
    if (!window.confirm('Excluir definitivamente este registro de nota do sistema?')) return;
    await execute({ action: 'delete', fiscal_document_id: docId, reason: 'Exclusão manual pelo painel fiscal.' }, 'Registro fiscal excluído.');
  };
  const cancelNfse = async () => {
    if (!cancelTarget || cancelReason.trim().length < 15) return toast.error('A justificativa deve ter no mínimo 15 caracteres.');
    await execute({ action: 'cancel_nfse', fiscal_document_id: cancelTarget, reason: cancelReason.trim() }, 'NFSe cancelada na Focus NFe.');
    setCancelTarget(null);
    setCancelReason('');
  };

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-sky-500/20 bg-gradient-to-br from-sky-500/10 to-violet-500/5 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="rounded-2xl bg-sky-500/15 p-2.5 text-sky-300"><Landmark className="h-5 w-5" /></div>
            <div>
              <h2 className="font-semibold text-white">Emissão de NFSe — Focus NFe</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/45">Integração ativa com a API da Focus NFe. O sistema prepara o RPS, transmite para a Focus NFe e consulta o status de autorização. Em homologação as notas não têm validade fiscal.</p>
            </div>
          </div>
          <Badge variant="outline" className={isFocusNfe ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-200'}>
            {isFocusNfe ? <><CheckCircle2 className="mr-1 h-3 w-3" />Focus NFe · {environmentLabel}</> : <><Ban className="mr-1 h-3 w-3" />Transmissão desativada</>}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white">Perfil fiscal da unidade</h3>
              <p className="text-sm text-white/40">Configure o provedor e os dados do prestador.</p>
            </div>
            {profile && <Badge variant="outline" className={profile.status === 'ready_for_homologation' ? 'border-emerald-500/30 text-emerald-300' : 'border-white/10 text-white/50'}>{profile.status}</Badge>}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="Provedor">
              <select value={form.provider} onChange={(e) => setForm((c) => ({ ...c, provider: e.target.value, environment: e.target.value === 'focusnfe' ? (c.environment === 'disabled' ? 'homologation' : c.environment) : 'disabled' }))} className="h-10 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-white">
                <option value="focusnfe">Focus NFe</option>
                <option value="national_nfse">Emissor Nacional (sem transmissão)</option>
                <option value="none">Nenhum</option>
              </select>
            </Field>
            <Field label="Ambiente">
              <select value={form.environment} onChange={(e) => setForm((c) => ({ ...c, environment: e.target.value }))} disabled={!isFocusNfe} className="h-10 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-white disabled:opacity-40">
                <option value="homologation">Homologação (testes)</option>
                <option value="production">Produção (notas válidas)</option>
                <option value="disabled">Desativado</option>
              </select>
            </Field>
            <Field label="Razão social"><Input value={form.legal_name} onChange={(e) => setForm((c) => ({ ...c, legal_name: e.target.value }))} className="border-white/10 bg-black/20" /></Field>
            <Field label="Nome fantasia"><Input value={form.trade_name} onChange={(e) => setForm((c) => ({ ...c, trade_name: e.target.value }))} className="border-white/10 bg-black/20" /></Field>
            <Field label="CNPJ/CPF"><Input value={form.tax_id} onChange={(e) => setForm((c) => ({ ...c, tax_id: e.target.value }))} className="border-white/10 bg-black/20" /></Field>
            <Field label="Inscrição municipal"><Input value={form.municipal_registration} onChange={(e) => setForm((c) => ({ ...c, municipal_registration: e.target.value }))} className="border-white/10 bg-black/20" /></Field>
            <Field label="Código do serviço"><Input value={form.service_code} onChange={(e) => setForm((c) => ({ ...c, service_code: e.target.value }))} className="border-white/10 bg-black/20" /></Field>
            <Field label="Código de tributação"><Input value={form.municipal_tax_code} onChange={(e) => setForm((c) => ({ ...c, municipal_tax_code: e.target.value }))} className="border-white/10 bg-black/20" /></Field>
            <Field label="Alíquota ISS (%)"><Input type="number" min="0" step="0.01" value={form.iss_rate} onChange={(e) => setForm((c) => ({ ...c, iss_rate: e.target.value }))} className="border-white/10 bg-black/20" /></Field>
            <Field label="Série e próximo RPS">
              <div className="grid grid-cols-2 gap-2">
                <Input value={form.rps_series} onChange={(e) => setForm((c) => ({ ...c, rps_series: e.target.value }))} className="border-white/10 bg-black/20" />
                <Input type="number" min="1" value={form.next_rps_number} onChange={(e) => setForm((c) => ({ ...c, next_rps_number: e.target.value }))} className="border-white/10 bg-black/20" />
              </div>
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <Label>Descrição do serviço</Label>
              <Input value={form.service_description} onChange={(e) => setForm((c) => ({ ...c, service_description: e.target.value }))} className="border-white/10 bg-black/20" />
            </div>
          </div>

          {!readiness.ready && <p className="mt-3 text-xs text-amber-200">Faltam: {readiness.missing.join(', ')}.</p>}
          <Button onClick={saveProfile} disabled={busy || !unitId} className="mt-4 w-full bg-sky-500 hover:bg-sky-400">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar perfil {isFocusNfe ? `· Focus NFe (${environmentLabel})` : ''}
          </Button>
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center gap-2"><FileCheck2 className="h-5 w-5 text-violet-300" /><h3 className="font-semibold text-white">Preparar RPS</h3></div>
            <p className="mt-1 text-sm text-white/40">Gera o documento interno e reserva a numeração.</p>
            <div className="mt-4 space-y-3">
              <select value={source} onChange={(e) => setSource(e.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 text-sm text-white">
                <option value="">Selecione a origem</option>
                <optgroup label="Pedidos">{eligibleOrders.slice(0, 300).map((order) => <option key={order.id} value={`order:${order.id}`}>{order.ticket_number || order.id} · {money(order.total_amount)}</option>)}</optgroup>
                <optgroup label="Faturamentos">{eligibleStatements.slice(0, 100).map((statement) => <option key={statement.id} value={`statement:${statement.id}`}>{statement.statement_number} · {money(statement.total_amount)}</option>)}</optgroup>
              </select>
              <Button onClick={prepare} disabled={busy || !profile || !source} className="w-full bg-violet-500 hover:bg-violet-400"><ShieldCheck className="mr-2 h-4 w-4" />Preparar e validar localmente</Button>
            </div>
            <div className="mt-5 border-t border-white/10 pt-4">
              <Label>Importar nota já emitida (referência Focus NFe)</Label>
              <div className="mt-2 flex gap-2">
                <Input value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="ex: 5asec-unidade-1-4" className="border-white/10 bg-black/20" />
                <Button onClick={importRef} disabled={busy || !profile || !refInput.trim()} variant="outline" className="border-white/10 bg-white/5 shrink-0"><RefreshCw className="mr-1 h-3.5 w-3.5" />Importar</Button>
              </div>
              <p className="mt-2 text-xs text-white/35">Traz para o painel notas transmitidas que ainda não aparecem aqui, com o status atual (processando, autorizada, etc.).</p>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="font-semibold text-white">Documentos fiscais</h3>
            <div className="mt-4 space-y-3">
              {scopedDocuments.slice(0, 12).map((document) => (
                <div key={document.id} className="rounded-2xl border border-white/10 bg-black/15 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{document.recipient?.legal_name || document.recipient?.name || 'Tomador não identificado'}</p>
                      <p className="text-xs text-white/35">RPS {document.rps_series}-{document.rps_number}{document.nfse_number ? ` · NFSe ${document.nfse_number}` : ''}</p>
                      {document.last_error_message && <p className="mt-1 text-xs text-red-300/70 truncate" title={document.last_error_message}>{document.last_error_message}</p>}
                    </div>
                    <Badge variant="outline" className={STATUS_COLORS[document.status] || 'border-white/10 text-white/50'}>{STATUS_LABELS[document.status] || document.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{money(document.total_amount)}</span>
                    <div className="flex gap-1.5">
                      {document.status === 'draft' && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => execute({ action: 'validate', fiscal_document_id: document.id }, 'Estrutura do RPS validada.')} className="border-white/10 bg-white/5"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Validar</Button>
                      )}
                      {document.status === 'ready' && isFocusNfe && (
                        <Button size="sm" disabled={busy} onClick={() => transmit(document.id)} className="bg-sky-500 hover:bg-sky-400"><Send className="mr-1 h-3.5 w-3.5" />Transmitir</Button>
                      )}
                      {(document.status === 'processing' || document.status === 'queued') && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => consult(document.id)} className="border-white/10 bg-white/5"><RefreshCw className="mr-1 h-3.5 w-3.5" />Consultar</Button>
                      )}
                      {document.status === 'authorized' && (
                        <>
                          {document.metadata?.focusnfe_ref && (
                            <a href={`${document.environment === 'production' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br'}/v2/nfse/${encodeURIComponent(document.metadata.focusnfe_ref)}.pdf`} target="_blank" rel="noopener noreferrer">
                              <Button size="sm" variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300"><ExternalLink className="mr-1 h-3.5 w-3.5" />PDF</Button>
                            </a>
                          )}
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => { setCancelTarget(document.id); setCancelReason(''); }} className="border-red-500/20 bg-red-500/5 text-red-300"><XCircle className="mr-1 h-3.5 w-3.5" />Cancelar</Button>
                        </>
                      )}
                      {(document.status === 'rejected' || document.status === 'error') && isFocusNfe && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => transmit(document.id)} className="border-white/10 bg-white/5"><RefreshCw className="mr-1 h-3.5 w-3.5" />Reenviar</Button>
                      )}
                      {['draft', 'ready', 'rejected', 'error'].includes(document.status) && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancelDraft(document.id)} className="text-white/40 hover:text-red-300">Descartar</Button>
                      )}
                      {document.status !== 'authorized' && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => deleteDocument(document.id)} className="text-white/40 hover:text-red-300"><Trash2 className="mr-1 h-3.5 w-3.5" />Excluir</Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {scopedDocuments.length === 0 && <p className="py-6 text-center text-sm text-white/35">Nenhum documento fiscal preparado.</p>}
            </div>
          </div>
        </div>
      </div>

      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCancelTarget(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1a0b36] p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">Cancelar NFSe na Focus NFe</h3>
            <p className="mt-1 text-sm text-white/50">Informe a justificativa do cancelamento (mínimo 15 caracteres). A NFSe será cancelada junto à prefeitura.</p>
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} className="mt-4 w-full rounded-md border border-white/10 bg-black/20 p-3 text-sm text-white" placeholder="Ex: Erro na descrição do serviço, solicitado pelo cliente..." />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCancelTarget(null)} className="border-white/10">Fechar</Button>
              <Button onClick={cancelNfse} disabled={busy || cancelReason.trim().length < 15} className="bg-red-600 hover:bg-red-500">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}Cancelar NFSe</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }