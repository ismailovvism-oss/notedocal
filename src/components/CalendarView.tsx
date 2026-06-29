import { useMemo, useState } from 'react';
import type { Note, Task } from '../types';
import {
  WEEKDAYS,
  dayKey,
  fromKey,
  gregMonthTitle,
  hijriDay,
  hijriFull,
  monthGrid,
  todayKey,
} from '../lib/dates';
import { TasksView } from './TasksView';
import { NotesView } from './NotesView';

interface Props {
  tasks: Task[];
  notes: Note[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
}

export function CalendarView({ tasks, notes, setTasks, setNotes }: Props) {
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<string>(todayKey());

  const grid = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  // Карты «день -> количество» для индикаторов на ячейках.
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

  const selDate = fromKey(selected);

  return (
    <section className="view">
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
          return (
            <button
              key={key}
              className={[
                'cal-cell',
                inMonth ? '' : 'out',
                isToday ? 'today' : '',
                isSel ? 'sel' : '',
              ].join(' ')}
              onClick={() => setSelected(key)}
            >
              <span className="greg">{d.getDate()}</span>
              <span className="hijri">{hijriDay(d)}</span>
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

      <div className="day-panel">
        <div className="day-panel-head">
          <h2>{selDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <p className="hijri-today">{hijriFull(selDate)}</p>
        </div>

        <div className="day-section">
          <h3 className="day-section-title">Задачи на день</h3>
          <TasksView tasks={tasks} setTasks={setTasks} fixedDate={selected} />
        </div>

        <div className="day-section">
          <h3 className="day-section-title">Заметки на день</h3>
          <NotesView notes={notes} setNotes={setNotes} fixedDate={selected} />
        </div>
      </div>
    </section>
  );
}
