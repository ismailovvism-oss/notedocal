import { useState } from 'react';
import type { Note, Tab, Task } from './types';
import { useLocalStorage } from './lib/storage';
import { hijriFull } from './lib/dates';
import { CalendarView } from './components/CalendarView';
import { TasksView } from './components/TasksView';
import { NotesView } from './components/NotesView';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'calendar', label: 'Календарь', icon: '📅' },
  { id: 'tasks', label: 'Задачи', icon: '✓' },
  { id: 'notes', label: 'Заметки', icon: '📝' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('calendar');
  const [tasks, setTasks] = useLocalStorage<Task[]>('ndc.tasks', []);
  const [notes, setNotes] = useLocalStorage<Note[]>('ndc.notes', []);

  const today = new Date();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🌙</span>
          <div>
            <h1>notedocal</h1>
            <p className="hijri-today">{hijriFull(today)}</p>
          </div>
        </div>
      </header>

      <main className="content">
        {tab === 'calendar' && (
          <CalendarView tasks={tasks} notes={notes} setTasks={setTasks} setNotes={setNotes} />
        )}
        {tab === 'tasks' && <TasksView tasks={tasks} setTasks={setTasks} />}
        {tab === 'notes' && <NotesView notes={notes} setNotes={setNotes} />}
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
