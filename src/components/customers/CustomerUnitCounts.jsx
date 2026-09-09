import React from 'react';
import { Building2, Users } from 'lucide-react';

export default function CustomerUnitCounts({ total, unitCounts, unassignedCount }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3">
        <Users className="mb-2 h-4 w-4 text-cyan-400" />
        <p className="text-xl font-bold text-white">{total}</p>
        <p className="text-xs text-white/50">Base total</p>
      </div>
      {unitCounts.map((unit) => (
        <div key={unit.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
          <Building2 className="mb-2 h-4 w-4 text-[#FF6600]" />
          <p className="text-xl font-bold text-white">{unit.count}</p>
          <p className="truncate text-xs text-white/50" title={unit.name}>{unit.name}</p>
        </div>
      ))}
      {unassignedCount > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
          <Building2 className="mb-2 h-4 w-4 text-amber-400" />
          <p className="text-xl font-bold text-white">{unassignedCount}</p>
          <p className="text-xs text-white/50">Sem unidade</p>
        </div>
      )}
    </div>
  );
}