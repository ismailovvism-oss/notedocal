// Что показывать в базе знаний (docs/ЗАМЕТКИ.md, раздел 10, «Рабочее и служебное»).
//
// В notedocal рядом с заметками хозяина лежит хозяйство: замеры здоровья, документы, контакты,
// места, пароли — их заводит в основном Claude через секретаря. В окне «База» они мешают, но
// нужны: на них ссылаются, их ищут. Поэтому они не удаляются и не переносятся, а прячутся:
// по роли, по папке и по отметке на самой заметке (`inBase`), которая сильнее правил.
//
// Без React: этот же модуль может звать secretary.mjs.

import type { Note, Relation } from '../../types.ts';

/** Роли хозяйства: в базе знаний их не видно. */
export const SERVICE_ROLES = ['document', 'person', 'location', 'credential', 'folder'];

/** Папки хозяйства по умолчанию (названия, без учёта регистра). Хозяин меняет список в «Базе». */
export const SERVICE_FOLDERS = ['Здоровье', 'Семья', 'Контакты', 'Места', 'Пароли', 'Коммуналка', 'Другие'];

export interface ScopeWhy {
  shown: boolean;
  /** Почему так: 'отметка', 'роль', 'здоровье', 'папка «…»' или '' — обычная рабочая. */
  why: string;
}

/** Папки над заметкой (по связям child, любой глубины) — их названия. */
export function folderTitles(relations: Relation[], byId: Map<string, Note>): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const r of relations) {
    if (r.deleted || r.type !== 'child') continue;
    const list = parents.get(r.to);
    if (list) list.push(r.from);
    else parents.set(r.to, [r.from]);
  }
  const memo = new Map<string, string[]>();
  const up = (id: string, seen: Set<string>): string[] => {
    const hit = memo.get(id);
    if (hit) return hit;
    const out: string[] = [];
    for (const p of parents.get(id) ?? []) {
      if (seen.has(p)) continue;
      const t = byId.get(p)?.title;
      if (t) out.push(t);
      out.push(...up(p, new Set([...seen, p])));
    }
    memo.set(id, out);
    return out;
  };
  const res = new Map<string, string[]>();
  for (const id of parents.keys()) res.set(id, up(id, new Set([id])));
  return res;
}

/** Видна ли заметка в базе знаний и почему. */
export function scopeOf(n: Note, folders: string[] | undefined, hiddenFolders: string[]): ScopeWhy {
  if (n.inBase === true) return { shown: true, why: 'отметка' };
  if (n.inBase === false) return { shown: false, why: 'отметка' };
  if (SERVICE_ROLES.includes(n.type ?? 'note')) return { shown: false, why: 'роль' };
  if (n.health) return { shown: false, why: 'здоровье' };
  const hidden = new Set(hiddenFolders.map((f) => f.trim().toLowerCase()));
  const f = (folders ?? []).find((t) => hidden.has(t.trim().toLowerCase()));
  if (f) return { shown: false, why: `папка «${f}»` };
  return { shown: true, why: '' };
}

/** id заметок, видимых в базе знаний. */
export function shownIds(notes: Note[], relations: Relation[], hiddenFolders: string[]): Set<string> {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const folders = folderTitles(relations, byId);
  const res = new Set<string>();
  for (const n of notes) if (!n.deleted && scopeOf(n, folders.get(n.id), hiddenFolders).shown) res.add(n.id);
  return res;
}
