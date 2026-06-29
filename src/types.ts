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

export type Tab = 'calendar' | 'tasks' | 'notes';
