import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CalEvent,
  Checklist,
  ClipItem,
  DayPlan,
  FinanceEntry,
  MoonSighting,
  PomodoroSession,
  PomodoroSettings,
  Project,
  Relation,
  Tab,
  Task,
} from './types';
import { uid, useListActions, useLocalStorage, visible } from './lib/storage';
import { persistParse, useNotesStore } from './lib/notesStore';
import { buildIndex, planRename } from './lib/kb/index';
import { KbContext, type KbApi, type KbFragment, type KbPicked, type KbTarget } from './lib/kb/ui';
import { NoteModal } from './components/NotesView';
import { CommentComposer, LinkPicker, SetPicker } from './components/KbDialogs';
import { linkText } from './lib/kb/edit';
import { planTagRename } from './lib/kb/tags';
import { useCloudSync, type SyncStatus } from './lib/sync';
import { useDocReminder, useMealReminder, useReminders } from './lib/reminders';
import { DEFAULT_MEAL_GAP_H } from './lib/health';
import { VAULT_META_ID, useVault } from './lib/vault';
import { DEFAULT_POMODORO, usePomodoro } from './lib/pomodoro';
import { dayKey, formatHijri, hijriFor, todayKey } from './lib/dates';
import { doneCounts, nextSlot, planSlots } from './lib/dayplan';
import { CalendarView } from './components/CalendarView';
import { ChecklistBoard } from './components/ChecklistBoard';
import { NotesExplorer } from './components/NotesExplorer';
import { MonthsView } from './components/MonthsView';
import { DashboardView } from './components/DashboardView';
import { TodayView } from './components/TodayView';
import { PlannerView } from './components/PlannerView';
import { FinanceView } from './components/FinanceView';
import { DirectoryView } from './components/DirectoryView';
import { DocumentsView } from './components/DocumentsView';
import { ClipboardView } from './components/ClipboardView';
import { PomodoroWidget } from './components/PomodoroWidget';
import { ProjectsView } from './components/ProjectsView';
import { QuickView } from './components/QuickView';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'projects', label: 'Проекты', icon: '🧭' },
  { id: 'today', label: 'Сегодня', icon: '⚡' },
  { id: 'planner', label: 'Карта дел', icon: '🎯' },
  { id: 'dashboard', label: 'Обзор', icon: '📊' },
  { id: 'calendar', label: 'Календарь', icon: '📅' },
  { id: 'tasks', label: 'Задачи', icon: '✓' },
  { id: 'notes', label: 'Заметки', icon: '📝' },
  { id: 'quick', label: 'Быстрые', icon: '✎' },
  { id: 'finance', label: 'Финансы', icon: '💰' },
  { id: 'directory', label: 'Справочник', icon: '📇' },
  { id: 'documents', label: 'Документы', icon: '🪪' },
  { id: 'clipboard', label: 'Буфер', icon: '📋' },
  { id: 'months', label: 'Месяцы', icon: '🌙' },
];

const STATUS_LABEL: Record<SyncStatus, string> = {
  disabled: '',
  'signed-out': 'Не синхронизируется',
  syncing: 'Синхронизация…',
  synced: 'Синхронизировано',
  offline: 'Офлайн',
};

type Theme = 'light' | 'dark';

const initialTheme: Theme =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

