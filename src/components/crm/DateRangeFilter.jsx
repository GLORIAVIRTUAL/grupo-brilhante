import React from 'react';
import { Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';

const PRESETS = [
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Esta semana' },
  { key: 'month', label: 'Este mês' },
  { key: 'all', label: 'Todo período' },
  { key: 'custom', label: 'Período específico' },
];

export default function DateRangeFilter({ value, onChange, customRange, onCustomRangeChange }) {
  return (
    <div className="flex flex-col gap-2 md:items-end">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-1">
        <Calendar className="ml-2 h-4 w-4 text-[#FF6600]" />
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            onClick={() => onChange(preset.key)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              value === preset.key
                ? 'bg-[#FF6600] text-white shadow-lg shadow-orange-500/20'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {value === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={customRange.start}
            onChange={(e) => onCustomRangeChange({ ...customRange, start: e.target.value })}
            className="w-auto border-white/10 bg-white/5 text-white"
          />
          <span className="text-white/60">até</span>
          <Input
            type="date"
            value={customRange.end}
            onChange={(e) => onCustomRangeChange({ ...customRange, end: e.target.value })}
            className="w-auto border-white/10 bg-white/5 text-white"
          />
        </div>
      )}
    </div>
  );
}