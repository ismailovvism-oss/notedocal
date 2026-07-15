import { useMemo, useState } from 'react';
import type { CalEvent, Repeat } from '../types';
import { uid, useListActions } from '../lib/storage';
import { eventsOnDay, repeatLabel } from '../lib/recurrence';

interface Props {
  date: string;
  events: CalEvent[];
  setEvents: React.Dispatch<React.SetStateAction<CalEvent[]>>;
}

const REPEAT_OPTIONS: Repeat[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

export function EventsBoard({ date, events, setEvents }: Props) {
  const { add, update, remove } = useListActions(setEvents);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [desc, setDesc] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [repeatUntil, setRepeatUntil] = useState('');

  // Вхождения повторов на выбранный день (не только точные совпадения date).
  const list = useMemo(() => eventsOnDay(events, date), [events, date]);

  function reset() {
    setTitle('');
    setStart('');
    setEnd('');
    setDesc('');
    setRepeat('none');
    setRepeatUntil('');
  }
  function startAdd() {
    setEditId(null);
    reset();
    setOpen(true);
  }
  function startEdit(e: CalEvent) {
    setEditId(e.id);
    setTitle(e.title);
    setStart(e.start ?? '');
    setEnd(e.end ?? '');
    setDesc(e.desc ?? '');
    setRepeat(e.repeat ?? 'none');
    setRepeatUntil(e.repeatUntil ?? '');
    setOpen(true);
  }
  function save() {
    const patch = {
      title: title.trim() || 'Событие',
      start,
      end,
      desc: desc.trim(),
      repeat,
      repeatUntil: repeat === 'none' ? null : repeatUntil || null,
    };
    if (editId) {
      update(editId, patch);
    } else {
      const now = Date.now();
      add({ id: uid(), date, ...patch, createdAt: now, updatedAt: now });
    }
    setOpen(false);
  }

  return (
    <div className="ev-board">
      {list.length > 0 && (
        <ul className="ev-list">
          {list.map((e) => (
            <li key={e.id} className="ev-item">
              <div className="ev-time">
                {e.start || '—'}
                {e.end ? `–${e.end}` : ''}
              </div>
              <div className="ev-body">
                <span className="ev-title">
                  {e.title}
                  {e.repeat && e.repeat !== 'none' && (
                    <span className="ev-repeat" title={repeatLabel(e.repeat)}>
                      ↻
                    </span>
                  )}
                </span>
                {e.desc && <span className="muted small ev-desc">{e.desc}</span>}
              </div>
              <button className="icon-btn" onClick={() => startEdit(e)} aria-label="Изменить">
                ✎
              </button>
              <button className="icon-btn" onClick={() => remove(e.id)} aria-label="Удалить">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="ev-form">
          <input
            className="input"
            placeholder="Название события"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="ev-form-row">
            <label className="field">
              <span className="field-label">Начало</span>
              <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Конец</span>
              <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <div className="ev-form-row">
            <label className="field">
              <span className="field-label">Повтор</span>
              <select
                className="input"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as Repeat)}
              >
                {REPEAT_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {repeatLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            {repeat !== 'none' && (
              <label className="field">
                <span className="field-label">До (необязательно)</span>
                <input
                  className="input"
                  type="date"
                  value={repeatUntil}
                  onChange={(e) => setRepeatUntil(e.target.value)}
                />
              </label>
            )}
          </div>
          <textarea
            className="input"
            rows={2}
            placeholder="Описание (необязательно)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <div className="ev-form-actions">
            <button className="btn btn-primary" onClick={save}>
              {editId ? 'Сохранить' : 'Добавить'}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-small ev-add" onClick={startAdd}>
          ＋ Событие
        </button>
      )}
    </div>
  );
}
