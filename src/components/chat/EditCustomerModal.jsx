import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { UserCog } from 'lucide-react';

export default function EditCustomerModal({ isOpen, onClose, customer, onSaved }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && customer) {
      const placeholder = ['', 'cliente', 'novo cliente'].includes((customer.full_name || '').trim().toLowerCase());
      setFullName(placeholder ? "" : (customer.full_name || ""));
      const realPhone = (customer.phones || []).find(p => p && !p.includes('@'));
      setPhone(realPhone || "");
    }
  }, [isOpen, customer]);

  const handleSave = async () => {
    if (!fullName.trim()) {
      toast.error("Informe o nome do cliente.");
      return;
    }
    const digits = phone.replace(/\D/g, '');
    if (digits && (digits.length < 10 || digits.length > 13)) {
      toast.error("Telefone inválido. Use DDD + número.");
      return;
    }

    setSaving(true);
    try {
      const updatePayload = { full_name: fullName.trim() };
      if (digits) {
        // Mantém telefones extras (sem @lid) e adiciona/atualiza o número informado.
        const others = (customer.phones || []).filter(p => p && !p.includes('@') && p.replace(/\D/g, '') !== digits);
        updatePayload.phones = [digits, ...others];
      }
      await base44.entities.Customer.update(customer.id, updatePayload);
      toast.success("Cadastro do cliente atualizado!");
      onSaved?.({ ...customer, ...updatePayload });
      onClose();
    } catch (err) {
      console.error("Error saving customer:", err);
      toast.error("Erro ao salvar cadastro.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-[#1a0b36] border border-white/10 text-white sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="w-5 h-5 text-[#FF6600]" />
            Cadastrar / Editar Cliente
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-300">Nome do cliente</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ex: Maria Silva"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-[#FF6600]/50"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-300">Telefone (com DDD)</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="51999999999"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-[#FF6600]/50"
            />
            <p className="text-[11px] text-gray-500">
              Necessário para conseguir enviar mensagens a este contato.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="text-white hover:bg-white/10">
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving} className="bg-[#FF6600] hover:bg-[#e55c00] text-white">
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}