export default function App() {
  // Приложение всегда открывается на «Проектах» — главной вкладке (просьба хозяина 26.10.26).
  const [tab, setTab] = useState<Tab>('projects');
  const [theme, setTheme] = useLocalStorage<Theme>('ndc.theme', initialTheme);
  const [tasks, setTasks] = useLocalStorage<Task[]>('ndc.tasks', []);
  // заметки — в IndexedDB (src/lib/notesStore.ts): волт в localStorage не помещается
  const [notes, setNotes] = useNotesStore();
  const [sightings, setSightings] = useLocalStorage<MoonSighting[]>('ndc.sightings', []);
  const [checklists, setChecklists] = useLocalStorage<Checklist[]>('ndc.checklists', []);
  const [events, setEvents] = useLocalStorage<CalEvent[]>('ndc.events', []);
  const [relations, setRelations] = useLocalStorage<Relation[]>('ndc.relations', []);
  const [finance, setFinance] = useLocalStorage<FinanceEntry[]>('ndc.finance', []);
  const [clipboard, setClipboard] = useLocalStorage<ClipItem[]>('ndc.clipboard', []);
  const [projects, setProjects] = useLocalStorage<Project[]>('ndc.projects', []);
  const [currency, setCurrency] = useLocalStorage<string>('ndc.currency', '');
  const [mealGap, setMealGap] = useLocalStorage<number>('ndc.mealGapH', DEFAULT_MEAL_GAP_H);
  const [pomodoros, setPomodoros] = useLocalStorage<PomodoroSession[]>('ndc.pomodoros', []);
  const [dayPlans, setDayPlans] = useLocalStorage<DayPlan[]>('ndc.dayPlans', []);
  const [pomodoroSettings, setPomodoroSettings] = useLocalStorage<PomodoroSettings>(
    'ndc.pomodoroSettings',
    DEFAULT_POMODORO,
  );
  // Официальный календарь админа (общий документ) и предпочтение его использовать.
  const [adminSightings, setAdminSightings] = useLocalStorage<MoonSighting[]>('ndc.admin', []);
  const [useAdmin, setUseAdmin] = useLocalStorage<boolean>('ndc.useAdmin', true);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Приём «поделиться» из других приложений (Web Share Target, текст/ссылка).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const shared = [p.get('title'), p.get('text'), p.get('url')]
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!shared) return;
    const now = Date.now();
    setClipboard((l) => [{ id: uid(), kind: 'text', text: shared, createdAt: now, updatedAt: now }, ...l]);
    setTab('clipboard');
    window.history.replaceState({}, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Держим активную вкладку в поле зрения (прокручиваемая навигация).
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current
      ?.querySelector('.tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [tab]);

  useReminders(checklists);

  // Завершённая рабочая помидорка → запись в журнал (синхронизируемый).
  const logPomodoro = useCallback(
    (
      startedAt: number,
      durationMin: number,
      itemId: string | null,
      itemText: string,
      projectId: string | null,
    ) => {
      const d = new Date(startedAt);
      const now = Date.now();
      // id от момента старта: конец фазы могут поймать дважды (второе окно приложения,
      // повторный запуск эффекта) — помидор всё равно один.
      const id = `run-${startedAt}`;
      setPomodoros((l) => (l.some((p) => p.id === id) ? l : [
        {
          id,
          date: dayKey(d),
          start: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          durationMin,
          itemId,
          itemText,
          projectId,
          createdAt: now,
          updatedAt: now,
        },
        ...l,
      ]));
    },
    [setPomodoros],
  );
  const pomodoro = usePomodoro(pomodoroSettings, logPomodoro);

  const sync = useCloudSync({
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
    finance,
    setFinance,
    clipboard,
    setClipboard,
    projects,
    setProjects,
    pomodoros,
    setPomodoros,
    dayPlans,
    setDayPlans,
    adminSightings,
    setAdminSightings,
  });
  const isAdmin = sync.isAdmin;

  // Хранилище секретов (мастер-пароль). Работает поверх «сырых» заметок.
  const vault = useVault(notes, setNotes);

  // В интерфейс отдаём данные без надгробий и без служебной заметки хранилища.
  const visibleNotes = useMemo(
    () => visible(notes).filter((n) => n.id !== VAULT_META_ID),
    [notes],
  );
  useMealReminder(visibleNotes, mealGap);
  useDocReminder(visibleNotes);
  const visibleSightings = useMemo(() => visible(sightings), [sightings]);
  const visibleChecklists = useMemo(() => visible(checklists), [checklists]);
  const visibleEvents = useMemo(() => visible(events), [events]);
  const visibleRelations = useMemo(() => visible(relations), [relations]);
  const visibleFinance = useMemo(() => visible(finance), [finance]);
  const visibleClipboard = useMemo(() => visible(clipboard), [clipboard]);
  const visibleProjects = useMemo(() => visible(projects), [projects]);
  const visibleAdmin = useMemo(() => visible(adminSightings), [adminSightings]);
  const visiblePomodoros = useMemo(() => visible(pomodoros), [pomodoros]);

  // Проекты плана дня для таймера в шапке: кто на очереди — первым.
  const dayKeyNow = todayKey();
  const dayProjects = useMemo(() => {
    const slots = planSlots(dayPlans, dayKeyNow);
    const next = nextSlot(slots, doneCounts(visiblePomodoros, dayKeyNow));
    const ordered = next ? [next, ...slots.filter((s) => s !== next)] : slots;
    return ordered.flatMap((s) => {
      const p = visibleProjects.find((x) => x.id === s.projectId);
      return p ? [{ id: p.id, title: p.title }] : [];
    });
  }, [dayPlans, dayKeyNow, visiblePomodoros, visibleProjects]);

  // База знаний: указатель связей из текстов всех заметок (src/lib/kb, docs/ЗАМЕТКИ.md).
  // Собирается при каждом изменении заметок; заново разбираются только изменённые, а разбор
  // хранится на устройстве — при запуске всё не разбирается заново.
  const kbIndex = useMemo(() => buildIndex(visibleNotes), [visibleNotes]);
  useEffect(() => {
    const t = setTimeout(() => void persistParse(), 2000);
    return () => clearTimeout(t);
  }, [kbIndex]);
  const noteActions = useListActions(setNotes);
  // Заметки, открытые переходом по ссылке, — стопкой поверх любой вкладки: закрыл — вернулся.
  const [opened, setOpened] = useState<KbTarget[]>([]);
  // Окна базы знаний: «Сослаться», комментарий, набор (src/components/KbDialogs.tsx)
  const [dialog, setDialog] = useState<
    | { kind: 'link'; fromId?: string; resolve: (t: KbPicked | null) => void }
    | { kind: 'comment'; frag: KbFragment }
    | { kind: 'set'; frag: KbFragment }
    | null
  >(null);
  // Нажали тег в тексте — вкладка «Заметки» с отбором по нему
  const [focusTag, setFocusTag] = useState<{ tag: string; n: number } | null>(null);
  // Выбор слов для ссылки в другой заметке: она открыта в стопке на глубине depth
  const [picking, setPicking] = useState<{ depth: number; resolve: (t: KbPicked | null) => void } | null>(null);
  useEffect(() => {
    // заметку, где выбирали слова, закрыли, не выбрав, — ссылки не будет
    if (picking && opened.length < picking.depth) {
      picking.resolve(null);
      setPicking(null);
    }
  }, [opened.length, picking]);
  const kb = useMemo<KbApi>(
    () => ({
      index: kbIndex,
      open: (t) => {
        let id = t.id;
        if (!id && t.name) {
          const hit = kbIndex.byName.get(t.name.trim().toLowerCase());
          id = hit?.[0]?.id;
          if (!id) {
            if (!confirm(`Заметки «${t.name}» нет. Создать?`)) return;
            const now = Date.now();
            id = uid();
            noteActions.add({ id, title: t.name.trim(), body: '', type: 'note', date: null, createdAt: now, updatedAt: now });
          }
        }
        if (id) setOpened((st) => [...st, { ...t, id }]);
      },
      renamed: (id, oldTitle, newTitle) => {
        const patches = planRename(kbIndex, id, oldTitle, newTitle);
        if (!patches.length) return;
        const byId = new Map(patches.map((p) => [p.id, p]));
        const now = Date.now();
        setNotes((list) =>
          list.map((n) => {
            const p = byId.get(n.id);
            if (!p) return n;
            return { ...n, ...(p.body !== undefined ? { body: p.body } : {}), ...(p.props ? { props: p.props } : {}), updatedAt: now };
          }),
        );
      },
      pickLink: (fromId) => new Promise((resolve) => setDialog({ kind: 'link', fromId, resolve })),
      picking: !!picking,
      pickHere: (f) => {
        if (!picking) return;
        picking.resolve({ id: f.noteId, title: f.title, anchor: f.anchor });
        setPicking(null);
        setOpened((st) => st.slice(0, picking.depth - 1));
      },
      comment: (frag) => setDialog({ kind: 'comment', frag }),
      addToSet: (frag) => setDialog({ kind: 'set', frag }),
      renameTag: (oldTag, newTag) => {
        const patches = planTagRename(visibleNotes, oldTag, newTag);
        if (!patches.length) return 0;
        if (!confirm(`Переписать тег «${oldTag}» → «${newTag}» в заметках: ${patches.length}?`)) return 0;
        const byId = new Map(patches.map((p) => [p.id, p]));
        const now = Date.now();
        setNotes((list) =>
          list.map((n) => {
            const p = byId.get(n.id);
            if (!p) return n;
            const { id: _id, ...rest } = p;
            void _id;
            return { ...n, ...rest, updatedAt: now };
          }),
        );
        return patches.length;
      },
      openTag: (tag) => {
        setOpened([]);
        setDialog(null);
        setTab('notes');
        setFocusTag((f) => ({ tag, n: (f?.n ?? 0) + 1 }));
      },
      updateNote: (id, patch) => noteActions.update(id, patch),
      removeNote: (id) => noteActions.remove(id),
    }),
    [kbIndex, noteActions, setNotes, picking, visibleNotes],
  );

  /** Название, которого ещё нет: «Комментарий: слова», «Комментарий: слова (2)»… */
  function freeTitle(base: string) {
    let t = base;
    for (let i = 2; kbIndex.byName.has(t.toLowerCase()); i++) t = `${base} (${i})`;
    return t;
  }
  function saveComment(frag: KbFragment, text: string) {
    const now = Date.now();
    noteActions.add({
      id: uid(),
      type: 'comment',
      title: freeTitle(`Комментарий: ${frag.excerpt}`),
      body: text,
      props: { к: [linkText({ title: frag.title, anchor: frag.anchor })] },
      date: null,
      createdAt: now,
      updatedAt: now,
    });
    setDialog(null);
  }
  function addToSet(frag: KbFragment, setId: string | null, title: string) {
    const embed = '!' + linkText({ title: frag.title, anchor: frag.anchor });
    const now = Date.now();
    if (setId) {
      setNotes((list) =>
        list.map((n) => (n.id === setId ? { ...n, body: (n.body.trimEnd() ? n.body.trimEnd() + '\n\n' : '') + embed, updatedAt: now } : n)),
      );
    } else {
      noteActions.add({ id: uid(), type: 'set', title: freeTitle(title), body: embed, date: null, createdAt: now, updatedAt: now });
    }
    setDialog(null);
  }

  // Админ показывает официальный календарь всегда; остальные — по переключателю.
  const effectiveUseAdmin = isAdmin || useAdmin;

  const today = new Date();

  return (
    <KbContext.Provider value={kb}>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🌙</span>
          <div>
            <h1>notedocal</h1>
            <p className="hijri-today">
              {formatHijri(hijriFor(today, visibleSightings, visibleAdmin, effectiveUseAdmin))}
            </p>
          </div>
        </div>

        <div className="account">
          <PomodoroWidget
            pomodoro={pomodoro}
            sessions={visiblePomodoros}
            settings={pomodoroSettings}
            setSettings={setPomodoroSettings}
            dayProjects={dayProjects}
            checklists={visibleChecklists}
          />
          <button
            className="icon-btn theme-toggle"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label="Сменить тему"
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {sync.enabled &&
            (sync.user ? (
              <>
                <span className="sync-status" title={STATUS_LABEL[sync.status]}>
                  {sync.status === 'synced' ? '☁︎' : sync.status === 'offline' ? '⚠︎' : '⟳'}
                </span>
                {sync.user.photoURL && (
                  <img className="avatar" src={sync.user.photoURL} alt="" referrerPolicy="no-referrer" />
                )}
                <button className="btn btn-small" onClick={sync.signOutUser}>
                  Выйти
                </button>
              </>
            ) : (
              <button className="btn btn-small btn-primary" onClick={sync.signIn}>
                Войти через Google
              </button>
            ))}
        </div>
      </header>

      <main className={`content ${tab === 'projects' || tab === 'quick' ? 'content-wide' : ''}`}>
        {tab === 'today' && (
          <TodayView
            checklists={visibleChecklists}
            setChecklists={setChecklists}
            events={visibleEvents}
          />
        )}
        {tab === 'projects' && <ProjectsView projects={visibleProjects} setProjects={setProjects} />}
        {tab === 'planner' && (
          <PlannerView
            checklists={visibleChecklists}
            setChecklists={setChecklists}
            projects={visibleProjects}
            plans={dayPlans}
            setPlans={setDayPlans}
            sessions={visiblePomodoros}
            setSessions={setPomodoros}
            pomodoro={pomodoro}
            workMin={pomodoroSettings.workMin}
            logPomodoro={logPomodoro}
          />
        )}
        {tab === 'dashboard' && (
          <DashboardView
            events={visibleEvents}
            checklists={visibleChecklists}
            notes={visibleNotes}
            pomodoros={visiblePomodoros}
            ownSightings={visibleSightings}
            adminSightings={visibleAdmin}
            useAdmin={effectiveUseAdmin}
            mealGap={mealGap}
            setChecklists={setChecklists}
          />
        )}
        {tab === 'calendar' && (
          <CalendarView
            notes={visibleNotes}
            checklists={visibleChecklists}
            events={visibleEvents}
            relations={visibleRelations}
            ownSightings={visibleSightings}
            adminSightings={visibleAdmin}
            useAdmin={effectiveUseAdmin}
            setNotes={setNotes}
            setChecklists={setChecklists}
            setEvents={setEvents}
            setRelations={setRelations}
            mealGap={mealGap}
            setMealGap={setMealGap}
          />
        )}
        {tab === 'tasks' && (
          <section className="view view-narrow">
            <div className="view-head">
              <h2>Задачи</h2>
              <span className="muted">списки</span>
            </div>
            <ChecklistBoard
              date={null}
              checklists={visibleChecklists}
              setChecklists={setChecklists}
              notes={visibleNotes}
            />
          </section>
        )}
        {tab === 'notes' && (
          <NotesExplorer
            notes={visibleNotes}
            setNotes={setNotes}
            relations={visibleRelations}
            setRelations={setRelations}
            focusTag={focusTag}
          />
        )}
        {tab === 'quick' && (
          <QuickView notes={visibleNotes} setNotes={setNotes} relations={visibleRelations} setRelations={setRelations} />
        )}
        {tab === 'finance' && (
          <FinanceView
            finance={visibleFinance}
            setFinance={setFinance}
            currency={currency}
            setCurrency={setCurrency}
            notes={visibleNotes}
            setNotes={setNotes}
            relations={visibleRelations}
            setRelations={setRelations}
            checklists={visibleChecklists}
            setChecklists={setChecklists}
            events={visibleEvents}
            vault={vault}
          />
        )}
        {tab === 'directory' && (
          <DirectoryView
            notes={visibleNotes}
            setNotes={setNotes}
            relations={visibleRelations}
            setRelations={setRelations}
            finance={visibleFinance}
            checklists={visibleChecklists}
            setChecklists={setChecklists}
            events={visibleEvents}
            vault={vault}
            currency={currency}
          />
        )}
        {tab === 'documents' && (
          <DocumentsView
            notes={visibleNotes}
            setNotes={setNotes}
            relations={visibleRelations}
            setRelations={setRelations}
          />
        )}
        {tab === 'clipboard' && (
          <ClipboardView
            clipboard={visibleClipboard}
            setClipboard={setClipboard}
            signedIn={!!sync.user}
          />
        )}
        {tab === 'months' && (
          <MonthsView
            editSightings={isAdmin ? visibleAdmin : visibleSightings}
            setEditSightings={isAdmin ? setAdminSightings : setSightings}
            adminSightings={visibleAdmin}
            isAdmin={isAdmin}
            useAdmin={useAdmin}
            setUseAdmin={setUseAdmin}
          />
        )}
      </main>

      <nav className="tabbar" ref={navRef}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* вся стопка остаётся живой: нижняя карточка может ждать выбора цели ссылки */}
      {opened.map((t, i) => {
        const n = visibleNotes.find((x) => x.id === t.id);
        if (!n) return null;
        return (
          <NoteModal
            key={`${n.id}-${i}`}
            note={n}
            allNotes={visibleNotes}
            relations={visibleRelations}
            setRelations={setRelations}
            focus={t.anchor || t.heading ? { anchor: t.anchor, heading: t.heading } : undefined}
            onSave={(patch) => noteActions.update(n.id, patch)}
            onDelete={() => {
              noteActions.remove(n.id);
              setOpened((st) => st.slice(0, i));
            }}
            onClose={() => setOpened((st) => st.slice(0, i))}
            picking={!!picking && i + 1 === picking.depth}
          />
        );
      })}

      {dialog?.kind === 'link' && (
        <LinkPicker
          index={kbIndex}
          fromId={dialog.fromId}
          onPick={(t) => {
            dialog.resolve(t);
            setDialog(null);
          }}
          onSelectWords={(id) => {
            setPicking({ depth: opened.length + 1, resolve: dialog.resolve });
            setDialog(null);
            setOpened((st) => [...st, { id }]);
          }}
          onClose={() => {
            dialog.resolve(null);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'comment' && (
        <CommentComposer frag={dialog.frag} onSave={(t) => saveComment(dialog.frag, t)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'set' && (
        <SetPicker
          index={kbIndex}
          frag={dialog.frag}
          onAdd={(id, title) => addToSet(dialog.frag, id, title)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
    </KbContext.Provider>
  );
}
