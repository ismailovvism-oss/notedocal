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
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { ADMIN_EMAIL, SHARED_DOC, auth, db, firebaseEnabled, googleProvider } from './firebase';
import { mergeById } from './storage';
import type { MoonSighting, Note, Task } from '../types';

export type SyncStatus = 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'offline';

interface Params {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  sightings: MoonSighting[];
  setSightings: React.Dispatch<React.SetStateAction<MoonSighting[]>>;
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

/** Подпись пользовательского документа (tasks + notes + личные наблюдения). */
function sig(tasks: Task[], notes: Note[], sightings: MoonSighting[]): string {
  return `${partSig(tasks)}//${partSig(notes)}//${partSig(sightings)}`;
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
    date: n.date ?? null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt ?? n.createdAt ?? 0,
    deleted: n.deleted ?? false,
  };
}

function cleanSighting(s: MoonSighting): MoonSighting {
  return {
    id: s.id,
    startDate: s.startDate,
    hijriMonth: s.hijriMonth,
    hijriYear: s.hijriYear,
    note: s.note ?? '',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt ?? s.createdAt ?? 0,
    deleted: s.deleted ?? false,
  };
}

export function useCloudSync({
  tasks,
  setTasks,
  notes,
  setNotes,
  sightings,
  setSightings,
  adminSightings,
  setAdminSightings,
}: Params): Result {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SyncStatus>(
    firebaseEnabled ? 'signed-out' : 'disabled',
  );

  const isAdmin = !!user?.email && user.email === ADMIN_EMAIL;

  // Свежие значения для использования внутри колбэков подписки без переподписки.
  const tasksRef = useRef(tasks);
  const notesRef = useRef(notes);
  const sightingsRef = useRef(sightings);
  const adminRef = useRef(adminSightings);
  tasksRef.current = tasks;
  notesRef.current = notes;
  sightingsRef.current = sightings;
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
          | { tasks?: Task[]; notes?: Note[]; sightings?: MoonSighting[] }
          | undefined;
        const cloudTasks = data?.tasks ?? [];
        const cloudNotes = data?.notes ?? [];
        const cloudSightings = data?.sightings ?? [];

        // Сливаем облако с текущими локальными данными (LWW).
        const mergedTasks = mergeById(cloudTasks, tasksRef.current);
        const mergedNotes = mergeById(cloudNotes, notesRef.current);
        const mergedSightings = mergeById(cloudSightings, sightingsRef.current);

        setTasks(mergedTasks);
        setNotes(mergedNotes);
        setSightings(mergedSightings);

        // Помечаем как синхронизированное состояние облака. Если после слияния
        // у нас есть более новые локальные данные, эффект записи ниже их
        // дольёт (его подпись будет отличаться от облачной).
        lastSyncedRef.current = sig(cloudTasks, cloudNotes, cloudSightings);
        setStatus(snap.metadata.fromCache ? 'offline' : 'synced');
      },
      () => setStatus('offline'),
    );
    return unsub;
  }, [user, setTasks, setNotes, setSightings]);

  // --- Выгрузка локальных изменений в облако (с дебаунсом) ---
  useEffect(() => {
    if (!firebaseEnabled || !db || !user) return;
    const cur = sig(tasks, notes, sightings);
    if (cur === lastSyncedRef.current) return;

    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      lastSyncedRef.current = cur;
      const ref = doc(db!, 'users', user.uid);
      setDoc(ref, {
        tasks: tasks.map(cleanTask),
        notes: notes.map(cleanNote),
        sightings: sightings.map(cleanSighting),
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
  }, [tasks, notes, sightings, user]);

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
