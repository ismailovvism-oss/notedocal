// Курс препарата: расписание уколов и остаток в ручке.
//
// Курс — заметка (Note) с health 'course': название, доза, периодичность,
// сколько доз в упаковке и дата первой дозы из текущей ручки. Сами уколы —
// обычные записи дневника (health 'med') с тем же `code`, поэтому счётчик
// считается из журнала, а не ведётся отдельно: отметил укол — счётчик поехал.

import type { Note } from '../types';
import { addDaysKey } from './dates';

export interface CourseState {
  /** Уколов сделано из текущей ручки. */
  taken: number;
  /** Доз осталось в ручке. */
  left: number;
  /** Дата последнего укола. */
  lastDate: string | null;
  /** Когда следующий (по расписанию от последнего укола). */
  nextDate: string | null;
  /** Сделан ли укол сегодня. */
  doneToday: boolean;
  /** Первый укол, на который ручки уже не хватит — к нему нужна новая. */
  buyBy: string | null;
  /** Просрочен ли укол (сегодня позже плановой даты). */
  overdue: boolean;
}

export function courseNotes(notes: Note[]): Note[] {
  return notes.filter((n) => !n.deleted && n.health === 'course');
}

/** Уколы курса — по коду препарата, начиная с текущей ручки. */
export function shotsOf(notes: Note[], course: Note): Note[] {
  return notes
    .filter(
      (n) =>
        !n.deleted &&
        n.health === 'med' &&
        n.code === course.code &&
        n.date &&
        (!course.penStart || n.date >= course.penStart),
    )
    .sort((a, b) => ((a.date as string) < (b.date as string) ? -1 : 1));
}

export function courseState(notes: Note[], course: Note, todayKey: string): CourseState {
  const every = course.everyDays && course.everyDays > 0 ? course.everyDays : 7;
  const perPen = course.dosesPerPen && course.dosesPerPen > 0 ? course.dosesPerPen : 0;
  const shots = shotsOf(notes, course);
  const taken = shots.length;
  const lastDate = taken ? (shots[taken - 1].date as string) : null;
  const left = perPen ? Math.max(0, perPen - taken) : 0;

  // Следующий укол: через `every` дней от последнего, а если уколов ещё не
  // было — в день старта ручки.
  const nextDate = lastDate ? addDaysKey(lastDate, every) : course.penStart ?? null;
  // Новая ручка нужна к уколу, который идёт сразу за последней дозой в ручке.
  const buyBy = perPen && nextDate ? addDaysKey(nextDate, every * left) : null;

  return {
    taken,
    left,
    lastDate,
    nextDate,
    doneToday: shots.some((s) => s.date === todayKey),
    buyBy,
    overdue: !!nextDate && nextDate < todayKey,
  };
}
