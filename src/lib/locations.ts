// Локации (места) поверх заметок: локация — это заметка типа 'location'.
// Хранятся в служебной папке «Места»; группируются по полю category.

import type { Note } from '../types';

export const LOCATIONS_FOLDER_ID = 'places-folder';

// Порядок — от повседневного к редкому; «Другое» всегда последним.
// Старые категории не удаляем: они уже проставлены у существующих мест.
export const LOCATION_CATEGORIES = [
  'Дом',
  'Работа',
  'Учёба',
  'Мечеть',
  'Магазин',
  'Рынок',
  'Аптека',
  'Клиника',
  'Больница',
  'Кафе',
  'Ресторан',
  'Заправка',
  'Банк',
  'Госуслуги',
  'Спорт',
  'Сервис',
  'Парковка',
  'Зиярат',
  'Транспорт',
  'Развлечения',
  'Отдых',
  'Другое',
];

/** Значок категории — заполняет карточку места, пока нет фотографии. */
export const CATEGORY_ICON: Record<string, string> = {
  Дом: '🏠',
  Работа: '💼',
  Учёба: '🎓',
  Мечеть: '🕌',
  Магазин: '🛒',
  Рынок: '🥬',
  Аптека: '💊',
  Клиника: '🩺',
  Больница: '🏥',
  Кафе: '☕',
  Ресторан: '🍽',
  Заправка: '⛽',
  Банк: '🏦',
  Госуслуги: '🏛',
  Спорт: '🏋',
  Сервис: '🔧',
  Парковка: '🅿️',
  Зиярат: '🕋',
  Транспорт: '✈️',
  Развлечения: '🎡',
  Отдых: '🌴',
  Другое: '📍',
};

export function iconOf(category?: string): string {
  return CATEGORY_ICON[(category ?? '').trim()] ?? '📍';
}

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

/** Город локации; пустой — «Без города» (чтобы такие места не терялись). */
export function cityOf(n: Note): string {
  return n.city?.trim() || 'Без города';
}

/**
 * Локации по городам, внутри города — по категориям.
 * Города по алфавиту, «Без города» всегда последним: это ещё не разобранные
 * места, и им не место в начале списка.
 */
export function locationsByCity(
  notes: Note[],
): { city: string; count: number; groups: { category: string; items: Note[] }[] }[] {
  const byCity = new Map<string, Note[]>();
  for (const n of listLocations(notes)) {
    const c = cityOf(n);
    const a = byCity.get(c);
    if (a) a.push(n);
    else byCity.set(c, [n]);
  }
  return [...byCity.entries()]
    .map(([city, items]) => ({
      city,
      count: items.length,
      groups: locationsByCategory(items),
    }))
    .sort((a, b) => {
      if (a.city === 'Без города') return 1;
      if (b.city === 'Без города') return -1;
      return a.city.localeCompare(b.city);
    });
}

/** Все города, где уже есть места — для подсказок в форме. */
export function knownCities(notes: Note[]): string[] {
  const s = new Set<string>();
  for (const n of listLocations(notes)) if (n.city?.trim()) s.add(n.city.trim());
  return [...s].sort((a, b) => a.localeCompare(b));
}

/** Обложка места — первое вложение-картинка (фото самого места). */
export function coverPhoto(n: Note) {
  return n.attachments?.find((a) => a.type?.startsWith('image/'));
}

/** Все фотографии места (в порядке загрузки). */
export function photosOf(n: Note) {
  return (n.attachments ?? []).filter((a) => a.type?.startsWith('image/'));
}

/** Ссылка на карту: если это уже ссылка (Google Maps и т.п.) — открываем как
 *  есть; иначе ищем адрес/координаты/название в Google Картах. */
export function mapLink(address: string): string {
  const v = address.trim();
  if (/^https?:\/\//i.test(v)) return v;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`;
}
