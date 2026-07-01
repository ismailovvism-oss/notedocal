// Облачная синхронизация заметок, задач и наблюдений через Cloud Firestore.
//
// Модель данных:
//  - `users/{uid}` — приватные данные пользователя (tasks, notes, личные
//    наблюдения sightings). Сливаются по принципу «последнее изменение
//    побеждает» (LWW по updatedAt, с надгробиями) и держатся в реальном времени.
//  - `shared/calendar` — общий «официальный» календарь наблюдений админа.
//    Читают ВСЕ (в т.ч. без входа), пишет только админ (проверка по email в
//    правилах Firestore). Подписка работает независимо от входа.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { ADMIN_EMAIL, SHARED_DOC, auth, db, firebaseEnabled, googleProvider } from './firebase';
import { mergeById } from './storage';
import type {
  CalEvent,
  Checklist,
  ChecklistItem,
  MoonSighting,
  Note,
  Relation,
  Task,
} from '../types';

export type SyncStatus = 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'offline';

interface Params {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  sightings: MoonSighting[];
  setSightings: React.Dispatch<React.SetStateAction<MoonSighting[]>>;
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  events: CalEvent[];
  setEvents: React.Dispatch<React.SetStateAction<CalEvent[]>>;
  /** Связи между заметками (подколлекция users/{uid}/relations). */
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
  /** Официальный календарь наблюдений (общий документ). */
  adminSightings: MoonSighting[];
  setAdminSightings: React.Dispatch<React.SetStateAction<MoonSighting[]>>;
}

interface Result {
  enabled: boolean;
  user: User | null;
  status: SyncStatus;
  /** Текущий вошедший пользователь — администратор (по email). */
  isAdmin: boolean;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

/** Подпись одного списка — стабильна независимо от порядка элементов.
 *  Меняется при любой правке (updatedAt) и при удалении (deleted). */
function partSig(l: { id: string; updatedAt: number; deleted?: boolean }[]): string {
  return l
    .map((i) => `${i.id}:${i.updatedAt}:${i.deleted ? 1 : 0}`)
    .sort()
    .join('|');
}

/** Подпись пользовательского документа (без заметок — они в подколлекции). */
function sig(
  tasks: Task[],
  sightings: MoonSighting[],
  checklists: Checklist[],
  events: CalEvent[],
): string {
  return `${partSig(tasks)}//${partSig(sightings)}//${partSig(checklists)}//${partSig(events)}`;
}

/** Привести задачу к виду без undefined (Firestore не принимает undefined). */
function cleanTask(t: Task): Task {
  return {
    id: t.id,
    title: t.title,
    done: t.done,
    due: t.due ?? null,
    priority: t.priority,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt ?? t.createdAt ?? 0,
    deleted: t.deleted ?? false,
  };
}

function cleanNote(n: Note): Note {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    type: n.type ?? 'note',
    date: n.date ?? null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt ?? n.createdAt ?? 0,
    deleted: n.deleted ?? false,
  };
}

function cleanRelation(r: Relation): Relation {
  return {
    id: r.id,
    from: r.from,
    to: r.to,
    type: r.type,
    position: r.position ?? 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? r.createdAt ?? 0,
    deleted: r.deleted ?? false,
  };
}

function cleanSighting(s: MoonSighting): MoonSighting {
  return {
    id: s.id,
    startDate: s.startDate,
    hijriMonth: s.hijriMonth,
    hijriYear: s.hijriYear,
    method: s.method ?? 'sighting',
    note: s.note ?? '',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt ?? s.createdAt ?? 0,
    deleted: s.deleted ?? false,
  };
}

function cleanItem(it: ChecklistItem): ChecklistItem {
  return {
    id: it.id,
    text: it.text ?? '',
    done: !!it.done,
    desc: it.desc ?? '',
    date: it.date ?? null,
    remindAt: it.remindAt ?? null,
    noteId: it.noteId ?? null,
    subitems: (it.subitems ?? []).map(cleanItem),
  };
}

function cleanEvent(e: CalEvent): CalEvent {
  return {
    id: e.id,
    title: e.title ?? '',
    date: e.date,
    start: e.start ?? '',
    end: e.end ?? '',
    desc: e.desc ?? '',
    createdAt: e.createdAt,
    updatedAt: e.updatedAt ?? e.createdAt ?? 0,
    deleted: e.deleted ?? false,
  };
}

