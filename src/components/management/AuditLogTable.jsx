import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { ShieldAlert, Search, Download, Loader2, Eye, TriangleAlert, CheckCircle2, XCircle, FileClock } from 'lucide-react';
import { toast } from 'sonner';

const TYPE_LABEL = {
  payment: 'Pagamento', finance_entry: 'Lançamento', order: 'Pedido', quote: 'Orçamento', garment_item: 'Peça',
  stock_item: 'Insumo', stock_movement: 'Movimento de estoque', cash_session: 'Caixa', accounts_payable: 'Conta a pagar',
  accounts_receivable: 'Conta a receber', user: 'Usuário', unit: 'Unidade', price_rule: 'Regra de preço',
  operational_catalog: 'Catálogo', loyalty_program: 'Fidelidade', loyalty_ledger: 'Pontos', voucher: 'Voucher',
  customer_package: 'Pacote', vehicle: 'Veículo', field_route: 'Rota', field_route_stop: 'Parada',
  specialized_report: 'Relatório', fiscal_document: 'Fiscal', third_party_job: 'Terceiro', rework: 'Retrabalho', quality_check: 'Qualidade',
};
const DOMAIN_LABEL = { security: 'Segurança', commercial: 'Comercial', finance: 'Financeiro', fiscal: 'Fiscal', inventory: 'Estoque', production: 'Produção', quality: 'Qualidade', crm: 'CRM', loyalty: 'Fidelidade', analytics: 'Analytics', logistics: 'Logística', integration: 'Integração', system: 'Sistema' };
const ACTION_LABEL = { create: 'Criou', view: 'Consultou', update: 'Alterou', delete: 'Excluiu', approve: 'Aprovou', reject: 'Rejeitou', export: 'Exportou', login: 'Entrou', logout: 'Saiu', upload: 'Enviou arquivo', download: 'Baixou', reconcile: 'Conciliou', refund: 'Estornou', status_change: 'Mudou estado', permission_change: 'Alterou acesso', ai_review: 'Revisou IA' };
const fmtDateTime = (value) => value ? format(new Date(value), 'dd/MM/yyyy HH:mm') : '—';

