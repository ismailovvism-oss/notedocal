import { useMemo, useState } from 'react';
import type { CalEvent, Checklist, MoonSighting, Note } from '../types';
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
import { EventsBoard } from './EventsBoard';
import { NotesView } from './NotesView';

interface Props {
  notes: Note[];
  checklists: Checklist[];
  events: CalEvent[];
  ownSightings: MoonSighting[];
  adminSightings: MoonSighting[];
  /** Учитывать ли календарь Tawhiid (уже с учётом роли админа). */
  useAdmin: boolean;
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  setEvents: React.Dispatch<React.SetStateAction<CalEvent[]>>;
}

export function CalendarView({
  notes,
  checklists,
  events,
  ownSightings,
  adminSightings,
  useAdmin,
  setNotes,
  setChecklists,
  setEvents,
}: Props) {
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<string>(todayKey());

  const grid = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  // Точки на ячейках: списки задач, события и заметки этого дня.
  const counts = useMemo(() => {
    const m = new Map<string, { tasks: number; notes: number; events: number }>();
    const at = (key: string) => {
      let e = m.get(key);
      if (!e) {
        e = { tasks: 0, notes: 0, events: 0 };
        m.set(key, e);
      }
      return e;
    };
    for (const c of checklists) {
      if (!c.date || c.deleted || c.items.length === 0) continue;
      at(c.date).tasks += 1;
    }
    for (const ev of events) {
      if (!ev.date || ev.deleted) continue;
      at(ev.date).events += 1;
    }
    for (const n of notes) {
      if (!n.date) continue;
      at(n.date).notes += 1;
    }
    return m;
  }, [checklists, events, notes]);

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
                    {c.events > 0 && <i className="dot dot-event" />}
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
          <h3 className="day-section-title">События</h3>
          <EventsBoard date={selected} events={events} setEvents={setEvents} />
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
