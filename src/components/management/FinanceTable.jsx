import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { Trash2, ArrowUpCircle, ArrowDownCircle, Eye } from 'lucide-react';

const METHOD_LABEL = {
  cash: 'Dinheiro', pix: 'Pix', credit: 'Crédito', debit: 'Débito',
  boleto: 'Boleto', transfer: 'Transferência', link: 'Link', other: 'Outro'
};

const methodDisplay = (e) => {
  let label = METHOD_LABEL[e.payment_method] || '—';
  if (e.payment_method === 'credit' && e.installments > 1) {
    label = `Crédito em ${e.installments}X`;
  }
  if (e.card_brand) label += ` · ${e.card_brand}`;
  return label;
};

const fmtDate = (d) => (d ? format(new Date(d), 'dd/MM/yyyy') : '—');

export default function FinanceTable({ entries, onDelete, onView }) {
  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader>
        <CardTitle className="text-white">Movimentações Financeiras</CardTitle>
        <CardDescription className="text-gray-300">Entradas (vendas + manuais) e saídas/despesas</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-gray-400">Tipo</TableHead>
                <TableHead className="text-gray-400">Data</TableHead>
                <TableHead className="text-gray-400">Categoria</TableHead>
                <TableHead className="text-gray-400">Descrição</TableHead>
                <TableHead className="text-gray-400">Pagamento</TableHead>
                <TableHead className="text-gray-400 text-right">Valor</TableHead>
                <TableHead className="text-gray-400" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow className="border-white/10">
                  <TableCell colSpan={7} className="py-8 text-center text-gray-500">Nenhuma movimentação no período</TableCell>
                </TableRow>
              ) : (
                entries.map((e) => {
                  const isIncome = e.type === 'income';
                  return (
                    <TableRow key={`${e.source}-${e.id}`} className="border-white/10">
                      <TableCell>
                        {isIncome ? (
                          <span className="inline-flex items-center gap-1 text-[#25D366]"><ArrowUpCircle className="h-4 w-4" /> Entrada</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-400"><ArrowDownCircle className="h-4 w-4" /> Saída</span>
                        )}
                      </TableCell>
                      <TableCell className="text-gray-400">{fmtDate(e.entry_date || e.created_date)}</TableCell>
                      <TableCell className="text-gray-200">{e.category || '—'}</TableCell>
                      <TableCell className="text-gray-300">
                        {e.description || '—'}
                        {e.source === 'payment' && <Badge className="ml-2 border-white/10 bg-white/5 text-xs text-gray-400">Venda</Badge>}
                      </TableCell>
                      <TableCell className="text-gray-400">{methodDisplay(e)}</TableCell>
                      <TableCell className={`text-right font-semibold ${isIncome ? 'text-[#25D366]' : 'text-red-400'}`}>
                        {isIncome ? '+' : '-'} R$ {Number(e.amount || 0).toFixed(2)}
                        {e.fee_amount > 0 && (
                          <div className="text-[11px] font-normal text-amber-400">
                            taxa {Number(e.fee_percent || 0).toFixed(2)}% (- R$ {Number(e.fee_amount).toFixed(2)})
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => onView(e)} className="h-8 gap-1 text-gray-300 hover:text-[#FF6600]">
                            <Eye className="h-4 w-4" /> Ver
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => onDelete(e)} className="h-8 w-8 text-gray-500 hover:text-red-400">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}