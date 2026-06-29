// Утилиты для работы с датами: григорианский и исламский (хиджра) календари.

import type { MoonSighting } from '../types';
import { CALENDAR_BRAND } from './firebase';

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
 *  'admin'    — календарь Tawhiid (наблюдения администратора);
 *  'observed' — личные наблюдения пользователя;
 *  'computed' — расчётный календарь Умм аль-Кура. */
export type HijriSource = 'admin' | 'observed' | 'computed';

export interface HijriDate {
  day: number;
  month: number;
  year: number;
  source: HijriSource;
  /** Точная (подтверждённая наблюдением/счётом текущего месяца) или
   *  предположительная (счёт будущих/прошлых месяцев, либо Умм аль-Кура). */
  certain: boolean;
}

/** Сдвинуть месяц хиджры (1..12) на delta с переносом года. */
function shiftHijriMonth(month: number, year: number, delta: number): { month: number; year: number } {
  const idx = month - 1 + delta;
  const y = year + Math.floor(idx / 12);
  const m = ((idx % 12) + 12) % 12 + 1;
  return { month: m, year: y };
}

/**
 * Разрешить дату по набору наблюдений-«якорей» (или null, если якорей нет).
 *
 * Каждый якорь — 1-е число подтверждённого месяца. Логика:
 *  - между двумя якорями (длина месяца ≤ 30) — все дни точные;
 *  - после последнего якоря без следующего — текущий месяц считаем до 30
 *    (правило хадиса: не увидел молодой месяц → досчитай до 30), эти дни точные;
 *    дальше счёт продолжается 30-дневными месяцами как ПРЕДПОЛОЖЕНИЕ (будущее
 *    ещё не подтверждено наблюдением);
 *  - до первого якоря — счёт назад 30-дневными месяцами как предположение.
 */
function resolveAnchors(
  key: string,
  sightings: MoonSighting[],
): { day: number; month: number; year: number; certain: boolean } | null {
  const anchors = sightings
    .filter((s) => !s.deleted)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  if (anchors.length === 0) return null;

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
    const offset = diffDays(prev.startDate, key); // дней с начала месяца (>=0)
    const monthLen = next ? diffDays(prev.startDate, next.startDate) : Infinity;

    // Месяц с известной границей (следующее наблюдение в пределах 30 дней) —
    // все дни точные.
    if (monthLen <= 30 && offset < monthLen) {
      return { day: offset + 1, month: prev.hijriMonth, year: prev.hijriYear, certain: true };
    }

    // Иначе считаем вперёд 30-дневными месяцами (досчёт по хадису).
    const monthsForward = Math.floor(offset / 30);
    const dom = (offset % 30) + 1;
    const { month, year } = shiftHijriMonth(prev.hijriMonth, prev.hijriYear, monthsForward);
    // Текущий месяц (досчитанный до 30) — точный; будущие месяцы — предположение.
    return { day: dom, month, year, certain: monthsForward === 0 };
  }

  // key раньше первого якоря: считаем назад 30-дневными месяцами.
  const before = diffDays(key, next!.startDate); // дней до 1-го числа (>=1)
  const k = before - 1; // 0 => 30-е прошлого месяца, 1 => 29-е, ...
  const monthsBack = Math.floor(k / 30) + 1;
  const dom = 30 - (k % 30);
  const { month, year } = shiftHijriMonth(next!.hijriMonth, next!.hijriYear, -monthsBack);
  return { day: dom, month, year, certain: false };
}

/**
 * Хиджра-дата с учётом приоритета источников.
 *
 * Приоритет при useAdmin=true:  Tawhiid → личное → расчёт.
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
  return { day: p.day, month: p.month, year: p.year, source: 'computed', certain: false };
}

/** Отформатировать хиджра-дату: «14 рамадан 1447». Предположительные — со знаком «≈». */
export function formatHijri(h: HijriDate): string {
  const base = `${h.day} ${HIJRI_MONTHS[h.month - 1] ?? ''} ${h.year}`.trim();
  return h.certain ? base : `≈ ${base}`;
}

/** Краткая подпись источника даты. */
export function hijriSourceLabel(h: HijriDate): string {
  if (h.source === 'computed') return 'расчётная';
  const who = h.source === 'admin' ? `по ${CALENDAR_BRAND}` : 'ваше наблюдение';
  return h.certain ? who : `${who} · счёт`;
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
