import { useMemo, useState } from 'react';
import type { CalEvent, Checklist, MoonSighting, Note, Relation } from '../types';
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
import { useLocalStorage } from '../lib/storage';
import { eventsOnDay } from '../lib/recurrence';
import { HEALTH_META, healthCounts, healthOnDay, mealScore } from '../lib/health';
import { ChecklistBoard } from './ChecklistBoard';
import { EventsBoard } from './EventsBoard';
import { HealthBoard } from './HealthBoard';
import { NotesView } from './NotesView';

interface Props {
  notes: Note[];
  checklists: Checklist[];
  events: CalEvent[];
  relations: Relation[];
  ownSightings: MoonSighting[];
  adminSightings: MoonSighting[];
  /** Учитывать ли календарь Tawhiid (уже с учётом роли админа). */
  useAdmin: boolean;
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  setEvents: React.Dispatch<React.SetStateAction<CalEvent[]>>;
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
  mealGap: number;
  setMealGap: React.Dispatch<React.SetStateAction<number>>;
}

export function CalendarView({
  notes,
  checklists,
  events,
  relations,
  ownSightings,
  adminSightings,
  useAdmin,
  setNotes,
  setChecklists,
  setEvents,
  setRelations,
  mealGap,
  setMealGap,
}: Props) {
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<string>(todayKey());
  // Слой «Здоровье» можно снять/наложить; состояние запоминается.
  const [showHealth, setShowHealth] = useLocalStorage<boolean>('ndc.showHealth', true);

  const grid = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  // Данные для каждой ячейки: события (с учётом повторов), списки задач и
  // число заметок — чтобы показывать прямо на календаре, без нажатия.
  const dayData = useMemo(() => {
    const m = new Map<
      string,
      { events: CalEvent[]; lists: Checklist[]; notes: number; health: Note[] }
    >();
    for (const d of grid) {
      const key = dayKey(d);
      const dayEvents = eventsOnDay(events, key);
      const lists = checklists.filter((c) => !c.deleted && (c.date ?? null) === key);
      const health = healthOnDay(notes, key);
      // «Обычные» заметки дня (без записей здоровья) — для точки.
      const noteCount = notes.filter((n) => !n.deleted && !n.health && n.date === key).length;
      if (dayEvents.length || lists.length || noteCount || health.length) {
        m.set(key, { events: dayEvents, lists, notes: noteCount, health });
      }
    }
    return m;
  }, [grid, checklists, events, notes]);

  const MAX_CHIPS = 3;

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

        <div className="cal-layers">
          <button
            className={`ne-chip ${showHealth ? 'on' : ''}`}
            onClick={() => setShowHealth((v) => !v)}
            title="Показать/скрыть дневник здоровья"
          >
            🩺 Здоровье
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
            const data = dayData.get(key);
            const h = hijriFor(d, ownSightings, adminSightings, useAdmin);
            const shownEvents = data ? data.events.slice(0, MAX_CHIPS) : [];
            const restForTasks = MAX_CHIPS - shownEvents.length;
            const shownLists = data ? data.lists.slice(0, Math.max(0, restForTasks)) : [];
            const total = (data?.events.length ?? 0) + (data?.lists.length ?? 0);
            const more = total - shownEvents.length - shownLists.length;
            // Цвет дня по режиму питания (когда слой здоровья включён).
            const score = showHealth && data ? mealScore(data.health, mealGap) : 'none';
            return (
              <button
                key={key}
                className={[
                  'cal-cell',
                  inMonth ? '' : 'out',
                  isToday ? 'today' : '',
                  isSel ? 'sel' : '',
                  score !== 'none' ? `score-${score}` : '',
                ].join(' ')}
                onClick={() => setSelected(key)}
              >
                <span className="cal-cell-head">
                  <span className="greg">{d.getDate()}</span>
                  <span className={`hijri ${h.certain ? '' : 'approx'}`}>{h.day}</span>
                </span>
                {data && (
                  <span className="cell-items">
                    {showHealth && data.health.length > 0 && (
                      <span className="ci ci-health" title="Дневник здоровья">
                        {(() => {
                          const c = healthCounts(data.health);
                          return (
                            <>
                              {c.meal > 0 && <span>{HEALTH_META.meal.icon}{c.meal}</span>}
                              {c.med > 0 && <span>{HEALTH_META.med.icon}{c.med}</span>}
                              {c.other > 0 && <span>{HEALTH_META.other.icon}{c.other}</span>}
                            </>
                          );
                        })()}
                      </span>
                    )}
                    {shownEvents.map((ev) => (
                      <span key={ev.id} className="ci ci-event" title={ev.title}>
                        {ev.start ? <b>{ev.start}</b> : null} {ev.title}
                      </span>
                    ))}
                    {shownLists.map((c) => {
                      const done = c.items.filter((it) => it.done).length;
                      return (
                        <span key={c.id} className="ci ci-task" title={c.title || 'Задачи'}>
                          {c.title || 'Задачи'}
                          {c.items.length > 0 && (
                            <span className="ci-num">
                              {done}/{c.items.length}
                            </span>
                          )}
                        </span>
                      );
                    })}
                    {more > 0 && <span className="ci-more">+{more}</span>}
                    {data.notes > 0 && <i className="dot dot-note" title="Заметки" />}
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

        {showHealth && (
          <div className="day-section">
            <h3 className="day-section-title">🩺 Здоровье</h3>
            <HealthBoard
              date={selected}
              notes={notes}
              setNotes={setNotes}
              relations={relations}
              setRelations={setRelations}
              gapHours={mealGap}
              setGapHours={setMealGap}
            />
          </div>
        )}

        <div className="day-section">
          <h3 className="day-section-title">События</h3>
          <EventsBoard date={selected} events={events} setEvents={setEvents} notes={notes} />
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
