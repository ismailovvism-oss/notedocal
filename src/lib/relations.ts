import type { Relation } from '../types';

const active = (r: Relation) => !r.deleted;

/** Подзаметки (дети) заметки — цели связей child от неё, по порядку. */
export function getChildren(noteId: string, relations: Relation[]): string[] {
  return relations
    .filter((r) => active(r) && r.type === 'child' && r.from === noteId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((r) => r.to);
}

/** Родители заметки — источники связей child, ведущих к ней. */
export function getParents(noteId: string, relations: Relation[]): string[] {
  return relations
    .filter((r) => active(r) && r.type === 'child' && r.to === noteId)
    .map((r) => r.from);
}

/** Теги заметки — цели связей tag от неё. */
export function getTags(noteId: string, relations: Relation[]): string[] {
  return relations
    .filter((r) => active(r) && r.type === 'tag' && r.from === noteId)
    .map((r) => r.to);
}

/** Заметки, помеченные данной заметкой-тегом. */
export function getTaggedNotes(tagNoteId: string, relations: Relation[]): string[] {
  return relations
    .filter((r) => active(r) && r.type === 'tag' && r.to === tagNoteId)
    .map((r) => r.from);
}

/** Исходящие смысловые ссылки заметки. */
export function getLinks(noteId: string, relations: Relation[]): string[] {
  return relations
    .filter((r) => active(r) && r.type === 'link' && r.from === noteId)
    .map((r) => r.to);
}

/** Беклинки — все заметки, ссылающиеся на данную (любым типом связи). */
export function getBacklinks(
  noteId: string,
  relations: Relation[],
): { from: string; type: Relation['type'] }[] {
  return relations
    .filter((r) => active(r) && r.to === noteId)
    .map((r) => ({ from: r.from, type: r.type }));
}

/**
 * Создаст ли связь child `parentId -> childId` цикл.
 * Цикл, если это связь на себя, или parentId уже является потомком childId.
 */
export function wouldCreateCycle(
  parentId: string,
  childId: string,
  relations: Relation[],
): boolean {
  if (parentId === childId) return true;
  // Обходим потомков childId; если наткнёмся на parentId — цикл.
  const seen = new Set<string>();
  const stack = [childId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === parentId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...getChildren(cur, relations));
  }
  return false;
}

/**
 * Дедупликация связей по (from, to, type): при дублях остаётся более свежая
 * по updatedAt. Надгробия сохраняются (не удаляются физически).
 */
export function dedupeRelations(relations: Relation[]): Relation[] {
  const best = new Map<string, Relation>();
  for (const r of relations) {
    const key = `${r.from}|${r.to}|${r.type}`;
    const prev = best.get(key);
    if (!prev || (r.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) best.set(key, r);
  }
  return [...best.values()];
}
