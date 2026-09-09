export const PICKUP_TIME_ZONE = 'America/Sao_Paulo';

export function normalizeUtcTimestamp(value) {
  if (!value) return value;
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text) ? `${text}Z` : text;
}

export function formatBrasiliaDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: PICKUP_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(normalizeUtcTimestamp(value))).replace(',', ' às');
}

export function formatBrasiliaTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: PICKUP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(normalizeUtcTimestamp(value)));
}

export function getBrasiliaDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PICKUP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(normalizeUtcTimestamp(value)));
  const map = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function getCalendarDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getBrasiliaTimeParts(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PICKUP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(normalizeUtcTimestamp(value)));
  const map = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return { hour: Number(map.hour), minute: Number(map.minute) };
}

export function buildPickupIso(date, time) {
  const dateKey = typeof date === 'string' ? date : getCalendarDateKey(date);
  return new Date(`${dateKey}T${time}:00-03:00`).toISOString();
}

export function isSameBrasiliaDay(value, date) {
  return getBrasiliaDateKey(value) === (typeof date === 'string' ? date : getCalendarDateKey(date));
}