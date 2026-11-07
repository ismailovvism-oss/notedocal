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
import { collection, doc, onSnapshot, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { ADMIN_EMAIL, SHARED_DOC, auth, db, firebaseEnabled, googleProvider } from './firebase';
import { mergeById } from './storage';
import { cleanAttachment, cleanNote, cleanRelation } from './clean';
import type { PomodoroRun } from './pomodoro';
import { loadMeta, saveMeta } from './notesStore';
import type {
  CalEvent,
  Checklist,
  ChecklistItem,
  ClipItem,
  FinanceEntry,
  MoonSighting,
  Note,
  DayPlan,
  PomodoroSession,
  Project,
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
  /** Журнал помидорок (подколлекция users/{uid}/pomodoros). */
  pomodoros: PomodoroSession[];
  setPomodoros: React.Dispatch<React.SetStateAction<PomodoroSession[]>>;
  /** Планы дня (подколлекция users/{uid}/dayplans, id документа — день). */
  dayPlans: DayPlan[];
  setDayPlans: React.Dispatch<React.SetStateAction<DayPlan[]>>;
  /** Домашняя бухгалтерия (подколлекция users/{uid}/finance). */
  finance: FinanceEntry[];
  setFinance: React.Dispatch<React.SetStateAction<FinanceEntry[]>>;
  /** Общий буфер обмена (подколлекция users/{uid}/clipboard). */
  clipboard: ClipItem[];
  setClipboard: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  /** Пульт проектов (подколлекция users/{uid}/projects). */
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
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

/**
 * Идущий помидор — в users/{uid}/live/pomodoro: его рисует значок в трее компьютера
 * (~/projects/apps/zametki/pomidor.py). Пишем только при смене фазы, паузе и остановке;
 * пустое при запуске не пишем, иначе открытое на телефоне приложение сбросит чужой таймер.
 */
export function useLivePomodoro(user: User | null, run: PomodoroRun | null): void {
  const sig = run ? `${run.phase}:${run.endsAt}:${run.pausedLeft}:${run.itemText}` : '';
  const written = useRef('');
  useEffect(() => {
    if (!firebaseEnabled || !db || !user || sig === written.current) return;
    written.current = sig;
    const live = run
      ? { phase: run.phase, endsAt: run.endsAt, pausedLeft: run.pausedLeft, text: run.itemText }
      : { phase: null };
    setDoc(doc(db, 'users', user.uid, 'live', 'pomodoro'), { ...live, updatedAt: Date.now() }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sig]);
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

function cleanClip(c: ClipItem): ClipItem {
  return {
    id: c.id,
    kind: c.kind,
    text: c.text ?? '',
    ...(c.attachment ? { attachment: cleanAttachment(c.attachment) } : {}),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt ?? c.createdAt ?? 0,
    deleted: c.deleted ?? false,
  };
}

function cleanFinance(f: FinanceEntry): FinanceEntry {
  return {
    id: f.id,
    kind: f.kind,
    amount: f.amount ?? 0,
    date: f.date,
    person: f.person ?? '',
    category: f.category ?? '',
    note: f.note ?? '',
    createdAt: f.createdAt,
    updatedAt: f.updatedAt ?? f.createdAt ?? 0,
    deleted: f.deleted ?? false,
  };
}

function cleanProject(p: Project): Project {
  return {
    id: p.id,
    title: p.title ?? p.id,
    sphere: p.sphere ?? 'tools',
    stage: p.stage ?? 'active',
    focus: !!p.focus,
    priority: p.priority ?? 0,
    what: p.what ?? '',
    goal: p.goal ?? '',
    now: p.now ?? '',
    next: (p.next ?? []).map((s) => ({
      t: s.t,
      who: s.who ?? 'me',
      done: !!s.done,
      ...(s.doneAt ? { doneAt: s.doneAt } : {}),
      ...(s.addedAt ? { addedAt: s.addedAt } : {}),
      ...(s.comment ? { comment: s.comment, commentAt: s.commentAt ?? '', commentState: s.commentState ?? 'new' } : {}),
      ...(s.comment && s.commentTo ? { commentTo: s.commentTo } : {}),
      ...(s.comment && s.commentReply ? { commentReply: s.commentReply } : {}),
    })),
    done: (p.done ?? []).map((d) => ({ t: d.t, d: d.d ?? '' })),
    waiting: p.waiting ?? '',
    path: p.path ?? '',
    sessions: (p.sessions ?? []).map((s) => ({ id: s.id, t: s.t ?? '' })),
    links: (p.links ?? []).map((l) => ({ t: l.t ?? l.u, u: l.u })),
    lastActivity: p.lastActivity ?? '',
    note: p.note ?? '',
    noteAt: p.noteAt ?? null,
    ...(p.note && p.noteState ? { noteState: p.noteState } : {}),
    ...(p.note && p.noteTo ? { noteTo: p.noteTo } : {}),
    ...(p.note && p.noteReply ? { noteReply: p.noteReply } : {}),
    updatedBy: p.updatedBy ?? '',
    createdAt: p.createdAt,
    updatedAt: p.updatedAt ?? p.createdAt ?? 0,
    deleted: p.deleted ?? false,
  };
}

function cleanPomodoro(p: PomodoroSession): PomodoroSession {
  return {
    id: p.id,
    date: p.date,
    start: p.start ?? '',
    durationMin: p.durationMin ?? 0,
    itemId: p.itemId ?? null,
    itemText: p.itemText ?? '',
    ...(p.projectId ? { projectId: p.projectId } : {}),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt ?? p.createdAt ?? 0,
    deleted: p.deleted ?? false,
  };
}

function cleanDayPlan(p: DayPlan): DayPlan {
  return {
    id: p.id,
    slots: (p.slots ?? []).map((s) => ({ projectId: s.projectId, goal: s.goal })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt ?? p.createdAt ?? 0,
    deleted: p.deleted ?? false,
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
    attachments: (it.attachments ?? []).map(cleanAttachment),
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
    locationId: e.locationId ?? null,
    attachments: (e.attachments ?? []).map(cleanAttachment),
    repeat: e.repeat ?? 'none',
    repeatUntil: e.repeatUntil ?? null,
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

/** Что сверено с облаком — для заметок хранится на устройстве (src/lib/notesStore.ts). */
interface SyncMeta {
  /** id → «updatedAt:deleted» версии, которая есть в облаке. */
  synced: Record<string, string>;
  /** Самое позднее `updatedAt`, пришедшее из облака. */
  since: number;
  /** Когда последний раз читали подколлекцию целиком. */
  full: number;
}

const DAY = 24 * 3600 * 1000;

/**
 * Синхронизация одной подколлекции `users/{uid}/{path}` по документу на запись.
 * Читает подколлекцию (onSnapshot), сливает с локальным (LWW по id) и пишет
 * только изменённые записи (дифф по подписи updatedAt:deleted), батчами.
 * Так документ `users/{uid}` не раздувается (лимит Firestore 1 МБ).
 *
 * `delta` (заметки): читать только изменённое с прошлого раза — `updatedAt` позже
 * запомненного с запасом в 2 суток на расхождение часов устройств. Иначе каждый запуск
 * читал бы все заметки: на волте это 8 800 чтений за раз при 50 000 бесплатных в сутки.
 * Раз в неделю подколлекция читается целиком — на случай часов, ушедших сильнее.
 */
function useCollectionSync<T extends { id: string; updatedAt: number; deleted?: boolean }>(
  user: User | null,
  path: string,
  items: T[],
  setItems: React.Dispatch<React.SetStateAction<T[]>>,
  clean: (x: T) => T,
  delta = false,
): void {
  const syncedRef = useRef<Map<string, string>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const isig = (x: T) => `${x.updatedAt}:${x.deleted ? 1 : 0}`;
  // писать можно, только когда известно, что уже есть в облаке: иначе всё локальное
  // показалось бы новым и ушло бы в облако целиком
  const [known, setKnown] = useState(false);
  const meta = useRef<{ since: number; full: number; dirty: boolean; timer?: ReturnType<typeof setTimeout> }>({
    since: 0,
    full: 0,
    dirty: false,
  });

  const saveMetaSoon = useCallback(() => {
    if (!delta || !user) return;
    const m = meta.current;
    m.dirty = true;
    if (m.timer) return;
    m.timer = setTimeout(() => {
      m.timer = undefined;
      if (!m.dirty) return;
      m.dirty = false;
      const value: SyncMeta = { synced: Object.fromEntries(syncedRef.current), since: m.since, full: m.full };
      void saveMeta(`sync:${user.uid}:${path}`, value);
    }, 2000);
  }, [delta, user, path]);

  useEffect(() => {
    if (!firebaseEnabled || !db || !user) return;
    syncedRef.current = new Map();
    meta.current = { since: 0, full: 0, dirty: false };
    setKnown(false);
    let alive = true;
    let unsub = () => {};
    (async () => {
      let since = 0;
      if (delta) {
        const saved = await loadMeta<SyncMeta>(`sync:${user.uid}:${path}`);
        if (!alive) return;
        if (saved && saved.full > Date.now() - 7 * DAY) {
          syncedRef.current = new Map(Object.entries(saved.synced));
          meta.current = { since: saved.since, full: saved.full, dirty: false };
          since = saved.since;
        }
      }
      const col = collection(db!, 'users', user.uid, path);
      const q = since ? query(col, where('updatedAt', '>', since - 2 * DAY)) : col;
      unsub = onSnapshot(
        q,
        (snap) => {
          const cloud = snap.docs.map((d) => d.data() as T);
          const m = syncedRef.current;
          for (const r of cloud) m.set(r.id, isig(r));
          setItems(mergeById(cloud, itemsRef.current));
          setKnown(true);
          if (delta) {
            const now = Date.now();
            for (const r of cloud) if (r.updatedAt > meta.current.since) meta.current.since = Math.min(r.updatedAt, now);
            if (!since && !snap.metadata.fromCache) meta.current.full = now;
            saveMetaSoon();
          }
        },
        () => {
          /* нет доступа/сети — оставляем локальное */
        },
      );
    })();
    return () => {
      alive = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, path, setItems]);

  useEffect(() => {
    if (!firebaseEnabled || !db || !user || !known) return;
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
          saveMetaSoon();
        })
        .catch(() => {
          /* повторим при следующем изменении */
        });
    }, 600);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, user, path, known]);
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
  pomodoros,
  setPomodoros,
  dayPlans,
  setDayPlans,
  finance,
  setFinance,
  clipboard,
  setClipboard,
  projects,
  setProjects,
  adminSightings,
  setAdminSightings,
}: Params): Result {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SyncStatus>(
    firebaseEnabled ? 'signed-out' : 'disabled',
  );

  const isAdmin = !!user?.email && user.email === ADMIN_EMAIL;

  // Заметки, связи и помидорки — в подколлекциях users/{uid}/{notes,relations,pomodoros}.
  useCollectionSync(user, 'notes', notes, setNotes, cleanNote, true);
  useCollectionSync(user, 'relations', relations, setRelations, cleanRelation);
  useCollectionSync(user, 'pomodoros', pomodoros, setPomodoros, cleanPomodoro);
  useCollectionSync(user, 'dayplans', dayPlans, setDayPlans, cleanDayPlan);
  useCollectionSync(user, 'finance', finance, setFinance, cleanFinance);
  useCollectionSync(user, 'clipboard', clipboard, setClipboard, cleanClip);
  useCollectionSync(user, 'projects', projects, setProjects, cleanProject);

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
