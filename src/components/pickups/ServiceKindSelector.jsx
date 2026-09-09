import React from 'react';
import { Truck, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ServiceKindSelector({ value = 'dirty', onChange }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-300">Tipo de Serviço</label>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onChange('dirty')}
          className={cn(
            "flex items-center justify-center gap-2 rounded-md border p-3 text-sm transition-colors",
            value === 'dirty'
              ? "bg-[#FF6600]/20 border-[#FF6600] text-white font-semibold"
              : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"
          )}
        >
          <Truck className="w-4 h-4" /> Coleta
        </button>
        <button
          type="button"
          onClick={() => onChange('clean')}
          className={cn(
            "flex items-center justify-center gap-2 rounded-md border p-3 text-sm transition-colors",
            value === 'clean'
              ? "bg-green-500/20 border-green-500 text-white font-semibold"
              : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"
          )}
        >
          <CheckCircle2 className="w-4 h-4" /> Entrega
        </button>
      </div>
      <p className="text-xs text-gray-500">
        {value === 'clean' ? 'Devolução de roupas limpas no cliente.' : 'Retirada de roupas sujas no cliente para lavagem.'}
      </p>
    </div>
  );
}