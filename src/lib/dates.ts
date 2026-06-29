// Утилиты для работы с датами: григорианский и исламский (хиджра) календари.

/** Ключ дня в формате YYYY-MM-DD по локальному времени. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Разбирает ключ YYYY-MM-DD в локальную дату (полдень — чтобы не прыгать по часовым поясам). */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export const todayKey = (): string => dayKey(new Date());

export const isSameDay = (a: Date, b: Date): boolean => dayKey(a) === dayKey(b);

const GREG_MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/** «Июнь 2026» — заголовок месяца. */
export function gregMonthTitle(d: Date): string {
  return `${capitalize(GREG_MONTHS[d.getMonth()])} ${d.getFullYear()}`;
}

const hijriLong = new Intl.DateTimeFormat('ru-u-ca-islamic-umalqura', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const hijriDayFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

/** Полная дата по хиджре: «14 мухаррам 1448 г. AH». */
export function hijriFull(d: Date): string {
  return hijriLong.format(d);
}

/** Числовые части даты по хиджре. */
export function hijriParts(d: Date): { day: number; month: number; year: number } {
  const parts = hijriDayFmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { day: get('day'), month: get('month'), year: get('year') };
}

/** Номер дня по хиджре — для отображения в ячейке календаря. */
export const hijriDay = (d: Date): number => hijriParts(d).day;

/** Сетка месяца: всегда 6 недель × 7 дней, неделя начинается с понедельника. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // getDay(): 0=вс..6=сб -> смещаем так, чтобы понедельник был 0.
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
