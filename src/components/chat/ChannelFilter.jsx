import React from 'react';
import { MessageCircle, Instagram, Send, Layers } from 'lucide-react';

const OPTIONS = [
  { value: 'all', label: 'Todos', icon: Layers, active: 'border-[#FF6600]/40 bg-[#FF6600]/15 text-[#FF6600]' },
  { value: 'WHATSAPP', label: 'WhatsApp', icon: MessageCircle, active: 'border-green-400/40 bg-green-400/15 text-green-300' },
  { value: 'INSTAGRAM', label: 'Instagram', icon: Instagram, active: 'border-pink-400/40 bg-pink-400/15 text-pink-300' },
  { value: 'MESSENGER', label: 'Messenger', icon: Send, active: 'border-blue-400/40 bg-blue-400/15 text-blue-300' },
];

export default function ChannelFilter({ value, onChange, counts = {} }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 px-2">
      {OPTIONS.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            title={`Ver conversas de ${opt.label}`}
            className={`flex items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-medium transition-colors ${
              isActive ? opt.active : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <opt.icon className="w-3.5 h-3.5" />
            <span>{opt.label}</span>
            <span className="opacity-70">({counts[opt.value] || 0})</span>
          </button>
        );
      })}
    </div>
  );
}