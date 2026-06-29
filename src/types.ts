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

/**
 * Личное наблюдение молодого месяца (хиляля).
 *
 * Пользователь отмечает ВЕЧЕР, когда увидел молодой месяц; 1-е число нового
 * хиджра-месяца — следующий день. В хранилище мы держим уже вычисленную
 * `startDate` (григорианская дата 1-го числа = вечер наблюдения + 1 день) —
 * с ней проще считать. Вечер наблюдения при необходимости получается как
 * `startDate − 1 день`.
 */
export interface MoonSighting {
  id: string;
  /** Григорианская дата 1-го числа месяца (YYYY-MM-DD) = вечер наблюдения + 1 день. */
  startDate: string;
  /** Номер хиджра-месяца, который начинается (1..12). */
  hijriMonth: number;
  /** Год хиджры. */
  hijriYear: number;
  /** Необязательная заметка к наблюдению. */
  note?: string;
  createdAt: number;
  updatedAt: number;
  /** Мягкое удаление (надгробие) — для синхронизации удалений. */
  deleted?: boolean;
}

export type Tab = 'calendar' | 'tasks' | 'notes';
