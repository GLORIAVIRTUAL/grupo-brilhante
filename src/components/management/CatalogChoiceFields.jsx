import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function CatalogSelectField({ label, value, options = [], onChange, placeholder = 'Selecione' }) {
  if (!options.length) {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <Input value={value || ''} onChange={(event) => onChange(event.target.value)} className="border-white/10 bg-black/20" />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value || '__none'} onValueChange={(next) => onChange(next === '__none' ? '' : next)}>
        <SelectTrigger className="border-white/10 bg-black/20"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Não informado</SelectItem>
          {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CatalogMultiField({ label, values = [], options = [], onChange }) {
  const toggle = (option) => onChange(values.includes(option) ? values.filter((entry) => entry !== option) : [...values, option]);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-white/10 bg-black/20 p-2">
        {options.map((option) => {
          const selected = values.includes(option);
          return (
            <button key={option} type="button" onClick={() => toggle(option)} className={`rounded-full border px-2.5 py-1 text-xs transition ${selected ? 'border-red-400/60 bg-red-500/15 text-red-100' : 'border-white/10 bg-white/5 text-white/45 hover:border-white/25 hover:text-white/80'}`}>
              {selected && <Check className="mr-1 inline h-3 w-3" />}{option}
            </button>
          );
        })}
      </div>
    </div>
  );
}