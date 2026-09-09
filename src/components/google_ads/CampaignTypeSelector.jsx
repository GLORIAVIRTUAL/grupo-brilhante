import React from 'react';
import { Card } from '@/components/ui/card';
import { Search, Image as ImageIcon, Zap, Youtube } from 'lucide-react';

const TYPES = [
  {
    id: 'search',
    icon: Search,
    title: 'Pesquisa',
    desc: 'Anúncios de texto que aparecem nos resultados de busca do Google.',
    badge: 'Mais usado',
    color: 'from-blue-500 to-blue-700',
  },
  {
    id: 'display',
    icon: ImageIcon,
    title: 'Display',
    desc: 'Banners com imagens em sites parceiros e Gmail.',
    badge: 'Com imagens',
    color: 'from-pink-500 to-rose-700',
  },
  {
    id: 'pmax',
    icon: Zap,
    title: 'Performance Max',
    desc: 'Anúncios automatizados em todos os canais (Search + Display + YouTube + Maps).',
    badge: 'Recomendado',
    color: 'from-orange-500 to-amber-600',
  },
  {
    id: 'video',
    icon: Youtube,
    title: 'Vídeo (YouTube)',
    desc: 'Anúncios em vídeo que rodam antes ou durante vídeos do YouTube.',
    badge: 'Vídeo',
    color: 'from-red-500 to-red-700',
  },
];

export default function CampaignTypeSelector({ selected, onSelect }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {TYPES.map(t => {
        const Icon = t.icon;
        const isActive = selected === t.id;
        return (
          <Card
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`p-4 cursor-pointer transition-all border ${
              isActive
                ? 'bg-[#FF6600]/15 border-[#FF6600] shadow-lg shadow-orange-500/20'
                : 'bg-white/5 border-white/10 hover:bg-white/10'
            }`}
          >
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${t.color} flex items-center justify-center mb-3`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-white">{t.title}</h4>
              {t.badge && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300">{t.badge}</span>
              )}
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{t.desc}</p>
          </Card>
        );
      })}
    </div>
  );
}