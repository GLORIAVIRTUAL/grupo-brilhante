import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { 
  Send, 
  Calendar, 
  Star, 
  UserX, 
  Clock, 
  Gift, 
  MessageCircle,
  Filter,
  Download,
  Search,
  CheckCircle,
  XCircle,
  Eye,
  ShieldCheck
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from "sonner";
import NewDispatchModal from '@/components/dispatches/NewDispatchModal';

export default function Dispatches() {
  const [dispatches, setDispatches] = useState([]);
  const [customers, setCustomers] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showNewDispatch, setShowNewDispatch] = useState(false);

  useEffect(() => {
    loadData();
    
    const unsub = base44.entities.AutomatedDispatch.subscribe((event) => {
      if (event.type === 'create' || event.type === 'update') {
        loadData();
      }
    });
    
    return () => unsub();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [dispatchList, customerList, orderList] = await Promise.all([
        base44.entities.AutomatedDispatch.list('-sent_at', 5000),
        // Limitando a busca a 10000 pra suportar toda a base sem explodir a memória do app 
        base44.entities.Customer.list(null, 10000),
        // Tickets (Orders) recentes para cálculo de retorno
        base44.entities.Order.list('-created_date', 10000)
      ]);
      
      const custMap = {};
      customerList.forEach(c => custMap[c.id] = c);

      // Index tickets por cliente
      const ordersByCustomer = {};
      orderList.forEach(o => {
        if (!o.customer_id) return;
        if (!ordersByCustomer[o.customer_id]) ordersByCustomer[o.customer_id] = [];
        ordersByCustomer[o.customer_id].push(o);
      });
      
      // Calculate return metrics (30 days window) baseado em TICKETS abertos
      const enrichedDispatches = dispatchList.map(dispatch => {
        const sentDate = dispatch.sent_at ? new Date(dispatch.sent_at) : null;
        if (!sentDate) return { ...dispatch, returned: false, returnTickets: [], returnValue: 0 };
        
        const windowEnd = new Date(sentDate);
        windowEnd.setDate(windowEnd.getDate() + 30);
        
        const customerOrders = ordersByCustomer[dispatch.customer_id] || [];
        
        // Tickets abertos pelo cliente dentro de 30 dias após o disparo
        const returnTickets = customerOrders
          .filter(o => {
            if (!o.created_date) return false;
            const openedAt = new Date(o.created_date);
            return openedAt >= sentDate && openedAt <= windowEnd;
          })
          .sort((a, b) => new Date(a.created_date) - new Date(b.created_date))
          .map(o => ({
            id: o.id,
            ticket_number: o.ticket_number || (o.id ? o.id.slice(-6).toUpperCase() : '—'),
            amount: o.total_amount || 0,
            date: o.created_date
          }));

        const returnValue = returnTickets.reduce((sum, t) => sum + (t.amount || 0), 0);
        
        return { 
          ...dispatch, 
          returned: returnTickets.length > 0,
          returnTickets,
          returnValue
        };
      });
      
      setDispatches(enrichedDispatches);
      setCustomers(custMap);
    } catch (error) {
      console.error("Error loading dispatches:", error);
      toast.error("Erro ao carregar disparos");
    } finally {
      setLoading(false);
    }
  };

  const typeIcons = {
    consent_request: { icon: ShieldCheck, label: 'Solicitação de consentimento', color: 'text-emerald-500 bg-emerald-500/10' },
    birthday: { icon: Calendar, label: 'Aniversariante', color: 'text-pink-500 bg-pink-500/10' },
    satisfaction_survey: { icon: Star, label: 'Pesquisa de Satisfação', color: 'text-yellow-500 bg-yellow-500/10' },
    inactive_customer: { icon: UserX, label: 'Cliente Ausente', color: 'text-orange-500 bg-orange-500/10' },
    order_reminder: { icon: Clock, label: 'Lembrete de Pedido', color: 'text-blue-500 bg-blue-500/10' },
    promotional: { icon: Gift, label: 'Promocional', color: 'text-purple-500 bg-purple-500/10' },
    follow_up: { icon: MessageCircle, label: 'Follow-up', color: 'text-green-500 bg-green-500/10' }
  };

  const statusConfig = {
    sent: { label: 'Enviado', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
    delivered: { label: 'Entregue', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
    read: { label: 'Lido', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
    failed: { label: 'Falhou', color: 'bg-red-500/10 text-red-400 border-red-500/20' }
  };

  const filteredDispatches = dispatches.filter(d => {
    const customer = customers[d.customer_id];
    const matchesSearch = !searchTerm || 
      customer?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.phone?.includes(searchTerm);
    const matchesType = filterType === 'all' || d.type === filterType;
    const matchesStatus = filterStatus === 'all' || d.status === filterStatus;
    
    return matchesSearch && matchesType && matchesStatus;
  });

  const stats = {
    total: dispatches.length,
    sent: dispatches.filter(d => d.status === 'sent' || d.status === 'delivered' || d.status === 'read').length,
    failed: dispatches.filter(d => d.status === 'failed').length,
    returned: dispatches.filter(d => d.returned).length,
    conversionRate: dispatches.length > 0 
      ? ((dispatches.filter(d => d.returned).length / dispatches.length) * 100).toFixed(1)
      : 0
  };

  const handleExportReport = () => {
    toast.info("Gerando relatório...");
    
    const csv = [
      ['Data/Hora', 'Tipo', 'Cliente', 'Telefone', 'Status', 'Retornou (30d)', 'Qtd Tickets', 'Tickets', 'Valor Retorno', 'Mensagem'].join(';'),
      ...filteredDispatches.map(d => [
        d.sent_at ? format(new Date(d.sent_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '',
        typeIcons[d.type]?.label || d.type,
        customers[d.customer_id]?.full_name || 'Desconhecido',
        `="${d.phone || ''}"`,
        statusConfig[d.status]?.label || d.status,
        d.returned ? 'Sim' : 'Não',
        d.returnTickets?.length || 0,
        `"${(d.returnTickets || []).map(t => `#${t.ticket_number} (R$ ${(t.amount || 0).toFixed(2)})`).join(', ')}"`,
        d.returnValue ? `R$ ${d.returnValue.toFixed(2)}` : '',
        `"${(d.message || '').replace(/"/g, '""')}"`
      ].join(';'))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-disparos-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
    
    toast.success("Relatório exportado!");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Send className="w-8 h-8 text-[#FF6600]" />
            Disparos Automáticos
          </h1>
          <p className="text-gray-400 mt-1">Histórico de mensagens enviadas automaticamente</p>
        </div>
        
        <div className="flex gap-3">
          <Button onClick={() => setShowNewDispatch(true)} className="bg-[#FF6600] hover:bg-[#e55c00] gap-2">
            <Send className="w-4 h-4" /> Novo Disparo
          </Button>
          <Button onClick={handleExportReport} variant="outline" className="bg-transparent border-white/20 text-white hover:bg-white/10 gap-2">
            <Download className="w-4 h-4" /> Relatório
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Enviado', value: stats.total, icon: Send, color: 'from-blue-500 to-blue-600' },
          { label: 'Sucesso', value: stats.sent, icon: CheckCircle, color: 'from-green-500 to-green-600' },
          { label: 'Falhas', value: stats.failed, icon: XCircle, color: 'from-red-500 to-red-600' },
          { label: 'Retornaram (30d)', value: stats.returned, icon: Star, color: 'from-yellow-500 to-yellow-600' },
          { label: 'Taxa Conversão', value: `${stats.conversionRate}%`, icon: Gift, color: 'from-purple-500 to-purple-600' }
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">{stat.label}</p>
                <p className="text-3xl font-bold text-white mt-1">{stat.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              placeholder="Buscar por cliente ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-white/5 border-white/10"
            />
          </div>
          
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-full md:w-48 bg-white/5 border-white/10">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Tipos</SelectItem>
              {Object.entries(typeIcons).map(([key, val]) => (
                <SelectItem key={key} value={key}>{val.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full md:w-48 bg-white/5 border-white/10">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              {Object.entries(statusConfig).map(([key, val]) => (
                <SelectItem key={key} value={key}>{val.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Dispatches List */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-20 text-center text-gray-400">Carregando...</div>
        ) : filteredDispatches.length === 0 ? (
          <div className="p-20 text-center">
            <Send className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">Nenhum disparo encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-black/20 border-b border-white/10">
                <tr>
                  <th className="text-left p-4 text-gray-400 font-medium">Data/Hora</th>
                  <th className="text-left p-4 text-gray-400 font-medium">Tipo</th>
                  <th className="text-left p-4 text-gray-400 font-medium">Cliente</th>
                  <th className="text-left p-4 text-gray-400 font-medium">Mensagem</th>
                  <th className="text-left p-4 text-gray-400 font-medium">Status</th>
                  <th className="text-left p-4 text-gray-400 font-medium">Retorno 30d</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredDispatches.map((dispatch) => {
                  const typeInfo = typeIcons[dispatch.type] || { icon: Send, label: dispatch.type, color: 'text-gray-500' };
                  const Icon = typeInfo.icon;
                  const customer = customers[dispatch.customer_id];
                  
                  return (
                    <motion.tr
                      key={dispatch.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="hover:bg-white/5 transition-colors"
                    >
                      <td className="p-4 text-gray-300 text-sm whitespace-nowrap">
                        {dispatch.sent_at ? format(new Date(dispatch.sent_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-'}
                      </td>
                      <td className="p-4">
                        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${typeInfo.color}`}>
                          <Icon className="w-4 h-4" />
                          <span className="text-sm font-medium">{typeInfo.label}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div>
                          <p className="text-white font-medium">{customer?.full_name || 'Desconhecido'}</p>
                          <p className="text-gray-500 text-xs">{dispatch.phone}</p>
                        </div>
                      </td>
                      <td className="p-4 text-gray-300 text-sm max-w-md truncate">
                        {dispatch.message}
                      </td>
                      <td className="p-4">
                        <Badge className={`${statusConfig[dispatch.status]?.color || ''} border`}>
                          {statusConfig[dispatch.status]?.label || dispatch.status}
                        </Badge>
                      </td>
                      <td className="p-4">
                        {dispatch.type === 'consent_request' && dispatch.metadata?.consent_response_text ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-emerald-400" />
                              <span className="text-emerald-400 font-medium text-sm">
                                {dispatch.metadata.consent_decision === 'accepted' ? 'Consentimento aceito' : 'Consentimento recusado'}
                              </span>
                            </div>
                            <p className="text-gray-400 text-xs">
                              Resposta: {dispatch.metadata.consent_response_text}
                              {dispatch.metadata.consent_responded_at ? ` · ${format(new Date(dispatch.metadata.consent_responded_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}` : ''}
                            </p>
                          </div>
                        ) : dispatch.returned ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-green-400" />
                              <span className="text-green-400 font-medium text-sm">
                                {dispatch.returnTickets.length} ticket{dispatch.returnTickets.length > 1 ? 's' : ''}
                              </span>
                              {dispatch.returnTickets.length > 1 && (
                                <span className="text-gray-300 text-xs font-semibold">
                                  Total: R$ {dispatch.returnValue.toFixed(2)}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {dispatch.returnTickets.map((t) => (
                                <span
                                  key={t.id}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-500/10 border border-green-500/20 text-green-300 text-[11px]"
                                  title={t.date ? format(new Date(t.date), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : ''}
                                >
                                  Ticket #{t.ticket_number} · R$ {(t.amount || 0).toFixed(2)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-500 text-sm">Sem retorno</span>
                        )}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <NewDispatchModal 
        open={showNewDispatch} 
        onOpenChange={setShowNewDispatch} 
        onSent={loadData} 
      />
    </div>
  );
}