import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getBrasiliaDateKey, getBrasiliaTimeParts, buildPickupIso } from '@/lib/pickupDateTime';
import MultiDatesSection from '@/components/pickups/MultiDatesSection';
import ServiceKindSelector from '@/components/pickups/ServiceKindSelector';

export default function EditPickupModal({ pickup, isOpen, onClose, customerMap }) {
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [cep, setCep] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [addressComplement, setAddressComplement] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [shift, setShift] = useState('manha');
  const [serviceKind, setServiceKind] = useState('dirty');
  const [fetchingCep, setFetchingCep] = useState(false);
  const [saving, setSaving] = useState(false);
  const [multiEnabled, setMultiEnabled] = useState(false);
  const [multiCount, setMultiCount] = useState(2);
  const [extraDates, setExtraDates] = useState(['']);

  const handleCountChange = (n) => {
    setMultiCount(n);
    setExtraDates(prev => {
      const next = [...prev];
      next.length = n - 1;
      return Array.from(next, v => v || '');
    });
  };

  const handleExtraDateChange = (index, value) => {
    setExtraDates(prev => prev.map((v, i) => (i === index ? value : v)));
  };

  useEffect(() => {
    if (pickup) {
      const customer = customerMap?.[pickup.customer_id];
      
      // Try to use customer's structured fields first
      if (customer?.address) {
        setAddress(customer.address || '');
        setAddressNumber(customer.address_number || '');
        setAddressComplement(customer.address_complement || '');
        setCep(customer.zip_code || '');
      } else {
        // Fallback: try to parse the concatenated pickup address
        const raw = pickup.address || '';
        // Pattern: "address, number - complement" or "address, number"
        const dashMatch = raw.match(/^(.+),\s*(\d+\S*)\s*-\s*(.+)$/);
        const commaMatch = raw.match(/^(.+),\s*(\d+\S*)\s*$/);
        
        if (dashMatch) {
          setAddress(dashMatch[1].trim());
          setAddressNumber(dashMatch[2].trim());
          setAddressComplement(dashMatch[3].trim());
        } else if (commaMatch) {
          setAddress(commaMatch[1].trim());
          setAddressNumber(commaMatch[2].trim());
          setAddressComplement('');
        } else {
          setAddress(raw);
          setAddressNumber('');
          setAddressComplement('');
        }
        setCep('');
      }
      
      setNotes(pickup.notes || '');
      setServiceKind(pickup.service_kind || 'dirty');

      if (pickup.scheduled_at) {
        setScheduledDate(getBrasiliaDateKey(pickup.scheduled_at));
        setShift(getBrasiliaTimeParts(pickup.scheduled_at).hour < 13 ? 'manha' : 'tarde');
      }

      setMultiEnabled(false);
      setMultiCount(2);
      setExtraDates(['']);
    }
  }, [pickup, customerMap]);

  const handleCepChange = async (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 5) value = value.replace(/^(\d{5})(\d)/, '$1-$2');
    setCep(value);

    const plain = value.replace(/\D/g, '');
    if (plain.length === 8) {
      setFetchingCep(true);
      try {
        const res = await fetch(`https://viacep.com.br/ws/${plain}/json/`);
        const data = await res.json();
        if (!data.erro) {
          setAddress(`${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`);
          toast.success("Endereço encontrado!");
        } else {
          toast.error("CEP não encontrado");
        }
      } catch {
        toast.error("Erro ao buscar CEP");
      } finally {
        setFetchingCep(false);
      }
    }
  };

  const handleSave = async () => {
    if (!pickup) return;
    setSaving(true);
    try {
      let finalAddress = address;
      if (address && addressNumber) finalAddress += `, ${addressNumber}`;
      if (finalAddress && addressComplement) finalAddress += ` - ${addressComplement}`;

      const payload = {
        address: finalAddress || pickup.address,
        notes: notes,
        service_kind: serviceKind
      };

      const current = pickup.scheduled_at
        ? { date: getBrasiliaDateKey(pickup.scheduled_at), parts: getBrasiliaTimeParts(pickup.scheduled_at) }
        : null;
      const currentShift = current ? (current.parts.hour < 13 ? 'manha' : 'tarde') : null;
      // Mantém a hora exata se o turno não mudou; senão usa o início do novo turno.
      const time = currentShift === shift && current
        ? `${String(current.parts.hour).padStart(2, '0')}:${String(current.parts.minute).padStart(2, '0')}`
        : (shift === 'manha' ? '09:00' : '14:00');

      if (scheduledDate && (!current || current.date !== scheduledDate || currentShift !== shift)) {
        payload.scheduled_at = buildPickupIso(scheduledDate, time);
      }

      await base44.entities.Pickup.update(pickup.id, payload);

      let createdCount = 0;
      if (multiEnabled) {
        const dates = extraDates.filter(Boolean);
        if (dates.length === 0) {
          toast.error("Informe as datas das coletas adicionais");
          setSaving(false);
          return;
        }
        await base44.entities.Pickup.bulkCreate(dates.map(date => ({
          customer_id: pickup.customer_id,
          scheduled_at: buildPickupIso(date, time),
          address: payload.address,
          neighborhood: pickup.neighborhood,
          fee: pickup.fee || 0,
          notes: notes,
          source: 'human',
          priority: pickup.priority || false,
          service_kind: serviceKind,
          type: pickup.type || 'regular',
          created_by_name: pickup.created_by_name,
          status: 'scheduled'
        })));
        createdCount = dates.length;
      }

      toast.success(createdCount ? `Coleta atualizada + ${createdCount} nova(s) data(s)!` : "Coleta atualizada!");
      onClose();
    } catch {
      toast.error("Erro ao atualizar coleta");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a0b36] border-white/10 text-white sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Editar Coleta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Data da coleta</label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="bg-white/5 border-white/10 [color-scheme:dark]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Turno</label>
              <Select value={shift} onValueChange={setShift}>
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue placeholder="Selecione o turno" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a0b36] border-white/10 text-white">
                  <SelectItem value="manha">Manhã (8h às 12h)</SelectItem>
                  <SelectItem value="tarde">Tarde (13h às 16h)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ServiceKindSelector value={serviceKind} onChange={setServiceKind} />

          <MultiDatesSection
            enabled={multiEnabled}
            onToggle={setMultiEnabled}
            count={multiCount}
            onCountChange={handleCountChange}
            extraDates={extraDates}
            onExtraDateChange={handleExtraDateChange}
          />

          <div className="grid grid-cols-3 gap-3">
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
            <div className="space-y-2 col-span-2">
              <label className="text-sm font-medium text-gray-300">Endereço</label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="bg-white/5 border-white/10"
                placeholder="Rua, Bairro, Cidade - UF"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Número</label>
              <Input
                value={addressNumber}
                onChange={(e) => setAddressNumber(e.target.value)}
                className="bg-white/5 border-white/10"
                placeholder="123"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <label className="text-sm font-medium text-gray-300">Complemento</label>
              <Input
                value={addressComplement}
                onChange={(e) => setAddressComplement(e.target.value)}
                className="bg-white/5 border-white/10"
                placeholder="Apto 402"
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

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} className="text-white hover:bg-white/10">
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-[#FF6600] hover:bg-[#e55c00] text-white">
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}