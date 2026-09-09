import React from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarPlus, X } from 'lucide-react';

export default function MultiDatesSection({ enabled, onToggle, count, onCountChange, extraDates, onExtraDateChange }) {
  if (!enabled) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => onToggle(true)}
        className="w-full border-white/10 bg-white/5 text-white hover:bg-white/10"
      >
        <CalendarPlus className="w-4 h-4 mr-2" /> Múltiplas coletas
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-[#FF6600]/30 bg-[#FF6600]/10 p-3 space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-200 flex-1">Quantas vezes?</label>
        <Select value={String(count)} onValueChange={(v) => onCountChange(Number(v))}>
          <SelectTrigger className="w-28 bg-white/5 border-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#1a0b36] border-white/10 text-white">
            {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
              <SelectItem key={n} value={String(n)}>{n} vezes</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button type="button" onClick={() => onToggle(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-gray-300">
        A 1ª coleta usa a data acima. Informe as datas seguintes:
      </p>

      <div className="grid grid-cols-2 gap-2">
        {extraDates.map((value, index) => (
          <div key={index} className="space-y-1">
            <label className="text-xs text-gray-400">Coleta {index + 2}</label>
            <Input
              type="date"
              value={value}
              onChange={(e) => onExtraDateChange(index, e.target.value)}
              className="bg-white/5 border-white/10 [color-scheme:dark]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}