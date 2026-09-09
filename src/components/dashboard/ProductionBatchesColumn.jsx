import React from 'react';
import { Factory, GripVertical, Package } from 'lucide-react';

const STAGE_LABELS = {
  washing: 'Lavagem',
  drying: 'Secagem',
  dry_cleaning: 'Lavagem a seco',
  ironing: 'Passadoria',
  finishing: 'Acabamento',
  quality_control: 'Qualidade',
  packaging: 'Embalagem'
};

const STAGE_TIME_KEY = {
  washing: 'wash_time',
  drying: 'dry_time',
  dry_cleaning: 'dry_clean_time',
  ironing: 'iron_time'
};

const STATUS_LABELS = {
  draft: 'Rascunho',
  scheduled: 'Agendado',
  waiting_materials: 'Aguardando insumos',
  queued: 'Fila',
  processing: 'Em produção',
  paused: 'Pausado'
};

export default function ProductionBatchesColumn({ batches }) {
  const handleDragStart = (event, batch) => {
    const timeKey = STAGE_TIME_KEY[batch.stage];
    const minutes = Number(batch.estimated_minutes) || 0;
    const times = timeKey ? { [timeKey]: minutes } : {};
    event.dataTransfer.setData('application/json', JSON.stringify({
      customerName: batch.code,
      saleId: batch.id,
      times
    }));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="mb-4 flex items-center gap-2">
        <Factory className="h-5 w-5 text-cyan-400" />
        <h3 className="font-bold text-white">Lotes em Produção</h3>
        <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-gray-300">
          {batches.length}
        </span>
      </div>

      {batches.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">Nenhum lote em produção.</p>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => (
            <div
              key={batch.id}
              draggable
              onDragStart={(event) => handleDragStart(event, batch)}
              className="flex cursor-grab items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 transition-colors hover:border-cyan-400/40 active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4 shrink-0 text-gray-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{batch.code}</p>
                <p className="text-xs text-gray-400">
                  {STAGE_LABELS[batch.stage] || batch.stage} · {STATUS_LABELS[batch.status] || batch.status}
                  {batch.estimated_minutes ? ` · ${batch.estimated_minutes} min` : ''}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-xs text-gray-300">
                <Package className="h-3.5 w-3.5" /> {batch.piece_count || 0}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Arraste um lote para uma máquina acima para iniciar o processo.
      </p>
    </div>
  );
}