import React from 'react';

const SOURCES = {
  SITE_QUOTE: { label: 'Orçamento do site', classes: 'border-cyan-400/30 bg-cyan-500/15 text-cyan-300' },
  COUNTER_MANUAL: { label: 'Manual do balcão', classes: 'border-amber-400/30 bg-amber-500/15 text-amber-300' },
  WHATSAPP_HUMAN: { label: 'WhatsApp humano', classes: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300' },
  WHATSAPP_GLORIA: { label: 'WhatsApp GlórIA', classes: 'border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-300' },
};

export default function CustomerSourceBadge({ source }) {
  const config = SOURCES[source] || { label: 'Origem não identificada', classes: 'border-white/15 bg-white/5 text-white/45' };
  return (
    <span className={`inline-flex max-w-full rounded-full border px-2 py-1 text-[10px] font-semibold leading-none ${config.classes}`}>
      {config.label}
    </span>
  );
}