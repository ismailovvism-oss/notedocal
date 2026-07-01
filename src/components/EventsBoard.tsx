import { useMemo, useState } from 'react';
import type { CalEvent } from '../types';
import { uid, useListActions } from '../lib/storage';

interface Props {
  date: string;
  events: CalEvent[];
  setEvents: React.Dispatch<React.SetStateAction<CalEvent[]>>;
}

export function EventsBoard({ date, events, setEvents }: Props) {
  const { add, update, remove } = useListActions(setEvents);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [desc, setDesc] = useState('');

  const list = useMemo(
    () =>
      events
        .filter((e) => e.date === date)
        .sort((a, b) => ((a.start || '99:99') < (b.start || '99:99') ? -1 : 1)),
    [events, date],
  );

  function reset() {
    setTitle('');
    setStart('');
    setEnd('');
    setDesc('');
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
    setOpen(true);
  }
  function save() {
    const patch = { title: title.trim() || 'Событие', start, end, desc: desc.trim() };
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
                <span className="ev-title">{e.title}</span>
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
