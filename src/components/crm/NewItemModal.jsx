import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';

export default function NewItemModal({ isOpen, onClose, pipeline, stage, unitId, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '', // For description or quick note
    customer_phone: '', // Search by phone
    priority: 'MEDIUM'
  });

  const handleSubmit = async () => {
    if (!unitId) {
      alert("Selecione uma unidade antes de criar o card.");
      return;
    }

    setLoading(true);
    try {
      const phone = formData.customer_phone.replace(/\D/g, '');
      
      if (!phone) {
          alert("Por favor insira um número de WhatsApp válido.");
          setLoading(false);
          return;
      }
      
      let customerId = null;
      // Search for customer with this phone number
      const customers = await base44.entities.Customer.filter({ phones: phone });
      
      if (customers.length > 0) {
          customerId = customers[0].id;
      } else {
          // Create new customer
          const newCustomer = await base44.entities.Customer.create({
              full_name: formData.title || `Cliente ${phone}`,
              phones: [phone],
              status: 'active'
          });
          customerId = newCustomer.id;
      }

      await base44.entities.CrmCard.create({
        pipeline_type: pipeline,
        stage: stage,
        priority: formData.priority,
        customer_id: customerId,
        unit_id: unitId,
        customer_source: 'COUNTER_MANUAL'
      });
      
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Error creating item:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a0b36] border border-white/10 text-white">
        <DialogHeader>
          <DialogTitle>Novo Card em {stage}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Nome / Título</Label>
            <Input 
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              placeholder="Ex: Orçamento Ternos"
              className="bg-white/5 border-white/10"
            />
          </div>
          <div className="space-y-2">
             <Label>WhatsApp do Cliente</Label>
             <Input 
               value={formData.customer_phone}
               onChange={(e) => setFormData({...formData, customer_phone: e.target.value})}
               placeholder="Ex: 5511999999999"
               className="bg-white/5 border-white/10"
             />
             <p className="text-xs text-gray-500">Se não existir, um novo cliente será criado.</p>
          </div>
          <div className="space-y-2">
            <Label>Prioridade</Label>
            <Select 
              value={formData.priority}
              onValueChange={(val) => setFormData({...formData, priority: val})}
            >
              <SelectTrigger className="bg-white/5 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Baixa</SelectItem>
                <SelectItem value="MEDIUM">Média</SelectItem>
                <SelectItem value="HIGH">Alta</SelectItem>
                <SelectItem value="CRITICAL">Crítica</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="hover:bg-white/10">Cancelar</Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-[#FF6600] hover:bg-[#ff7b24]">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}