import React from 'react';
import { History, ExternalLink, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function SavedCampaignCard({ campaign, onLoad, onDelete }) {
  const createdAt = campaign.created_date
    ? new Date(campaign.created_date).toLocaleDateString('pt-BR')
    : '';

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
      <div className="aspect-[4/5] overflow-hidden bg-black/20">
        <img src={campaign.image_url} alt={campaign.name} className="h-full w-full object-cover" />
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">{campaign.name}</h3>
            <p className="text-xs text-gray-400">{createdAt}</p>
          </div>
          <Badge className="border border-[#FF6600]/30 bg-[#FF6600]/10 text-[#FF6600]">Salva</Badge>
        </div>

        <p className="max-h-24 overflow-hidden whitespace-pre-wrap text-sm text-gray-300">
          {campaign.caption}
        </p>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => onLoad(campaign)} className="bg-[#4C12A1] text-white hover:bg-[#5b17bf]">
            <History className="w-4 h-4" />
            Usar novamente
          </Button>
          <a href={campaign.image_url} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10">
              <ExternalLink className="w-4 h-4" />
              Abrir arte
            </Button>
          </a>
          <Button onClick={() => onDelete(campaign.id)} variant="outline" className="border-red-500/30 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200">
            <Trash2 className="w-4 h-4" />
            Excluir
          </Button>
        </div>
      </div>
    </div>
  );
}