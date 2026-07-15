// Повторяющиеся события: разворачивание правила повтора в конкретные дни.
//
// У события есть «якорь» (date) и правило repeat. Отдельные вхождения не
// хранятся — они вычисляются на лету для нужного дня/диапазона. Поэтому
// правка/удаление события затрагивают всю серию (это ожидаемо для, например,
// ежемесячной оплаты коммуналки).

import type { CalEvent, Repeat } from '../types';
import { fromKey } from './dates';

const REPEAT_LABEL: Record<Repeat, string> = {
  none: 'Без повтора',
  daily: 'Каждый день',
  weekly: 'Каждую неделю',
  monthly: 'Каждый месяц',
  yearly: 'Каждый год',
};

export function repeatLabel(r?: Repeat): string {
  return REPEAT_LABEL[r ?? 'none'];
}

/** Показывается ли событие в день `key` (YYYY-MM-DD). */
export function occursOn(ev: CalEvent, key: string): boolean {
  if (ev.deleted || !ev.date) return false;
  const repeat = ev.repeat ?? 'none';
  if (repeat === 'none') return ev.date === key;

  // Строки YYYY-MM-DD сравниваются лексикографически как даты.
  if (key < ev.date) return false;
  if (ev.repeatUntil && key > ev.repeatUntil) return false;

  const a = fromKey(ev.date);
  const d = fromKey(key);
  switch (repeat) {
    case 'daily':
      return true;
    case 'weekly':
      return a.getDay() === d.getDay(); // тот же день недели ⇒ кратно 7 дней
    case 'monthly':
      return a.getDate() === d.getDate(); // то же число месяца (нет числа — нет вхождения)
    case 'yearly':
      return a.getDate() === d.getDate() && a.getMonth() === d.getMonth();
    default:
      return false;
  }
}

/** События (включая вхождения повторов), попадающие на день `key`. */
export function eventsOnDay(events: CalEvent[], key: string): CalEvent[] {
  return events
    .filter((e) => occursOn(e, key))
    .sort((a, b) => ((a.start || '99:99') < (b.start || '99:99') ? -1 : 1));
}
