import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Gerencia o estado das máquinas da lavanderia: qual cliente está dentro de cada
 * máquina, o tempo restante da contagem regressiva e o alarme sonoro/visual.
 *
 * O estado é persistido na entidade `MachineState` (banco de dados) e sincronizado
 * em tempo real entre TODOS os usuários via subscription. Assim, qualquer pessoa
 * que abrir o site (publicado ou preview) vê as mesmas máquinas com os mesmos timers.
 */

const MachineContext = createContext(null);

// Som de campainha (alarme) repetível
const ALARM_SRC = 'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg';

export function MachineProvider({ children }) {
  // machines: { [machine_id]: { recordId, customerName, machineType, minutes, endsAt, finished } }
  const [machines, setMachines] = useState({});
  const alarmRef = useRef(null);

  // Constrói o mapa local a partir dos registros do banco
  const buildMap = useCallback((records) => {
    const map = {};
    (records || []).forEach((r) => {
      if (!r.machine_id) return;
      map[r.machine_id] = {
        recordId: r.id,
        customerName: r.customer_name,
        saleId: r.sale_id || null,
        machineType: r.machine_type || null,
        minutes: r.minutes || 0,
        endsAt: r.ends_at || 0,
        finished: !!r.finished,
      };
    });
    return map;
  }, []);

  // Carga inicial + subscription em tempo real
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const records = await base44.entities.MachineState.list('-updated_date', 200);
        if (mounted) setMachines(buildMap(records));
      } catch (e) {
        console.error('Erro ao carregar máquinas:', e);
      }
    };
    load();

    const unsub = base44.entities.MachineState.subscribe(() => {
      // Recarrega o estado completo a cada mudança (poucos registros, simples e confiável)
      base44.entities.MachineState.list('-updated_date', 200)
        .then((records) => { if (mounted) setMachines(buildMap(records)); })
        .catch(() => {});
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, [buildMap]);

  // Inicializa o áudio do alarme uma única vez
  useEffect(() => {
    const audio = new Audio(ALARM_SRC);
    audio.loop = true;
    alarmRef.current = audio;
    return () => {
      audio.pause();
    };
  }, []);

  // Tick a cada segundo: ao zerar o tempo, marca como finished no banco (uma vez)
  useEffect(() => {
    const interval = setInterval(() => {
      Object.values(machines).forEach((m) => {
        if (m && m.recordId && m.endsAt && !m.finished && m.endsAt - Date.now() <= 0) {
          base44.entities.MachineState.update(m.recordId, { finished: true }).catch(() => {});
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [machines]);

  // Controla o som do alarme: toca se houver QUALQUER máquina finished
  useEffect(() => {
    const anyFinished = Object.values(machines).some((m) => m && m.finished);
    if (!alarmRef.current) return;
    if (anyFinished) {
      alarmRef.current.play().catch(() => {});
    } else {
      alarmRef.current.pause();
      alarmRef.current.currentTime = 0;
    }
  }, [machines]);

  // Coloca um cliente dentro de uma máquina e inicia a contagem (minutes em minutos)
  const startMachine = useCallback(async (machineId, { customerName, minutes, machineType, saleId }) => {
    const durationMs = Math.max(0, Number(minutes) || 0) * 60 * 1000;
    const payload = {
      machine_id: machineId,
      customer_name: customerName,
      sale_id: saleId || null,
      machine_type: machineType || null,
      minutes: Number(minutes) || 0,
      ends_at: Date.now() + durationMs,
      finished: durationMs === 0,
    };

    try {
      const existing = await base44.entities.MachineState.filter({ machine_id: machineId });
      if (existing && existing.length > 0) {
        await base44.entities.MachineState.update(existing[0].id, payload);
        // Remove duplicados eventuais
        for (let i = 1; i < existing.length; i++) {
          base44.entities.MachineState.delete(existing[i].id).catch(() => {});
        }
      } else {
        await base44.entities.MachineState.create(payload);
      }

      // Ticket entrou na máquina -> muda status do pedido para "processing" (em processo)
      if (saleId) {
        base44.entities.Order.update(saleId, { status: 'processing' }).catch(() => {});
      }
    } catch (e) {
      console.error('Erro ao iniciar máquina:', e);
    }
  }, []);

  // Retorna o rótulo de status do TICKET específico que está na máquina.
  // Usa saleId (identificador único do ticket) — assim, mesmo que vários tickets
  // tenham o mesmo nome de cliente, só o que realmente foi para a máquina mostra o status.
  const getCustomerStatus = useCallback((saleId) => {
    if (!saleId) return null;
    const DONE_COLOR = 'bg-green-500/25 text-green-300 border-green-500/50';
    const LABELS = {
      wash: { running: 'Lavando', done: 'Lavado', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
      dry: { running: 'Secando', done: 'Seco', color: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40' },
      iron: { running: 'Passando', done: 'Passado', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
      dry_clean: { running: 'Lavando a seco', done: 'Lavado a seco', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
    };
    const entries = Object.values(machines).filter(
      (m) => m && m.saleId === saleId && m.machineType
    );
    if (entries.length === 0) return null;
    // Prioriza máquina ainda em execução; se nenhuma estiver rodando,
    // mostra a máquina finalizada mais recente (status "pronto").
    const running = entries.find((m) => !m.finished);
    const target = running || entries.reduce((a, b) => (b.endsAt > a.endsAt ? b : a));
    const cfg = LABELS[target.machineType];
    if (!cfg) return null;
    return {
      label: target.finished ? cfg.done : cfg.running,
      color: target.finished ? DONE_COLOR : cfg.color,
      done: !!target.finished,
    };
  }, [machines]);

  // Botão "Pronto": esvazia a máquina (deleta o registro) e para o alarme
  const clearMachine = useCallback(async (machineId) => {
    const m = machines[machineId];
    try {
      if (m && m.recordId) {
        await base44.entities.MachineState.delete(m.recordId);
      } else {
        const existing = await base44.entities.MachineState.filter({ machine_id: machineId });
        await Promise.all((existing || []).map((r) => base44.entities.MachineState.delete(r.id).catch(() => {})));
      }

      // Time finalizou a máquina -> muda status do pedido para "ready" (pronto)
      if (m && m.saleId) {
        base44.entities.Order.update(m.saleId, { status: 'ready' }).catch(() => {});
      }
    } catch (e) {
      console.error('Erro ao limpar máquina:', e);
    }
  }, [machines]);

  return (
    <MachineContext.Provider value={{ machines, startMachine, clearMachine, getCustomerStatus }}>
      {children}
    </MachineContext.Provider>
  );
}

export function useCustomerStatus() {
  const ctx = useContext(MachineContext);
  if (!ctx) throw new Error('useCustomerStatus deve ser usado dentro de MachineProvider');
  return ctx.getCustomerStatus;
}

export function useMachine(machineId) {
  const ctx = useContext(MachineContext);
  if (!ctx) throw new Error('useMachine deve ser usado dentro de MachineProvider');
  const state = ctx.machines[machineId] || null;
  return {
    state,
    start: (payload) => ctx.startMachine(machineId, payload),
    clear: () => ctx.clearMachine(machineId),
  };
}