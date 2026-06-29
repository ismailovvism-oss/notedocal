// Утилиты для работы с датами: григорианский и исламский (хиджра) календари.

import type { MoonSighting } from '../types';

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

/** Прибавить n дней к ключу YYYY-MM-DD и вернуть новый ключ. */
export function addDaysKey(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Целое число дней между двумя ключами (b − a). */
export function diffDays(aKey: string, bKey: string): number {
  const a = fromKey(aKey).getTime();
  const b = fromKey(bKey).getTime();
  return Math.round((b - a) / 86_400_000);
}

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

/** Полная дата по хиджре из встроенного календаря: «14 мухаррам 1448 г. AH». */
export function hijriFull(d: Date): string {
  return hijriLong.format(d);
}

/** Числовые части даты по хиджре (по расчётному календарю Умм аль-Кура). */
export function hijriParts(d: Date): { day: number; month: number; year: number } {
  const parts = hijriDayFmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { day: get('day'), month: get('month'), year: get('year') };
}

/** Названия месяцев хиджры (1..12). */
export const HIJRI_MONTHS = [
  'мухаррам',
  'сафар',
  'раби-уль-авваль',
  'раби-уль-ахир',
  'джумада-уль-уля',
  'джумада-уль-ахира',
  'раджаб',
  'шаабан',
  'рамадан',
  'шавваль',
  'зуль-каада',
  'зуль-хиджа',
];

/** Откуда взята хиджра-дата:
 *  'admin'    — официальный календарь администратора (точная);
 *  'observed' — личное наблюдение пользователя (точная);
 *  'computed' — расчётный календарь Умм аль-Кура (предположительная). */
export type HijriSource = 'admin' | 'observed' | 'computed';

export interface HijriDate {
  day: number;
  month: number;
  year: number;
  source: HijriSource;
}

/**
 * Разрешить дату по набору наблюдений-«якорей» или вернуть null.
 *
 * Находим ближайший якорь, начавшийся не позже дня. Месяц длится 29–30 дней:
 *  - если известна граница следующего месяца (следующий якорь в пределах
 *    30 дней) — все дни до неё точные;
 *  - если следующего якоря нет (или он далеко — наблюдение пропущено) —
 *    точными считаем только дни 1..29; день 30 и далее неоднозначны → null.
 */
function resolveAnchors(
  key: string,
  sightings: MoonSighting[],
): { day: number; month: number; year: number } | null {
  const anchors = sightings
    .filter((s) => !s.deleted)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

  let prev: MoonSighting | null = null;
  let next: MoonSighting | null = null;
  for (const s of anchors) {
    if (s.startDate <= key) prev = s;
    else {
      next = s;
      break;
    }
  }

  if (prev) {
    const dom = diffDays(prev.startDate, key) + 1; // номер дня в месяце
    const monthLen = next ? diffDays(prev.startDate, next.startDate) : Infinity;
    const certain = monthLen <= 30 ? dom <= monthLen : dom <= 29;
    if (certain) return { day: dom, month: prev.hijriMonth, year: prev.hijriYear };
  }
  return null;
}

/**
 * Хиджра-дата с учётом приоритета источников.
 *
 * По умолчанию официальные данные администратора перебивают всё. Если
 * пользователь отключил официальный календарь (`useAdmin = false`) — берутся
 * только его личные наблюдения, затем расчётный календарь.
 *
 * Приоритет при useAdmin=true:  админ → личное → расчёт.
 * Приоритет при useAdmin=false: личное → расчёт.
 */
export function hijriFor(
  d: Date,
  own: MoonSighting[],
  admin: MoonSighting[],
  useAdmin: boolean,
): HijriDate {
  const key = dayKey(d);

  if (useAdmin) {
    const a = resolveAnchors(key, admin);
    if (a) return { ...a, source: 'admin' };
  }
  const o = resolveAnchors(key, own);
  if (o) return { ...o, source: 'observed' };

  const p = hijriParts(d);
  return { day: p.day, month: p.month, year: p.year, source: 'computed' };
}

/** Отформатировать хиджра-дату: «14 рамадан 1447». Предположительные — со знаком «≈». */
export function formatHijri(h: HijriDate): string {
  const base = `${h.day} ${HIJRI_MONTHS[h.month - 1] ?? ''} ${h.year}`.trim();
  return h.source === 'computed' ? `≈ ${base}` : base;
}

/** Краткая подпись источника даты. */
export function hijriSourceLabel(source: HijriSource): string {
  switch (source) {
    case 'admin':
      return 'официальная';
    case 'observed':
      return 'ваше наблюдение';
    default:
      return 'расчётная';
  }
}

/** Номер дня по хиджре — для отображения в ячейке календаря (расчётный). */
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
