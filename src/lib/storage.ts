import { useCallback, useEffect, useState } from 'react';
import type { Syncable } from '../types';

/**
 * Состояние, синхронизированное с localStorage.
 * Данные хранятся прямо на устройстве — без сервера и регистрации.
 */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // переполнение хранилища игнорируем
    }
  }, [key, value]);

  return [value, setValue] as const;
}

/** Короткий уникальный id без внешних зависимостей. */
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Удобный коллбэк-сеттер для иммутабельного обновления массива.
 *
 * `update` и `remove` всегда проставляют `updatedAt`, а `remove` помечает
 * запись надгробием (`deleted: true`) вместо физического удаления — так
 * удаление корректно доезжает до других устройств при синхронизации.
 * Видимый список фильтруется от надгробий в `App` (см. `visible`).
 */
export function useListActions<T extends Syncable>(
  setList: React.Dispatch<React.SetStateAction<T[]>>,
) {
  const add = useCallback((item: T) => setList((l) => [item, ...l]), [setList]);
  const update = useCallback(
    (id: string, patch: Partial<T>) =>
      setList((l) =>
        l.map((it) => (it.id === id ? { ...it, ...patch, updatedAt: Date.now() } : it)),
      ),
    [setList],
  );
  const remove = useCallback(
    (id: string) =>
      setList((l) =>
        l.map((it) => (it.id === id ? { ...it, deleted: true, updatedAt: Date.now() } : it)),
      ),
    [setList],
  );
  return { add, update, remove };
}

/** Отфильтровать надгробия для отображения. */
export function visible<T extends Syncable>(list: T[]): T[] {
  return list.filter((it) => !it.deleted);
}

/**
 * Слияние двух списков по id по принципу «выигрывает последнее изменение»
 * (Last-Write-Wins по `updatedAt`). Надгробия участвуют наравне с записями,
 * поэтому удаление на одном устройстве переживает правки на другом, если оно
 * новее. Используется при синхронизации локальных данных с облаком.
 */
export function mergeById<T extends Syncable>(a: T[], b: T[]): T[] {
  const byId = new Map<string, T>();
  for (const it of [...a, ...b]) {
    const prev = byId.get(it.id);
    if (!prev || (it.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) byId.set(it.id, it);
  }
  return [...byId.values()];
}
