import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const PRESETS = [30, 60, 90];

export default function TimeField({ label, value, onChange }) {
  const num = Number(value) || 0;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange(p)}
            className={`h-8 rounded-md border text-xs ${
              num === p
                ? 'border-[#FF6600] bg-[#FF6600]/20 text-[#FF6600]'
                : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            {p} min
          </Button>
        ))}
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min="0"
            step="5"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="min"
            className="h-8 w-20 bg-white/5 border-white/10 text-center"
          />
          <span className="text-xs text-gray-400">min</span>
        </div>
      </div>
    </div>
  );
}