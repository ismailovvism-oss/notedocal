import type { NoteType } from '../types';

/** Подписи типов заметок для интерфейса. */
export const TYPE_LABELS: Record<NoteType, string> = {
  note: 'Обычная',
  folder: 'Папка',
  tag: 'Тег',
  moc: 'MOC',
  concept: 'Понятие',
  source: 'Источник',
  person: 'Персона',
  location: 'Локация',
  document: 'Документ',
  credential: 'Пароль',
  comment: 'Комментарий',
  set: 'Набор',
  schema: 'Схема',
  view: 'Вид',
};

/** Короткие подписи для бейджа на карточке/строке. */
export const TYPE_BADGE: Record<NoteType, string> = {
  note: 'заметка',
  folder: 'папка',
  tag: 'тег',
  moc: 'MOC',
  concept: 'понятие',
  source: 'источник',
  person: 'персона',
  location: 'локация',
  document: 'документ',
  credential: 'пароль',
  comment: 'комментарий',
  set: 'набор',
  schema: 'схема',
  view: 'вид',
};
