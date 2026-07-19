import { useCallback, useEffect, useMemo } from 'react';
import type {
  CalEvent,
  Checklist,
  MoonSighting,
  Note,
  PomodoroSession,
  PomodoroSettings,
  Relation,
  Tab,
  Task,
} from './types';
import { uid, useLocalStorage, visible } from './lib/storage';
import { useCloudSync, type SyncStatus } from './lib/sync';
import { useMealReminder, useReminders } from './lib/reminders';
import { DEFAULT_MEAL_GAP_H } from './lib/health';
import { DEFAULT_POMODORO, usePomodoro } from './lib/pomodoro';
import { dayKey, formatHijri, hijriFor } from './lib/dates';
import { CalendarView } from './components/CalendarView';
import { ChecklistBoard } from './components/ChecklistBoard';
import { NotesExplorer } from './components/NotesExplorer';
import { MonthsView } from './components/MonthsView';
import { DashboardView } from './components/DashboardView';
import { PomodoroWidget } from './components/PomodoroWidget';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Обзор', icon: '📊' },
  { id: 'calendar', label: 'Календарь', icon: '📅' },
  { id: 'tasks', label: 'Задачи', icon: '✓' },
  { id: 'notes', label: 'Заметки', icon: '📝' },
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
  const [tab, setTab] = useLocalStorage<Tab>('ndc.tab', 'calendar');
  const [theme, setTheme] = useLocalStorage<Theme>('ndc.theme', initialTheme);
  const [tasks, setTasks] = useLocalStorage<Task[]>('ndc.tasks', []);
  const [notes, setNotes] = useLocalStorage<Note[]>('ndc.notes', []);
  const [sightings, setSightings] = useLocalStorage<MoonSighting[]>('ndc.sightings', []);
  const [checklists, setChecklists] = useLocalStorage<Checklist[]>('ndc.checklists', []);
  const [events, setEvents] = useLocalStorage<CalEvent[]>('ndc.events', []);
  const [relations, setRelations] = useLocalStorage<Relation[]>('ndc.relations', []);
  const [mealGap, setMealGap] = useLocalStorage<number>('ndc.mealGapH', DEFAULT_MEAL_GAP_H);
  const [pomodoros, setPomodoros] = useLocalStorage<PomodoroSession[]>('ndc.pomodoros', []);
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

  useReminders(checklists);

  // Завершённая рабочая помидорка → запись в журнал (синхронизируемый).
  const logPomodoro = useCallback(
    (startedAt: number, durationMin: number, itemId: string | null, itemText: string) => {
      const d = new Date(startedAt);
      const now = Date.now();
      setPomodoros((l) => [
        {
          id: uid(),
          date: dayKey(d),
          start: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          durationMin,
          itemId,
          itemText,
          createdAt: now,
          updatedAt: now,
        },
        ...l,
      ]);
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
    pomodoros,
    setPomodoros,
    adminSightings,
    setAdminSightings,
  });
  const isAdmin = sync.isAdmin;

  // В интерфейс отдаём данные без надгробий (мягко удалённых записей).
  const visibleNotes = useMemo(() => visible(notes), [notes]);
  useMealReminder(visibleNotes, mealGap);
  const visibleSightings = useMemo(() => visible(sightings), [sightings]);
  const visibleChecklists = useMemo(() => visible(checklists), [checklists]);
  const visibleEvents = useMemo(() => visible(events), [events]);
  const visibleRelations = useMemo(() => visible(relations), [relations]);
  const visibleAdmin = useMemo(() => visible(adminSightings), [adminSightings]);
  const visiblePomodoros = useMemo(() => visible(pomodoros), [pomodoros]);

  // Админ показывает официальный календарь всегда; остальные — по переключателю.
  const effectiveUseAdmin = isAdmin || useAdmin;

  const today = new Date();

  return (
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

      <main className="content">
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

      <nav className="tabbar">
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
    </div>
  );
}
