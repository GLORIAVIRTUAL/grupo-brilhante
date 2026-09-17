import { subDays } from 'date-fns';

const MAX_DATE = new Date(8640000000000000);

// Converte a seleção do filtro de datas em um intervalo concreto.
export function resolveDateRange(dateRange, customStart, customEnd) {
  if (dateRange === 'all') return { start: new Date(0), end: MAX_DATE };
  if (dateRange === 'custom') {
    return {
      start: customStart ? new Date(`${customStart}T00:00:00`) : new Date(0),
      end: customEnd ? new Date(`${customEnd}T23:59:59`) : MAX_DATE,
    };
  }
  return { start: subDays(new Date(), parseInt(dateRange, 10) || 30), end: MAX_DATE };
}

// Mantém apenas registros cuja primeira data disponível está dentro do intervalo.
export function filterByDateRange(records = [], range, fields = ['created_date']) {
  if (!range) return records;
  return records.filter((record) => {
    const value = fields.map((field) => record?.[field]).find((item) => !!item);
    if (!value) return true;
    const time = new Date(value);
    return time >= range.start && time <= range.end;
  });
}