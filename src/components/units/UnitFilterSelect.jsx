import React from 'react';
import { Building2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function UnitFilterSelect({ isAdmin, units, value, onChange }) {
  if (!units?.length) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
      <Building2 className="h-4 w-4 text-gray-400" />
      <Select value={value} onValueChange={onChange} disabled={!isAdmin}>
        <SelectTrigger className="h-8 min-w-[220px] border-0 bg-transparent text-white">
          <SelectValue placeholder="Selecione a unidade" />
        </SelectTrigger>
        <SelectContent>
          {isAdmin && <SelectItem value="all">Todas as unidades</SelectItem>}
          {units.map((unit) => (
            <SelectItem key={unit.id} value={unit.id}>
              {unit.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}