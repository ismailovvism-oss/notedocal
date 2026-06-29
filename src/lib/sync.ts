// Облачная синхронизация заметок и задач через Cloud Firestore.
//
// Модель данных: на каждого пользователя — один документ `users/{uid}` с
// полями `tasks` и `notes` (полные массивы). При входе локальные данные
// сливаются с облачными по принципу «последнее изменение побеждает»
// (Last-Write-Wins по updatedAt, надгробия учитываются), затем оба
// направления поддерживаются в актуальном состоянии в реальном времени.

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
import { auth, db, firebaseEnabled, googleProvider } from './firebase';
import { mergeById } from './storage';
import type { Note, Task } from '../types';

export type SyncStatus = 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'offline';

interface Params {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
}

interface Result {
  enabled: boolean;
  user: User | null;
  status: SyncStatus;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

/** Подпись набора данных — стабильна независимо от порядка элементов.
 *  Меняется при любой правке (updatedAt) и при удалении (deleted). */
function sig(tasks: Task[], notes: Note[]): string {
  const part = (l: { id: string; updatedAt: number; deleted?: boolean }[]) =>
    l
      .map((i) => `${i.id}:${i.updatedAt}:${i.deleted ? 1 : 0}`)
      .sort()
      .join('|');
  return `${part(tasks)}//${part(notes)}`;
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

export function useCloudSync({ tasks, setTasks, notes, setNotes }: Params): Result {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SyncStatus>(
    firebaseEnabled ? 'signed-out' : 'disabled',
  );

  // Свежие значения для использования внутри колбэков подписки без переподписки.
  const tasksRef = useRef(tasks);
  const notesRef = useRef(notes);
  tasksRef.current = tasks;
  notesRef.current = notes;

  // Подпись последних синхронизированных данных — чтобы не зацикливать
  // «получили из облака → записали обратно».
  const lastSyncedRef = useRef<string>('');
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const data = snap.data() as { tasks?: Task[]; notes?: Note[] } | undefined;
        const cloudTasks = data?.tasks ?? [];
        const cloudNotes = data?.notes ?? [];

        // Сливаем облако с текущими локальными данными (LWW).
        const mergedTasks = mergeById(cloudTasks, tasksRef.current);
        const mergedNotes = mergeById(cloudNotes, notesRef.current);

        setTasks(mergedTasks);
        setNotes(mergedNotes);

        // Помечаем как синхронизированное состояние облака. Если после слияния
        // у нас есть более новые локальные данные, эффект записи ниже их
        // дольёт (его подпись будет отличаться от облачной).
        lastSyncedRef.current = sig(cloudTasks, cloudNotes);
        setStatus(snap.metadata.fromCache ? 'offline' : 'synced');
      },
      () => setStatus('offline'),
    );
    return unsub;
  }, [user, setTasks, setNotes]);

  // --- Выгрузка локальных изменений в облако (с дебаунсом) ---
  useEffect(() => {
    if (!firebaseEnabled || !db || !user) return;
    const cur = sig(tasks, notes);
    if (cur === lastSyncedRef.current) return;

    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      lastSyncedRef.current = cur;
      const ref = doc(db!, 'users', user.uid);
      setDoc(ref, {
        tasks: tasks.map(cleanTask),
        notes: notes.map(cleanNote),
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
  }, [tasks, notes, user]);

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

  return { enabled: firebaseEnabled, user, status, signIn, signOutUser };
}

// Реэкспорт для возможного использования провайдера в других местах.
export { GoogleAuthProvider };
