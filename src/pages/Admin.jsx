import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { 
  Building2, 
  Plus, 
  CreditCard, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Clock,
  Search,
  MoreHorizontal,
  LogOut,
  LayoutDashboard,
  ShieldCheck
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function Admin() {
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [authorized, setAuthorized] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const isAuth = await base44.auth.isAuthenticated();
        if (!isAuth) {
          setAuthorized(false);
          await base44.auth.redirectToLogin('/admin');
          return;
        }
        setAuthorized(true);
      } catch (e) {
        setAuthorized(false);
        await base44.auth.redirectToLogin('/admin');
      }
    })();
  }, []);

  useEffect(() => {
    if (authorized !== true) return;
    fetchUnits();
    
    // Subscribe to unit changes
    const unsubscribe = base44.entities.Unit.subscribe(() => {
        fetchUnits();
    });

    return () => unsubscribe();
  }, [authorized]);

  const fetchUnits = async () => {
    try {
      const data = await base44.entities.Unit.list('-created_at');
      setUnits(data);
    } catch (error) {
      console.error("Error fetching units:", error);
      toast.error("Erro ao carregar unidades.");
    } finally {
      setLoading(false);
    }
  };

  const filteredUnits = units.filter(unit => 
    unit.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    unit.subdomain.toLowerCase().includes(searchTerm.toLowerCase()) ||
    unit.owner_email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500/20 text-green-400 hover:bg-green-500/30 border-green-500/50">Ativo</Badge>;
      case 'inactive':
        return <Badge className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/50">Inativo</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 border-yellow-500/50">Pendente</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPaymentStatusBadge = (status) => {
    switch (status) {
      case 'paid':
        return (
            <div className="flex items-center gap-1.5 text-green-400 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" />
                <span>Em dia</span>
            </div>
        );
      case 'late':
        return (
            <div className="flex items-center gap-1.5 text-red-400 text-sm font-medium">
                <AlertCircle className="w-4 h-4" />
                <span>Atrasado</span>
            </div>
        );
      case 'trial':
        return (
            <div className="flex items-center gap-1.5 text-blue-400 text-sm font-medium">
                <Clock className="w-4 h-4" />
                <span>Trial</span>
            </div>
        );
       case 'cancelled':
        return (
            <div className="flex items-center gap-1.5 text-gray-400 text-sm font-medium">
                <XCircle className="w-4 h-4" />
                <span>Cancelado</span>
            </div>
        );
      default:
        return <span className="text-gray-500">-</span>;
    }
  };

  if (authorized !== true) {
    return (
      <div className="min-h-screen bg-[#1a0b36] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#FF6600] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a0b36] text-white font-sans selection:bg-[#FF6600] selection:text-white relative overflow-hidden">
        {/* Background Elements */}
        <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#4C12A1] blur-[150px] opacity-40 pointer-events-none" />
        <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-[#FF6600] blur-[150px] opacity-20 pointer-events-none" />

        {/* Header */}
        <header className="relative z-10 border-b border-white/10 bg-white/5 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                <div className="flex items-center gap-3">
                     <div className="w-9 h-9 bg-gradient-to-br from-[#FF6600] to-orange-600 rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-orange-500/20">
                        <ShieldCheck className="text-white w-5 h-5" />
                     </div>
                     <span className="font-bold text-lg tracking-tight">
                        ADMIN<span className="text-[#FF6600]">5àsec</span>
                     </span>
                </div>
                <div className="flex items-center gap-4">
                     <Link to="/landing">
                        <Button variant="ghost" className="text-gray-400 hover:text-white hover:bg-white/10 gap-2">
                            <LogOut className="w-4 h-4" />
                            Sair
                        </Button>
                     </Link>
                </div>
            </div>
        </header>

        <main className="relative z-10 max-w-7xl mx-auto p-6 lg:p-10 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                    Gestão de Franquias
                  </h1>
                  <p className="text-gray-400 mt-1">Visão geral das unidades e saúde financeira da rede.</p>
                </div>
                <Link to="/register-unit">
                  <Button className="bg-[#FF6600] hover:bg-[#e55c00] text-white shadow-lg shadow-orange-500/20">
                    <Plus className="w-4 h-4 mr-2" />
                    Nova Unidade
                  </Button>
                </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-500/20 rounded-xl">
                            <Building2 className="w-6 h-6 text-blue-400" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-400 font-medium">Total de Unidades</p>
                            <p className="text-3xl font-bold text-white mt-1">{units.length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-green-500/20 rounded-xl">
                            <CheckCircle2 className="w-6 h-6 text-green-400" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-400 font-medium">Unidades Ativas</p>
                            <p className="text-3xl font-bold text-white mt-1">
                                {units.filter(u => u.status === 'active').length}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-red-500/20 rounded-xl">
                            <AlertCircle className="w-6 h-6 text-red-400" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-400 font-medium">Pagamentos Atrasados</p>
                            <p className="text-3xl font-bold text-white mt-1">
                                {units.filter(u => u.payment_status === 'late').length}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-white">Todas as Unidades</h2>
                    <div className="flex items-center gap-2 w-full max-w-sm">
                        <div className="relative w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <Input 
                                placeholder="Buscar por nome, email ou domínio..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:bg-white/10"
                            />
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/5 backdrop-blur-md shadow-2xl">
                    <Table>
                        <TableHeader className="bg-black/20">
                            <TableRow className="border-white/10 hover:bg-transparent">
                                <TableHead className="text-gray-300 font-medium py-4 pl-6">Unidade</TableHead>
                                <TableHead className="text-gray-300 font-medium">Responsável</TableHead>
                                <TableHead className="text-gray-300 font-medium">Status</TableHead>
                                <TableHead className="text-gray-300 font-medium">Pagamento (Stripe)</TableHead>
                                <TableHead className="text-gray-300 font-medium">Criado em</TableHead>
                                <TableHead className="text-right text-gray-300 font-medium pr-6">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center text-gray-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-6 h-6 border-2 border-[#FF6600] border-t-transparent rounded-full animate-spin" />
                                            <p>Carregando unidades...</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : filteredUnits.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center text-gray-400">
                                        Nenhuma unidade encontrada.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredUnits.map((unit) => (
                                    <TableRow key={unit.id} className="border-white/5 hover:bg-white/5 transition-colors group">
                                        <TableCell className="pl-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center border border-white/10 group-hover:border-[#FF6600]/30 transition-colors">
                                                    <Building2 className="w-5 h-5 text-gray-400 group-hover:text-[#FF6600]" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-white">{unit.name}</span>
                                                    <span className="text-xs text-gray-500 font-mono mt-0.5">{unit.subdomain}.chat5asec.com.br</span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-gray-300">{unit.owner_email}</TableCell>
                                        <TableCell>{getStatusBadge(unit.status)}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                {getPaymentStatusBadge(unit.payment_status)}
                                                {unit.last_payment_date && (
                                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                                                        {format(new Date(unit.last_payment_date), "dd/MM/yy", { locale: ptBR })}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-gray-400 text-sm">
                                            {unit.created_at ? format(new Date(unit.created_at), "dd/MM/yyyy", { locale: ptBR }) : '-'}
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-white hover:bg-white/10">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="bg-[#1a0b36] border-white/10 text-white shadow-xl w-48">
                                                    <DropdownMenuLabel>Gerenciar</DropdownMenuLabel>
                                                    <DropdownMenuItem className="focus:bg-white/10 cursor-pointer gap-2">
                                                        <LayoutDashboard className="w-4 h-4" /> Acessar Painel
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem className="focus:bg-white/10 cursor-pointer gap-2">
                                                        <CreditCard className="w-4 h-4" /> Assinatura
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator className="bg-white/10" />
                                                    <DropdownMenuItem className="text-red-400 focus:bg-red-500/10 cursor-pointer gap-2 focus:text-red-400">
                                                        <XCircle className="w-4 h-4" /> Desativar Unidade
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </main>
    </div>
  );
}