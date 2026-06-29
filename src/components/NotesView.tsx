import { useMemo, useState } from 'react';
import type { Note } from '../types';
import { uid, useListActions } from '../lib/storage';
import { fromKey } from '../lib/dates';

interface Props {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  fixedDate?: string;
}

export function NotesView({ notes, setNotes, fixedDate }: Props) {
  const { add, update, remove } = useListActions(setNotes);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const list = useMemo(() => {
    const base = fixedDate ? notes.filter((n) => n.date === fixedDate) : notes;
    return [...base].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, fixedDate]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const b = body.trim();
    if (!t && !b) return;
    const now = Date.now();
    add({
      id: uid(),
      title: t || 'Без названия',
      body: b,
      date: fixedDate ?? null,
      createdAt: now,
      updatedAt: now,
    });
    setTitle('');
    setBody('');
  }

  return (
    <section className="view">
      {!fixedDate && (
        <div className="view-head">
          <h2>Заметки</h2>
          <span className="muted">{notes.length}</span>
        </div>
      )}

      <form className="note-form" onSubmit={submit}>
        <input
          className="input"
          placeholder="Заголовок"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="input textarea"
          placeholder="Текст заметки…"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">
          Сохранить заметку
        </button>
      </form>

      <ul className="list notes-grid">
        {list.length === 0 && <li className="empty">Заметок пока нет</li>}
        {list.map((n) => (
          <li key={n.id} className="note-card">
            {editing === n.id ? (
              <NoteEditor
                note={n}
                onSave={(patch) => {
                  update(n.id, { ...patch, updatedAt: Date.now() });
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <div className="note-head">
                  <h3>{n.title}</h3>
                  <div className="note-actions">
                    <button className="icon-btn" onClick={() => setEditing(n.id)} aria-label="Изменить">
                      ✎
                    </button>
                    <button className="icon-btn" onClick={() => remove(n.id)} aria-label="Удалить">
                      ✕
                    </button>
                  </div>
                </div>
                {n.body && <p className="note-body">{n.body}</p>}
                <div className="note-foot">
                  {n.date && <span className="chip">{fromKey(n.date).toLocaleDateString('ru-RU')}</span>}
                  <span className="muted small">{relTime(n.updatedAt)}</span>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NoteEditor({
  note,
  onSave,
  onCancel,
}: {
  note: Note;
  onSave: (patch: Partial<Note>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  return (
    <div className="note-editor">
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        className="input textarea"
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="note-actions">
        <button className="btn btn-primary" onClick={() => onSave({ title: title.trim() || 'Без названия', body: body.trim() })}>
          Сохранить
        </button>
        <button className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  return new Date(ts).toLocaleDateString('ru-RU');
}
