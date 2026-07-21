// Утилиты для связи задач с заметками (персоной/локацией через noteId).

import type { Checklist, ChecklistItem } from '../types';

export interface LinkedTask {
  item: ChecklistItem;
  listId: string;
  listTitle: string;
}

function walk(items: ChecklistItem[], fn: (it: ChecklistItem) => void) {
  for (const it of items) {
    fn(it);
    if (it.subitems) walk(it.subitems, fn);
  }
}

/** Все задачи (на любом уровне), у которых noteId === заданному. */
export function tasksLinkedToNote(checklists: Checklist[], noteId: string): LinkedTask[] {
  const out: LinkedTask[] = [];
  for (const c of checklists) {
    if (c.deleted) continue;
    walk(c.items ?? [], (it) => {
      if (it.noteId === noteId) out.push({ item: it, listId: c.id, listTitle: c.title || 'Без названия' });
    });
  }
  return out;
}

/** Переключить «выполнено» у задачи в дереве списка. */
export function toggleItemInList(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.map((it) =>
    it.id === id
      ? { ...it, done: !it.done }
      : { ...it, subitems: it.subitems ? toggleItemInList(it.subitems, id) : it.subitems },
  );
}
