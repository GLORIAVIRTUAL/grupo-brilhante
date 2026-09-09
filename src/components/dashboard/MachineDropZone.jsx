import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, BellRing } from 'lucide-react';
import { useMachine } from '@/components/dashboard/MachineContext';
import { cn } from '@/lib/utils';

/**
 * Envolve uma máquina, tornando-a um alvo de "soltar" (drop) e exibindo o
 * cliente atual + cronômetro regressivo + alarme quando o tempo acaba.
 *
 * Props:
 * - machineId: identificador único da máquina (ex: "WSH-9001")
 * - timeKey: campo de tempo do ticket usado por esta máquina
 *            (wash_time | dry_time | iron_time | dry_clean_time)
 * - accent: cor de destaque (classe tailwind para texto/borda)
 * - children: a representação visual da máquina
 */
export default function MachineDropZone({ machineId, timeKey, accent = 'text-blue-400', accentRing = 'ring-blue-400', children }) {
  const { state, start, clear } = useMachine(machineId);
  const [isOver, setIsOver] = useState(false);
  const [, setTick] = useState(0);

  // Re-renderiza a cada segundo para atualizar o cronômetro exibido
  useEffect(() => {
    if (!state || state.finished) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [state]);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsOver(false);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const data = JSON.parse(raw);
      const minutes = Number(data.times?.[timeKey]) || 0;
      if (minutes <= 0) {
        alert('Este cliente não possui tempo cadastrado para esta etapa. Edite o ticket e informe o tempo.');
        return;
      }
      const typeMap = { wash_time: 'wash', dry_time: 'dry', iron_time: 'iron', dry_clean_time: 'dry_clean' };
      start({ customerName: data.customerName || 'Cliente', saleId: data.saleId || null, minutes, machineType: typeMap[timeKey] });
    } catch {
      // ignore
    }
  };

  const formatRemaining = () => {
    if (!state?.endsAt) return '00:00';
    const remaining = Math.max(0, state.endsAt - Date.now());
    const totalSec = Math.floor(remaining / 1000);
    const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const finished = state?.finished;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      className={cn(
        'relative rounded-2xl transition-all',
        isOver && `ring-2 ${accentRing} ring-offset-2 ring-offset-[#1a0b36] scale-105`
      )}
    >
      {/* Pulso vermelho quando o tempo acaba */}
      {finished && (
        <>
          <motion.div
            animate={{ opacity: [0.15, 0.9, 0.15] }}
            transition={{ duration: 0.6, repeat: Infinity }}
            className="absolute -inset-3 rounded-3xl bg-red-500/50 blur-2xl pointer-events-none z-0"
          />
          {/* Borda vermelha piscando ao redor da máquina inteira */}
          <motion.div
            animate={{ opacity: [0.3, 1, 0.3], boxShadow: ['0 0 10px rgba(239,68,68,0.4)', '0 0 35px rgba(239,68,68,0.9)', '0 0 10px rgba(239,68,68,0.4)'] }}
            transition={{ duration: 0.6, repeat: Infinity }}
            className="absolute -inset-1 rounded-2xl border-2 border-red-500 pointer-events-none z-20"
          />
        </>
      )}

      <div className={cn('relative z-10', finished && 'animate-pulse')}>
        {children}

        <AnimatePresence>
          {state && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute inset-x-1 top-9 bottom-9 flex flex-col items-center justify-center gap-1 rounded-xl bg-black/60 backdrop-blur-sm border border-white/10 p-2 text-center"
            >
              <span className="text-[11px] font-bold text-white leading-tight truncate w-full px-1">
                {state.customerName}
              </span>

              {finished ? (
                <>
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                    className="flex items-center gap-1 text-red-400"
                  >
                    <BellRing className="w-4 h-4" />
                    <span className="text-xs font-bold">PRONTO!</span>
                  </motion.div>
                  <button
                    onClick={clear}
                    className="mt-1 flex items-center gap-1 rounded-lg bg-green-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-green-600 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Pronto
                  </button>
                </>
              ) : (
                <>
                  <span className={cn('font-mono text-lg font-bold', accent)}>
                    {formatRemaining()}
                  </span>
                  <button
                    onClick={clear}
                    className="text-[10px] text-white/50 hover:text-white underline"
                  >
                    cancelar
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}