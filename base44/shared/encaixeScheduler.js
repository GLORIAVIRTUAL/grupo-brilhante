// Lógica de ENCAIXE: quando o pagamento antecipado via Pix é confirmado pelo Asaas,
// a coleta entra automaticamente no próximo turno disponível (sem depender da IA).
// Extraído para shared/ para reuso entre o interceptor determinístico e o tool handler.

import { getPickupScheduleForDate, getPickupDateRange, getPickupLocalHour, getPickupSlotIso } from './pickupSchedule.js';

const HOLIDAYS_FIXED = {
    '01-01': true, '02-02': true, '21-04': true, '01-05': true,
    '07-09': true, '20-09': true, '12-10': true, '02-11': true,
    '15-11': true, '25-12': true
};

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const isHoliday = (d) => {
    const ddmm = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}`;
    return !!HOLIDAYS_FIXED[ddmm];
};

// Verifica se há capacidade num turno específico (manhã ou tarde) para uma data.
async function hasCapacity(base44, date, period) {
    const sched = getPickupScheduleForDate(date);
    if (!sched.isOpen) return false;
    const checkDate = new Date(`${date}T12:00:00-03:00`);
    if (isHoliday(checkDate)) return false;
    if (period === 'morning' && sched.morningSlots.length === 0) return false;
    if (period === 'afternoon' && sched.afternoonSlots.length === 0) return false;
    const range = getPickupDateRange(date);
    const dayPickups = await base44.asServiceRole.entities.Pickup.filter({
        scheduled_at: { $gte: range.start, $lte: range.end },
        status: { $ne: 'cancelled' }
    });
    const capacity = period === 'morning' ? sched.morningCapacity : sched.afternoonCapacity;
    const count = dayPickups.filter(p => {
        const h = getPickupLocalHour(p.scheduled_at);
        return period === 'morning' ? h < 13 : h >= 13;
    }).length;
    return count < capacity;
}

// Encontra o próximo turno disponível para encaixe.
// Regra: se agora é manhã e a tarde de hoje tem vaga → hoje à tarde.
//        Senão, procura a próxima manhã útil (pulando feriados/fins de semana).
// Retorna { date, period, schedule, slot } ou null se não houver turno nos próximos 7 dias.
export async function findNextEncaixeSlot(base44) {
    const nowBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const currentHour = nowBRT.getHours();
    const isMorning = currentHour < 12;

    let targetDate = null;
    let targetPeriod = null;

    // Manhã → tenta tarde de hoje (se ainda dentro do horário de agendamento)
    if (isMorning && currentHour < 16) {
        const todayKey = dateKey(nowBRT);
        if (await hasCapacity(base44, todayKey, 'afternoon')) {
            targetDate = todayKey;
            targetPeriod = 'afternoon';
        }
    }

    // Se não achou, procura próxima manhã útil (até 7 dias)
    if (!targetDate) {
        for (let i = 1; i <= 7; i++) {
            const future = new Date(nowBRT);
            future.setDate(future.getDate() + i);
            const futureKey = dateKey(future);
            if (await hasCapacity(base44, futureKey, 'morning')) {
                targetDate = futureKey;
                targetPeriod = 'morning';
                break;
            }
        }
    }

    // Se ainda não achou manhã, tenta próximas tardes úteis
    if (!targetDate) {
        for (let i = 1; i <= 7; i++) {
            const future = new Date(nowBRT);
            future.setDate(future.getDate() + i);
            const futureKey = dateKey(future);
            if (await hasCapacity(base44, futureKey, 'afternoon')) {
                targetDate = futureKey;
                targetPeriod = 'afternoon';
                break;
            }
        }
    }

    if (!targetDate) return null;

    const schedule = getPickupScheduleForDate(targetDate);
    const targetSlots = targetPeriod === 'morning' ? schedule.morningSlots : schedule.afternoonSlots;

    // Encontra o primeiro slot livre (sem colisão com coletas existentes)
    const range = getPickupDateRange(targetDate);
    const existingPickups = await base44.asServiceRole.entities.Pickup.filter({
        scheduled_at: { $gte: range.start, $lte: range.end },
        status: { $ne: 'cancelled' }
    });

    let selectedSlot = null;
    for (const slot of targetSlots) {
        const slotIso = getPickupSlotIso(targetDate, slot);
        const isTaken = existingPickups.some(p =>
            Math.abs(new Date(p.scheduled_at).getTime() - new Date(slotIso).getTime()) < 60000
        );
        if (!isTaken) {
            selectedSlot = slot;
            break;
        }
    }

    if (!selectedSlot) return null;

    return {
        date: targetDate,
        period: targetPeriod,
        schedule,
        slot: selectedSlot,
        slotIso: getPickupSlotIso(targetDate, selectedSlot)
    };
}

// Formata a data do encaixe para exibição ao cliente (ex: "08/09/2026")
export function formatEncaixeDate(dateStr) {
    return new Date(`${dateStr}T12:00:00-03:00`).toLocaleDateString('pt-BR');
}