export default function AuditLogTable({ logs = [], selectedUnit = 'all' }) {
  const [rows, setRows] = useState(logs);
  const [summary, setSummary] = useState({ total: logs.length, success: logs.filter((log) => log.success !== false).length, denied_or_failed: logs.filter((log) => log.success === false).length, critical: logs.filter((log) => log.severity === 'critical').length });
  const [filters, setFilters] = useState({ search: '', domain: 'all', action_filter: 'all', severity: 'all', result: 'all', start_date: '', end_date: '' });
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportReason, setExportReason] = useState('');
  const [showExport, setShowExport] = useState(false);

  useEffect(() => { setRows(logs); }, [logs]);

  const request = async (action = 'query', reason = '') => {
    const payload = {
      action,
      unit_ids: selectedUnit && selectedUnit !== 'all' ? [selectedUnit] : [],
      search: filters.search || undefined,
      domain: filters.domain === 'all' ? undefined : filters.domain,
      action_filter: filters.action_filter === 'all' ? undefined : filters.action_filter,
      severity: filters.severity === 'all' ? undefined : filters.severity,
      result: filters.result === 'all' ? undefined : filters.result,
      start_date: filters.start_date || undefined,
      end_date: filters.end_date || undefined,
      limit: action === 'export' ? 5000 : 500,
      reason,
    };
    return base44.functions.invoke('query_audit_log', payload);
  };

  const load = async () => {
    setLoading(true);
    try {
      const response = await request('query');
      setRows(response.data.rows || []);
      setSummary(response.data.summary || {});
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || 'Não foi possível consultar a auditoria.');
    } finally { setLoading(false); }
  };

  const exportCsv = async () => {
    if (exportReason.trim().length < 8) return;
    setExporting(true);
    try {
      const response = await request('export', exportReason);
      const blob = new Blob([response.data.content], { type: response.data.content_type || 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = response.data.filename || 'auditoria.csv';
      anchor.click();
      URL.revokeObjectURL(url);
      setShowExport(false);
      setExportReason('');
      toast.success('Exportação auditada concluída.');
      await load();
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.error || 'A exportação não foi autorizada.');
    } finally { setExporting(false); }
  };

  const hasFilters = useMemo(() => Object.entries(filters).some(([key, value]) => key === 'search' ? value.trim() : value && value !== 'all'), [filters]);

  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div><CardTitle className="flex items-center gap-2 text-white"><ShieldAlert className="h-5 w-5 text-violet-300" />Central de Auditoria</CardTitle><CardDescription className="mt-1 text-gray-300">Eventos de segurança, financeiro, estoque, produção, CRM e logística com correlação e histórico antes/depois.</CardDescription></div>
          <div className="flex flex-wrap gap-2"><Summary icon={FileClock} label="Eventos" value={summary.total || 0} tone="slate" /><Summary icon={CheckCircle2} label="Sucesso" value={summary.success || 0} tone="green" /><Summary icon={XCircle} label="Negados/falhas" value={summary.denied_or_failed || 0} tone="red" /><Summary icon={TriangleAlert} label="Críticos" value={summary.critical || 0} tone="amber" /></div>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-8">
          <div className="relative md:col-span-2"><Search className="absolute left-3 top-3 h-4 w-4 text-white/30" /><Input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Item, motivo, usuário ou request ID" className="border-white/10 bg-black/20 pl-9" /></div>
          <FilterSelect value={filters.domain} onChange={(value) => setFilters((current) => ({ ...current, domain: value }))} placeholder="Domínio" options={Object.entries(DOMAIN_LABEL)} />
          <FilterSelect value={filters.action_filter} onChange={(value) => setFilters((current) => ({ ...current, action_filter: value }))} placeholder="Ação" options={Object.entries(ACTION_LABEL)} />
          <FilterSelect value={filters.severity} onChange={(value) => setFilters((current) => ({ ...current, severity: value }))} placeholder="Severidade" options={['info', 'notice', 'warning', 'critical'].map((value) => [value, value])} />
          <FilterSelect value={filters.result} onChange={(value) => setFilters((current) => ({ ...current, result: value }))} placeholder="Resultado" options={[['success', 'Sucesso'], ['denied', 'Negado'], ['validation_error', 'Validação'], ['failure', 'Falha']]} />
          <Input type="date" value={filters.start_date} onChange={(event) => setFilters((current) => ({ ...current, start_date: event.target.value }))} className="border-white/10 bg-black/20" />
          <Input type="date" value={filters.end_date} onChange={(event) => setFilters((current) => ({ ...current, end_date: event.target.value }))} className="border-white/10 bg-black/20" />
        </div>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" className="border-white/10 bg-white/5" onClick={() => { setFilters({ search: '', domain: 'all', action_filter: 'all', severity: 'all', result: 'all', start_date: '', end_date: '' }); setRows(logs); }} disabled={!hasFilters}>Limpar</Button><Button variant="outline" className="border-white/10 bg-white/5" onClick={() => setShowExport(true)}><Download className="mr-2 h-4 w-4" />Exportar</Button><Button onClick={load} disabled={loading} className="bg-violet-600 hover:bg-violet-500">{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Consultar</Button></div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-gray-400">Data / Hora</TableHead><TableHead className="text-gray-400">Domínio</TableHead><TableHead className="text-gray-400">Ação</TableHead><TableHead className="text-gray-400">Item</TableHead><TableHead className="text-gray-400">Resultado</TableHead><TableHead className="text-gray-400">Motivo</TableHead><TableHead className="text-gray-400">Usuário</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.length === 0 ? <TableRow className="border-white/10"><TableCell colSpan={8} className="py-10 text-center text-gray-500">Nenhum evento encontrado</TableCell></TableRow> : rows.map((log) => <TableRow key={log.id} className="border-white/10"><TableCell className="whitespace-nowrap text-gray-400">{fmtDateTime(log.occurred_at || log.created_date)}</TableCell><TableCell><Badge variant="outline" className="border-violet-500/20 text-violet-200">{DOMAIN_LABEL[log.domain] || log.domain || 'Sistema'}</Badge></TableCell><TableCell className="text-gray-300">{ACTION_LABEL[log.action] || log.action}</TableCell><TableCell className="text-gray-200"><span className="block max-w-[220px] truncate">{log.item_label || TYPE_LABEL[log.entity_type] || log.entity_type || '—'}</span>{log.customer_name && <span className="block text-xs text-gray-500">{log.customer_name}</span>}</TableCell><TableCell><ResultBadge log={log} /></TableCell><TableCell className="max-w-[300px] text-gray-300"><span className="line-clamp-2">{log.reason || '—'}</span></TableCell><TableCell className="whitespace-nowrap text-gray-400">{log.user_name || log.user_email || 'Sistema'}{log.user_email && log.user_name && <span className="block text-xs text-gray-500">{log.user_email}</span>}</TableCell><TableCell><Button size="icon" variant="ghost" onClick={() => setDetail(log)}><Eye className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table>
        </div>
      </CardContent>
      {detail && <AuditDetail log={detail} onClose={() => setDetail(null)} />}
      <Dialog open={showExport} onOpenChange={setShowExport}><DialogContent className="max-w-lg border-white/10 bg-[#160a2b] text-white"><DialogHeader><DialogTitle>Exportar auditoria</DialogTitle><DialogDescription className="text-white/40">A exportação respeita os filtros atuais, mascara campos sensíveis e gera um novo evento de auditoria.</DialogDescription></DialogHeader><div className="space-y-2"><Label>Justificativa</Label><Input value={exportReason} onChange={(event) => setExportReason(event.target.value)} placeholder="Mínimo 8 caracteres" className="border-white/10 bg-black/20" /></div><Button onClick={exportCsv} disabled={exporting || exportReason.trim().length < 8} className="bg-violet-600 hover:bg-violet-500">{exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Exportar CSV</Button></DialogContent></Dialog>
    </Card>
  );
}

function FilterSelect({ value, onChange, placeholder, options }) { return <Select value={value} onValueChange={onChange}><SelectTrigger className="border-white/10 bg-black/20"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent><SelectItem value="all">{placeholder}: todos</SelectItem>{options.map(([code, label]) => <SelectItem key={code} value={code}>{label}</SelectItem>)}</SelectContent></Select>; }
function Summary({ icon: Icon, label, value, tone }) { const styles = { slate: 'text-slate-200', green: 'text-emerald-300', red: 'text-red-300', amber: 'text-amber-300' }; return <div className="min-w-24 rounded-xl border border-white/10 bg-black/15 px-3 py-2"><div className={`flex items-center gap-1 text-xs ${styles[tone]}`}><Icon className="h-3.5 w-3.5" />{label}</div><p className="mt-1 text-lg font-bold text-white">{value}</p></div>; }
function ResultBadge({ log }) { const result = log.result || (log.success === false ? 'failure' : 'success'); const styles = result === 'success' ? 'border-emerald-500/20 text-emerald-300' : result === 'denied' ? 'border-amber-500/20 text-amber-200' : 'border-red-500/20 text-red-200'; return <Badge variant="outline" className={styles}>{result}</Badge>; }
function AuditDetail({ log, onClose }) { return <Dialog open onOpenChange={(value) => !value && onClose()}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto border-white/10 bg-[#160a2b] text-white"><DialogHeader><DialogTitle>{log.item_label || TYPE_LABEL[log.entity_type] || 'Evento de auditoria'}</DialogTitle><DialogDescription className="text-white/40">{fmtDateTime(log.occurred_at || log.created_date)} · {log.request_id || 'sem correlação'}</DialogDescription></DialogHeader><div className="grid gap-3 md:grid-cols-3"><Info label="Domínio" value={DOMAIN_LABEL[log.domain] || log.domain || 'Sistema'} /><Info label="Ação" value={ACTION_LABEL[log.action] || log.action} /><Info label="Resultado" value={log.result || (log.success === false ? 'failure' : 'success')} /><Info label="Usuário" value={log.user_name || log.user_email || 'Sistema'} /><Info label="Unidade" value={log.unit_id || '—'} /><Info label="Severidade" value={log.severity || 'info'} /></div><div className="rounded-xl border border-white/10 bg-white/[0.035] p-4"><p className="text-xs uppercase tracking-wide text-white/35">Motivo</p><p className="mt-2 text-sm text-white/75">{log.reason || '—'}</p></div><div className="grid gap-4 lg:grid-cols-2"><JsonBlock title="Antes" value={log.before_data} /><JsonBlock title="Depois" value={log.after_data} /></div><JsonBlock title="Metadados" value={log.metadata} /></DialogContent></Dialog>; }
function Info({ label, value }) { return <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3"><p className="text-xs text-white/35">{label}</p><p className="mt-1 break-words text-sm text-white/75">{value || '—'}</p></div>; }
function JsonBlock({ title, value }) { return <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-4"><p className="mb-2 text-xs uppercase tracking-wide text-white/35">{title}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs text-white/60">{value ? JSON.stringify(value, null, 2) : 'Sem dados'}</pre></div>; }
