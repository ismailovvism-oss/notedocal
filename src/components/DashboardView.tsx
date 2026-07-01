import { useMemo, useState } from 'react';
import type { CalEvent, Checklist, ChecklistItem, MoonSighting, Note } from '../types';
import { useListActions } from '../lib/storage';
import {
  addDaysKey,
  diffDays,
  formatHijri,
  fromKey,
  hijriFor,
  todayKey,
} from '../lib/dates';

interface Props {
  events: CalEvent[];
  checklists: Checklist[];
  notes: Note[];
  ownSightings: MoonSighting[];
  adminSightings: MoonSighting[];
  useAdmin: boolean;
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
}

interface TaskRef {
  item: ChecklistItem;
  listId: string;
  listTitle: string;
}

function findItem(items: ChecklistItem[], id: string): boolean {
  for (const it of items) {
    if (it.id === id) return true;
    if (it.subitems && findItem(it.subitems, id)) return true;
  }
  return false;
}
function toggleInItems(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.map((it) =>
    it.id === id
      ? { ...it, done: !it.done }
      : { ...it, subitems: it.subitems ? toggleInItems(it.subitems, id) : it.subitems },
  );
}

export function DashboardView({
  events,
  checklists,
  notes,
  ownSightings,
  adminSightings,
  useAdmin,
  setChecklists,
}: Props) {
  const { update } = useListActions(setChecklists);
  const [from, setFrom] = useState(() => todayKey());
  const [to, setTo] = useState(() => addDaysKey(todayKey(), 6));

  function preset(days: number) {
    const t = todayKey();
    setFrom(t);
    setTo(addDaysKey(t, days));
  }

  const days = useMemo(() => {
    const n = diffDays(from, to);
    if (n < 0) return [];
    const arr: string[] = [];
    for (let i = 0; i <= Math.min(n, 366); i++) arr.push(addDaysKey(from, i));
    return arr;
  }, [from, to]);

  // Группировка по дню.
  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      if (!e.date) continue;
      (m.get(e.date) ?? m.set(e.date, []).get(e.date)!).push(e);
    }
    for (const arr of m.values())
      arr.sort((a, b) => ((a.start || '99:99') < (b.start || '99:99') ? -1 : 1));
    return m;
  }, [events]);

  const notesByDay = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of notes) {
      if (!n.date) continue;
      (m.get(n.date) ?? m.set(n.date, []).get(n.date)!).push(n);
    }
    return m;
  }, [notes]);

  const tasksByDay = useMemo(() => {
    const m = new Map<string, TaskRef[]>();
    for (const c of checklists) {
      if (c.deleted) continue;
      for (const it of c.items) {
        const eff = it.date ?? c.date;
        if (!eff) continue;
        (m.get(eff) ?? m.set(eff, []).get(eff)!).push({
          item: it,
          listId: c.id,
          listTitle: c.title || 'Без названия',
        });
      }
    }
    return m;
  }, [checklists]);

  function toggle(ref: TaskRef) {
    const list = checklists.find((c) => c.id === ref.listId);
    if (list && findItem(list.items, ref.item.id)) {
      update(list.id, { items: toggleInItems(list.items, ref.item.id) });
    }
  }

  const activeDays = days.filter(
    (d) => eventsByDay.has(d) || notesByDay.has(d) || tasksByDay.has(d),
  );

  return (
    <section className="view view-narrow">
      <div className="view-head">
        <h2>Обзор</h2>
      </div>

      <div className="db-range">
        <div className="db-presets">
          <button className="btn btn-small" onClick={() => preset(0)}>
            День
          </button>
          <button className="btn btn-small" onClick={() => preset(6)}>
            Неделя
          </button>
          <button className="btn btn-small" onClick={() => preset(29)}>
            Месяц
          </button>
        </div>
        <div className="db-dates">
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted">—</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {activeDays.length === 0 ? (
        <p className="empty">За этот период ничего нет</p>
      ) : (
        <div className="db-days">
          {activeDays.map((d) => {
            const date = fromKey(d);
            const hijri = hijriFor(date, ownSightings, adminSightings, useAdmin);
            const evs = eventsByDay.get(d) ?? [];
            const tks = tasksByDay.get(d) ?? [];
            const nts = notesByDay.get(d) ?? [];
            return (
              <div key={d} className="db-day">
                <div className="db-day-head">
                  <span className="db-day-date">
                    {date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}
                  </span>
                  <span className={`db-day-hijri ${hijri.certain ? '' : 'approx'}`}>
                    {formatHijri(hijri)}
                  </span>
                </div>

                {evs.map((e) => (
                  <div key={e.id} className="db-row db-ev">
                    <span className="db-time">{e.start || '—'}</span>
                    <span className="db-text">{e.title}</span>
                  </div>
                ))}

                {tks.map((t) => (
                  <div key={t.item.id} className={`db-row db-task ${t.item.done ? 'done' : ''}`}>
                    <button className="cl-check" onClick={() => toggle(t)} aria-label="Отметить">
                      {t.item.done ? '✓' : ''}
                    </button>
                    <span className="db-text">{t.item.text || '—'}</span>
                    <span className="db-list muted small">{t.listTitle}</span>
                  </div>
                ))}

                {nts.map((n) => (
                  <div key={n.id} className="db-row db-note">
                    <span className="db-dot" />
                    <span className="db-text">{n.title}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
