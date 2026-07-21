// Персоны (контакты) поверх заметок: персона — это заметка типа 'person'.
// Все персоны складываются в служебную папку «Контакты».

import type { ContactMethod, ContactType, Note } from '../types';

export const CONTACTS_FOLDER_ID = 'contacts-folder';

export const CONTACT_TYPES: ContactType[] = ['phone', 'whatsapp', 'telegram', 'email', 'other'];

export const CONTACT_META: Record<ContactType, { icon: string; label: string }> = {
  phone: { icon: '📞', label: 'Телефон' },
  whatsapp: { icon: '🟢', label: 'WhatsApp' },
  telegram: { icon: '✈️', label: 'Telegram' },
  email: { icon: '✉️', label: 'Email' },
  other: { icon: '🔗', label: 'Другое' },
};

/** Кликабельная ссылка для способа связи (tel/wa.me/t.me/mailto). */
export function contactHref(c: ContactMethod): string | undefined {
  const v = c.value.trim();
  if (!v) return undefined;
  const digits = v.replace(/[^\d]/g, '');
  switch (c.type) {
    case 'phone':
      return `tel:${v.replace(/\s+/g, '')}`;
    case 'whatsapp':
      return `https://wa.me/${digits}`;
    case 'telegram':
      return `https://t.me/${v.replace(/^@/, '')}`;
    case 'email':
      return `mailto:${v}`;
    default:
      return undefined;
  }
}

/** Контакты персоны с учётом устаревшего одиночного поля phone. */
export function effectiveContacts(note: Note): ContactMethod[] {
  if (note.contacts && note.contacts.length) return note.contacts;
  if (note.phone) return [{ type: 'phone', value: note.phone }];
  return [];
}

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
