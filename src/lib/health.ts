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
