import { useMemo, useState } from 'react';
import type { MoonSighting, Note, SightingMethod, Task } from '../types';
import {
  HIJRI_MONTHS,
  type HijriDate,
  WEEKDAYS,
  addDaysKey,
  dayKey,
  formatHijri,
  fromKey,
  gregMonthTitle,
  hijriFor,
  hijriParts,
  hijriSourceLabel,
  monthGrid,
  sightingMethodLabel,
  todayKey,
} from '../lib/dates';
import { uid, useListActions } from '../lib/storage';
import { CALENDAR_BRAND } from '../lib/firebase';
import { TasksView } from './TasksView';
import { NotesView } from './NotesView';

interface Props {
  tasks: Task[];
  notes: Note[];
  /** Личные наблюдения пользователя. */
  ownSightings: MoonSighting[];
  /** Официальный календарь админа (общий). */
  adminSightings: MoonSighting[];
  /** Использовать официальный календарь (предпочтение обычного пользователя). */
  useAdmin: boolean;
  setUseAdmin: React.Dispatch<React.SetStateAction<boolean>>;
  /** Текущий пользователь — администратор. */
  isAdmin: boolean;
  /** Набор, который пользователь редактирует (личный или, для админа, официальный). */
  editSightings: MoonSighting[];
  setEditSightings: React.Dispatch<React.SetStateAction<MoonSighting[]>>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
}

