import React from 'react';
import { Check, Sparkles } from 'lucide-react';

const Card = ({ children, className = '' }) => (
  <div className={`rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-6 ${className}`}>{children}</div>
);

export function BulletList({ bullets = [], advantage }) {
  return (
    <div className="space-y-6">
      <ul className="grid md:grid-cols-2 gap-4">
        {bullets.map((b) => (
          <li key={b} className="flex gap-3 rounded-xl bg-white/5 border border-white/10 p-4">
            <Check className="w-5 h-5 text-[#FF6600] shrink-0 mt-0.5" />
            <span className="text-gray-200">{b}</span>
          </li>
        ))}
      </ul>
      {advantage && (
        <div className="flex gap-3 rounded-xl border border-[#FF6600]/40 bg-[#FF6600]/10 p-4">
          <Sparkles className="w-5 h-5 text-[#FF6600] shrink-0 mt-0.5" />
          <span className="text-white font-medium">{advantage}</span>
        </div>
      )}
    </div>
  );
}

export function StatsGrid({ stats = [] }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <p className="text-4xl font-bold text-[#FF6600]">{s.value}</p>
          <p className="mt-2 font-semibold text-white">{s.label}</p>
          <p className="mt-2 text-sm text-gray-400">{s.detail}</p>
        </Card>
      ))}
    </div>
  );
}

export function PlansGrid({ plans = [], extra, discount }) {
  return (
    <div className="space-y-6">
      {discount && (
        <div className="flex gap-3 rounded-2xl border-2 border-[#FF6600] bg-[#FF6600]/15 p-5">
          <Sparkles className="w-6 h-6 text-[#FF6600] shrink-0 mt-0.5" />
          <p className="text-white font-semibold text-lg">{discount}</p>
        </div>
      )}
      <div className="grid md:grid-cols-3 gap-5">
        {plans.map((p) => (
          <Card
            key={p.name}
            className={p.highlight ? 'border-[#FF6600]/60 shadow-lg shadow-orange-900/20' : ''}
          >
            {p.highlight && (
              <span className="inline-block mb-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#FF6600] text-white">
                Mais escolhido
              </span>
            )}
            <p className="text-sm font-semibold text-gray-300 uppercase tracking-wide">{p.name}</p>
            <p className="mt-2 text-3xl font-bold text-white">
              {p.price}
              <span className="text-sm font-normal text-gray-400"> {p.period}</span>
            </p>
            <ul className="mt-5 space-y-3">
              {p.items.map((it) => (
                <li key={it} className="flex gap-2 text-sm text-gray-200">
                  <Check className="w-4 h-4 text-[#FF6600] shrink-0 mt-0.5" />
                  {it}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {extra && (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6">
          <p className="font-semibold text-white">{extra.title}</p>
          <p className="mt-2 text-gray-300">{extra.text}</p>
        </div>
      )}
    </div>
  );
}