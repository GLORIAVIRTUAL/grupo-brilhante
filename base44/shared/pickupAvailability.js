import { getPickupLocalHour } from './pickupSchedule.js';

const normalize = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const toDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function resolvePickupAvailabilityRequest(text = '', now = new Date()) {
  const value = normalize(text);
  const asksPickup = /\b(coleta|coletar|recolher|recolhe|buscar|retirar|retirada)\b/.test(value);
  const asksAvailability = /\b(hoje|amanha|consegue|conseguem|pode|podem|disponibilidade|vaga|tem coleta|vai ter coleta)\b/.test(value);
  if (!asksPickup || !asksAvailability) return null;

  const brasiliaNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const requestedDate = new Date(brasiliaNow);
  let label = 'hoje';

  if (value.includes('amanha')) {
    requestedDate.setDate(requestedDate.getDate() + 1);
    label = 'amanhã';
  } else if (!value.includes('hoje')) {
    return null;
  }

  return { date: toDateKey(requestedDate), label };
}

export function buildPickupAvailabilityResponse({ request, schedule, pickups = [], now = new Date() }) {
  if (!schedule.isOpen) {
    return {
      message: schedule.error || `Não realizamos coletas ${request.label}. Posso verificar a próxima data disponível para você?`,
      period: null
    };
  }

  let morningCount = 0;
  let afternoonCount = 0;
  for (const pickup of pickups) {
    if (getPickupLocalHour(pickup.scheduled_at) < 13) morningCount++;
    else afternoonCount++;
  }

  const brasiliaNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const todayKey = toDateKey(brasiliaNow);
  const isToday = request.date === todayKey;
  const morningPast = isToday && brasiliaNow.getHours() >= 12;
  const afternoonPast = isToday && brasiliaNow.getHours() >= 16;
  const morningAvailable = morningPast ? 0 : Math.max(0, schedule.morningCapacity - morningCount);
  const afternoonAvailable = afternoonPast ? 0 : Math.max(0, schedule.afternoonCapacity - afternoonCount);

  if (morningAvailable > 0 && afternoonAvailable > 0) {
    // Os dois turnos livres: o cliente escolhe qual prefere (não escolhemos por ele).
    return {
      message: `Sim! Temos disponibilidade ${request.label} nos dois turnos: *${schedule.morningLabel}* ou *Tarde (das 13h às 16h)*. Qual você prefere? 😊`,
      period: null
    };
  }
  if (morningAvailable > 0) {
    return {
      message: `Sim! Temos disponibilidade ${request.label} no turno da ${schedule.morningLabel}. Posso agendar para você? 😊`,
      period: 'morning'
    };
  }
  if (afternoonAvailable > 0) {
    return {
      message: `Sim! Temos disponibilidade ${request.label} no turno da tarde (das 13h às 16h). Posso agendar para você? 😊`,
      period: 'afternoon'
    };
  }
  return {
    message: `Infelizmente não temos mais vagas para coleta ${request.label}. Posso verificar a próxima data disponível para você?`,
    period: null
  };
}