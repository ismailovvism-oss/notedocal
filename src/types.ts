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
}

export type Tab = 'calendar' | 'tasks' | 'notes';
