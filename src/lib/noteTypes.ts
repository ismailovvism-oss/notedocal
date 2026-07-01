import type { NoteType } from '../types';

/** Подписи типов заметок для интерфейса. */
export const TYPE_LABELS: Record<NoteType, string> = {
  note: 'Обычная',
  folder: 'Папка',
  tag: 'Тег',
  moc: 'MOC',
  concept: 'Понятие',
  source: 'Источник',
};

/** Короткие подписи для бейджа на карточке/строке. */
export const TYPE_BADGE: Record<NoteType, string> = {
  note: 'заметка',
  folder: 'папка',
  tag: 'тег',
  moc: 'MOC',
  concept: 'понятие',
  source: 'источник',
};
