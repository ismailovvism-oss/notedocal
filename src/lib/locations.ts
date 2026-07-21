// Локации (места) поверх заметок: локация — это заметка типа 'location'.
// Хранятся в служебной папке «Места»; группируются по полю category.

import type { Note } from '../types';

export const LOCATIONS_FOLDER_ID = 'places-folder';

export const LOCATION_CATEGORIES = [
  'Дом',
  'Работа',
  'Магазин',
  'Аптека',
  'Кафе',
  'Ресторан',
  'Заправка',
  'Больница',
  'Другое',
];

/** Все локации (не удалённые). */
export function listLocations(notes: Note[]): Note[] {
  return notes
    .filter((n) => !n.deleted && n.type === 'location')
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

/** Локации, сгруппированные по категориям. */
export function locationsByCategory(notes: Note[]): { category: string; items: Note[] }[] {
  const m = new Map<string, Note[]>();
  for (const n of listLocations(notes)) {
    const c = n.category?.trim() || 'Без категории';
    const a = m.get(c);
    if (a) a.push(n);
    else m.set(c, [n]);
  }
  return [...m.entries()]
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/** Ссылка на карту по адресу. */
export function mapLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
