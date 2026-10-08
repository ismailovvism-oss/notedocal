// Реестр документов: собирает документы со всех карточек людей в один список.
//
// Документ — дочерняя заметка `type: 'document'` у персоны (см. lib/docs.ts).
// Пока их было видно только внутри карточки, и список отвечал на вопрос «что
// есть у этого человека». Здесь обратный вопрос — «где лежит вот этот документ
// и у кого что скоро истекает», поэтому владелец хранится рядом с документом.

import type { Note } from '../types';
import { expiryStatus } from './docs';
import type { Relation } from '../types';

/** Документ вместе с тем, на чьих карточках он висит. */
export interface DocEntry {
  doc: Note;
  /** Владельцы: у документа бывает несколько (общее свидетельство о браке). */
  owners: Note[];
  /** 'expired' | 'soon' | 'none' — то же, что у карточки. */
  status: 'none' | 'soon' | 'expired';
}

export type DocFilter = 'all' | 'expired' | 'soon' | 'dated' | 'undated';

/**
 * Все документы всех персон. Документ без владельца в список не попадает:
 * без карточки он не виден и в приложении (связь `child` — единственный путь).
 */
export function allDocuments(notes: Note[], relations: Relation[], todayKey?: string): DocEntry[] {
  const живые = notes.filter((n) => !n.deleted);
  const byId = new Map(живые.map((n) => [n.id, n]));
  const владельцы = new Map<string, Note[]>();

  for (const r of relations) {
    if (r.deleted || r.type !== 'child') continue;
    const родитель = byId.get(r.from);
    const ребёнок = byId.get(r.to);
    if (!родитель || !ребёнок || родитель.type !== 'person' || ребёнок.type !== 'document') continue;
    const список = владельцы.get(ребёнок.id) ?? [];
    if (!список.some((p) => p.id === родитель.id)) список.push(родитель);
    владельцы.set(ребёнок.id, список);
  }

  return [...владельцы.entries()]
    .map(([id, owners]) => {
      const doc = byId.get(id)!;
      return { doc, owners, status: expiryStatus(doc.expires, todayKey) };
    })
    .sort(сравнить);
}

/**
 * Порядок: сначала то, что горит. Истёкшие, потом истекающие, потом остальные
 * со сроком по возрастанию, бессрочные — в конце по имени владельца.
 */
function сравнить(a: DocEntry, b: DocEntry): number {
  const вес = { expired: 0, soon: 1, none: 2 };
  if (вес[a.status] !== вес[b.status]) return вес[a.status] - вес[b.status];
  if (a.doc.expires && b.doc.expires) return a.doc.expires < b.doc.expires ? -1 : 1;
  if (a.doc.expires) return -1;
  if (b.doc.expires) return 1;
  const ia = a.owners[0]?.title ?? '';
  const ib = b.owners[0]?.title ?? '';
  return ia.localeCompare(ib) || docLabel(a.doc).localeCompare(docLabel(b.doc));
}

/**
 * Что показать строкой. Раньше в карточке стояло `category || 'Документ'`, и
 * у всех документов был один и тот же заголовок «Документ»: категорию никто не
 * заполнял, а название лежало в `title` и не показывалось.
 */
export function docLabel(doc: Note): string {
  return doc.title?.trim() || doc.category?.trim() || 'Документ';
}

/** Подпись под названием: категория и номер, если они есть и не дублируют название. */
export function docSubtitle(doc: Note): string {
  const части: string[] = [];
  const кат = doc.category?.trim();
  if (кат && кат !== doc.title?.trim()) части.push(кат);
  const номер = doc.docNumber?.trim();
  if (номер) части.push(номер);
  return части.join(' · ');
}

/** Подходит ли документ под срез и строку поиска. */
export function matchesDoc(e: DocEntry, filter: DocFilter, query: string): boolean {
  if (filter === 'expired' && e.status !== 'expired') return false;
  if (filter === 'soon' && e.status !== 'soon') return false;
  if (filter === 'dated' && !e.doc.expires) return false;
  if (filter === 'undated' && e.doc.expires) return false;

  const q = query.trim().toLowerCase();
  if (!q) return true;
  const стог = [
    docLabel(e.doc),
    e.doc.category ?? '',
    e.doc.docNumber ?? '',
    e.doc.body ?? '',
    ...e.owners.map((o) => o.title),
    ...(e.doc.attachments ?? []).map((a) => a.name),
  ]
    .join(' ')
    .toLowerCase();
  return стог.includes(q);
}

/** Сколько документов в каждом срезе — для цифр на чипах. */
export function docCounts(entries: DocEntry[]): Record<DocFilter, number> {
  return {
    all: entries.length,
    expired: entries.filter((e) => e.status === 'expired').length,
    soon: entries.filter((e) => e.status === 'soon').length,
    dated: entries.filter((e) => !!e.doc.expires).length,
    undated: entries.filter((e) => !e.doc.expires).length,
  };
}

/** Сколько дней осталось до срока (отрицательное — просрочено). */
export function daysLeft(expires: string, todayKey: string): number {
  const день = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((день(expires) - день(todayKey)) / 86400000);
}

/** «осталось 84 дня» / «просрочен 12 дней назад» — человеческим языком. */
export function expiryWords(expires: string, todayKey: string): string {
  const n = daysLeft(expires, todayKey);
  if (n === 0) return 'сегодня последний день';
  const дней = (x: number) => {
    const a = Math.abs(x) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return 'дней';
    if (b === 1) return 'день';
    if (b >= 2 && b <= 4) return 'дня';
    return 'дней';
  };
  return n > 0 ? `осталось ${n} ${дней(n)}` : `просрочен ${-n} ${дней(n)} назад`;
}
