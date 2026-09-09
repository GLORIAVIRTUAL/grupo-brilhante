import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Modal de confirmação de exclusão que exige um motivo.
 * O motivo é obrigatório e é registrado no log de auditoria.
 */
export default function DeleteReasonModal({ open, onClose, onConfirm, title, itemLabel }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setSaving(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#1a0b36] border-white/10 text-white sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" /> {title || 'Confirmar exclusão'}
          </DialogTitle>
          <DialogDescription className="text-gray-300">
            {itemLabel ? <span className="text-white font-medium">{itemLabel}</span> : null}
            <span className="block mt-1">Esta ação não pode ser desfeita. Informe o motivo da exclusão — ele será registrado no log de auditoria.</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <label className="text-sm font-medium text-gray-300">Motivo da exclusão *</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: Lançamento duplicado, valor incorreto, cliente desistiu..."
            className="bg-white/5 border-white/10 min-h-[90px]"
            autoFocus
          />
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} className="bg-white/5 border-white/10 text-white hover:bg-white/10">
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!reason.trim() || saving}
            className="bg-red-600 hover:bg-red-700 text-white gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Apagar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}