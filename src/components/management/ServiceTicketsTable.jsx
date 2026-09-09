import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { Search, Ticket, Download, Printer, Pencil, Trash2 } from 'lucide-react';
import { downloadTicketPdf, printTicket } from '@/components/management/ticketDocument';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import PaymentStatusBadge from '@/components/payments/PaymentStatusBadge';

const STATUS_LABEL = {
  pending: { label: 'Pendente', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  processing: { label: 'Em Processo', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  ready: { label: 'Pronto', cls: 'bg-[#FF6600]/20 text-[#FF6600] border-[#FF6600]/30' },
  delivered: { label: 'Entregue', cls: 'bg-[#25D366]/20 text-[#25D366] border-[#25D366]/30' },
  finished: { label: 'Finalizado', cls: 'bg-[#25D366]/20 text-[#25D366] border-[#25D366]/30' },
  cancelled: { label: 'Cancelado', cls: 'bg-red-500/20 text-red-300 border-red-500/30' }
};

const fmtDate = (d) => (d ? format(new Date(d), 'dd/MM/yyyy') : '—');

export default function ServiceTicketsTable({ orders, customerMap, onEdit, onDelete }) {
  const [search, setSearch] = useState('');

  const filtered = orders.filter((o) => {
    const ticket = (o.ticket_number || o.id || '').toString().toLowerCase();
    const customer = (customerMap[o.customer_id] || '').toLowerCase();
    const q = search.toLowerCase();
    return ticket.includes(q) || customer.includes(q);
  });

  const deliveryDays = (o) => {
    if (!o.created_date || !o.expected_finish_at) return null;
    const diff = (new Date(o.expected_finish_at) - new Date(o.created_date)) / (1000 * 60 * 60 * 24);
    return diff >= 0 ? diff.toFixed(1) : null;
  };

  // Busca itens do orçamento vinculado e telefone do cliente para completar o ticket
  const buildTicketOpts = async (order) => {
    const opts = { items: [], customerPhone: '' };
    try {
      const [cards, customer] = await Promise.all([
        base44.entities.CrmCard.filter({ customer_id: order.customer_id }, '-created_date', 20),
        order.customer_id ? base44.entities.Customer.list().then((all) => all.find((c) => c.id === order.customer_id)) : Promise.resolve(null)
      ]);
      const cardWithQuote = (cards || []).find((c) => c.linked_quote_id);
      if (cardWithQuote) {
        const quote = await base44.entities.Quote.list().then((all) => all.find((q) => q.id === cardWithQuote.linked_quote_id));
        if (quote?.items) opts.items = quote.items;
      }
      if (customer?.phones?.length) opts.customerPhone = customer.phones[0];
    } catch (e) {
      console.warn('Não foi possível carregar itens do orçamento', e);
    }
    return opts;
  };

  const handlePrint = async (order) => {
    toast.info('Preparando ticket...');
    const opts = await buildTicketOpts(order);
    printTicket(order, customerMap[order.customer_id], opts);
  };

  const handleDownload = async (order) => {
    toast.info('Gerando PDF...');
    const opts = await buildTicketOpts(order);
    downloadTicketPdf(order, customerMap[order.customer_id], opts);
  };

  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <Ticket className="h-5 w-5 text-[#FF6600]" /> Tickets de Serviço
            </CardTitle>
            <CardDescription className="text-gray-300">Pedidos da lavanderia com prazo de entrega</CardDescription>
          </div>
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Buscar ticket ou cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-white/10 bg-white/5 pl-9 text-white"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-gray-400">Ticket</TableHead>
                <TableHead className="text-gray-400">Cliente</TableHead>
                <TableHead className="text-gray-400">Abertura</TableHead>
                <TableHead className="text-gray-400">Previsão</TableHead>
                <TableHead className="text-gray-400">Prazo (dias)</TableHead>
                <TableHead className="text-gray-400">Valor</TableHead>
                <TableHead className="text-gray-400">Pagamento</TableHead>
                <TableHead className="text-gray-400">Status</TableHead>
                <TableHead className="text-right text-gray-400">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow className="border-white/10">
                  <TableCell colSpan={9} className="py-8 text-center text-gray-500">Nenhum ticket encontrado</TableCell>
                </TableRow>
              ) : (
                filtered.map((o) => {
                  const st = STATUS_LABEL[o.status] || { label: o.status, cls: 'bg-white/10 text-gray-300' };
                  return (
                    <TableRow key={o.id} className="border-white/10">
                      <TableCell className="font-mono text-white">#{o.ticket_number || o.id.slice(-6)}</TableCell>
                      <TableCell className="text-gray-200">{customerMap[o.customer_id] || 'Desconhecido'}</TableCell>
                      <TableCell className="text-gray-400">{fmtDate(o.created_date)}</TableCell>
                      <TableCell className="text-gray-400">{fmtDate(o.expected_finish_at)}</TableCell>
                      <TableCell className="text-gray-300">{deliveryDays(o) ?? '—'}</TableCell>
                      <TableCell className="text-[#25D366]">R$ {Number(o.total_amount || 0).toFixed(2)}</TableCell>
                      <TableCell><PaymentStatusBadge status={o.payment_status} /></TableCell>
                      <TableCell><Badge className={`border ${st.cls}`}>{st.label}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Editar"
                            onClick={() => onEdit && onEdit(o)}
                            className="h-8 w-8 text-gray-300 hover:bg-white/10 hover:text-[#FF6600]"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Baixar PDF"
                            onClick={() => handleDownload(o)}
                            className="h-8 w-8 text-gray-300 hover:bg-white/10 hover:text-[#FF6600]"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Imprimir"
                            onClick={() => handlePrint(o)}
                            className="h-8 w-8 text-gray-300 hover:bg-white/10 hover:text-[#25D366]"
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                          {onDelete && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Apagar ticket"
                              onClick={() => onDelete(o)}
                              className="h-8 w-8 text-gray-300 hover:bg-white/10 hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
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