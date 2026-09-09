import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function DispatchAudienceFilters({ units, unitId, onUnitChange, inactivity, onInactivityChange, eligibleCount, isConsentRequest }) {
  return (
    <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="flex items-start gap-2 text-sm text-emerald-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{isConsentRequest
          ? 'Esta mensagem solicita autorização. Clientes sem consentimento podem recebê-la; clientes já autorizados podem ser selecionados manualmente para repetir o teste.'
          : 'Envio protegido: 10 horas, horários variados e das 9h às 19h. Campanhas promocionais exigem consentimento confirmado.'}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Unidade</Label>
          <Select value={unitId} onValueChange={onUnitChange}>
            <SelectTrigger className="border-white/10 bg-white/5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as unidades</SelectItem>
              {units.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Última conversa</Label>
          <Select value={inactivity} onValueChange={onInactivityChange}>
            <SelectTrigger className="border-white/10 bg-white/5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Qualquer período</SelectItem>
              <SelectItem value="3">Sem falar há 3 meses</SelectItem>
              <SelectItem value="6">Sem falar há 6 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-white/50">{eligibleCount} clientes elegíveis após os filtros e a validação de consentimento.</p>
    </div>
  );
}