import React, { useState } from 'react';
import { Save } from 'lucide-react';
import { autoReason } from '@/lib/autoReason';

const STAGES = [
  { value: 'not_started', label: 'Não iniciada' },
  { value: 'mapping', label: 'Mapeamento' },
  { value: 'migration', label: 'Migração' },
  { value: 'homologation', label: 'Homologação' },
  { value: 'ready', label: 'Pronta para operar' },
];

const inputClass = 'w-full rounded-xl border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-sky-400/60 focus:bg-black/25';

export default function ImplementationStageForm({ company, busy, onSubmit }) {
  const [stage, setStage] = useState(company.implementation_status || 'not_started');

  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ implementation_status: stage, reason: autoReason('Etapa de implantação') });
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-white/55">Etapa de implantação</span>
        <select className={inputClass} value={stage} onChange={(event) => setStage(event.target.value)}>
          {STAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <div className="self-end">
        <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40">
          <Save className="h-4 w-4" /> Salvar etapa
        </button>
      </div>
      <p className="text-[11px] text-white/35 sm:col-span-3">A entrada em produção definitiva (go-live) exige aprovação separada e não é feita por aqui.</p>
    </form>
  );
}