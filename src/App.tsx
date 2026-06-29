import { useMemo, useState } from 'react';
import type { MoonSighting, Note, Tab, Task } from './types';
import { useLocalStorage, visible } from './lib/storage';
import { useCloudSync, type SyncStatus } from './lib/sync';
import { formatHijri, hijriFor } from './lib/dates';
import { CalendarView } from './components/CalendarView';
import { TasksView } from './components/TasksView';
import { NotesView } from './components/NotesView';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'calendar', label: 'Календарь', icon: '📅' },
  { id: 'tasks', label: 'Задачи', icon: '✓' },
  { id: 'notes', label: 'Заметки', icon: '📝' },
];

const STATUS_LABEL: Record<SyncStatus, string> = {
  disabled: '',
  'signed-out': 'Не синхронизируется',
  syncing: 'Синхронизация…',
  synced: 'Синхронизировано',
  offline: 'Офлайн',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('calendar');
  const [tasks, setTasks] = useLocalStorage<Task[]>('ndc.tasks', []);
  const [notes, setNotes] = useLocalStorage<Note[]>('ndc.notes', []);
  const [sightings, setSightings] = useLocalStorage<MoonSighting[]>('ndc.sightings', []);
  // Официальный календарь админа (общий документ) и предпочтение его использовать.
  const [adminSightings, setAdminSightings] = useLocalStorage<MoonSighting[]>('ndc.admin', []);
  const [useAdmin, setUseAdmin] = useLocalStorage<boolean>('ndc.useAdmin', true);

  const sync = useCloudSync({
    tasks,
    setTasks,
    notes,
    setNotes,
    sightings,
    setSightings,
    adminSightings,
    setAdminSightings,
  });
  const isAdmin = sync.isAdmin;

  // В интерфейс отдаём данные без надгробий (мягко удалённых записей).
  const visibleTasks = useMemo(() => visible(tasks), [tasks]);
  const visibleNotes = useMemo(() => visible(notes), [notes]);
  const visibleSightings = useMemo(() => visible(sightings), [sightings]);
  const visibleAdmin = useMemo(() => visible(adminSightings), [adminSightings]);

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

        {sync.enabled && (
          <div className="account">
            {sync.user ? (
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
            )}
          </div>
        )}
      </header>

      <main className="content">
        {tab === 'calendar' && (
          <CalendarView
            tasks={visibleTasks}
            notes={visibleNotes}
            ownSightings={visibleSightings}
            adminSightings={visibleAdmin}
            useAdmin={useAdmin}
            setUseAdmin={setUseAdmin}
            isAdmin={isAdmin}
            editSightings={isAdmin ? visibleAdmin : visibleSightings}
            setEditSightings={isAdmin ? setAdminSightings : setSightings}
            setTasks={setTasks}
            setNotes={setNotes}
          />
        )}
        {tab === 'tasks' && <TasksView tasks={visibleTasks} setTasks={setTasks} />}
        {tab === 'notes' && <NotesView notes={visibleNotes} setNotes={setNotes} />}
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
