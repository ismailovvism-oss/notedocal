import { useMemo, useState } from 'react';
import type { Checklist, ChecklistItem, Note } from '../types';
import { uid, useListActions, useLocalStorage } from '../lib/storage';

interface Props {
  /** День (YYYY-MM-DD) или null для общих (недатированных) списков. */
  date: string | null;
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  /** Заметки — чтобы прицеплять их к пунктам. */
  notes: Note[];
}

export function ChecklistBoard({ date, checklists, setChecklists, notes }: Props) {
  const { add, update, remove } = useListActions(setChecklists);
  const [cols, setCols] = useLocalStorage<number>('ndc.cols', 1);

  const lists = useMemo(
    () =>
      checklists
        .filter((c) => (c.date ?? null) === date)
        .sort((a, b) => a.createdAt - b.createdAt),
    [checklists, date],
  );

  function addList() {
    const now = Date.now();
    add({ id: uid(), title: '', date, items: [], createdAt: now, updatedAt: now });
  }

  return (
    <div className="cl-board">
      <div className="cl-board-head">
        <button className="btn btn-small" onClick={addList}>
          ＋ Список
        </button>
        {lists.length > 1 && (
          <div className="cl-cols" role="group" aria-label="Колонки">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                className={`cl-col-btn ${cols === n ? 'active' : ''}`}
                onClick={() => setCols(n)}
                aria-label={`${n} колонк(и)`}
              >
                {n}
              </button>
            ))}
          </div>
        )}
      </div>

      {lists.length === 0 ? (
        <p className="cl-empty muted small">Списков пока нет — добавьте первый.</p>
      ) : (
        <div className="cl-grid" style={{ ['--cols' as string]: cols }}>
          {lists.map((c) => (
            <ChecklistCard key={c.id} list={c} notes={notes} update={update} remove={remove} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChecklistCard({
  list,
  notes,
  update,
  remove,
}: {
  list: Checklist;
  notes: Note[];
  update: (id: string, patch: Partial<Checklist>) => void;
  remove: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [subFor, setSubFor] = useState<string | null>(null);
  const [subDraft, setSubDraft] = useState('');
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [descFor, setDescFor] = useState<string | null>(null);

  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const setItems = (items: ChecklistItem[]) => update(list.id, { items });
  const mapItem = (id: string, fn: (it: ChecklistItem) => ChecklistItem) =>
    setItems(list.items.map((it) => (it.id === id ? fn(it) : it)));

  const toggle = (id: string) => mapItem(id, (it) => ({ ...it, done: !it.done }));
  const editText = (id: string, text: string) => mapItem(id, (it) => ({ ...it, text }));
  const removeItem = (id: string) => setItems(list.items.filter((it) => it.id !== id));
  const attachNote = (id: string, noteId: string) => mapItem(id, (it) => ({ ...it, noteId }));
  const detachNote = (id: string) => mapItem(id, (it) => ({ ...it, noteId: null }));
  const editDesc = (id: string, desc: string) => mapItem(id, (it) => ({ ...it, desc }));

  const toggleSub = (id: string, sid: string) =>
    mapItem(id, (it) => ({
      ...it,
      subitems: (it.subitems ?? []).map((s) => (s.id === sid ? { ...s, done: !s.done } : s)),
    }));
  const editSub = (id: string, sid: string, text: string) =>
    mapItem(id, (it) => ({
      ...it,
      subitems: (it.subitems ?? []).map((s) => (s.id === sid ? { ...s, text } : s)),
    }));
  const removeSub = (id: string, sid: string) =>
    mapItem(id, (it) => ({ ...it, subitems: (it.subitems ?? []).filter((s) => s.id !== sid) }));

  function addItem(e: React.FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    setItems([...list.items, { id: uid(), text: t, done: false }]);
    setDraft('');
  }

  function addSub(e: React.FormEvent, id: string) {
    e.preventDefault();
    const t = subDraft.trim();
    if (!t) return;
    mapItem(id, (it) => ({
      ...it,
      subitems: [...(it.subitems ?? []), { id: uid(), text: t, done: false }],
    }));
    setSubDraft('');
  }

  const total = list.items.length;
  const done = list.items.filter((it) => it.done).length;

  return (
    <div className="cl-card">
      <div className="cl-card-head">
        <input
          className="cl-title"
          placeholder="Название списка"
          value={list.title}
          onChange={(e) => update(list.id, { title: e.target.value })}
        />
        {total > 0 && (
          <span className="cl-count muted small">
            {done}/{total}
          </span>
        )}
        <button className="icon-btn cl-del-list" onClick={() => remove(list.id)} aria-label="Удалить список">
          ✕
        </button>
      </div>

      <ul className="cl-items">
        {list.items.map((it) => {
          const note = it.noteId ? noteById.get(it.noteId) : undefined;
          return (
            <li key={it.id} className={`cl-item ${it.done ? 'done' : ''}`}>
              <div className="cl-item-row">
                <button className="cl-check" onClick={() => toggle(it.id)} aria-label="Отметить">
                  {it.done ? '✓' : ''}
                </button>
                <input
                  className="cl-item-text"
                  value={it.text}
                  onChange={(e) => editText(it.id, e.target.value)}
                />
                <button
                  className="icon-btn cl-act"
                  onClick={() => {
                    setSubFor(subFor === it.id ? null : it.id);
                    setSubDraft('');
                  }}
                  title="Подзадача"
                  aria-label="Добавить подзадачу"
                >
                  ＋
                </button>
                <button
                  className="icon-btn cl-act"
                  onClick={() => setDescFor(descFor === it.id ? null : it.id)}
                  title="Описание"
                  aria-label="Описание"
                >
                  ≡
                </button>
                <button
                  className="icon-btn cl-act"
                  onClick={() => setAttachFor(attachFor === it.id ? null : it.id)}
                  title="Прицепить заметку"
                  aria-label="Прицепить заметку"
                >
                  📎
                </button>
                <button className="icon-btn cl-del" onClick={() => removeItem(it.id)} aria-label="Удалить пункт">
                  ✕
                </button>
              </div>

              {descFor === it.id ? (
                <textarea
                  className="input cl-desc-edit"
                  placeholder="Описание…"
                  value={it.desc ?? ''}
                  onChange={(e) => editDesc(it.id, e.target.value)}
                  rows={2}
                  autoFocus
                />
              ) : (
                it.desc && (
                  <p className="cl-desc" onClick={() => setDescFor(it.id)}>
                    {it.desc}
                  </p>
                )
              )}

              {attachFor === it.id && (
                <select
                  className="input cl-note-select"
                  value={it.noteId ?? ''}
                  onChange={(e) => {
                    if (e.target.value) attachNote(it.id, e.target.value);
                    else detachNote(it.id);
                    setAttachFor(null);
                  }}
                >
                  <option value="">— выбрать заметку —</option>
                  {notes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title || 'Без названия'}
                    </option>
                  ))}
                </select>
              )}

              {note && (
                <div className="cl-note">
                  <button className="cl-note-chip" onClick={() => setOpenNote(openNote === it.id ? null : it.id)}>
                    📄 {note.title || 'Без названия'}
                  </button>
                  <button className="icon-btn cl-note-detach" onClick={() => detachNote(it.id)} aria-label="Открепить">
                    ✕
                  </button>
                  {openNote === it.id && note.body && <p className="cl-note-body">{note.body}</p>}
                </div>
              )}

              {(it.subitems?.length ?? 0) > 0 && (
                <ul className="cl-subitems">
                  {it.subitems!.map((s) => (
                    <li key={s.id} className={`cl-item cl-subitem ${s.done ? 'done' : ''}`}>
                      <div className="cl-item-row">
                        <button className="cl-check" onClick={() => toggleSub(it.id, s.id)} aria-label="Отметить">
                          {s.done ? '✓' : ''}
                        </button>
                        <input
                          className="cl-item-text"
                          value={s.text}
                          onChange={(e) => editSub(it.id, s.id, e.target.value)}
                        />
                        <button
                          className="icon-btn cl-del"
                          onClick={() => removeSub(it.id, s.id)}
                          aria-label="Удалить подзадачу"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {subFor === it.id && (
                <form className="cl-subadd" onSubmit={(e) => addSub(e, it.id)}>
                  <input
                    className="cl-add-input"
                    placeholder="+ подзадача"
                    value={subDraft}
                    onChange={(e) => setSubDraft(e.target.value)}
                    autoFocus
                  />
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <form className="cl-add" onSubmit={addItem}>
        <input
          className="cl-add-input"
          placeholder="+ пункт"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
    </div>
  );
}
