// Персоны (контакты) поверх заметок: персона — это заметка типа 'person'.
// Все персоны складываются в служебную папку «Контакты».

import type { Note } from '../types';

export const CONTACTS_FOLDER_ID = 'contacts-folder';

/** Все персоны (не удалённые). */
export function listPersons(notes: Note[]): Note[] {
  return notes
    .filter((n) => !n.deleted && n.type === 'person')
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

/** Найти персону по имени (без учёта регистра). */
export function findPerson(notes: Note[], name: string): Note | undefined {
  const key = name.trim().toLowerCase();
  return notes.find((n) => !n.deleted && n.type === 'person' && (n.title || '').trim().toLowerCase() === key);
}
