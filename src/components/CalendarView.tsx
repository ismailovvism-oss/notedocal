import { useMemo, useState } from 'react';
import type { MoonSighting, Note, Task } from '../types';
import {
  WEEKDAYS,
  dayKey,
  formatHijri,
  fromKey,
  gregMonthTitle,
  hijriFor,
  hijriSourceLabel,
  monthGrid,
  todayKey,
} from '../lib/dates';
import { TasksView } from './TasksView';
import { NotesView } from './NotesView';

interface Props {
  tasks: Task[];
  notes: Note[];
  ownSightings: MoonSighting[];
  adminSightings: MoonSighting[];
  /** Учитывать ли календарь Tawhiid (уже с учётом роли админа). */
  useAdmin: boolean;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
}

export function CalendarView({
  tasks,
  notes,
  ownSightings,
  adminSightings,
  useAdmin,
  setTasks,
  setNotes,
}: Props) {
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<string>(todayKey());
  // На телефоне выбор дня открывает отдельный экран дня (оверлей).
  const [dayOpen, setDayOpen] = useState(false);

  const grid = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  const counts = useMemo(() => {
    const m = new Map<string, { tasks: number; notes: number }>();
    for (const t of tasks) {
      if (!t.due) continue;
      const c = m.get(t.due) ?? { tasks: 0, notes: 0 };
      c.tasks += 1;
      m.set(t.due, c);
    }
    for (const n of notes) {
      if (!n.date) continue;
      const c = m.get(n.date) ?? { tasks: 0, notes: 0 };
      c.notes += 1;
      m.set(n.date, c);
    }
    return m;
  }, [tasks, notes]);

  const month = cursor.getMonth();
  const shift = (delta: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));

  function pick(key: string) {
    setSelected(key);
    setDayOpen(true);
  }

  const selDate = fromKey(selected);
  const selHijri = hijriFor(selDate, ownSightings, adminSightings, useAdmin);

  return (
    <section className="view cal-layout">
      <div className="cal-main">
        <div className="cal-head">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Предыдущий месяц">
            ‹
          </button>
          <button className="cal-title" onClick={() => setCursor(new Date())}>
            {gregMonthTitle(cursor)}
          </button>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Следующий месяц">
            ›
          </button>
        </div>

        <div className="cal-weekdays">
          {WEEKDAYS.map((w) => (
            <div key={w} className="cal-weekday">
              {w}
            </div>
          ))}
        </div>

        <div className="cal-grid">
          {grid.map((d) => {
            const key = dayKey(d);
            const inMonth = d.getMonth() === month;
            const isToday = key === todayKey();
            const isSel = key === selected;
            const c = counts.get(key);
            const h = hijriFor(d, ownSightings, adminSightings, useAdmin);
            return (
              <button
                key={key}
                className={[
                  'cal-cell',
                  inMonth ? '' : 'out',
                  isToday ? 'today' : '',
                  isSel ? 'sel' : '',
                ].join(' ')}
                onClick={() => pick(key)}
              >
                <span className="greg">{d.getDate()}</span>
                <span className={`hijri ${h.certain ? '' : 'approx'}`}>{h.day}</span>
                {c && (
                  <span className="dots">
                    {c.tasks > 0 && <i className="dot dot-task" />}
                    {c.notes > 0 && <i className="dot dot-note" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <aside className={`day-side ${dayOpen ? 'open' : ''}`}>
        <div className="day-side-head">
          <button className="day-back icon-btn" onClick={() => setDayOpen(false)} aria-label="Назад">
            ‹
          </button>
          <div>
            <h2 className="day-date">
              {selDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h2>
            <p className={`day-hijri ${selHijri.certain ? '' : 'approx'}`}>
              {formatHijri(selHijri)} <span className="day-src">· {hijriSourceLabel(selHijri)}</span>
            </p>
          </div>
        </div>

        <div className="day-section">
          <h3 className="day-section-title">Задачи</h3>
          <TasksView tasks={tasks} setTasks={setTasks} fixedDate={selected} />
        </div>

        <div className="day-section">
          <h3 className="day-section-title">Заметки</h3>
          <NotesView notes={notes} setNotes={setNotes} fixedDate={selected} />
        </div>
      </aside>
    </section>
  );
}
