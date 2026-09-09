import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { 
  Search, 
  Plus, 
  Phone, 
  Mail, 
  User,
  Trash2,
  Edit2,
  MessageSquare,
  Upload,
  Loader2,
  Sparkles
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import CustomerHistoryModal from "@/components/customers/CustomerHistoryModal";
import Customer360Dialog from "@/components/customers/Customer360Dialog";
import CustomerUnitCounts from '@/components/customers/CustomerUnitCounts';
import useUnitAccess, { filterRecordsByUnit } from '@/components/units/useUnitAccess';

export default function Customers() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const { accessibleUnits, selectedUnit, selectedUnitId, setSelectedUnitId, defaultUnitId, isAdmin } = useUnitAccess();
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [historyCustomer, setHistoryCustomer] = useState(null);
  const [customer360, setCustomer360] = useState(null);
  const [customerCount, setCustomerCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
      full_name: "",
      email: "",
      phone: "",
      address: "",
      address_number: "",
      address_complement: "",
      status: "active",
      birthdate: "",
      zip_code: "",
      neighborhood: "",
      tax_id: "",
      unit_id: ""
  });

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setIsLoadingCustomers(true);
    const fullList = await base44.entities.Customer.list('-created_date', 5000);
    setCustomers(fullList);
    setCustomerCount(fullList.length);
    setIsLoadingCustomers(false);
  };

  const handleImportCustomers = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const units = await base44.entities.Unit.list('name', 100);
      const unitMap = Object.fromEntries(units.map((unit) => [unit.id, unit.name]));
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: {
          type: 'object',
          properties: {
            full_name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            phones: { type: 'array', items: { type: 'string' } },
            birthdate: { type: 'string' },
            zip_code: { type: 'string' },
            address: { type: 'string' },
            address_number: { type: 'string' },
            address_complement: { type: 'string' },
            status: { type: 'string' },
            preferred_unit_name: { type: 'string' },
            unit_id: { type: 'string' },
            opt_in_whatsapp: { type: 'boolean' }
          }
        }
      });

      const extracted = /** @type {any} */ (result);
      const rows = Array.isArray(extracted.output) ? extracted.output : [];
      const normalizedRows = rows
        .map((row) => {
          const rawPhone = row.phone || row.telefone || row.whatsapp || row.celular || row.phones?.[0] || '';
          const cleanPhone = String(rawPhone).replace(/\D/g, '');
          const normalizedPhone = cleanPhone.length >= 10 && cleanPhone.length <= 11 ? `55${cleanPhone}` : cleanPhone;

          return {
            full_name: row.full_name || row.nome || '',
            email: row.email || '',
            phones: normalizedPhone ? [normalizedPhone] : [],
            birthdate: row.birthdate || row.data_nascimento || '',
            zip_code: row.zip_code || row.cep || '',
            address: row.address || row.endereco || '',
            address_number: row.address_number || row.numero || '',
            address_complement: row.address_complement || row.complemento || '',
            status: row.status || 'active',
            preferred_unit_name: row.preferred_unit_name || row.unidade || unitMap[row.unit_id || ''] || '',
            unit_id: row.unit_id || '',
            opt_in_whatsapp: row.opt_in_whatsapp ?? true
          };
        })
        .filter((row) => row.full_name && row.phones.length > 0);

      if (!normalizedRows.length) {
        alert('Nenhum cliente válido encontrado no arquivo.');
        return;
      }

      await base44.entities.Customer.bulkCreate(normalizedRows);
      await loadCustomers();
      alert(`${normalizedRows.length} clientes importados com sucesso.`);
    } catch (error) {
      console.error('Erro ao importar clientes:', error);
      alert('Erro ao importar arquivo.');
    } finally {
      event.target.value = '';
      setIsImporting(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
        // Normalize Phone: Remove non-digits, ensure 55 prefix for BR numbers
        let cleanPhone = formData.phone.replace(/\D/g, '');
        if (cleanPhone.length >= 10 && cleanPhone.length <= 11) {
            cleanPhone = '55' + cleanPhone;
        }

        // Busca especificamente pelo telefone para evitar carregar a base toda na validação
        let duplicate = null;
        if (cleanPhone) {
            const checkDuplicate = await base44.entities.Customer.filter({ phones: cleanPhone });
            duplicate = checkDuplicate.find(c => c.id !== editingCustomer?.id);
        }

        if (duplicate) {
            alert(`Já existe um cliente com este telefone: ${duplicate.full_name}`);
            return;
        }

        const selectedUnitObj = accessibleUnits.find(u => u.id === formData.unit_id);
        const payload = {
            full_name: formData.full_name,
            email: formData.email,
            phones: [cleanPhone],
            address: formData.address,
            address_number: formData.address_number,
            address_complement: formData.address_complement,
            status: formData.status,
            birthdate: formData.birthdate,
            zip_code: formData.zip_code,
            neighborhood: formData.neighborhood,
            tax_id: formData.tax_id?.replace(/\D/g, '') || '',
            unit_id: formData.unit_id || '',
            preferred_unit_name: selectedUnitObj?.name || '',
            opt_in_whatsapp: true
        };

        if (editingCustomer) {
            await base44.entities.Customer.update(editingCustomer.id, payload);
        } else {
            await base44.entities.Customer.create(payload);
        }

        setIsDialogOpen(false);
        setEditingCustomer(null);
        setFormData({ full_name: "", email: "", phone: "", address: "", address_number: "", address_complement: "", status: "active", birthdate: "", zip_code: "", neighborhood: "", tax_id: "", unit_id: "" });
        loadCustomers();
    } catch (err) {
        console.error("Error saving customer:", err);
        alert("Erro ao salvar cliente: " + (err.message || err));
    }
  };

  const handleDelete = async (id) => {
      if (confirm("Tem certeza que deseja excluir este cliente?")) {
          await base44.entities.Customer.delete(id);
          loadCustomers();
      }
  };

  const openEdit = (customer) => {
      setEditingCustomer(customer);
      setFormData({
          full_name: customer.full_name,
          email: customer.email,
          phone: customer.phones?.[0] || "",
          address: customer.address || "",
          address_number: customer.address_number || "",
          address_complement: customer.address_complement || "",
          status: customer.status || "active",
          birthdate: customer.birthdate || "",
          zip_code: customer.zip_code || "",
          neighborhood: customer.neighborhood || "",
          tax_id: customer.tax_id || "",
          unit_id: customer.unit_id || ""
      });
      setIsDialogOpen(true);
  };

  const handleCepBlur = async () => {
    const cep = formData.zip_code?.replace(/\D/g, '');
    if (cep?.length === 8) {
        try {
            const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            const data = await response.json();
            if (!data.erro) {
                setFormData(prev => ({
                    ...prev,
                    address: `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`,
                    neighborhood: prev.neighborhood || data.bairro || ''
                }));
            }
        } catch (error) {
            console.error("Error fetching CEP", error);
        }
    }
  };

  const unitCustomers = useMemo(() => {
    // All users see all customers (no unit filtering)
    const activeUnitId = selectedUnitId || 'all';
    if (activeUnitId === 'all') return customers;
    return filterRecordsByUnit(customers, activeUnitId, defaultUnitId);
  }, [customers, selectedUnitId, defaultUnitId]);

  const filteredCustomers = useMemo(() => unitCustomers.filter(c => 
      (c.full_name && c.full_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (c.phones && c.phones[0] && c.phones[0].includes(searchTerm)) ||
      (c.email && c.email.toLowerCase().includes(searchTerm.toLowerCase()))
  ), [unitCustomers, searchTerm]);

  const unitCounts = useMemo(() => accessibleUnits.map((unit) => ({
    id: unit.id,
    name: unit.name,
    count: customers.filter((customer) =>
      customer.unit_id === unit.id || (!customer.unit_id && customer.preferred_unit_name === unit.name)
    ).length
  })), [accessibleUnits, customers]);

  const assignedCustomerCount = unitCounts.reduce((sum, unit) => sum + unit.count, 0);
  const unassignedCustomerCount = Math.max(customerCount - assignedCustomerCount, 0);
  const displayedCustomers = filteredCustomers.slice(0, 150);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Clientes</h1>
          <p className="text-white/60 text-sm mt-1">Gerencie sua base de clientes e contatos</p>
          <p className="text-white/40 text-xs mt-2">Base total: {customerCount} clientes</p>
          <p className="text-white/40 text-xs mt-1">Unidade atual: {selectedUnit?.name || 'Todas as unidades'}</p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={selectedUnitId}
            onChange={(e) => setSelectedUnitId(e.target.value)}
            className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-white"
          >
            <option value="all">Todas as unidades</option>
            {accessibleUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.name}</option>
            ))}
          </select>
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input 
              placeholder="Buscar por nome, telefone..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-black/20 border-white/10 text-white placeholder:text-gray-600"
            />
          </div>
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.json"
            onChange={handleImportCustomers}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="border-white/10 bg-black/20 text-white hover:bg-white/5 gap-2"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Importar lista
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <Button 
                    onClick={() => { setEditingCustomer(null); setFormData({ full_name: "", email: "", phone: "", address: "", address_number: "", address_complement: "", status: "active", birthdate: "", zip_code: "", neighborhood: "", tax_id: "", unit_id: "" }); }}
                    className="bg-[#FF6600] hover:bg-[#ff7b24] text-white gap-2"
                >
                    <Plus className="w-4 h-4" /> Novo Cliente
                </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1a0b36] border border-white/10 text-white sm:max-w-[425px]">
                <DialogHeader>
                <DialogTitle>{editingCustomer ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSave} className="space-y-4 mt-4">
                    <div className="space-y-2">
                        <Label>Nome Completo</Label>
                        <Input 
                            required 
                            value={formData.full_name} 
                            onChange={e => setFormData({...formData, full_name: e.target.value})}
                            className="bg-white/5 border-white/10" 
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Data de Nascimento</Label>
                            <Input 
                                type="date"
                                value={formData.birthdate} 
                                onChange={e => setFormData({...formData, birthdate: e.target.value})}
                                className="bg-white/5 border-white/10" 
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Telefone (WhatsApp)</Label>
                            <Input 
                                required 
                                value={formData.phone} 
                                onChange={e => setFormData({...formData, phone: e.target.value})}
                                placeholder="5511999999999"
                                className="bg-white/5 border-white/10" 
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>CPF / CNPJ</Label>
                        <Input
                            value={formData.tax_id}
                            onChange={e => setFormData({...formData, tax_id: e.target.value})}
                            placeholder="Somente números"
                            className="bg-white/5 border-white/10"
                        />
                        <p className="text-[11px] text-gray-500">Exigido pelo Asaas para gerar cobranças Pix ou cartão.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>Email</Label>
                        <Input 
                            type="email"
                            value={formData.email} 
                            onChange={e => setFormData({...formData, email: e.target.value})}
                            className="bg-white/5 border-white/10" 
                        />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-1 space-y-2">
                             <Label>CEP</Label>
                             <div className="relative">
                                <Input 
                                    value={formData.zip_code} 
                                    onChange={e => setFormData({...formData, zip_code: e.target.value})}
                                    onBlur={handleCepBlur}
                                    placeholder="00000-000"
                                    className="bg-white/5 border-white/10 pr-8" 
                                />
                                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                             </div>
                        </div>
                        <div className="col-span-2 space-y-2">
                            <Label>Endereço</Label>
                            <Input 
                                value={formData.address} 
                                onChange={e => setFormData({...formData, address: e.target.value})}
                                className="bg-white/5 border-white/10" 
                                placeholder="Endereço completo, Bairro, Cidade - UF"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-1 space-y-2">
                            <Label>Número</Label>
                            <Input 
                                value={formData.address_number} 
                                onChange={e => setFormData({...formData, address_number: e.target.value})}
                                className="bg-white/5 border-white/10" 
                                placeholder="Ex: 123"
                            />
                        </div>
                        <div className="col-span-1 space-y-2">
                            <Label>Bairro</Label>
                            <Input
                                value={formData.neighborhood}
                                onChange={e => setFormData({...formData, neighborhood: e.target.value})}
                                className="bg-white/5 border-white/10"
                                placeholder="Ex: Centro"
                            />
                        </div>
                        <div className="col-span-1 space-y-2">
                            <Label>Complemento</Label>
                            <Input 
                                value={formData.address_complement} 
                                onChange={e => setFormData({...formData, address_complement: e.target.value})}
                                className="bg-white/5 border-white/10" 
                                placeholder="Ex: Apto 402, Bloco B"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Unidade (Loja)</Label>
                        <select 
                            value={formData.unit_id}
                            onChange={e => setFormData({...formData, unit_id: e.target.value})}
                            className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-sm text-white"
                        >
                            <option value="" className="text-black bg-white">Selecione a unidade</option>
                            {accessibleUnits.map(u => (
                                <option key={u.id} value={u.id} className="text-black bg-white">{u.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-2">
                        <Label>Status</Label>
                        <select 
                            value={formData.status}
                            onChange={e => setFormData({...formData, status: e.target.value})}
                            className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-sm text-white"
                        >
                            <option value="active" className="text-black bg-white">Ativo</option>
                            <option value="vip" className="text-black bg-white">VIP</option>
                            <option value="inactive" className="text-black bg-white">Inativo</option>
                        </select>
                    </div>
                    <div className="pt-4 flex justify-end gap-2">
                        <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)} className="hover:bg-white/10 text-white">Cancelar</Button>
                        <Button type="submit" className="bg-[#FF6600] hover:bg-[#ff7b24]">Salvar</Button>
                    </div>
                </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <CustomerUnitCounts
        total={customerCount}
        unitCounts={unitCounts}
        unassignedCount={unassignedCustomerCount}
      />

      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        {isLoadingCustomers && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-white/60 border-b border-white/10 bg-black/10">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando clientes...
          </div>
        )}
        <Table>
            <TableHeader className="bg-white/5">
                <TableRow className="border-white/10 hover:bg-white/5">
                    <TableHead className="text-gray-400">Nome</TableHead>
                    <TableHead className="text-gray-400">Status</TableHead>
                    <TableHead className="text-gray-400">Telefone</TableHead>
                    <TableHead className="text-gray-400">Email</TableHead>
                    <TableHead className="text-gray-400">Unidade</TableHead>
                    <TableHead className="text-right text-gray-400">Ações</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {displayedCustomers.map((customer) => (
                    <TableRow key={customer.id} className="border-white/10 hover:bg-white/5">
                        <TableCell className="font-medium text-white">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-xs font-bold text-white shadow-inner">
                                    {customer.full_name.charAt(0)}
                                </div>
                                <div className="flex flex-col">
                                    <span>{customer.full_name}</span>
                                    {customer.address && <span className="text-xs text-gray-500 truncate max-w-[200px]">{customer.address}</span>}
                                </div>
                            </div>
                        </TableCell>
                        <TableCell>
                            <span className={`text-xs px-2 py-0.5 rounded-full border 
                                ${customer.status === 'vip' ? 'border-yellow-500/50 text-yellow-500 bg-yellow-500/10' : 
                                  customer.status === 'active' ? 'border-green-500/50 text-green-500 bg-green-500/10' : 
                                  'border-gray-500/50 text-gray-500'}`}>
                                {customer.status?.toUpperCase()}
                            </span>
                        </TableCell>
                        <TableCell className="text-gray-300">
                            {customer.phones?.[0] && (
                                <div className="flex items-center gap-2">
                                    <Phone className="w-3 h-3 text-[#FF6600]" />
                                    <span>{customer.phones[0]}</span>
                                </div>
                            )}
                        </TableCell>
                        <TableCell className="text-gray-300">
                             {customer.email && (
                                <div className="flex items-center gap-2">
                                    <Mail className="w-3 h-3 text-[#FF6600]" />
                                    <span>{customer.email}</span>
                                </div>
                            )}
                        </TableCell>
                        <TableCell className="text-gray-300 text-xs">
                            {customer.preferred_unit_name || accessibleUnits.find((unit) => unit.id === customer.unit_id)?.name || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                                <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => navigate(`/chat?customer_id=${customer.id}`)}
                                    className="h-8 w-8 hover:bg-white/10 hover:text-[#FF6600] text-gray-400"
                                    title="Enviar Mensagem"
                                >
                                    <MessageSquare className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setCustomer360(customer)}
                                    className="h-8 w-8 hover:bg-violet-500/15 hover:text-violet-300 text-gray-400"
                                    title="CRM 360"
                                >
                                    <Sparkles className="w-4 h-4" />
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => setHistoryCustomer(customer)}
                                    className="h-8 w-8 hover:bg-white/10 hover:text-white text-gray-400"
                                    title="Histórico"
                                >
                                    <div className="w-4 h-4 rotate-180" >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-history"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74-2.74L3 12"/><path d="M3 3v9h9"/><path d="M12 7v5l4 2"/></svg>
                                    </div>
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => openEdit(customer)}
                                    className="h-8 w-8 hover:bg-white/10 hover:text-blue-400 text-gray-400"
                                    title="Editar"
                                >
                                    <Edit2 className="w-4 h-4" />
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => handleDelete(customer.id)}
                                    className="h-8 w-8 hover:bg-white/10 hover:text-red-400 text-gray-400"
                                    title="Excluir"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
      </div>

      {filteredCustomers.length > 150 && (
          <div className="text-center text-gray-500 py-4 text-sm font-medium">
              Mostrando os primeiros 150 resultados de {filteredCustomers.length}. Use a busca acima para encontrar clientes específicos.
          </div>
      )}

      {filteredCustomers.length === 0 && (
          <div className="text-center py-20 opacity-50">
              <User className="w-16 h-16 mx-auto mb-4" />
              <p>Nenhum cliente encontrado</p>
              <p className="text-xs text-white/40 mt-2">Você pode importar um arquivo CSV, Excel ou JSON com a sua base.</p>
          </div>
      )}

      <CustomerHistoryModal 
        customer={historyCustomer} 
        isOpen={!!historyCustomer} 
        onClose={() => setHistoryCustomer(null)} 
      />
      <Customer360Dialog
        customer={customer360}
        open={!!customer360}
        onClose={() => setCustomer360(null)}
      />
    </div>
  );
}