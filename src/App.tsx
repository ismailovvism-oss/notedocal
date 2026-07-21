import { useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  CalEvent,
  Checklist,
  ClipItem,
  FinanceEntry,
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
import { useDocReminder, useMealReminder, useReminders } from './lib/reminders';
import { DEFAULT_MEAL_GAP_H } from './lib/health';
import { VAULT_META_ID, useVault } from './lib/vault';
import { DEFAULT_POMODORO, usePomodoro } from './lib/pomodoro';
import { dayKey, formatHijri, hijriFor } from './lib/dates';
import { CalendarView } from './components/CalendarView';
import { ChecklistBoard } from './components/ChecklistBoard';
import { NotesExplorer } from './components/NotesExplorer';
import { MonthsView } from './components/MonthsView';
import { DashboardView } from './components/DashboardView';
import { FinanceView } from './components/FinanceView';
import { DirectoryView } from './components/DirectoryView';
import { ClipboardView } from './components/ClipboardView';
import { PomodoroWidget } from './components/PomodoroWidget';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Обзор', icon: '📊' },
  { id: 'calendar', label: 'Календарь', icon: '📅' },
  { id: 'tasks', label: 'Задачи', icon: '✓' },
  { id: 'notes', label: 'Заметки', icon: '📝' },
  { id: 'finance', label: 'Финансы', icon: '💰' },
  { id: 'directory', label: 'Справочник', icon: '📇' },
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
  const [tab, setTab] = useLocalStorage<Tab>('ndc.tab', 'calendar');
  const [theme, setTheme] = useLocalStorage<Theme>('ndc.theme', initialTheme);
  const [tasks, setTasks] = useLocalStorage<Task[]>('ndc.tasks', []);
  const [notes, setNotes] = useLocalStorage<Note[]>('ndc.notes', []);
  const [sightings, setSightings] = useLocalStorage<MoonSighting[]>('ndc.sightings', []);
  const [checklists, setChecklists] = useLocalStorage<Checklist[]>('ndc.checklists', []);
  const [events, setEvents] = useLocalStorage<CalEvent[]>('ndc.events', []);
  const [relations, setRelations] = useLocalStorage<Relation[]>('ndc.relations', []);
  const [finance, setFinance] = useLocalStorage<FinanceEntry[]>('ndc.finance', []);
  const [clipboard, setClipboard] = useLocalStorage<ClipItem[]>('ndc.clipboard', []);
  const [currency, setCurrency] = useLocalStorage<string>('ndc.currency', '');
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
    finance,
    setFinance,
    clipboard,
    setClipboard,
    pomodoros,
    setPomodoros,
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
    </div>
  );
}