function cleanChecklist(c: Checklist): Checklist {
  return {
    id: c.id,
    title: c.title ?? '',
    date: c.date ?? null,
    items: (c.items ?? []).map(cleanItem),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt ?? c.createdAt ?? 0,
    deleted: c.deleted ?? false,
  };
}

/**
 * Синхронизация одной подколлекции `users/{uid}/{path}` по документу на запись.
 * Читает всю подколлекцию (onSnapshot), сливает с локальным (LWW по id) и пишет
 * только изменённые записи (дифф по подписи updatedAt:deleted), батчами.
 * Так документ `users/{uid}` не раздувается (лимит Firestore 1 МБ).
 */
function useCollectionSync<T extends { id: string; updatedAt: number; deleted?: boolean }>(
  user: User | null,
  path: string,
  items: T[],
  setItems: React.Dispatch<React.SetStateAction<T[]>>,
  clean: (x: T) => T,
): void {
  const syncedRef = useRef<Map<string, string>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const isig = (x: T) => `${x.updatedAt}:${x.deleted ? 1 : 0}`;

  useEffect(() => {
    if (!firebaseEnabled || !db || !user) return;
    syncedRef.current = new Map();
    const col = collection(db, 'users', user.uid, path);
    return onSnapshot(
      col,
      (snap) => {
        const cloud = snap.docs.map((d) => d.data() as T);
        const m = syncedRef.current;
        for (const r of cloud) m.set(r.id, isig(r));
        setItems(mergeById(cloud, itemsRef.current));
      },
      () => {
        /* нет доступа/сети — оставляем локальное */
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, path, setItems]);

  useEffect(() => {
    if (!firebaseEnabled || !db || !user) return;
    const m = syncedRef.current;
    const changed = items.filter((r) => m.get(r.id) !== isig(r));
    if (changed.length === 0) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const col = collection(db!, 'users', user.uid, path);
      const chunks: T[][] = [];
      for (let i = 0; i < changed.length; i += 450) chunks.push(changed.slice(i, i + 450));
      Promise.all(
        chunks.map((chunk) => {
          const batch = writeBatch(db!);
          for (const r of chunk) batch.set(doc(col, r.id), clean(r));
          return batch.commit();
        }),
      )
        .then(() => {
          for (const r of changed) m.set(r.id, isig(r));
        })
        .catch(() => {
          /* повторим при следующем изменении */
        });
    }, 600);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, user, path]);
}

