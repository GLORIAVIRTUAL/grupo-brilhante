import React from 'react';
import { Truck, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ServiceKindBadge({ value }) {
  const isClean = value === 'clean';
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        isClean
          ? "bg-green-500/20 border-green-500/40 text-green-300"
          : "bg-[#FF6600]/20 border-[#FF6600]/40 text-[#FF9A4D]"
      )}
    >
      {isClean ? <CheckCircle2 className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
      {isClean ? 'Entrega' : 'Coleta'}
    </span>
  );
}