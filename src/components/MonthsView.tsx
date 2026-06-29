import { useMemo, useState } from 'react';
import type { MoonSighting, SightingMethod } from '../types';
import {
  HIJRI_MONTHS,
  fromKey,
  gregLong,
  hijriParts,
  sightingMethodLabel,
  todayKey,
} from '../lib/dates';
import { uid, useListActions } from '../lib/storage';
import { CALENDAR_BRAND } from '../lib/firebase';

interface Props {
  /** Набор, который пользователь редактирует (личный или, для админа, Tawhiid). */
  editSightings: MoonSighting[];
  setEditSightings: React.Dispatch<React.SetStateAction<MoonSighting[]>>;
  /** Официальный календарь Tawhiid (для показа обычному пользователю). */
  adminSightings: MoonSighting[];
  isAdmin: boolean;
  useAdmin: boolean;
  setUseAdmin: React.Dispatch<React.SetStateAction<boolean>>;
}

export function MonthsView({
  editSightings,
  setEditSightings,
  adminSightings,
  isAdmin,
  useAdmin,
  setUseAdmin,
}: Props) {
  return (
    <section className="view view-narrow">
      <div className="view-head">
        <h2>Месяцы</h2>
        <span className="muted">хиджра</span>
      </div>

      {isAdmin ? (
        <p className="banner">
          🛡 Вы ведёте календарь <b>{CALENDAR_BRAND}</b> — его видят все пользователи.
        </p>
      ) : (
        <label className="toggle">
          <input
            type="checkbox"
            checked={useAdmin}
            onChange={(e) => setUseAdmin(e.target.checked)}
            disabled={adminSightings.length === 0}
          />
          Использовать календарь {CALENDAR_BRAND}
          {adminSightings.length === 0 && <span className="muted small"> (пока нет данных)</span>}
        </label>
      )}

      <Editor
        title={isAdmin ? `Начала месяцев — ${CALENDAR_BRAND}` : 'Мои наблюдения'}
        sightings={editSightings}
        setSightings={setEditSightings}
      />

      {!isAdmin && adminSightings.length > 0 && (
        <div className="months-readonly">
          <h3 className="day-section-title">Календарь {CALENDAR_BRAND}</h3>
          <SightingList sightings={adminSightings} />
        </div>
      )}
    </section>
  );
}

/** Список фиксаций с формой добавления/редактирования. */
function Editor({
  title,
  sightings,
  setSightings,
}: {
  title: string;
  sightings: MoonSighting[];
  setSightings: React.Dispatch<React.SetStateAction<MoonSighting[]>>;
}) {
  const { add, update, remove } = useListActions(setSightings);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(todayKey());
  const [method, setMethod] = useState<SightingMethod>('sighting');
  const [hijriMonth, setHijriMonth] = useState(1);
  const [hijriYear, setHijriYear] = useState(1447);
  const [note, setNote] = useState('');

  const sorted = useMemo(
    () => [...sightings].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [sightings],
  );

  function fillFromDate(key: string) {
    const c = hijriParts(fromKey(key));
    setHijriMonth(c.month);
    setHijriYear(c.year);
  }

  function startAdd() {
    const today = todayKey();
    setEditId(null);
    setStartDate(today);
    setMethod('sighting');
    fillFromDate(today);
    setNote('');
    setOpen(true);
  }

  function startEdit(s: MoonSighting) {
    setEditId(s.id);
    setStartDate(s.startDate);
    setMethod(s.method ?? 'sighting');
    setHijriMonth(s.hijriMonth);
    setHijriYear(s.hijriYear);
    setNote(s.note ?? '');
    setOpen(true);
  }

  function save() {
    if (editId) {
      update(editId, { startDate, hijriMonth, hijriYear, method, note: note.trim() });
    } else {
      const now = Date.now();
      add({
        id: uid(),
        startDate,
        hijriMonth,
        hijriYear,
        method,
        note: note.trim(),
        createdAt: now,
        updatedAt: now,
      });
    }
    setOpen(false);
  }

  return (
    <div className="months">
      <div className="view-head">
        <h3 className="day-section-title">{title}</h3>
        {!open && (
          <button className="btn btn-small btn-primary" onClick={startAdd}>
            ＋ Начало месяца
          </button>
        )}
      </div>

      {open && (
        <div className="month-form">
          <label className="field">
            <span className="field-label">Дата 1-го числа (григорианская)</span>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                fillFromDate(e.target.value);
              }}
            />
          </label>

          <div className="moon-form-methods">
            <label className="radio">
              <input
                type="radio"
                checked={method === 'sighting'}
                onChange={() => setMethod('sighting')}
              />
              🌙 По наблюдению
            </label>
            <label className="radio">
              <input type="radio" checked={method === 'count'} onChange={() => setMethod('count')} />
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
              {editId ? 'Сохранить' : 'Добавить'}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      <SightingList sightings={sorted} onEdit={startEdit} onRemove={remove} />
    </div>
  );
}

/** Список фиксаций. Если переданы onEdit/onRemove — с кнопками управления. */
function SightingList({
  sightings,
  onEdit,
  onRemove,
}: {
  sightings: MoonSighting[];
  onEdit?: (s: MoonSighting) => void;
  onRemove?: (id: string) => void;
}) {
  const sorted = useMemo(
    () => [...sightings].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [sightings],
  );

  if (sorted.length === 0) {
    return <p className="empty">Пока нет начал месяцев</p>;
  }

  return (
    <ul className="month-list">
      {sorted.map((s) => (
        <li key={s.id} className="month-item">
          <div className="month-item-body">
            <span className="month-item-title">
              {HIJRI_MONTHS[s.hijriMonth - 1]} {s.hijriYear}
            </span>
            <span className="muted small">
              1-е число: {gregLong(s.startDate)} · {s.method === 'count' ? '🌑' : '🌙'}{' '}
              {sightingMethodLabel(s.method)}
            </span>
            {s.note && <span className="muted small month-item-note">«{s.note}»</span>}
          </div>
          {(onEdit || onRemove) && (
            <div className="month-item-actions">
              {onEdit && (
                <button className="icon-btn" onClick={() => onEdit(s)} aria-label="Изменить">
                  ✎
                </button>
              )}
              {onRemove && (
                <button className="icon-btn" onClick={() => onRemove(s.id)} aria-label="Удалить">
                  ✕
                </button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
