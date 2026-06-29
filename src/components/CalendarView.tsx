import { useMemo, useState } from 'react';
import type { MoonSighting, Note, Task } from '../types';
import {
  HIJRI_MONTHS,
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
  todayKey,
} from '../lib/dates';
import { uid, useListActions } from '../lib/storage';
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
              <span className={`hijri ${h.source === 'computed' ? 'approx' : ''}`}>{h.day}</span>
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
          <p className={`hijri-today ${selHijri.source === 'computed' ? 'approx' : ''}`}>
            {formatHijri(selHijri)}
            <span className="hijri-hint"> · {hijriSourceLabel(selHijri.source)}</span>
          </p>
        </div>

        <div className="day-section">
          <h3 className="day-section-title">Молодой месяц</h3>
          <MoonPanel
            selected={selected}
            editSightings={editSightings}
            setEditSightings={setEditSightings}
            isAdmin={isAdmin}
            useAdmin={useAdmin}
            setUseAdmin={setUseAdmin}
            hasAdminData={adminSightings.length > 0}
          />
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
  editSightings,
  setEditSightings,
  isAdmin,
  useAdmin,
  setUseAdmin,
  hasAdminData,
}: {
  selected: string;
  editSightings: MoonSighting[];
  setEditSightings: React.Dispatch<React.SetStateAction<MoonSighting[]>>;
  isAdmin: boolean;
  useAdmin: boolean;
  setUseAdmin: React.Dispatch<React.SetStateAction<boolean>>;
  hasAdminData: boolean;
}) {
  const { add, remove } = useListActions(setEditSightings);
  // Вечером выбранного дня видим молодой месяц → 1-е число завтра.
  const startDate = addDaysKey(selected, 1);
  const computed = hijriParts(fromKey(startDate));

  const [open, setOpen] = useState(false);
  const [hijriMonth, setHijriMonth] = useState(computed.month);
  const [hijriYear, setHijriYear] = useState(computed.year);

  // Уже отмечено наблюдение на этот вечер?
  const existing = editSightings.find((s) => s.startDate === startDate);

  // Все наблюдения по убыванию даты — для списка.
  const sorted = useMemo(
    () => [...editSightings].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [editSightings],
  );

  function openForm() {
    setHijriMonth(computed.month);
    setHijriYear(computed.year);
    setOpen(true);
  }

  function save() {
    const now = Date.now();
    add({
      id: uid(),
      startDate,
      hijriMonth,
      hijriYear,
      note: '',
      createdAt: now,
      updatedAt: now,
    });
    setOpen(false);
  }

  return (
    <div className="moon-panel">
      {isAdmin ? (
        <p className="muted small">
          🛡 Вы редактируете <b>официальный календарь</b> — его видят все пользователи.
        </p>
      ) : (
        <label className="toggle">
          <input
            type="checkbox"
            checked={useAdmin}
            onChange={(e) => setUseAdmin(e.target.checked)}
            disabled={!hasAdminData}
          />
          Использовать официальный календарь
          {!hasAdminData && <span className="muted small"> (пока нет данных)</span>}
        </label>
      )}

      {existing ? (
        <p className="muted small">
          ✓ Отмечено: молодой месяц виден вечером этого дня — с {gregLong(startDate)} идёт{' '}
          {HIJRI_MONTHS[existing.hijriMonth - 1]} {existing.hijriYear}.
        </p>
      ) : open ? (
        <div className="moon-form">
          <p className="muted small">
            Молодой месяц виден вечером {gregLong(selected)}. 1-е число нового месяца —{' '}
            {gregLong(startDate)}. Какой это месяц?
          </p>
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
          <div className="moon-form-actions">
            <button className="btn btn-primary" onClick={save}>
              Сохранить
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button className="btn moon-btn" onClick={openForm}>
          🌙 Видел молодой месяц вечером этого дня
        </button>
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
                  1-е число: {gregLong(s.startDate)} · наблюдение вечером{' '}
                  {gregLong(addDaysKey(s.startDate, -1))}
                </span>
              </div>
              <button className="icon-btn" onClick={() => remove(s.id)} aria-label="Удалить наблюдение">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