export function CalendarView({
  tasks,
  notes,
  ownSightings,
  adminSightings,
  useAdmin,
  setUseAdmin,
  isAdmin,
  editSightings,
  setEditSightings,
  setTasks,
  setNotes,
}: Props) {
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<string>(todayKey());
  const [moonOpen, setMoonOpen] = useState(false);

  // Админ всегда видит официальный календарь; остальные — по переключателю.
  const effUseAdmin = isAdmin || useAdmin;

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
  const selHijri = hijriFor(selDate, ownSightings, adminSightings, effUseAdmin);
  // 29–30-й день — возможный конец месяца (когда фиксируют начало следующего).
  const monthEnd = selHijri.day >= 29;

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
          const h = hijriFor(d, ownSightings, adminSightings, effUseAdmin);
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

      <div className="day-panel">
        <div className="day-panel-head">
          <h2>{selDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <button
            className={`hijri-chip ${selHijri.certain ? '' : 'approx'}`}
            onClick={() => setMoonOpen((o) => !o)}
            aria-expanded={moonOpen}
          >
            <span>{formatHijri(selHijri)}</span>
            {monthEnd && (
              <span className="moon-badge" title="Возможен конец месяца">
                🌙
              </span>
            )}
            <span className="chev">{moonOpen ? '▴' : '▾'}</span>
          </button>
        </div>

        {moonOpen && (
          <MoonPanel
            selected={selected}
            hijri={selHijri}
            monthEnd={monthEnd}
            editSightings={editSightings}
            setEditSightings={setEditSightings}
            isAdmin={isAdmin}
            useAdmin={useAdmin}
            setUseAdmin={setUseAdmin}
            hasAdminData={adminSightings.length > 0}
          />
        )}

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

/** Дата по-русски: «12 марта 2026». */
function gregLong(key: string): string {
  return fromKey(key).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Блок ввода и управления наблюдениями молодого месяца. */
function MoonPanel({
  selected,
  hijri,
  monthEnd,
  editSightings,
  setEditSightings,
  isAdmin,
  useAdmin,
  setUseAdmin,
  hasAdminData,
}: {
  selected: string;
  hijri: HijriDate;
  monthEnd: boolean;
  editSightings: MoonSighting[];
  setEditSightings: React.Dispatch<React.SetStateAction<MoonSighting[]>>;
  isAdmin: boolean;
  useAdmin: boolean;
  setUseAdmin: React.Dispatch<React.SetStateAction<boolean>>;
  hasAdminData: boolean;
}) {
  const { add, remove } = useListActions(setEditSightings);
  // Выбранный день — последний день месяца → 1-е число нового месяца завтра.
  const startDate = addDaysKey(selected, 1);
  const computed = hijriParts(fromKey(startDate));

  const [open, setOpen] = useState<SightingMethod | null>(null);
  const [hijriMonth, setHijriMonth] = useState(computed.month);
  const [hijriYear, setHijriYear] = useState(computed.year);
  const [note, setNote] = useState('');

  // Уже отмечена фиксация на этот переход?
  const existing = editSightings.find((s) => s.startDate === startDate);

  // Все фиксации по убыванию даты — для списка.
  const sorted = useMemo(
    () => [...editSightings].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [editSightings],
  );

  function openForm(method: SightingMethod) {
    setHijriMonth(computed.month);
    setHijriYear(computed.year);
    setNote('');
    setOpen(method);
  }

  function save() {
    if (!open) return;
    const now = Date.now();
    add({
      id: uid(),
      startDate,
      hijriMonth,
      hijriYear,
      method: open,
      note: note.trim(),
      createdAt: now,
      updatedAt: now,
    });
    setOpen(null);
  }

  return (
    <div className="moon-panel">
      <p className="moon-summary muted small">
        {hijriSourceLabel(hijri)}
        {hijri.anchor && (
          <>
            {' · '}
            {hijri.anchor.method === 'count' ? '🌑' : '🌙'} {sightingMethodLabel(hijri.anchor.method)}
            {hijri.anchor.note ? ` — «${hijri.anchor.note}»` : ''}
          </>
        )}
      </p>

      {isAdmin ? (
        <p className="muted small">
          🛡 Вы редактируете <b>календарь {CALENDAR_BRAND}</b> — его видят все пользователи.
        </p>
      ) : (
        <label className="toggle">
          <input
            type="checkbox"
            checked={useAdmin}
            onChange={(e) => setUseAdmin(e.target.checked)}
            disabled={!hasAdminData}
          />
          Использовать календарь {CALENDAR_BRAND}
          {!hasAdminData && <span className="muted small"> (пока нет данных)</span>}
        </label>
      )}

      {existing ? (
        <p className="muted small">
          ✓ Зафиксировано: с {gregLong(startDate)} идёт {HIJRI_MONTHS[existing.hijriMonth - 1]}{' '}
          {existing.hijriYear} ({existing.method === 'count' ? '🌑' : '🌙'}{' '}
          {sightingMethodLabel(existing.method)}).
        </p>
      ) : open ? (
        <div className="moon-form">
          <p className="muted small">
            {open === 'sighting'
              ? `Молодой месяц виден вечером ${gregLong(selected)}.`
              : `${gregLong(selected)} — последний (30-й) день месяца, молодой месяц не виден.`}{' '}
            1-е число нового месяца — {gregLong(startDate)}.
          </p>
          <div className="moon-form-methods">
            <label className="radio">
              <input
                type="radio"
                checked={open === 'sighting'}
                onChange={() => setOpen('sighting')}
              />
              🌙 Видел молодой месяц
            </label>
            <label className="radio">
              <input type="radio" checked={open === 'count'} onChange={() => setOpen('count')} />
              🌑 Досчёт до 30
            </label>
          </div>
          <div className="moon-form-row">
            <select
              className="input input-select"
              value={hijriMonth}
              onChange={(e) => setHijriMonth(Number(e.target.value))}
            >
              {HIJRI_MONTHS.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <input
              className="input input-year"
              type="number"
              value={hijriYear}
              onChange={(e) => setHijriYear(Number(e.target.value))}
              aria-label="Год хиджры"
            />
          </div>
          <input
            className="input"
            placeholder="Как зафиксировано (необязательно): кто видел, где, по чьему объявлению…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="moon-form-actions">
            <button className="btn btn-primary" onClick={save}>
              Сохранить
            </button>
            <button className="btn" onClick={() => setOpen(null)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="moon-record">
          <p className="muted small">
            {monthEnd
              ? 'Возможно, сегодня последний день месяца — отметьте начало нового:'
              : 'Отметить начало месяца с этого дня:'}
          </p>
          <div className="moon-buttons">
            <button className="btn moon-btn" onClick={() => openForm('sighting')}>
              🌙 Видел молодой месяц вечером этого дня
            </button>
            <button className="btn moon-btn" onClick={() => openForm('count')}>
              🌑 Не видел — этот день 30-й, закрыть месяц
            </button>
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <ul className="moon-list">
          {sorted.map((s) => (
            <li key={s.id} className="moon-item">
              <div className="moon-item-body">
                <span className="moon-item-title">
                  {HIJRI_MONTHS[s.hijriMonth - 1]} {s.hijriYear}
                </span>
                <span className="muted small">
                  1-е число: {gregLong(s.startDate)} · {s.method === 'count' ? '🌑' : '🌙'}{' '}
                  {sightingMethodLabel(s.method)}
                </span>
                {s.note && <span className="muted small moon-item-note">«{s.note}»</span>}
              </div>
              <button className="icon-btn" onClick={() => remove(s.id)} aria-label="Удалить фиксацию">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
