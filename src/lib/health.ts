// Дневник здоровья поверх заметок.
//
// Запись здоровья — это обычная заметка (Note) с полем health (вид: еда,
// препарат, другое) и временем time. Так бесплатно достаются фото-вложения,
// markdown-описание и синхронизация. Все такие заметки складываются в
// служебную папку «Здоровье» (заметка-папка с фиксированным id).

import type { HealthKind, Note } from '../types';
import { addDaysKey } from './dates';

/** Фиксированный id папки-заметки «Здоровье» (одинаков на всех устройствах). */
export const HEALTH_FOLDER_ID = 'health-folder';

/** Виды, которые можно завести кнопкой в дневнике. 'course' сюда не входит:
 *  курс препарата заводится отдельной карточкой, а не записью дня. */
export const HEALTH_KINDS: HealthKind[] = ['meal', 'med', 'metric', 'lab', 'symptom', 'other'];

export const HEALTH_META: Record<HealthKind, { icon: string; label: string }> = {
  meal: { icon: '🍽', label: 'Приём пищи' },
  med: { icon: '💊', label: 'Препарат' },
  metric: { icon: '📏', label: 'Замер' },
  lab: { icon: '🧪', label: 'Анализ' },
  symptom: { icon: '🤕', label: 'Симптом' },
  other: { icon: '🩹', label: 'Другое' },
  course: { icon: '💉', label: 'Курс препарата' },
};

/** Записи здоровья на день, отсортированные по времени. */
export function healthOnDay(notes: Note[], key: string): Note[] {
  return notes
    .filter((n) => !n.deleted && n.health && n.health !== 'course' && n.date === key)
    .sort((a, b) => ((a.time || '99:99') < (b.time || '99:99') ? -1 : 1));
}

/** Сводка по видам за день (для маркера на ячейке календаря). */
export function healthCounts(entries: Note[]): Record<HealthKind, number> {
  const c: Record<HealthKind, number> = {
    meal: 0,
    med: 0,
    metric: 0,
    lab: 0,
    symptom: 0,
    other: 0,
    course: 0,
  };
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

/** «HH:MM» из минут суток. */
export function minToHHMM(min: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(min / 60))}:${p(min % 60)}`;
}

/** Приёмы пищи, сгруппированные по дню. */
function groupMeals(notes: Note[]): Map<string, Note[]> {
  const m = new Map<string, Note[]>();
  for (const n of notes) {
    if (n.deleted || n.health !== 'meal' || !n.date) continue;
    const a = m.get(n.date);
    if (a) a.push(n);
    else m.set(n.date, [n]);
  }
  return m;
}

/** Серия «зелёных» дней: текущая (по сегодня) и рекорд. */
export function mealStreaks(
  notes: Note[],
  todayKey: string,
  gapHours: number,
): { current: number; best: number } {
  const byDay = groupMeals(notes);
  const scoreOf = (k: string): MealScore => {
    const e = byDay.get(k);
    return e ? mealScore(e, gapHours) : 'none';
  };

  // Текущая серия: если сегодня ещё не «зелёный» (день в процессе) — считаем
  // серию, оканчивающуюся вчера, чтобы незавершённый день её не обнулял.
  let current = 0;
  let d = scoreOf(todayKey) === 'good' ? todayKey : addDaysKey(todayKey, -1);
  while (scoreOf(d) === 'good') {
    current++;
    d = addDaysKey(d, -1);
  }

  // Рекорд: самый длинный прогон «зелёных» дней в известной истории.
  const keys = [...byDay.keys()].filter((k) => k <= todayKey).sort();
  let best = current;
  let run = 0;
  if (keys.length) {
    for (let day = keys[0]; day <= todayKey; day = addDaysKey(day, 1)) {
      if (scoreOf(day) === 'good') {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
  }
  return { current, best };
}

/** Сводка по режиму питания за набор дней. */
export function mealPeriodSummary(
  notes: Note[],
  dayKeys: string[],
  gapHours: number,
): { good: number; ok: number; over: number; mealDays: number; avg: number } {
  const byDay = groupMeals(notes);
  let good = 0;
  let ok = 0;
  let over = 0;
  let mealDays = 0;
  let meals = 0;
  for (const k of dayKeys) {
    const e = byDay.get(k);
    if (!e || e.length === 0) continue;
    const s = mealScore(e, gapHours);
    if (s === 'good') good++;
    else if (s === 'over') over++;
    else ok++;
    mealDays++;
    meals += e.length;
  }
  return { good, ok, over, mealDays, avg: mealDays ? meals / mealDays : 0 };
}

/** Окно питания дня: от первого до последнего приёма + «голодание». */
export function eatingWindow(
  entries: Note[],
): { first: number; last: number; windowMin: number; fastingMin: number } | null {
  const times = entries
    .filter((e) => e.health === 'meal')
    .map((e) => mealMinutes(e.time))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  if (times.length === 0) return null;
  const first = times[0];
  const last = times[times.length - 1];
  const windowMin = last - first;
  return { first, last, windowMin, fastingMin: 24 * 60 - windowMin };
}
