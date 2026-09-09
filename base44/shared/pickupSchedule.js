export const PICKUP_TIME_ZONE = 'America/Sao_Paulo';
export const PICKUP_UTC_OFFSET = '-03:00';

export function getPickupDateRange(date) {
  return {
    start: new Date(`${date}T00:00:00${PICKUP_UTC_OFFSET}`).toISOString(),
    end: new Date(`${date}T23:59:59${PICKUP_UTC_OFFSET}`).toISOString()
  };
}

export function getPickupSlotIso(date, time) {
  return new Date(`${date}T${time}:00${PICKUP_UTC_OFFSET}`).toISOString();
}

export function getPickupLocalHour(value) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: PICKUP_TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value)).find((part) => part.type === 'hour')?.value;
  return Number(hour);
}

export function getPickupScheduleForDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return { isOpen: false, error: 'Data inválida para coleta.' };
  }

  const localDate = new Date(`${date}T12:00:00-03:00`);
  if (Number.isNaN(localDate.getTime())) {
    return { isOpen: false, error: 'Data inválida para coleta.' };
  }

  const dayOfWeek = localDate.getUTCDay();
  if (dayOfWeek === 0) {
    return { isOpen: false, error: 'Não realizamos coletas aos domingos. Sugira uma data de segunda a sábado.' };
  }

  if (dayOfWeek === 6) {
    return {
      isOpen: true,
      isSaturday: true,
      morningSlots: ['09:00', '10:00', '11:00', '12:00'],
      afternoonSlots: [],
      morningCapacity: 4,
      afternoonCapacity: 0,
      morningLabel: 'Manhã (das 9h às 12h)'
    };
  }

  return {
    isOpen: true,
    isSaturday: false,
    morningSlots: ['08:00', '09:00', '10:00', '11:00', '12:00'],
    afternoonSlots: ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'],
    morningCapacity: 5,
    afternoonCapacity: 7,
    morningLabel: 'Manhã (das 8h às 12h)'
  };
}