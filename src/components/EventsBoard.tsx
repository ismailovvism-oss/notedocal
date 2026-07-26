import { useMemo, useState } from 'react';
import type { Attachment, CalEvent, Note, Repeat } from '../types';
import { uid, useListActions } from '../lib/storage';
import { eventsOnDay, repeatLabel } from '../lib/recurrence';
import { listLocations } from '../lib/locations';
import { deleteAttachment } from '../lib/attachments';
import { AttachmentAdder, AttachmentList } from './Attachments';

interface Props {
  date: string;
  events: CalEvent[];
  setEvents: React.Dispatch<React.SetStateAction<CalEvent[]>>;
  notes: Note[];
}

const REPEAT_OPTIONS: Repeat[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

export function EventsBoard({ date, events, setEvents, notes }: Props) {
  const { add, update, remove } = useListActions(setEvents);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [desc, setDesc] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [repeatUntil, setRepeatUntil] = useState('');
  const [locationId, setLocationId] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Вхождения повторов на выбранный день (не только точные совпадения date).
  const list = useMemo(() => eventsOnDay(events, date), [events, date]);
  const locations = useMemo(() => listLocations(notes), [notes]);
  const locName = (id?: string | null) => notes.find((n) => n.id === id)?.title;

  function reset() {
    setTitle('');
    setStart('');
    setEnd('');
    setDesc('');
    setRepeat('none');
    setRepeatUntil('');
    setLocationId('');
    setAttachments([]);
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
    setLocationId(e.locationId ?? '');
    setAttachments(e.attachments ?? []);
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
      locationId: locationId || null,
      attachments,
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
                {locName(e.locationId) && (
                  <span className="muted small ev-loc">📍 {locName(e.locationId)}</span>
                )}
                {e.desc && <span className="muted small ev-desc">{e.desc}</span>}
                {e.attachments && e.attachments.length > 0 && (
                  <AttachmentList items={e.attachments} />
                )}
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
          {locations.length > 0 && (
            <label className="field">
              <span className="field-label">Место</span>
              <select
                className="input"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">— без места —</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title || 'Без названия'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <textarea
            className="input"
            rows={2}
            placeholder="Описание (необязательно)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <AttachmentList
            items={attachments}
            onRemove={(a) => {
              deleteAttachment(a);
              setAttachments((list) => list.filter((x) => x.id !== a.id));
            }}
          />
          <AttachmentAdder onAdd={(added) => setAttachments((list) => [...list, ...added])} />
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
