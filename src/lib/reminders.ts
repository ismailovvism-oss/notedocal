import { useEffect, useRef } from 'react';
import type { Checklist, ChecklistItem, Note } from '../types';
import { dayKey } from './dates';
import { healthOnDay, mealPlan } from './health';

function flatten(items: ChecklistItem[], acc: ChecklistItem[] = []): ChecklistItem[] {
  for (const it of items) {
    acc.push(it);
    if (it.subitems) flatten(it.subitems, acc);
  }
  return acc;
}

/**
 * Напоминания в рамках открытого приложения.
 *
 * Пока вкладка открыта, для задач с `remindAt` в ближайшие сутки ставится
 * таймер, который показывает браузерное уведомление. Полноценные напоминания
 * при закрытом приложении требуют push-инфраструктуры (FCM) — это отдельный шаг.
 */
export function useReminders(checklists: Checklist[]): void {
  const fired = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const now = Date.now();
    const items = checklists
      .filter((c) => !c.deleted)
      .flatMap((c) => flatten(c.items ?? []));

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const it of items) {
      if (it.done || !it.remindAt) continue;
      const key = `${it.id}:${it.remindAt}`;
      if (fired.current.has(key)) continue;
      const delay = it.remindAt - now;
      if (delay <= 0 || delay > 24 * 60 * 60 * 1000) continue;
      timers.push(
        setTimeout(() => {
          fired.current.add(key);
          if (Notification.permission === 'granted') {
            try {
              new Notification(it.text || 'Напоминание', { body: it.desc || '' });
            } catch {
              /* игнорируем */
            }
          }
        }, delay),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [checklists]);
}

/**
 * Напоминание о следующем приёме пищи. После первого приёма за сегодня
 * ставит таймер на «время первого + промежуток» и показывает уведомление,
 * что пора на второй приём (цель — 2 приёма в день).
 */
export function useMealReminder(notes: Note[], gapHours: number): void {
  const fired = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const today = dayKey(new Date());
    const plan = mealPlan(healthOnDay(notes, today), today, gapHours);
    if (!plan.nextMs) return;

    const delay = plan.nextMs - Date.now();
    const key = `meal:${today}:${plan.lastTime}`;
    if (fired.current.has(key)) return;
    if (delay <= 0 || delay > 24 * 60 * 60 * 1000) return;

    const timer = setTimeout(() => {
      fired.current.add(key);
      if (Notification.permission === 'granted') {
        try {
          new Notification('Пора на второй приём пищи 🍽', {
            body: 'Ты планировал 2 приёма в день — время следующего.',
          });
        } catch {
          /* игнорируем */
        }
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [notes, gapHours]);
}
