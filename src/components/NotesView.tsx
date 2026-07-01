import { useMemo, useRef, useState } from 'react';
import type { Note } from '../types';
import { uid, useListActions } from '../lib/storage';
import { fromKey } from '../lib/dates';
import { renderMarkdown } from '../lib/markdown';

interface Props {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  fixedDate?: string;
}

export function NotesView({ notes, setNotes, fixedDate }: Props) {
  const { add, update, remove } = useListActions(setNotes);
  // null — закрыто, 'new' — новая заметка, иначе редактируемая.
  const [editing, setEditing] = useState<Note | 'new' | null>(null);

  const list = useMemo(() => {
    const base = fixedDate ? notes.filter((n) => n.date === fixedDate) : notes;
    return [...base].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, fixedDate]);

  function save(patch: Pick<Note, 'title' | 'body' | 'date'>) {
    const now = Date.now();
    if (editing && editing !== 'new') {
      update(editing.id, { ...patch, updatedAt: now });
    } else {
      add({
        id: uid(),
        title: patch.title || 'Без названия',
        body: patch.body,
        date: fixedDate ?? patch.date ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
    setEditing(null);
  }

  return (
    <section className="view">
      {!fixedDate && (
        <div className="view-head">
          <h2>Заметки</h2>
          <button className="btn btn-small btn-primary" onClick={() => setEditing('new')}>
            ＋ Заметка
          </button>
        </div>
      )}
      {fixedDate && (
        <button className="btn btn-small ev-add" onClick={() => setEditing('new')}>
          ＋ Заметка
        </button>
      )}

      <ul className="list notes-grid">
        {list.length === 0 && <li className="empty">Заметок пока нет</li>}
        {list.map((n) => (
          <li key={n.id} className="note-card" onClick={() => setEditing(n)}>
            <div className="note-head">
              <h3>{n.title}</h3>
              <button
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(n.id);
                }}
                aria-label="Удалить"
              >
                ✕
              </button>
            </div>
            {n.body && (
              <div className="md note-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(n.body) }} />
            )}
            <div className="note-foot">
              {n.date && <span className="chip">{fromKey(n.date).toLocaleDateString('ru-RU')}</span>}
              <span className="muted small">{relTime(n.updatedAt)}</span>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <NoteModal
          note={editing === 'new' ? null : editing}
          fixedDate={fixedDate}
          onSave={save}
          onDelete={
            editing !== 'new'
              ? () => {
                  remove(editing.id);
                  setEditing(null);
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function NoteModal({
  note,
  fixedDate,
  onSave,
  onDelete,
  onClose,
}: {
  note: Note | null;
  fixedDate?: string;
  onSave: (patch: Pick<Note, 'title' | 'body' | 'date'>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [date, setDate] = useState(note?.date ?? '');
  const [preview, setPreview] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function surround(before: string, after = before) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = body.slice(s, e);
    const next = body.slice(0, s) + before + sel + after + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  }

  function linePrefix(prefix: string) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = body.lastIndexOf('\n', s - 1) + 1;
    const next = body.slice(0, lineStart) + prefix + body.slice(lineStart);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + prefix.length, s + prefix.length);
    });
  }

  function insertCallout() {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = body.slice(s, e) || 'текст';
    const block = `> [!note] Заметка\n> ${sel}\n`;
    const next = body.slice(0, s) + block + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => ta.focus());
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-note" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="md-tabs">
            <button className={`md-tab ${!preview ? 'active' : ''}`} onClick={() => setPreview(false)}>
              Текст
            </button>
            <button className={`md-tab ${preview ? 'active' : ''}`} onClick={() => setPreview(true)}>
              Просмотр
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <input
          className="input modal-title"
          placeholder="Заголовок"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {!preview ? (
          <>
            <div className="md-toolbar">
              <button className="md-btn" title="Жирный" onClick={() => surround('**')}>
                <b>Ж</b>
              </button>
              <button className="md-btn" title="Курсив" onClick={() => surround('*')}>
                <i>К</i>
              </button>
              <button className="md-btn" title="Подчёркнутый" onClick={() => surround('<u>', '</u>')}>
                <u>Ч</u>
              </button>
              <button className="md-btn" title="Зачёркнутый" onClick={() => surround('~~')}>
                <s>З</s>
              </button>
              <span className="md-sep" />
              <button className="md-btn" title="Заголовок" onClick={() => linePrefix('## ')}>
                H
              </button>
              <button className="md-btn" title="Список" onClick={() => linePrefix('- ')}>
                •
              </button>
              <button className="md-btn" title="Нумерованный" onClick={() => linePrefix('1. ')}>
                1.
              </button>
              <button className="md-btn" title="Цитата" onClick={() => linePrefix('> ')}>
                ❝
              </button>
              <button className="md-btn" title="Коллаут" onClick={insertCallout}>
                💡
              </button>
              <button className="md-btn" title="Код" onClick={() => surround('`')}>
                {'</>'}
              </button>
            </div>
            <textarea
              ref={taRef}
              className="input md-editor"
              placeholder="Текст заметки (Markdown)…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </>
        ) : (
          <div className="md md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        )}

        {!fixedDate && (
          <label className="field">
            <span className="field-label">Дата</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}

        <div className="modal-foot modal-foot-split">
          {onDelete ? (
            <button className="btn cl-danger" onClick={onDelete}>
              Удалить
            </button>
          ) : (
            <span />
          )}
          <button
            className="btn btn-primary"
            onClick={() => onSave({ title: title.trim() || 'Без названия', body, date: date || null })}
          >
            Сохранить
          </button>
        </div>
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
