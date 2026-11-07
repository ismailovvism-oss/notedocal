// План дня в «Карте дел»: три проекта по три помидора, короткому хватит одного.
//
// План — документ на день (users/{uid}/dayplans/<ГГГГ-ММ-ДД>), а сколько сделано,
// не хранится отдельно: это число записей журнала помидоров за день с projectId.
// Так счётчик не расходится с журналом, а снятый помидор снимается и там.
// Те же правила — в scripts/projects.mjs (команда `secretary project day`).

import type { DayPlan, DayPlanSlot, PomodoroSession, Project } from '../types';

/** Столько мест показываем всегда: «хотя бы три проекта». */
export const SLOTS_MIN = 3;
export const SLOTS_MAX = 6;
export const GOAL_DEFAULT = 3;
export const GOAL_MAX = 6;

export function planSlots(plans: DayPlan[], day: string): DayPlanSlot[] {
  return plans.find((p) => p.id === day && !p.deleted)?.slots ?? [];
}

/** Записать места плана на день; документа ещё нет — завести. */
export function withSlots(plans: DayPlan[], day: string, slots: DayPlanSlot[]): DayPlan[] {
  const now = Date.now();
  if (plans.some((p) => p.id === day)) {
    return plans.map((p) => (p.id === day ? { ...p, slots, deleted: false, updatedAt: now } : p));
  }
  return [{ id: day, slots, createdAt: now, updatedAt: now }, ...plans];
}

/** Сколько помидоров за день у каждого проекта. */
export function doneCounts(sessions: PomodoroSession[], day: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (s.date === day && s.projectId) counts.set(s.projectId, (counts.get(s.projectId) ?? 0) + 1);
  }
  return counts;
}

/** Какой проект на очереди: первый по порядку, где ещё есть несделанные помидоры. */
export function nextSlot(slots: DayPlanSlot[], counts: Map<string, number>): DayPlanSlot | null {
  return slots.find((s) => (counts.get(s.projectId) ?? 0) < s.goal) ?? null;
}

/** Проекты для выбора: без закрытых и уже взятых, главное — сверху. */
export function pickable(projects: Project[], taken: DayPlanSlot[]): Project[] {
  return projects.filter((p) => p.stage !== 'closed' && !taken.some((s) => s.projectId === p.id));
}
