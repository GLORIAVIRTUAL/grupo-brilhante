import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { format, startOfDay, isSameDay, parseISO, eachDayOfInterval, getDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  Truck, 
  Clock, 
  MapPin, 
  Plus, 
  Search,
  CheckCircle,
  XCircle,
  Bot,
  Phone,
  Store,
  Pencil,
  GripVertical,
  Receipt,
  CheckCircle2
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { motion } from "framer-motion";
import PickupRoutePlanner from '@/components/pickups/PickupRoutePlanner';
import LogisticsOperationsPanel from '@/components/pickups/LogisticsOperationsPanel';
import EditPickupModal from '@/components/pickups/EditPickupModal';
import AdvancedQuoteModal from '@/components/crm/AdvancedQuoteModal';
import OverflowPickupsSection from '@/components/pickups/OverflowPickupsSection';
import PickupAuditInfo from '@/components/pickups/PickupAuditInfo';
import MultiDatesSection from '@/components/pickups/MultiDatesSection';
import ServiceKindSelector from '@/components/pickups/ServiceKindSelector';
import ServiceKindBadge from '@/components/pickups/ServiceKindBadge';
import { loadAllCustomers } from '@/lib/loadAllCustomers';
import { buildPickupIso, formatBrasiliaDateTime, getBrasiliaTimeParts, isSameBrasiliaDay } from '@/lib/pickupDateTime';

const formatBR = formatBrasiliaDateTime;

export default function Pickups() {
  const [date, setDate] = useState(new Date());
  const [pickups, setPickups] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerMap, setCustomerMap] = useState({});
  const [units, setUnits] = useState({});
  const [userMap, setUserMap] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isNewPickupOpen, setIsNewPickupOpen] = useState(false);
  const [editingPickup, setEditingPickup] = useState(null);
  const [cancelFixedPickup, setCancelFixedPickup] = useState(null);
  const [ticketPickup, setTicketPickup] = useState(null);

  // Abre o fluxo de orçamento/ticket já com o cliente da coleta pré-selecionado
  const handleGenerateTicket = (pickup) => {
    const customer = customerMap[pickup.customer_id];
    (/** @type {any} */ (window)).initialQuoteData = {
      id: pickup.customer_id,
      name: customer?.full_name || '',
      phone: (customer?.phones && customer.phones[0]) || ''
    };
    setTicketPickup(pickup);
  };

  // New Pickup Form State
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedShift, setSelectedShift] = useState('morning');
  const [address, setAddress] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [addressComplement, setAddressComplement] = useState('');
  const [cep, setCep] = useState('');
  const [fetchingCep, setFetchingCep] = useState(false);
  const [notes, setNotes] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [priority, setPriority] = useState(false);
  const [serviceKind, setServiceKind] = useState('dirty');
  const [isExtraPickup, setIsExtraPickup] = useState(false);
  const [isFixedPickup, setIsFixedPickup] = useState(false);
  const [fixedStartDate, setFixedStartDate] = useState('');
  const [fixedEndDate, setFixedEndDate] = useState('');
  const [fixedDays, setFixedDays] = useState([]);
  const [multiDatesEnabled, setMultiDatesEnabled] = useState(false);
  const [multiCount, setMultiCount] = useState(2);
  const [extraDates, setExtraDates] = useState(['']);

  const handleMultiCountChange = (count) => {
    setMultiCount(count);
    setExtraDates(prev => {
      const next = [...prev];
      next.length = count - 1;
      return Array.from(next, v => v || '');
    });
  };

  const handleExtraDateChange = (index, value) => {
    setExtraDates(prev => prev.map((v, i) => (i === index ? value : v)));
  };

  // Subscribe to changes + polling de segurança (caso o evento em tempo real se perca)
  useEffect(() => {
    loadData();
    const unsub = base44.entities.Pickup.subscribe(() => loadData());
    const poll = setInterval(() => loadData(), 20000);
    return () => { unsub(); clearInterval(poll); };
  }, [date]);

  const loadData = async () => {
    try {
      setLoading(true);

      // 1) Carrega o essencial (rápido) — a agenda não fica bloqueada pela lista de clientes
      const [userRes, pickupsRes, unitsRes, usersRes] = await Promise.allSettled([
        base44.auth.me(),
        base44.entities.Pickup.list('-scheduled_at', 5000),
        base44.entities.Unit.list('name', 1000),
        base44.entities.User.list('full_name', 1000)
      ]);

      if (userRes.status === 'fulfilled') setCurrentUser(userRes.value);
      const allPickups = pickupsRes.status === 'fulfilled' ? pickupsRes.value : [];
      const allUnits = unitsRes.status === 'fulfilled' ? unitsRes.value : [];
      const allUsers = usersRes.status === 'fulfilled' ? usersRes.value : [];

      if (pickupsRes.status === 'rejected') console.error('Pickup.list falhou:', pickupsRes.reason);
      if (unitsRes.status === 'rejected') console.error('Unit.list falhou:', unitsRes.reason);

      const unitMap = {};
      allUnits.forEach(u => { unitMap[u.id] = u; });

      // 2) Mapa de clientes a partir dos que já temos em memória + busca individual dos ausentes
      //    (garante que os nomes da agenda apareçam rápido, sem esperar a lista completa)
      const custMap = { ...customerMap };
      const missingIds = [...new Set(
        allPickups
          .map(p => p.customer_id)
          .filter(id => id && !custMap[id])
      )];

      if (missingIds.length > 0) {
        const fetched = await Promise.all(
          missingIds.map(id => base44.entities.Customer.get(id).catch(() => null))
        );
        fetched.forEach(c => {
          if (c) custMap[c.id] = c;
        });
      }

      setPickups(allPickups);
      setCustomerMap(custMap);
      setUnits(unitMap);
      setUserMap(Object.fromEntries(allUsers.map(appUser => [appUser.id, appUser])));
      setLoading(false);

      // 3) Lista completa de clientes (para a busca ao agendar) — em segundo plano, sem travar a tela
      loadAllCustomers()
        .then(allCustomers => {
          const fullMap = { ...custMap };
          allCustomers.forEach(c => { fullMap[c.id] = c; });
          setCustomers(allCustomers);
          setCustomerMap(fullMap);
        })
        .catch(err => console.error('Customer.list falhou:', err));
    } catch (error) {
      console.error("Error loading pickups:", error);
      toast.error("Erro ao carregar coletas");
      setLoading(false);
    }
  };

  const handleCreatePickup = async () => {
    if (!selectedCustomer) {
      toast.error("Selecione um cliente");
      return;
    }

    try {
      // Define slots
      const morningSlots = ['08:00', '09:00', '10:00', '11:00', '12:00'];
      const afternoonSlots = ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];
      const targetSlots = selectedShift === 'morning' ? morningSlots : afternoonSlots;

      const cust = customerMap[selectedCustomer];
      let finalAddress = address;
      if (address && addressNumber) {
          finalAddress += `, ${addressNumber}`;
      }
      if (finalAddress && addressComplement) {
          finalAddress += ` - ${addressComplement}`;
      }

      if (isFixedPickup) {
        if (!fixedStartDate || !fixedEndDate || fixedDays.length === 0) {
          toast.error("Preencha as datas e os dias da semana para a coleta fixa");
          return;
        }

        const startD = parseISO(fixedStartDate);
        const endD = parseISO(fixedEndDate);
        if (startD > endD) {
          toast.error("Data inicial não pode ser maior que a final");
          return;
        }

        const allDays = eachDayOfInterval({ start: startD, end: endD });
        const targetDates = allDays.filter(d => fixedDays.includes(getDay(d)));

        if (targetDates.length === 0) {
          toast.error("Nenhum dia encontrado neste período com os dias selecionados");
          return;
        }

        const [defaultH, defaultM] = targetSlots[0].split(':').map(Number);
        
        const payloads = targetDates.map(d => ({
          customer_id: selectedCustomer,
          scheduled_at: buildPickupIso(d, `${String(defaultH).padStart(2, '0')}:${String(defaultM).padStart(2, '0')}`),
          status: 'scheduled',
          address: finalAddress || cust?.address || 'Endereço não informado',
          notes: notes,
          source: 'human',
          created_by_name: currentUser?.full_name || currentUser?.email || 'Usuário do sistema',
          priority: priority,
          service_kind: serviceKind,
          type: 'fixed'
        }));

        // Batch create sequentially to avoid overload if many records
        for (let i = 0; i < payloads.length; i += 10) {
          const chunk = payloads.slice(i, i + 10);
          await Promise.all(chunk.map(p => base44.entities.Pickup.create(p)));
        }

        toast.success(`${payloads.length} coletas fixas agendadas com sucesso!`);
      } else if (isExtraPickup) {
        // Encaixe: cria a coleta sem consumir slot, no horário inicial do turno escolhido
        const [h, m] = targetSlots[0].split(':').map(Number);
        const scheduledAt = buildPickupIso(date, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

        await base44.entities.Pickup.create({
          customer_id: selectedCustomer,
          scheduled_at: scheduledAt,
          status: 'scheduled',
          address: finalAddress || cust?.address || 'Endereço não informado',
          notes: notes,
          source: 'human',
          created_by_name: currentUser?.full_name || currentUser?.email || 'Usuário do sistema',
          priority: priority,
          service_kind: serviceKind,
          type: 'extra'
        });

        toast.success("Encaixe agendado com sucesso!");
      } else {
        // Datas a agendar: a data selecionada + (opcional) datas extras informadas
        const targetDates = [date];
        if (multiDatesEnabled) {
          const missing = extraDates.some(d => !d);
          if (missing) {
            toast.error("Informe todas as datas das coletas adicionais");
            return;
          }
          extraDates.forEach(d => targetDates.push(parseISO(d)));
        }

        const takenIso = new Set();
        const payloads = [];

        for (const targetDate of targetDates) {
          let scheduledAt = null;

          // Find first available slot
          for (const time of targetSlots) {
            const [h, m] = time.split(':').map(Number);
            const iso = buildPickupIso(targetDate, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
            if (takenIso.has(iso)) continue;

            const isTaken = pickups.some(p => {
               if (p.status === 'cancelled' || p.type === 'fixed' || p.type === 'extra') return false;
               const pickupTime = getBrasiliaTimeParts(p.scheduled_at);
               return isSameBrasiliaDay(p.scheduled_at, targetDate) && pickupTime.hour === h && pickupTime.minute === m;
            });

            if (!isTaken) {
                scheduledAt = iso;
                takenIso.add(iso);
                break;
            }
          }

          if (!scheduledAt) {
            toast.error(`O turno da ${selectedShift === 'morning' ? 'manhã' : 'tarde'} está lotado em ${format(targetDate, 'dd/MM/yyyy')}.`);
            return;
          }

          payloads.push({
            customer_id: selectedCustomer,
            scheduled_at: scheduledAt,
            status: 'scheduled',
            address: finalAddress || cust?.address || 'Endereço não informado',
            notes: notes,
            source: 'human',
            created_by_name: currentUser?.full_name || currentUser?.email || 'Usuário do sistema',
            priority: priority,
            service_kind: serviceKind,
            type: 'regular'
          });
        }

        for (const payload of payloads) {
          await base44.entities.Pickup.create(payload);
        }

        toast.success(payloads.length > 1 ? `${payloads.length} coletas agendadas com sucesso!` : "Coleta agendada com sucesso!");
      }

      setIsNewPickupOpen(false);
      resetForm();
    } catch (error) {
      console.error("Error creating pickup:", error);
      toast.error("Erro ao criar agendamento");
    }
  };

  const handleUpdateStatus = async (id, newStatus) => {
    try {
      await base44.entities.Pickup.update(id, { status: newStatus });
      toast.success("Status atualizado");
    } catch (error) {
      toast.error("Erro ao atualizar status");
    }
  };

  const handleCancelFixed = async (cancelAll) => {
    if (!cancelFixedPickup) return;
    
    try {
      if (cancelAll) {
        const pickupsToCancel = pickups.filter(p => 
          p.customer_id === cancelFixedPickup.customer_id && 
          p.type === 'fixed' && 
          p.status === 'scheduled'
        );
        
        for (let i = 0; i < pickupsToCancel.length; i += 10) {
          const chunk = pickupsToCancel.slice(i, i + 10);
          await Promise.all(chunk.map(p => base44.entities.Pickup.update(p.id, { status: 'cancelled' })));
        }
        toast.success(`${pickupsToCancel.length} coletas fixas canceladas`);
      } else {
        await base44.entities.Pickup.update(cancelFixedPickup.id, { status: 'cancelled' });
        toast.success("Coleta cancelada");
      }
    } catch (error) {
      toast.error("Erro ao cancelar coletas");
    } finally {
      setCancelFixedPickup(null);
    }
  };

  const handleCepChange = async (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 5) {
      value = value.replace(/^(\d{5})(\d)/, '$1-$2');
    }
    setCep(value);
    
    const plainCep = value.replace(/\D/g, '');
    if (plainCep.length === 8) {
      setFetchingCep(true);
      try {
        const response = await fetch(`https://viacep.com.br/ws/${plainCep}/json/`);
        const data = await response.json();
        
        if (!data.erro) {
          setAddress(`${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`);
          toast.success("Endereço encontrado!");
        } else {
          toast.error("CEP não encontrado");
        }
      } catch (error) {
        console.error("Erro ao buscar CEP:", error);
        toast.error("Erro ao buscar CEP");
      } finally {
        setFetchingCep(false);
      }
    }
  };

  const resetForm = () => {
    setSelectedCustomer('');
    setSelectedShift('morning');
    setAddress('');
    setAddressNumber('');
    setAddressComplement('');
    setCep('');
    setNotes('');
    setSearchTerm('');
    setPriority(false);
    setServiceKind('dirty');
    setIsExtraPickup(false);
    setIsFixedPickup(false);
    setFixedStartDate('');
    setFixedEndDate('');
    setFixedDays([]);
    setMultiDatesEnabled(false);
    setMultiCount(2);
    setExtraDates(['']);
  };

  const morningSlotsDef = ['08:00', '09:00', '10:00', '11:00', '12:00'];
  const afternoonSlotsDef = ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];

  const timeSlots = [
    ...morningSlotsDef.map((time, idx) => {
      const [hour, minute] = time.split(':').map(Number);
      return { time, label: `Coleta ${idx + 1}`, period: 'Manhã', hour, minute, shift: 'morning', index: idx };
    }),
    ...afternoonSlotsDef.map((time, idx) => {
      const [hour, minute] = time.split(':').map(Number);
      return { time, label: `Coleta ${idx + 1}`, period: 'Tarde', hour, minute, shift: 'afternoon', index: idx };
    })
  ];

  // Allocate one pickup per slot, ordered by scheduled time, separated by shift (morning/afternoon)
  // Encaixes (type === 'extra') NÃO ocupam slot — são exibidos em uma seção separada.
  const allocatePickupsToSlots = () => {
    const dayPickups = pickups
      .filter(p => isSameBrasiliaDay(p.scheduled_at, date) && p.status !== 'cancelled' && p.type !== 'extra')
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

    const morningPickups = dayPickups.filter(p => getBrasiliaTimeParts(p.scheduled_at).hour < 13);
    const afternoonPickups = dayPickups.filter(p => getBrasiliaTimeParts(p.scheduled_at).hour >= 13);

    const slotMap = {};
    morningSlotsDef.forEach((time, idx) => {
      slotMap[`morning-${idx}`] = morningPickups[idx] || null;
    });
    afternoonSlotsDef.forEach((time, idx) => {
      slotMap[`afternoon-${idx}`] = afternoonPickups[idx] || null;
    });
    // Coletas além da capacidade dos slots NÃO podem sumir da tela —
    // vão para uma seção de "excedentes" visível abaixo da agenda.
    const overflow = [
      ...morningPickups.slice(morningSlotsDef.length),
      ...afternoonPickups.slice(afternoonSlotsDef.length)
    ];
    return { slotMap, overflow };
  };

  const { slotMap: slotAllocation, overflow: overflowPickups } = allocatePickupsToSlots();

  // Encaixes (coletas extras) do dia selecionado — não consomem slot, aparecem em seção separada
  const extraPickupsForDay = pickups
    .filter(p => isSameBrasiliaDay(p.scheduled_at, date) && p.status !== 'cancelled' && p.type === 'extra')
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  const handleDragEnd = async (result) => {
    if (!result.destination) return;
    const { source, destination } = result;
    if (source.droppableId === destination.droppableId) return;

    const sourcePickup = slotAllocation[source.droppableId];
    const destPickup = slotAllocation[destination.droppableId];
    if (!sourcePickup) return;

    const [destShift, destIdxStr] = destination.droppableId.split('-');
    const destIdx = parseInt(destIdxStr, 10);
    const destTime = (destShift === 'morning' ? morningSlotsDef : afternoonSlotsDef)[destIdx];
    const [destH, destM] = destTime.split(':').map(Number);
    const newSourceDate = buildPickupIso(date, `${String(destH).padStart(2, '0')}:${String(destM).padStart(2, '0')}`);

    try {
      if (destPickup) {
        // Swap: move dest to source's old slot
        const [srcShift, srcIdxStr] = source.droppableId.split('-');
        const srcIdx = parseInt(srcIdxStr, 10);
        const srcTime = (srcShift === 'morning' ? morningSlotsDef : afternoonSlotsDef)[srcIdx];
        const [srcH, srcM] = srcTime.split(':').map(Number);
        const newDestDate = buildPickupIso(date, `${String(srcH).padStart(2, '0')}:${String(srcM).padStart(2, '0')}`);

        await Promise.all([
          base44.entities.Pickup.update(sourcePickup.id, { scheduled_at: newSourceDate }),
          base44.entities.Pickup.update(destPickup.id, { scheduled_at: newDestDate })
        ]);
        toast.success("Coletas trocadas de posição");
      } else {
        await base44.entities.Pickup.update(sourcePickup.id, { scheduled_at: newSourceDate });
        toast.success("Coleta movida");
      }
    } catch (error) {
      console.error("Error reordering pickup:", error);
      toast.error("Erro ao reordenar coleta");
    }
  };

  const normalizeDigits = (str) => (str || '').replace(/\D/g, '');
  // Todos os usuários da agenda podem buscar qualquer cliente, de qualquer unidade.
  const availableCustomers = customers;
  
  const filteredCustomers = availableCustomers.filter(c => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase().trim();
    const termDigits = normalizeDigits(term);
    
    // Match by name
    if (c.full_name?.toLowerCase().includes(term)) return true;
    
    // Match by phone (normalized - ignoring formatting, DDD, country code differences)
    if (termDigits.length >= 3 && c.phones?.some(p => {
      const phoneDigits = normalizeDigits(p);
      // Match if search digits appear anywhere in phone digits
      // Also match last N digits (handles cases where stored phone has country code but search doesn't)
      return phoneDigits.includes(termDigits) || termDigits.includes(phoneDigits.slice(-termDigits.length));
    })) return true;
    
    return false;
  }).slice(0, 100);

  const isPastMorning = isSameDay(date, new Date()) && new Date().getHours() >= 12;

  useEffect(() => {
    if (isPastMorning && selectedShift === 'morning') {
      setSelectedShift('afternoon');
    }
  }, [isPastMorning, selectedShift]);

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white flex items-center justify-center gap-3">
            <Truck className="w-8 h-8 text-[#FF6600]" />
            Agenda de Coletas
          </h1>
          <p className="text-gray-400 mt-1">Gerencie os agendamentos de retirada e entrega</p>
          <p className="text-xs text-[#FF6600] mt-2">Busca liberada para clientes de todas as unidades.</p>
        </div>
        
        <Dialog open={isNewPickupOpen} onOpenChange={(open) => { setIsNewPickupOpen(open); if (!open) resetForm(); else { setIsExtraPickup(false); setIsFixedPickup(false); } }}>
          <div className="flex justify-center">
            <DialogTrigger asChild>
              <Button className="gap-3 animate-pulse rounded-2xl border-2 border-[#FF6600]/60 bg-[#FF6600]/10 px-12 py-7 text-xl font-bold text-[#FF6600] shadow-lg shadow-[#FF6600]/20 backdrop-blur-sm hover:bg-[#FF6600]/20">
                <Plus className="w-7 h-7" /> Nova Coleta
              </Button>
            </DialogTrigger>
          </div>
          <DialogContent className="bg-[#1a0b36] border-white/10 text-white sm:max-w-[500px] p-0 overflow-hidden">
            <div className="p-6 pb-0">
              <DialogHeader>
                <DialogTitle>Agendar Nova Coleta</DialogTitle>
              </DialogHeader>
            </div>
            <div className="space-y-4 p-6 pt-4 pb-8 max-h-[75vh] overflow-y-auto custom-scrollbar">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Data</label>
                <div className="p-2 border border-white/10 rounded-md bg-white/5 text-center">
                  {format(date, "EEEE, d 'de' MMMM", { locale: ptBR })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Cliente</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                  <Input 
                    placeholder="Buscar cliente..." 
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="pl-9 bg-white/5 border-white/10"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                {searchTerm && !selectedCustomer && (
                  <div className="border border-white/10 rounded-md bg-black/20 mt-1 max-h-48 overflow-y-auto">
                    {filteredCustomers.length > 0 ? filteredCustomers.map(c => (
                      <div 
                        key={c.id}
                        onClick={() => {
                          setSelectedCustomer(c.id);
                          setSearchTerm(c.full_name);
                          setAddress(c.address || '');
                          if (c.address_number) setAddressNumber(c.address_number);
                          if (c.address_complement) setAddressComplement(c.address_complement);
                          if (c.zip_code) setCep(c.zip_code);
                        }}
                        className="p-2.5 hover:bg-white/10 cursor-pointer flex justify-between items-center gap-2"
                      >
                        <div className="min-w-0">
                          <span className="text-sm text-white block truncate">{c.full_name}</span>
                          {c.phones?.[0] && (
                            <span className="text-xs text-gray-500">{c.phones[0]}</span>
                          )}
                        </div>
                        {c.preferred_unit_name && (
                          <span className="text-[10px] text-[#FF6600] whitespace-nowrap">{c.preferred_unit_name}</span>
                        )}
                      </div>
                    )) : (
                      <div className="p-3 text-sm text-gray-500 text-center flex flex-col items-center gap-2">
                        <span>Nenhum cliente encontrado</span>
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="sm" 
                          onClick={() => window.open('/customers', '_blank')}
                          className="bg-white/5 border-white/10 hover:bg-white/10 mt-1"
                        >
                          + Novo Cliente
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {selectedCustomer && (
                  <div className="flex items-center gap-2 mt-1 p-2 bg-[#FF6600]/10 border border-[#FF6600]/20 rounded-md">
                    <CheckCircle className="w-4 h-4 text-[#FF6600] shrink-0" />
                    <span className="text-sm text-white truncate">{searchTerm}</span>
                    <button 
                      onClick={() => { setSelectedCustomer(''); setSearchTerm(''); }}
                      className="ml-auto text-xs text-gray-400 hover:text-white"
                    >
                      Trocar
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Turno</label>
                <Select value={selectedShift} onValueChange={setSelectedShift}>
                  <SelectTrigger className="bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="morning" disabled={isPastMorning}>Manhã (08h - 12h)</SelectItem>
                    <SelectItem value="afternoon">Tarde (13h - 16h)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  O sistema irá alocar automaticamente a primeira vaga disponível no turno.
                </p>
              </div>

              <ServiceKindSelector value={serviceKind} onChange={setServiceKind} />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">CEP</label>
                  <div className="relative">
                    <Input 
                      value={cep}
                      onChange={handleCepChange}
                      maxLength={9}
                      className="bg-white/5 border-white/10"
                      placeholder="00000-000"
                    />
                    {fetchingCep && <div className="absolute right-3 top-2.5 w-4 h-4 rounded-full border-2 border-white/20 border-t-[#FF6600] animate-spin" />}
                  </div>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-gray-300">Endereço</label>
                  <Input 
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="bg-white/5 border-white/10"
                    placeholder="Endereço completo, Bairro, Cidade - UF"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">Número</label>
                  <Input 
                    value={addressNumber}
                    onChange={(e) => setAddressNumber(e.target.value)}
                    className="bg-white/5 border-white/10"
                    placeholder="Ex: 123"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-gray-300">Complemento</label>
                  <Input 
                    value={addressComplement}
                    onChange={(e) => setAddressComplement(e.target.value)}
                    className="bg-white/5 border-white/10"
                    placeholder="Ex: Apto 402, Bloco B"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Observações</label>
                <Textarea 
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="bg-white/5 border-white/10"
                  placeholder="Ex: Tocar interfone 102"
                />
              </div>

              <div className="flex items-center justify-between bg-red-500/10 border border-red-500/20 p-3 rounded-md">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium text-red-400">Coleta Prioritária</label>
                  <p className="text-xs text-red-400/70">Destacar esta coleta com selo de prioridade</p>
                </div>
                <Switch checked={priority} onCheckedChange={setPriority} className="data-[state=checked]:bg-red-500" />
              </div>

              {!isFixedPickup && !isExtraPickup && (
                <MultiDatesSection
                  enabled={multiDatesEnabled}
                  onToggle={setMultiDatesEnabled}
                  count={multiCount}
                  onCountChange={handleMultiCountChange}
                  extraDates={extraDates}
                  onExtraDateChange={handleExtraDateChange}
                />
              )}

              <div className="space-y-4 pt-2 border-t border-white/10 mt-2">
                <div className="flex items-center justify-between bg-purple-500/10 border border-purple-500/20 p-3 rounded-md">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-purple-400">Encaixe (Coleta Extra)</label>
                    <p className="text-xs text-purple-400/70">Ignora a capacidade do turno e cria sem consumir vaga</p>
                  </div>
                  <Switch
                    checked={isExtraPickup}
                    onCheckedChange={(v) => { setIsExtraPickup(v); if (v) setIsFixedPickup(false); }}
                    className="data-[state=checked]:bg-purple-500"
                  />
                </div>

                <div className="flex items-center justify-between bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-md">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-yellow-500">Coleta Fixa (Recorrente)</label>
                    <p className="text-xs text-yellow-500/70">Não consome vagas do dia e tem cor especial</p>
                  </div>
                  <Switch
                    checked={isFixedPickup}
                    onCheckedChange={(v) => { setIsFixedPickup(v); if (v) setIsExtraPickup(false); }}
                    className="data-[state=checked]:bg-yellow-500"
                  />
                </div>
                
                {isFixedPickup && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-300">Data Inicial</label>
                        <Input type="date" value={fixedStartDate} onChange={e => setFixedStartDate(e.target.value)} className="bg-white/5 border-white/10 text-sm" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-300">Data Final</label>
                        <Input type="date" value={fixedEndDate} onChange={e => setFixedEndDate(e.target.value)} className="bg-white/5 border-white/10 text-sm" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-gray-300">Dias da Semana</label>
                      <div className="flex flex-wrap gap-2">
                        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setFixedDays(prev => 
                                prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx]
                              );
                            }}
                            className={cn(
                              "px-3 py-1 rounded-md text-xs transition-colors border",
                              fixedDays.includes(idx) 
                                ? "bg-yellow-500 text-white border-yellow-500" 
                                : "bg-white/5 text-gray-400 border-white/10 hover:bg-white/10"
                            )}
                          >
                            {day}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>

              <Button onClick={handleCreatePickup} className="w-full bg-[#FF6600] hover:bg-[#e55c00] mt-4">
                {isFixedPickup ? "Agendar Coletas Fixas" : isExtraPickup ? "Agendar Encaixe" : "Confirmar Agendamento"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <PickupRoutePlanner
        pickups={pickups}
        customers={customers}
        customerMap={customerMap}
        date={date}
        onStatusChange={handleUpdateStatus}
      />

      <LogisticsOperationsPanel
        pickups={pickups}
        customers={customers}
        onRefresh={loadData}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Calendar Sidebar */}
        <div className="lg:col-span-4 xl:col-span-3">
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sticky top-6 overflow-hidden">
            <div className="w-full flex justify-center overflow-x-auto pb-2 custom-scrollbar">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                className="rounded-md border-0 w-full flex justify-center min-w-[260px]"
                classNames={{
                  months: "w-full flex justify-center",
                  month: "w-full max-w-full",
                  table: "w-full border-collapse space-y-1",
                  head_row: "flex justify-between w-full",
                  head_cell: "text-gray-400 font-normal text-[0.75rem] w-8 sm:w-9 text-center",
                  row: "flex justify-between w-full mt-2",
                  cell: "text-center text-sm p-0 relative [&:has([aria-selected])]:bg-white/5 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20 w-8 sm:w-9 flex justify-center",
                  day: "h-8 w-8 sm:h-9 sm:w-9 p-0 font-normal aria-selected:opacity-100 hover:bg-white/10 rounded-md transition-colors text-gray-300 flex items-center justify-center",
                  day_selected: "bg-[#FF6600] text-white hover:bg-[#FF6600] hover:text-white focus:bg-[#FF6600] focus:text-white",
                  day_today: "bg-white/10 text-white",
                }}
              />
            </div>
            
            <div className="mt-6 space-y-4 border-t border-white/10 pt-4">
              <h3 className="text-sm font-medium text-gray-400">Resumo do Dia</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                  <div className="text-2xl font-bold text-blue-400">
                    {pickups.filter(p => isSameBrasiliaDay(p.scheduled_at, date) && p.status !== 'cancelled').length}
                  </div>
                  <div className="text-xs text-blue-300">Agendados</div>
                </div>
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                  <div className="text-2xl font-bold text-green-400">
                    {pickups.filter(p => isSameBrasiliaDay(p.scheduled_at, date) && p.status === 'completed').length}
                  </div>
                  <div className="text-xs text-green-300">Concluídos</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="lg:col-span-8 xl:col-span-9 flex flex-col h-full min-h-0 overflow-hidden bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl">
          <div className="p-4 border-b border-white/10 bg-black/20 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">
              Agenda: {format(date, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </h2>
            <div className="flex gap-2 text-xs flex-wrap">
               <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Agendado</div>
               <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500"></div> Realizado</div>
               <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500"></div> Fixa / IA</div>
               <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500"></div> Encaixe</div>
            </div>
          </div>
          
          <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {timeSlots.map((slot, index) => {
              const droppableId = `${slot.shift}-${slot.index}`;
              const pickup = slotAllocation[droppableId];
              const now = new Date();
              const isPast = startOfDay(date) < startOfDay(now);
              
              const isFirstAfternoon = slot.period === 'Tarde' && index > 0 && timeSlots[index - 1].period === 'Manhã';
              
              return (
                <React.Fragment key={slot.time}>
                  {isFirstAfternoon && (
                    <div className="flex items-center gap-4 py-2">
                      <div className="w-24"></div>
                      <div className="flex-1 border-t border-dashed border-white/20"></div>
                    </div>
                  )}
                  <div className="flex gap-4 group">
                  <div className="w-24 flex-shrink-0 text-right pt-2">
                    <div className={cn(
                      "text-sm font-bold",
                      isPast ? "text-gray-600" : "text-gray-200"
                    )}>
                      {slot.label}
                    </div>
                    <div className={cn(
                      "text-xs",
                      isPast ? "text-gray-700" : "text-[#FF6600]"
                    )}>
                      {slot.period}
                    </div>
                  </div>
                  
                  <div className="flex-1 min-h-[80px] border-l border-white/10 pl-4 py-1 relative">
                    {/* Time line dot */}
                    <div className="absolute left-[-5px] top-4 w-2.5 h-2.5 rounded-full bg-[#1a0b36] border border-white/20" />
                    
                    <Droppable droppableId={droppableId}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={cn(
                            "min-h-[70px] rounded-lg transition-colors",
                            snapshot.isDraggingOver && "bg-[#FF6600]/5 ring-1 ring-[#FF6600]/30"
                          )}
                        >
                          {!pickup ? (
                            <div className="h-full border border-dashed border-white/5 rounded-lg p-3 flex items-center justify-center text-gray-700 text-sm group-hover:border-white/10 transition-colors">
                              Disponível
                            </div>
                          ) : (
                            <Draggable draggableId={pickup.id} index={0}>
                              {(dragProvided, dragSnapshot) => {
                                const customer = customerMap[pickup.customer_id];
                                return (
                                  <div
                                    ref={dragProvided.innerRef}
                                    {...dragProvided.draggableProps}
                                    className={cn(
                                      "rounded-lg p-3 border shadow-sm relative overflow-hidden",
                                      pickup.status === 'completed' 
                                        ? "bg-green-500/10 border-green-500/20" 
                                        : pickup.type === 'fixed'
                                          ? "bg-yellow-500/20 border-yellow-500/30"
                                          : "bg-blue-500/10 border-blue-500/20",
                                      dragSnapshot.isDragging && "ring-2 ring-[#FF6600] shadow-2xl"
                                    )}
                                  >
                                    {pickup.source === 'ai' && (
                                      <div className="absolute top-0 right-0 p-1 bg-purple-500/20 rounded-bl-lg">
                                        <Bot className="w-3 h-3 text-purple-400" />
                                      </div>
                                    )}
                                    
                                    <div className="flex justify-between items-start">
                                      <div className="flex items-start gap-2 flex-1 min-w-0">
                                        <div
                                          {...dragProvided.dragHandleProps}
                                          className="mt-1 text-gray-500 hover:text-white cursor-grab active:cursor-grabbing"
                                          title="Arraste para reordenar"
                                        >
                                          <GripVertical className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <h4 className="font-semibold text-white flex items-center gap-2 flex-wrap">
                                            {customer?.full_name || 'Cliente Desconhecido'}
                                            <ServiceKindBadge value={pickup.service_kind} />
                                            {pickup.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
                                            {pickup.type === 'fixed' && <Badge variant="outline" className="ml-2 text-[10px] py-0 h-5 bg-yellow-500/20 text-yellow-500 border-yellow-500/30">FIXA</Badge>}
                                            {pickup.priority && <Badge variant="destructive" className="ml-2 text-[10px] py-0 h-5">PRIORIDADE</Badge>}
                                          </h4>
                                          <div className="flex flex-col gap-1 mt-1">
                                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                              <MapPin className="w-3 h-3" />
                                              <span className="truncate max-w-[200px] md:max-w-md">{pickup.address}</span>
                                            </div>
                                            {customer?.phones?.[0] && (
                                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                                <Phone className="w-3 h-3" />
                                                <span>{customer.phones[0]}</span>
                                              </div>
                                            )}
                                            {(customer?.preferred_unit_name || units[customer?.unit_id]?.name) && (
                                              <div className="flex items-center gap-2 text-xs text-[#FF6600]">
                                                <Store className="w-3 h-3" />
                                                <span>{customer.preferred_unit_name || units[customer.unit_id]?.name}</span>
                                              </div>
                                            )}
                                          </div>
                                          {pickup.notes && (
                                            <p className="text-xs text-gray-500 mt-2 italic">"{pickup.notes}"</p>
                                          )}
                                          <PickupAuditInfo pickup={pickup} userMap={userMap} />
                                          {pickup.scheduled_at && (
                                            <div className="flex items-center gap-1.5 mt-2 text-[10px] text-gray-500">
                                              <Clock className="w-3 h-3" />
                                              <span>Coleta para {formatBR(pickup.scheduled_at)}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      
                                      <div className="flex flex-col items-end gap-2">
                                        {pickup.ticket_generated ? (
                                          <div className="flex items-center gap-1 rounded-md bg-green-500/20 border border-green-500/40 text-green-300 text-xs font-semibold px-2 h-7">
                                            <CheckCircle2 className="w-3.5 h-3.5" /> Ticket gerado
                                          </div>
                                        ) : (
                                          <Button
                                            size="sm"
                                            className="h-7 gap-1 bg-[#FF6600] hover:bg-[#e55c00] text-white text-xs px-2"
                                            title="Gerar Ticket / Orçamento"
                                            onClick={() => handleGenerateTicket(pickup)}
                                          >
                                            <Receipt className="w-3.5 h-3.5" /> Gerar Ticket
                                          </Button>
                                        )}
                                        {pickup.status === 'scheduled' && (
                                          <div className="flex gap-2">
                                            <Button 
                                              size="sm" 
                                              variant="ghost" 
                                              className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                              title="Cancelar"
                                              onClick={() => {
                                                if (pickup.type === 'fixed') {
                                                  setCancelFixedPickup(pickup);
                                                } else {
                                                  handleUpdateStatus(pickup.id, 'cancelled');
                                                }
                                              }}
                                            >
                                              <XCircle className="w-4 h-4" />
                                            </Button>
                                            <Button 
                                              size="sm" 
                                              variant="ghost" 
                                              className="h-7 w-7 p-0 text-green-400 hover:text-green-300 hover:bg-green-500/10"
                                              title="Concluir"
                                              onClick={() => handleUpdateStatus(pickup.id, 'completed')}
                                            >
                                              <CheckCircle className="w-4 h-4" />
                                            </Button>
                                            <Button 
                                              size="sm" 
                                              variant="ghost" 
                                              className="h-7 w-7 p-0 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10"
                                              title="Editar"
                                              onClick={() => setEditingPickup(pickup)}
                                            >
                                              <Pencil className="w-4 h-4" />
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              }}
                            </Draggable>
                          )}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                </div>
                </React.Fragment>
              );
            })}
          </div>
          </DragDropContext>

          <OverflowPickupsSection
            pickups={overflowPickups}
            customerMap={customerMap}
            formatBR={formatBR}
            userMap={userMap}
            onStatusChange={handleUpdateStatus}
            onEdit={setEditingPickup}
          />

          {extraPickupsForDay.length > 0 && (
            <div className="border-t border-white/10 p-4 bg-purple-500/5">
              <h3 className="text-sm font-semibold text-purple-300 mb-3 flex items-center gap-2">
                <Plus className="w-4 h-4" /> Encaixes do dia ({extraPickupsForDay.length})
              </h3>
              <div className="space-y-2">
                {extraPickupsForDay.map((pickup) => {
                  const customer = customerMap[pickup.customer_id];
                  return (
                    <div
                      key={pickup.id}
                      className={cn(
                        "rounded-lg p-3 border shadow-sm relative",
                        pickup.status === 'completed'
                          ? "bg-green-500/10 border-green-500/20"
                          : "bg-purple-500/15 border-purple-500/30"
                      )}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-white flex items-center gap-2 flex-wrap">
                            {customer?.full_name || 'Cliente Desconhecido'}
                            <ServiceKindBadge value={pickup.service_kind} />
                            <Badge variant="outline" className="text-[10px] py-0 h-5 bg-purple-500/20 text-purple-300 border-purple-500/30">ENCAIXE</Badge>
                            {pickup.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
                            {pickup.priority && <Badge variant="destructive" className="text-[10px] py-0 h-5">PRIORIDADE</Badge>}
                          </h4>
                          <div className="flex flex-col gap-1 mt-1">
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <MapPin className="w-3 h-3" />
                              <span className="truncate max-w-[200px] md:max-w-md">{pickup.address}</span>
                            </div>
                            {customer?.phones?.[0] && (
                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                <Phone className="w-3 h-3" />
                                <span>{customer.phones[0]}</span>
                              </div>
                            )}
                            {(customer?.preferred_unit_name || units[customer?.unit_id]?.name) && (
                              <div className="flex items-center gap-2 text-xs text-[#FF6600]">
                                <Store className="w-3 h-3" />
                                <span>{customer.preferred_unit_name || units[customer.unit_id]?.name}</span>
                              </div>
                            )}
                          </div>
                          {pickup.notes && (
                            <p className="text-xs text-gray-500 mt-2 italic">"{pickup.notes}"</p>
                          )}
                          <PickupAuditInfo pickup={pickup} userMap={userMap} />
                                          {pickup.scheduled_at && (
                            <div className="flex items-center gap-1.5 mt-2 text-[10px] text-gray-500">
                              <Clock className="w-3 h-3" />
                              <span>Coleta para {formatBR(pickup.scheduled_at)}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {pickup.ticket_generated ? (
                            <div className="flex items-center gap-1 rounded-md bg-green-500/20 border border-green-500/40 text-green-300 text-xs font-semibold px-2 h-7">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Ticket gerado
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              className="h-7 gap-1 bg-[#FF6600] hover:bg-[#e55c00] text-white text-xs px-2"
                              title="Gerar Ticket / Orçamento"
                              onClick={() => handleGenerateTicket(pickup)}
                            >
                              <Receipt className="w-3.5 h-3.5" /> Gerar Ticket
                            </Button>
                          )}
                          {pickup.status === 'scheduled' && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                title="Cancelar"
                                onClick={() => handleUpdateStatus(pickup.id, 'cancelled')}
                              >
                                <XCircle className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-green-400 hover:text-green-300 hover:bg-green-500/10"
                                title="Concluir"
                                onClick={() => handleUpdateStatus(pickup.id, 'completed')}
                              >
                                <CheckCircle className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10"
                                title="Editar"
                                onClick={() => setEditingPickup(pickup)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      <EditPickupModal
        pickup={editingPickup}
        isOpen={!!editingPickup}
        onClose={() => setEditingPickup(null)}
        customerMap={customerMap}
      />

      {ticketPickup && (
        <AdvancedQuoteModal
          isOpen={!!ticketPickup}
          onClose={() => setTicketPickup(null)}
          onSuccess={async () => {
            try { await base44.entities.Pickup.update(ticketPickup.id, { ticket_generated: true }); } catch (e) { console.error(e); }
            setTicketPickup(null);
            toast.success('Ticket gerado com sucesso!');
          }}
          pipeline="ORDER"
          stage="pending"
          unitId={
            customerMap[ticketPickup.customer_id]?.unit_id ||
            currentUser?.unit_id ||
            Object.keys(units)[0]
          }
        />
      )}

      <Dialog open={!!cancelFixedPickup} onOpenChange={(open) => !open && setCancelFixedPickup(null)}>
        <DialogContent className="bg-[#1a0b36] border-white/10 text-white sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Cancelar Coleta Fixa</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-gray-300 text-sm">
              Esta é uma coleta fixa (recorrente). Você deseja cancelar apenas esta coleta ou todas as coletas fixas agendadas para este cliente?
            </p>
          </div>
          <div className="flex flex-col gap-2 mt-2">
            <Button 
              onClick={() => handleCancelFixed(false)} 
              variant="outline" 
              className="bg-white/5 border-white/10 text-white hover:bg-white/10"
            >
              Cancelar Apenas Esta
            </Button>
            <Button 
              onClick={() => handleCancelFixed(true)} 
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Cancelar Todas (Excluir Recorrência)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}