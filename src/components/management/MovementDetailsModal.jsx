import React, { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Download, Printer, User, Receipt, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

const METHOD_LABEL = {
  cash: 'Dinheiro', pix: 'Pix', credit: 'Crédito', debit: 'Débito',
  boleto: 'Boleto', transfer: 'Transferência', link: 'Link', other: 'Outro'
};

const fmtDate = (d) => (d ? format(new Date(d), 'dd/MM/yyyy HH:mm') : '—');
const money = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

export default function MovementDetailsModal({ open, onClose, movement, customerName, quote, ticketNumber }) {
  const printRef = useRef(null);

  if (!movement) return null;

  const isIncome = movement.type === 'income';
  const items = quote?.items || [];

  const buildHtml = () => {
    const rows = items.map((it) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${it.garment_type || '—'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${it.qty || 0}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${money(it.unit_price)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${money((it.unit_price || 0) * (it.qty || 0))}</td>
      </tr>`).join('');

    return `
      <html><head><meta charset="utf-8"><title>Lançamento</title></head>
      <body style="font-family:Arial,sans-serif;color:#1a0b36;padding:24px;max-width:700px;margin:0 auto">
        <h1 style="color:#FF6600;margin-bottom:4px">Detalhe do Lançamento</h1>
        <p style="color:#666;margin-top:0">${fmtDate(movement.entry_date || movement.created_date)}</p>
        <table style="width:100%;margin:16px 0;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#666">Tipo</td><td style="padding:6px 0;text-align:right;font-weight:bold">${isIncome ? 'Entrada' : 'Saída'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Cliente</td><td style="padding:6px 0;text-align:right;font-weight:bold">${customerName || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Categoria</td><td style="padding:6px 0;text-align:right">${movement.category || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Pagamento</td><td style="padding:6px 0;text-align:right">${METHOD_LABEL[movement.payment_method] || '—'}</td></tr>
          ${ticketNumber ? `<tr><td style="padding:6px 0;color:#666">Ticket</td><td style="padding:6px 0;text-align:right">#${ticketNumber}</td></tr>` : ''}
        </table>
        ${items.length ? `
        <h3 style="margin-bottom:8px">Serviços / Peças</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr style="background:#f5f5f5">
            <th style="padding:8px;text-align:left">Item</th>
            <th style="padding:8px;text-align:center">Qtd</th>
            <th style="padding:8px;text-align:right">Unit.</th>
            <th style="padding:8px;text-align:right">Subtotal</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>` : '<p style="color:#999">Sem itens detalhados para este lançamento.</p>'}
        <h2 style="text-align:right;color:#FF6600;margin-top:24px">Total: ${money(movement.amount)}</h2>
      </body></html>`;
  };

  const handlePrint = () => {
    const w = window.open('', '_blank');
    w.document.write(buildHtml());
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const handleDownload = () => {
    const blob = new Blob([buildHtml()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lancamento-${(ticketNumber || movement.id || '').toString().slice(-6)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a0b36] border border-white/10 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-[#FF6600]" /> Detalhe do Lançamento
          </DialogTitle>
        </DialogHeader>

        <div ref={printRef} className="space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-white/5 p-4 border border-white/10">
            <div className="flex items-center gap-2 text-gray-300">
              <User className="h-4 w-4 text-[#FF6600]" />
              <span className="font-medium text-white">{customerName || 'Cliente não informado'}</span>
            </div>
            <span className={isIncome ? 'inline-flex items-center gap-1 text-[#25D366]' : 'inline-flex items-center gap-1 text-red-400'}>
              {isIncome ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
              {isIncome ? 'Entrada' : 'Saída'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-white/5 p-3 border border-white/10">
              <p className="text-gray-400">Data</p>
              <p className="font-medium">{fmtDate(movement.entry_date || movement.created_date)}</p>
            </div>
            <div className="rounded-lg bg-white/5 p-3 border border-white/10">
              <p className="text-gray-400">Pagamento</p>
              <p className="font-medium">{METHOD_LABEL[movement.payment_method] || '—'}</p>
            </div>
            <div className="rounded-lg bg-white/5 p-3 border border-white/10">
              <p className="text-gray-400">Categoria</p>
              <p className="font-medium">{movement.category || '—'}</p>
            </div>
            <div className="rounded-lg bg-white/5 p-3 border border-white/10">
              <p className="text-gray-400">Ticket</p>
              <p className="font-medium">{ticketNumber ? `#${ticketNumber}` : '—'}</p>
            </div>
          </div>

          <div className="rounded-lg bg-white/5 p-4 border border-white/10">
            <p className="mb-3 font-semibold text-white">Serviços / Peças incluídas</p>
            {items.length ? (
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs text-gray-400 pb-1 border-b border-white/10">
                  <span className="col-span-6">Item</span>
                  <span className="col-span-2 text-center">Qtd</span>
                  <span className="col-span-2 text-right">Unit.</span>
                  <span className="col-span-2 text-right">Subtotal</span>
                </div>
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 text-sm py-1 border-b border-white/5 last:border-0">
                    <span className="col-span-6 text-gray-200">{it.garment_type || '—'}</span>
                    <span className="col-span-2 text-center text-gray-300">{it.qty || 0}</span>
                    <span className="col-span-2 text-right text-gray-300">{money(it.unit_price)}</span>
                    <span className="col-span-2 text-right text-gray-200">{money((it.unit_price || 0) * (it.qty || 0))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {movement.source === 'payment'
                  ? 'Sem itens detalhados vinculados a esta venda.'
                  : 'Lançamento manual — sem peças associadas.'}
              </p>
            )}
            <div className="mt-3 flex justify-between border-t border-white/10 pt-3">
              <span className="text-gray-400">Total</span>
              <span className="text-xl font-bold text-[#FF6600]">{money(movement.amount)}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleDownload} className="gap-2 border-white/10 bg-white/5 text-white hover:bg-white/10">
            <Download className="h-4 w-4" /> Baixar
          </Button>
          <Button onClick={handlePrint} className="gap-2 bg-[#FF6600] hover:bg-[#FF6600]/90">
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}