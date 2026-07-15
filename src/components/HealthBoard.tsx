import { useMemo, useState } from 'react';
import type { HealthKind, Note, Relation } from '../types';
import { uid, useListActions } from '../lib/storage';
import { HEALTH_FOLDER_ID, HEALTH_KINDS, HEALTH_META, healthOnDay } from '../lib/health';
import { NoteModal } from './NotesView';

interface Props {
  date: string;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
}

function nowTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function HealthBoard({ date, notes, setNotes, relations, setRelations }: Props) {
  const notesActions = useListActions(setNotes);
  const relActions = useListActions(setRelations);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [kind, setKind] = useState<HealthKind>('meal');
  const [time, setTime] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  // Открытая заметка-запись в полном окне (фото, подробное описание).
  const [modalId, setModalId] = useState<string | null>(null);

  const list = useMemo(() => healthOnDay(notes, date), [notes, date]);
  const modalNote = modalId ? notes.find((n) => n.id === modalId) ?? null : null;

  // Гарантируем существование папки «Здоровье».
  function ensureFolder() {
    if (notes.some((n) => n.id === HEALTH_FOLDER_ID)) return;
    const now = Date.now();
    notesActions.add({
      id: HEALTH_FOLDER_ID,
      title: 'Здоровье',
      body: '',
      type: 'folder',
      date: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  function startAdd(k: HealthKind) {
    setEditId(null);
    setKind(k);
    setTime(nowTime());
    setTitle('');
    setDesc('');
    setOpen(true);
  }
  function startEdit(n: Note) {
    setEditId(n.id);
    setKind(n.health ?? 'other');
    setTime(n.time ?? '');
    setTitle(n.title);
    setDesc(n.body);
    setOpen(true);
  }
  function save() {
    const now = Date.now();
    const patch = {
      health: kind,
      time,
      title: title.trim() || HEALTH_META[kind].label,
      body: desc,
    };
    if (editId) {
      notesActions.update(editId, { ...patch, updatedAt: now });
    } else {
      ensureFolder();
      const id = uid();
      notesActions.add({ id, type: 'note', date, createdAt: now, updatedAt: now, ...patch });
      relActions.add({
        id: uid(),
        from: HEALTH_FOLDER_ID,
        to: id,
        type: 'child',
        position: list.length,
        createdAt: now,
        updatedAt: now,
      });
    }
    setOpen(false);
  }

  const descPlaceholder = kind === 'med' ? 'Доза, заметка…' : kind === 'meal' ? 'Что съел…' : 'Заметка…';
  const titlePlaceholder =
    kind === 'med' ? 'Название препарата' : kind === 'meal' ? 'Завтрак / обед / перекус…' : 'Название';

  return (
    <div className="hl-board">
      {list.length > 0 && (
        <ul className="hl-list">
          {list.map((n) => {
            const meta = HEALTH_META[n.health ?? 'other'];
            return (
              <li key={n.id} className={`hl-item hl-${n.health}`}>
                <span className="hl-ic" title={meta.label}>
                  {meta.icon}
                </span>
                <div className="hl-body">
                  <span className="hl-title">
                    {n.time && <b className="hl-time">{n.time}</b>} {n.title}
                  </span>
                  {n.body && <span className="muted small hl-desc">{n.body}</span>}
                  {n.attachments && n.attachments.length > 0 && (
                    <span className="muted small hl-clip">📎 {n.attachments.length}</span>
                  )}
                </div>
                <button className="icon-btn" onClick={() => startEdit(n)} aria-label="Изменить">
                  ✎
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setModalId(n.id)}
                  title="Фото и подробности"
                  aria-label="Открыть заметку"
                >
                  📷
                </button>
                <button className="icon-btn" onClick={() => notesActions.remove(n.id)} aria-label="Удалить">
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <div className="hl-form">
          <div className="hl-kinds" role="group" aria-label="Вид записи">
            {HEALTH_KINDS.map((k) => (
              <button
                key={k}
                className={`hl-kind ${kind === k ? 'active' : ''}`}
                onClick={() => setKind(k)}
              >
                {HEALTH_META[k].icon} {HEALTH_META[k].label}
              </button>
            ))}
          </div>
          <div className="ev-form-row">
            <input
              className="input"
              placeholder={titlePlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <label className="field hl-time-field">
              <span className="field-label">Время</span>
              <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <textarea
            className="input"
            rows={2}
            placeholder={descPlaceholder}
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
        <div className="hl-add">
          {HEALTH_KINDS.map((k) => (
            <button key={k} className="btn btn-small" onClick={() => startAdd(k)}>
              {HEALTH_META[k].icon} {HEALTH_META[k].label}
            </button>
          ))}
        </div>
      )}

      {modalNote && (
        <NoteModal
          note={modalNote}
          fixedDate={date}
          allNotes={notes}
          relations={relations}
          setRelations={setRelations}
          onSave={(patch) => notesActions.update(modalNote.id, { ...patch, updatedAt: Date.now() })}
          onDelete={() => {
            notesActions.remove(modalNote.id);
            setModalId(null);
          }}
          onClose={() => setModalId(null)}
        />
      )}
    </div>
  );
}
