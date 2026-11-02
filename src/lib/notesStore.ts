// Заметки на устройстве — в IndexedDB, а не в localStorage (docs/ЗАМЕТКИ.md, раздел 5, этап 5).
//
// localStorage держит 5–10 МБ на всё приложение и пишется целиком на каждую правку; волт —
// 57 МБ. Здесь заметки лежат по записи на заметку, и после правки пишутся только изменённые.
// Рядом — служебное: разбор текстов для указателя связей (src/lib/kb/index.ts, чтобы при
// запуске не разбирать всё заново) и что уже сверено с облаком (src/lib/sync.ts).

import { useEffect, useRef, useState } from 'react';
import type { Note } from '../types';
import { mergeById } from './storage';
import { seedParseCache, takeParseUpdates, type BodyParse } from './kb/index';

const LEGACY_KEY = 'ndc.notes';

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** База на устройстве; null — IndexedDB нет (старый браузер, запрет) — живём на localStorage. */
function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open('notedocal', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('notes', { keyPath: 'id' });
        db.createObjectStore('parse');
        db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

function getAll<T>(db: IDBDatabase, store: string): Promise<[string, T][]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store);
    const keys = tx.objectStore(store).getAllKeys();
    const vals = tx.objectStore(store).getAll();
    tx.oncomplete = () => resolve((keys.result as string[]).map((k, i) => [k, vals.result[i] as T]));
    tx.onerror = () => reject(tx.error);
  });
}

/** Служебная запись (что сверено с облаком и т.п.). */
export async function loadMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const req = db.transaction('meta').objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

export async function saveMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(value, key);
  await done(tx).catch(() => {});
}

/** Сохранить на устройстве разбор, появившийся после прошлой сборки указателя. */
export async function persistParse(): Promise<void> {
  const { put, del } = takeParseUpdates();
  if (!put.length && !del.length) return;
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction('parse', 'readwrite');
  const st = tx.objectStore('parse');
  for (const [id, e] of put) st.put(e, id);
  for (const id of del) st.delete(id);
  await done(tx).catch(() => {});
}

function legacy(): Note[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? (JSON.parse(raw) as Note[]) : [];
  } catch {
    return [];
  }
}

/**
 * Список заметок, сохраняемый на устройстве. Пока база поднимается, список пуст (или взят из
 * старого localStorage); поднятое сливается с тем, что успело прийти из облака, — по
 * «последнее изменение побеждает», как везде.
 */
export function useNotesStore() {
  const [notes, setNotes] = useState<Note[]>(legacy);
  const [loaded, setLoaded] = useState(false);
  // что уже лежит на устройстве: id → тот же объект (правка создаёт новый объект)
  const stored = useRef<Map<string, Note>>(new Map());
  const db = useRef<IDBDatabase | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await openDb();
      if (!alive) return;
      db.current = d;
      if (d) {
        const [parse, rows] = await Promise.all([getAll<{ sig: string; bp: BodyParse }>(d, 'parse'), getAll<Note>(d, 'notes')]);
        if (!alive) return;
        seedParseCache(parse);
        const saved = rows.map(([, n]) => n);
        for (const n of saved) stored.current.set(n.id, n);
        if (saved.length) setNotes((prev) => mergeById(saved, prev));
      }
      setLoaded(true);
    })().catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // запись изменённых — пачкой, с задержкой: правки идут очередями
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      const d = db.current;
      if (!d) {
        try {
          localStorage.setItem(LEGACY_KEY, JSON.stringify(notes));
        } catch {
          // переполнение — заметки остаются в облаке
        }
        return;
      }
      const changed = notes.filter((n) => stored.current.get(n.id) !== n);
      if (!changed.length) return;
      const tx = d.transaction('notes', 'readwrite');
      const st = tx.objectStore('notes');
      for (const n of changed) st.put(n);
      done(tx)
        .then(() => {
          for (const n of changed) stored.current.set(n.id, n);
          // перенос из localStorage закончен: старая копия больше не нужна
          if (localStorage.getItem(LEGACY_KEY) !== null) localStorage.removeItem(LEGACY_KEY);
        })
        .catch(() => {
          /* повторим при следующей правке */
        });
    }, 400);
    return () => clearTimeout(t);
  }, [notes, loaded]);

  return [notes, setNotes, loaded] as const;
}
