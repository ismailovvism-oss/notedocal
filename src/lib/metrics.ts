// Замеры и анализы поверх дневника здоровья.
//
// Запись показателя — это заметка (Note) с health 'metric' (замерил сам) или
// 'lab' (сдал в лаборатории), кодом показателя в `code` и числом в `value`
// (у давления второе число в `value2`). Справочник норм и целей лежит в
// metrics.json — тот же файл читает scripts/secretary.mjs, чтобы правила
// не разъезжались между приложением и командной строкой.

import catalog from './metrics.json';
import type { Note } from '../types';

export interface MetricDef {
  code: string;
  label: string;
  unit: string;
  group: 'metric' | 'lab';
  /** Референс лаборатории. */
  normLow?: number;
  normHigh?: number;
  /** Для давления — верх по диастолическому. */
  normHigh2?: number;
  /** Личная цель из медпрофиля (жёстче нормы). */
  goalMin?: number;
  goalMax?: number;
  decimals?: number;
  /** Два числа в одном замере (давление). */
  pair?: boolean;
  /** Через сколько дней пересдавать. */
  repeatDays?: number;
  hint?: string;
  aliases?: string[];
}

export const METRICS: MetricDef[] = (catalog.items as MetricDef[]).slice();

export const METRIC_BY_CODE: Record<string, MetricDef> = Object.fromEntries(
  METRICS.map((m) => [m.code, m]),
);

export function metricDef(code?: string): MetricDef | null {
  return code ? METRIC_BY_CODE[code] ?? null : null;
}

/** Оценка значения. Вне нормы и вне цели — красный; что-то одно — жёлтый.
 *  Так HbA1c 5.7 (выше нормы, но в цели ≤6.5) не кричит красным, а LDL 216
 *  (выше и нормы, и цели) кричит. */
export type MetricStatus = 'ok' | 'warn' | 'bad';

const WORST: Record<MetricStatus, number> = { ok: 0, warn: 1, bad: 2 };

/** Статус замера целиком: у давления учитывает и нижнее число. */
export function statusOfNote(def: MetricDef, value: number, value2?: number): MetricStatus {
  const first = statusOf(def, value);
  if (!def.pair || value2 == null || def.normHigh2 == null) return first;
  const second: MetricStatus = value2 > def.normHigh2 ? 'bad' : 'ok';
  return WORST[second] > WORST[first] ? second : first;
}

export function statusOf(def: MetricDef, value: number): MetricStatus {
  const inNorm =
    (def.normLow == null || value >= def.normLow) && (def.normHigh == null || value <= def.normHigh);
  const hasGoal = def.goalMin != null || def.goalMax != null;
  // Без личной цели судим по норме: вышел за референс — красный.
  if (!hasGoal) return inNorm ? 'ok' : 'bad';
  const inGoal =
    (def.goalMin == null || value >= def.goalMin) && (def.goalMax == null || value <= def.goalMax);
  if (!inNorm && !inGoal) return 'bad';
  if (!inNorm || !inGoal) return 'warn';
  return 'ok';
}

export function fmtValue(def: MetricDef, n: Note): string {
  const d = def.decimals ?? 0;
  const v = (n.value ?? 0).toFixed(d);
  return def.pair && n.value2 != null ? `${v}/${n.value2.toFixed(d)}` : v;
}

/** Норма и цель словами — для подписи под значением. */
export function rangeLabel(def: MetricDef): string {
  const parts: string[] = [];
  if (def.normLow != null && def.normHigh != null) parts.push(`норма ${def.normLow}–${def.normHigh}`);
  else if (def.normHigh != null) parts.push(`норма <${def.normHigh}`);
  else if (def.normLow != null) parts.push(`норма >${def.normLow}`);
  if (def.goalMax != null) parts.push(`цель <${def.goalMax}`);
  else if (def.goalMin != null) parts.push(`цель >${def.goalMin}`);
  return parts.join(' · ');
}

export interface Point {
  date: string;
  value: number;
  value2?: number;
  note: Note;
}

/** Все записи показателя по возрастанию даты. */
export function seriesOf(notes: Note[], code: string): Point[] {
  return notes
    .filter((n) => !n.deleted && n.code === code && n.value != null && n.date)
    .map((n) => ({ date: n.date as string, value: n.value as number, value2: n.value2, note: n }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function latestOf(notes: Note[], code: string): Point | null {
  const s = seriesOf(notes, code);
  return s.length ? s[s.length - 1] : null;
}

/** Коды, по которым вообще есть записи, в порядке справочника. */
export function usedCodes(notes: Note[], group: 'metric' | 'lab'): string[] {
  const have = new Set(
    notes.filter((n) => !n.deleted && n.code && n.value != null).map((n) => n.code as string),
  );
  return METRICS.filter((m) => m.group === group && have.has(m.code)).map((m) => m.code);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export interface DueItem {
  def: MetricDef;
  lastDate: string | null;
  overdueDays: number | null;
}

/** Что пора пересдать: никогда не сдавалось или прошло больше repeatDays.
 *  `watch` — коды, за которыми следим, даже если анализа ещё не было. */
export function dueLabs(notes: Note[], todayKey: string, watch: string[] = []): DueItem[] {
  const out: DueItem[] = [];
  for (const def of METRICS) {
    if (def.group !== 'lab') continue;
    const last = latestOf(notes, def.code);
    if (!last) {
      if (watch.includes(def.code)) out.push({ def, lastDate: null, overdueDays: null });
      continue;
    }
    if (def.repeatDays == null) continue;
    const age = daysBetween(last.date, todayKey);
    if (age >= def.repeatDays) out.push({ def, lastDate: last.date, overdueDays: age - def.repeatDays });
  }
  return out;
}

/** Точки для мини-графика: путь polyline в координатах w×h. */
export function sparkPoints(points: Point[], w: number, h: number, pad = 2): string {
  if (points.length === 0) return '';
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  return points
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((p.value - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Изменение относительно первой точки периода — «−2.4 кг за 30 дней». */
export function deltaOf(points: Point[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1].value - points[0].value;
}

/** Записи показателей за последние N дней. */
export function sinceDays(points: Point[], todayKey: string, days: number): Point[] {
  const from = new Date(Date.parse(todayKey) - days * 86400000).toISOString().slice(0, 10);
  return points.filter((p) => p.date >= from);
}
