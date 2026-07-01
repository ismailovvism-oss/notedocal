import { useMemo, useState } from 'react';
import type { Checklist, MoonSighting, Note } from '../types';
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
import { ChecklistBoard } from './ChecklistBoard';
import { NotesView } from './NotesView';

interface Props {
  notes: Note[];
  checklists: Checklist[];
  ownSightings: MoonSighting[];
  adminSightings: MoonSighting[];
  /** Учитывать ли календарь Tawhiid (уже с учётом роли админа). */
  useAdmin: boolean;
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
}

export function CalendarView({
  notes,
  checklists,
  ownSightings,
  adminSightings,
  useAdmin,
  setNotes,
  setChecklists,
}: Props) {
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<string>(todayKey());

  const grid = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  // Точки на ячейках: списки задач и заметки этого дня.
  const counts = useMemo(() => {
    const m = new Map<string, { tasks: number; notes: number }>();
    for (const c of checklists) {
      if (!c.date || c.deleted || c.items.length === 0) continue;
      const e = m.get(c.date) ?? { tasks: 0, notes: 0 };
      e.tasks += 1;
      m.set(c.date, e);
    }
    for (const n of notes) {
      if (!n.date) continue;
      const e = m.get(n.date) ?? { tasks: 0, notes: 0 };
      e.notes += 1;
      m.set(n.date, e);
    }
    return m;
  }, [checklists, notes]);

  const month = cursor.getMonth();
  const shift = (delta: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));

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
                onClick={() => setSelected(key)}
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

      <aside className="day-side">
        <div className="day-side-head">
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
          <h3 className="day-section-title">Списки задач</h3>
          <ChecklistBoard
            date={selected}
            checklists={checklists}
            setChecklists={setChecklists}
            notes={notes}
          />
        </div>

        <div className="day-section">
          <h3 className="day-section-title">Заметки</h3>
          <NotesView notes={notes} setNotes={setNotes} fixedDate={selected} />
        </div>
      </aside>
    </section>
  );
}
