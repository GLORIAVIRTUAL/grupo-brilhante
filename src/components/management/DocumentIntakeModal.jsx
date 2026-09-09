import { useState } from 'react';
import { Check, FileSearch, Loader2, ReceiptText, ShieldCheck, TriangleAlert, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { uploadSecureFile } from '@/lib/secureFiles';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

const FINANCIAL_TYPES = [
  ['electricity_bill', 'Conta de energia'],
  ['water_bill', 'Conta de água'],
  ['gas_bill', 'Conta de gás'],
  ['internet_bill', 'Internet e telefonia'],
  ['rent', 'Aluguel'],
  ['service_invoice', 'Nota de serviço'],
  ['bank_slip', 'Boleto'],
  ['other', 'Outro documento'],
];

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

export default function DocumentIntakeModal({ open, onOpenChange, mode = 'purchase', unitId, onProcessed }) {
  const [file, setFile] = useState(null);
  const [expectedType, setExpectedType] = useState(mode === 'purchase' ? 'nfe' : 'electricity_bill');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [approved, setApproved] = useState(false);

  const reset = () => {
    setFile(null);
    setExpectedType(mode === 'purchase' ? 'nfe' : 'electricity_bill');
    setResult(null);
    setApproved(false);
    setBusy(false);
  };

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && !busy) reset();
    onOpenChange(nextOpen);
  };

  const processFile = async () => {
    if (!file) return toast.error('Selecione um documento.');
    if (!unitId) return toast.error('Selecione uma unidade.');

    setBusy(true);
    try {
      const documentType = mode === 'purchase'
        ? 'purchase_invoice'
        : (expectedType === 'service_invoice' ? 'service_invoice' : 'utility_bill');
      const upload = await uploadSecureFile({
        file,
        documentType,
        unitId,
        metadata: { source: mode === 'purchase' ? 'purchase_document_inbox' : 'financial_document_inbox' },
      });

      const response = mode === 'purchase'
        ? await base44.functions.invoke('extract_purchase_document', { document_asset_id: upload.asset.id })
        : await base44.functions.invoke('extract_financial_document', {
            document_asset_id: upload.asset.id,
            expected_document_type: expectedType,
          });

      setResult(response.data);
      toast.success(response.data?.configured === false ? 'Documento recebido para preenchimento manual.' : 'Documento lido. Confira os campos antes de aprovar.');
    } catch (error) {
      console.error(error);
      toast.error(error.code === 'DUPLICATE_DOCUMENT' ? error.message : 'Não foi possível processar o documento.');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      const response = mode === 'purchase'
        ? await base44.functions.invoke('approve_purchase_document', {
            purchase_document_id: result.purchase_document.id,
          })
        : await base44.functions.invoke('approve_financial_document', {
            financial_document_id: result.financial_document.id,
          });
      setApproved(true);
      onProcessed?.(response.data);
      toast.success(mode === 'purchase' ? 'Estoque e conta a pagar gerados.' : 'Conta a pagar criada para aprovação.');
    } catch (error) {
      console.error(error);
      const code = error.response?.data?.error;
      toast.error(code === 'purchase_items_require_review' ? 'Relacione todos os itens aos insumos antes de aprovar.' : 'O documento ainda precisa de revisão.');
    } finally {
      setBusy(false);
    }
  };

  const entity = result?.purchase_document || result?.financial_document;
  const title = mode === 'purchase' ? 'Entrada inteligente de compra' : 'Leitura inteligente de conta';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl border-white/10 bg-[#170c2b] text-white">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-fuchsia-600 p-2.5"><ReceiptText className="h-5 w-5" /></div>
            <div><DialogTitle>{title}</DialogTitle><DialogDescription className="text-white/50">O sistema extrai os dados; nenhum estoque ou pagamento é alterado antes da aprovação.</DialogDescription></div>
          </div>
        </DialogHeader>

        {!result ? (
          <div className="space-y-5 py-3">
            {mode === 'financial' && (
              <div className="space-y-2">
                <Label>Tipo esperado</Label>
                <Select value={expectedType} onValueChange={setExpectedType}>
                  <SelectTrigger className="border-white/10 bg-white/5"><SelectValue /></SelectTrigger>
                  <SelectContent>{FINANCIAL_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <Label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-violet-400/40 bg-violet-500/5 px-6 py-10 text-center hover:bg-violet-500/10">
              <UploadCloud className="h-10 w-10 text-violet-300" />
              <span className="mt-3 font-semibold">Fotografe ou selecione PDF, XML, JPG, PNG ou WEBP</span>
              <span className="mt-1 max-w-md text-sm font-normal text-white/45">Prefira o XML da NF-e quando disponível. Arquivos duplicados são bloqueados pelo hash.</span>
              <Input type="file" accept={mode === 'purchase' ? 'image/jpeg,image/png,image/webp,application/pdf,application/xml,text/xml,.xml' : 'image/jpeg,image/png,image/webp,application/pdf'} onChange={(event) => setFile(event.target.files?.[0] || null)} className="sr-only" />
            </Label>
            {file && <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3"><span className="truncate text-sm">{file.name}</span><Badge variant="outline">{(file.size / 1024 / 1024).toFixed(2)} MB</Badge></div>}
            <Button onClick={processFile} disabled={busy || !file} className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-500">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSearch className="mr-2 h-4 w-4" />}Ler e preparar rascunho
            </Button>
          </div>
        ) : (
          <div className="space-y-5 py-3">
            <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              {result.configured === false || entity?.status === 'human_review' ? <TriangleAlert className="mt-0.5 h-5 w-5 text-amber-300" /> : <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-300" />}
              <div className="flex-1"><p className="font-semibold">{entity?.status === 'human_review' ? 'Revisão necessária' : 'Rascunho preparado'}</p><p className="mt-1 text-sm text-white/50">Confiança: {Math.round(Number(entity?.extraction_confidence || 0) * 100)}%. Confira dados e correspondências antes de aprovar.</p></div>
              <Badge variant="outline">{entity?.status}</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-wide text-white/35">Emissor / fornecedor</p><p className="mt-1 font-medium">{entity?.supplier_name || entity?.issuer_name || 'Não identificado'}</p></div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-wide text-white/35">Valor</p><p className="mt-1 text-xl font-bold text-orange-300">{money(entity?.total ?? entity?.amount)}</p></div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-wide text-white/35">Documento</p><p className="mt-1 font-medium">{entity?.document_number || entity?.document_type || 'Pendente'}</p></div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-wide text-white/35">Vencimento</p><p className="mt-1 font-medium">{entity?.due_date ? new Date(entity.due_date).toLocaleDateString('pt-BR') : 'Revisar'}</p></div>
            </div>

            {mode === 'purchase' && <p className="text-sm text-white/50">{result.items?.length || 0} linha(s) extraída(s). Itens sem correspondência entram na fila de revisão de estoque.</p>}

            {approved ? (
              <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-200"><Check className="h-5 w-5" />Documento aprovado e registrado.</div>
            ) : (
              <div className="flex flex-wrap justify-end gap-3">
                <Button variant="outline" onClick={() => setResult(null)} disabled={busy}>Enviar outro</Button>
                <Button onClick={approve} disabled={busy || entity?.status === 'human_review'} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Aprovar lançamento</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
