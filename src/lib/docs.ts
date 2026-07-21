// Документы и пароли — дочерние заметки персоны (типы document / credential).

import type { Note } from '../types';
import { getChildren } from './relations';

export const DOC_KINDS = [
  'Паспорт',
  'Загранпаспорт',
  'ВНЖ',
  'ИНН',
  'СНИЛС',
  'Водительские права',
  'Свидетельство о рождении',
  'Полис',
  'Виза',
  'Другое',
];

/** Документы, привязанные к персоне (её дочерние заметки типа document). */
export function personDocuments(person: Note, notes: Note[], relations: Parameters<typeof getChildren>[1]): Note[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  return getChildren(person.id, relations)
    .map((id) => byId.get(id))
    .filter((n): n is Note => !!n && !n.deleted && n.type === 'document');
}

/** Пароли, привязанные к персоне (дочерние заметки типа credential). */
export function personCredentials(person: Note, notes: Note[], relations: Parameters<typeof getChildren>[1]): Note[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  return getChildren(person.id, relations)
    .map((id) => byId.get(id))
    .filter((n): n is Note => !!n && !n.deleted && n.type === 'credential');
}

/** Статус срока действия документа. */
export function expiryStatus(expires?: string, todayKey?: string): 'none' | 'soon' | 'expired' {
  if (!expires) return 'none';
  if (todayKey && expires < todayKey) return 'expired';
  if (todayKey) {
    // «Скоро» — в пределах 30 дней.
    const soon = addDays(todayKey, 30);
    if (expires <= soon) return 'soon';
  }
  return 'none';
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