export function useCloudSync({
  tasks,
  setTasks,
  notes,
  setNotes,
  sightings,
  setSightings,
  checklists,
  setChecklists,
  events,
  setEvents,
  relations,
  setRelations,
  adminSightings,
  setAdminSightings,
}: Params): Result {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SyncStatus>(
    firebaseEnabled ? 'signed-out' : 'disabled',
  );

  const isAdmin = !!user?.email && user.email === ADMIN_EMAIL;

  // Заметки и связи — в подколлекциях users/{uid}/{notes,relations}.
  useCollectionSync(user, 'notes', notes, setNotes, cleanNote);
  useCollectionSync(user, 'relations', relations, setRelations, cleanRelation);

  // Свежие значения для использования внутри колбэков подписки без переподписки.
  const tasksRef = useRef(tasks);
  const sightingsRef = useRef(sightings);
  const checklistsRef = useRef(checklists);
  const eventsRef = useRef(events);
  const adminRef = useRef(adminSightings);
  tasksRef.current = tasks;
  sightingsRef.current = sightings;
  checklistsRef.current = checklists;
  eventsRef.current = events;
  adminRef.current = adminSightings;

  // Подпись последних синхронизированных данных — чтобы не зацикливать
  // «получили из облака → записали обратно».
  const lastSyncedRef = useRef<string>('');
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAdminSyncedRef = useRef<string>('');
  const adminWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Слежение за состоянием входа ---
  useEffect(() => {
    if (!firebaseEnabled || !auth) return;
    // Завершаем поток входа через редирект (мобильные/PWA).
    getRedirectResult(auth).catch(() => {});
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setStatus(u ? 'syncing' : 'signed-out');
      if (!u) lastSyncedRef.current = '';
    });
  }, []);

  // --- Подписка на документ пользователя ---
  useEffect(() => {
    if (!firebaseEnabled || !db || !user) return;
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as
          | {
              tasks?: Task[];
              sightings?: MoonSighting[];
              checklists?: Checklist[];
              events?: CalEvent[];
            }
          | undefined;
        const cloudTasks = data?.tasks ?? [];
        const cloudSightings = data?.sightings ?? [];
        const cloudChecklists = data?.checklists ?? [];
        const cloudEvents = data?.events ?? [];

        // Сливаем облако с текущими локальными данными (LWW).
        const mergedTasks = mergeById(cloudTasks, tasksRef.current);
        const mergedSightings = mergeById(cloudSightings, sightingsRef.current);
        const mergedChecklists = mergeById(cloudChecklists, checklistsRef.current);
        const mergedEvents = mergeById(cloudEvents, eventsRef.current);

        setTasks(mergedTasks);
        setSightings(mergedSightings);
        setChecklists(mergedChecklists);
        setEvents(mergedEvents);

        // Помечаем как синхронизированное состояние облака. Если после слияния
        // у нас есть более новые локальные данные, эффект записи ниже их
        // дольёт (его подпись будет отличаться от облачной).
        lastSyncedRef.current = sig(cloudTasks, cloudSightings, cloudChecklists, cloudEvents);
        // Вошёл и есть сеть → синхронизировано. Подробности «кэш/сервер»
        // пользователю не важны и только путают (кружок «висел»).
        const online = typeof navigator === 'undefined' || navigator.onLine;
        setStatus(online ? 'synced' : 'offline');
      },
      () => setStatus('offline'),
    );
    return unsub;
  }, [user, setTasks, setSightings, setChecklists, setEvents]);

  // --- Выгрузка локальных изменений в облако (с дебаунсом) ---
  useEffect(() => {
    if (!firebaseEnabled || !db || !user) return;
    const cur = sig(tasks, sightings, checklists, events);
    if (cur === lastSyncedRef.current) return;

    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      lastSyncedRef.current = cur;
      const ref = doc(db!, 'users', user.uid);
      setDoc(ref, {
        tasks: tasks.map(cleanTask),
        sightings: sightings.map(cleanSighting),
        checklists: checklists.map(cleanChecklist),
        events: events.map(cleanEvent),
        updatedAt: Date.now(),
      }).catch(() => {
        // Запись не удалась — сбрасываем подпись, попробуем при следующем
        // изменении. Офлайн-кэш Firestore сам поставит запись в очередь.
        lastSyncedRef.current = '';
      });
    }, 600);

    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };
  }, [tasks, sightings, checklists, events, user]);

  // --- Подписка на общий («официальный») календарь админа ---
  // Работает независимо от входа: документ доступен на чтение всем.
  useEffect(() => {
    if (!firebaseEnabled || !db) return;
    const ref = doc(db, SHARED_DOC.collection, SHARED_DOC.id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as { sightings?: MoonSighting[] } | undefined;
        const cloud = data?.sightings ?? [];
        if (isAdmin) {
          // Админ редактирует этот документ — сливаем с локальными правками.
          setAdminSightings(mergeById(cloud, adminRef.current));
          lastAdminSyncedRef.current = partSig(cloud);
        } else {
          // Остальные только читают — зеркалим облако.
          setAdminSightings(cloud);
        }
      },
      () => {
        // Нет доступа/сети — оставляем локальный кэш как есть.
      },
    );
    return unsub;
  }, [isAdmin, setAdminSightings]);

  // --- Выгрузка официального календаря (только админ, с дебаунсом) ---
  useEffect(() => {
    if (!firebaseEnabled || !db || !isAdmin) return;
    const cur = partSig(adminSightings);
    if (cur === lastAdminSyncedRef.current) return;

    if (adminWriteTimer.current) clearTimeout(adminWriteTimer.current);
    adminWriteTimer.current = setTimeout(() => {
      lastAdminSyncedRef.current = cur;
      const ref = doc(db!, SHARED_DOC.collection, SHARED_DOC.id);
      setDoc(ref, {
        sightings: adminSightings.map(cleanSighting),
        updatedAt: Date.now(),
      }).catch(() => {
        lastAdminSyncedRef.current = '';
      });
    }, 600);

    return () => {
      if (adminWriteTimer.current) clearTimeout(adminWriteTimer.current);
    };
  }, [adminSightings, isAdmin]);

  const signIn = useCallback(async () => {
    if (!auth) return;
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      // Попап часто блокируется на мобильных/в установленном PWA → редирект.
      await signInWithRedirect(auth, googleProvider);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    if (!auth) return;
    await fbSignOut(auth);
    // Локальные данные не трогаем — остаются на устройстве.
  }, []);

  return { enabled: firebaseEnabled, user, status, isAdmin, signIn, signOutUser };
}

// Реэкспорт для возможного использования провайдера в других местах.
export { GoogleAuthProvider };
