import { useCallback, useEffect, useState } from 'react';

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

/** Удобный коллбэк-сеттер для иммутабельного обновления массива. */
export function useListActions<T extends { id: string }>(
  setList: React.Dispatch<React.SetStateAction<T[]>>,
) {
  const add = useCallback((item: T) => setList((l) => [item, ...l]), [setList]);
  const update = useCallback(
    (id: string, patch: Partial<T>) =>
      setList((l) => l.map((it) => (it.id === id ? { ...it, ...patch } : it))),
    [setList],
  );
  const remove = useCallback(
    (id: string) => setList((l) => l.filter((it) => it.id !== id)),
    [setList],
  );
  return { add, update, remove };
}
