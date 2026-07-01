// Доменные типы приложения notedocal (заметки + задачи + календарь)

/** Задача из списка дел. */
export interface Task {
  id: string;
  title: string;
  done: boolean;
  /** Дата выполнения в формате YYYY-MM-DD (григорианская) либо null. */
  due: string | null;
  priority: 'low' | 'normal' | 'high';
  createdAt: number;
  /** Время последнего изменения — для слияния при синхронизации. */
  updatedAt: number;
  /** Мягкое удаление (надгробие) — чтобы удаление доезжало до других устройств. */
  deleted?: boolean;
}

/** Текстовая заметка. */
export interface Note {
  id: string;
  title: string;
  body: string;
  /** Необязательная привязка к дню (YYYY-MM-DD). */
  date: string | null;
  createdAt: number;
  updatedAt: number;
  /** Мягкое удаление (надгробие) — чтобы удаление доезжало до других устройств. */
  deleted?: boolean;
}

/** Запись с идентификатором и временем изменения — основа для слияния. */
export interface Syncable {
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

/** Способ фиксации начала месяца:
 *  'sighting' — виден молодой месяц (хиляль) вечером накануне;
 *  'count'    — молодой месяц не виден, предыдущий месяц досчитан до 30 (хадис). */
export type SightingMethod = 'sighting' | 'count';

/**
 * Фиксация начала хиджра-месяца.
 *
 * `startDate` — григорианская дата 1-го числа месяца:
 *  - для 'sighting' это вечер наблюдения + 1 день;
 *  - для 'count' это день после 30-го (последнего) дня предыдущего месяца.
 * В обоих случаях в форме выбирается «этот день», а 1-е число = выбранный + 1.
 */
export interface MoonSighting {
  id: string;
  /** Григорианская дата 1-го числа месяца (YYYY-MM-DD). */
  startDate: string;
  /** Номер хиджра-месяца, который начинается (1..12). */
  hijriMonth: number;
  /** Год хиджры. */
  hijriYear: number;
  /** Способ фиксации (по умолчанию 'sighting' для старых записей). */
  method?: SightingMethod;
  /** Необязательная заметка о фиксации (как именно зафиксировано). */
  note?: string;
  createdAt: number;
  updatedAt: number;
  /** Мягкое удаление (надгробие) — для синхронизации удалений. */
  deleted?: boolean;
}

/** Пункт списка задач. */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** Описание/детали пункта (многострочное), помимо заголовка. */
  desc?: string;
  /** Подзадачи (один уровень вложенности). */
  subitems?: ChecklistItem[];
  /** Прицеплённая заметка (id из коллекции заметок). */
  noteId?: string | null;
}

/** Список задач (чек-лист), привязанный к дню. */
export interface Checklist {
  id: string;
  title: string;
  /** День (YYYY-MM-DD), к которому относится список. */
  date: string | null;
  items: ChecklistItem[];
  createdAt: number;
  updatedAt: number;
  /** Мягкое удаление (надгробие) — для синхронизации. */
  deleted?: boolean;
}

export type Tab = 'calendar' | 'tasks' | 'notes' | 'months';
