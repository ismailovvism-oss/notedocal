// Дневник здоровья поверх заметок.
//
// Запись здоровья — это обычная заметка (Note) с полем health (вид: еда,
// препарат, другое) и временем time. Так бесплатно достаются фото-вложения,
// markdown-описание и синхронизация. Все такие заметки складываются в
// служебную папку «Здоровье» (заметка-папка с фиксированным id).

import type { HealthKind, Note } from '../types';

/** Фиксированный id папки-заметки «Здоровье» (одинаков на всех устройствах). */
export const HEALTH_FOLDER_ID = 'health-folder';

export const HEALTH_KINDS: HealthKind[] = ['meal', 'med', 'other'];

export const HEALTH_META: Record<HealthKind, { icon: string; label: string }> = {
  meal: { icon: '🍽', label: 'Приём пищи' },
  med: { icon: '💊', label: 'Препарат' },
  other: { icon: '🩹', label: 'Другое' },
};

/** Записи здоровья на день, отсортированные по времени. */
export function healthOnDay(notes: Note[], key: string): Note[] {
  return notes
    .filter((n) => !n.deleted && n.health && n.date === key)
    .sort((a, b) => ((a.time || '99:99') < (b.time || '99:99') ? -1 : 1));
}

/** Сводка по видам за день (для маркера на ячейке календаря). */
export function healthCounts(entries: Note[]): Record<HealthKind, number> {
  const c: Record<HealthKind, number> = { meal: 0, med: 0, other: 0 };
  for (const e of entries) if (e.health) c[e.health] += 1;
  return c;
}

// ---- Мотивация по режиму питания ----

export const MEAL_GOAL = 2; // цель — 2 приёма в день
export const MEAL_MAX = 3; // максимум — 3
export const DEFAULT_MEAL_GAP_H = 5; // рекомендуемый промежуток между приёмами, ч

/** Оценка дня: 'good' — идеально (2 приёма с промежутком), 'ok' — средне
 *  (1 или 3), 'over' — перебор (4+), 'none' — приёмов пищи нет. */
export type MealScore = 'none' | 'good' | 'ok' | 'over';

function mealMinutes(time?: string): number | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

export function mealScore(entries: Note[], gapHours: number): MealScore {
  const meals = entries.filter((e) => e.health === 'meal');
  const n = meals.length;
  if (n === 0) return 'none';
  if (n >= 4) return 'over';
  if (n === MEAL_GOAL) {
    const times = meals
      .map((e) => mealMinutes(e.time))
      .filter((x): x is number => x != null)
      .sort((a, b) => a - b);
    // Два приёма с достаточным промежутком — отлично; впритык — средне.
    if (times.length === 2) return times[1] - times[0] >= gapHours * 60 ? 'good' : 'ok';
    return 'good';
  }
  return 'ok'; // 1 или 3 приёма — средне
}

function toMs(dateKey: string, hhmm: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime();
}

export interface MealPlan {
  count: number;
  lastTime: string | null;
  /** Рекомендуемое время следующего приёма (ms) — если пора напомнить. */
  nextMs: number | null;
}

/** План приёмов пищи на день: сколько было и когда пора следующий.
 *  Напоминаем, только пока не достигнута цель (после 1-го — о 2-м). */
export function mealPlan(entries: Note[], dateKey: string, gapHours: number): MealPlan {
  const meals = entries
    .filter((e) => e.health === 'meal')
    .sort((a, b) => ((a.time || '99:99') < (b.time || '99:99') ? -1 : 1));
  const timed = meals.filter((e) => e.time);
  const last = timed[timed.length - 1];
  const nextMs =
    last && meals.length < MEAL_GOAL ? toMs(dateKey, last.time as string) + gapHours * 3600000 : null;
  return { count: meals.length, lastTime: last?.time ?? null, nextMs };
}
