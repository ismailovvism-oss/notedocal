import { useMemo, useState } from 'react';
import type { Checklist, ChecklistItem, Note } from '../types';
import { uid, useListActions, useLocalStorage } from '../lib/storage';

interface Props {
  /** День (YYYY-MM-DD) или null для общих (недатированных) списков. */
  date: string | null;
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  notes: Note[];
}

// ---- Операции над деревом задач (по уникальному id) ----
const newItem = (text: string): ChecklistItem => ({ id: uid(), text, done: false });

function treeUpdate(
  items: ChecklistItem[],
  id: string,
  fn: (it: ChecklistItem) => ChecklistItem,
): ChecklistItem[] {
  return items.map((it) =>
    it.id === id
      ? fn(it)
      : { ...it, subitems: it.subitems ? treeUpdate(it.subitems, id, fn) : it.subitems },
  );
}
function treeRemove(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items
    .filter((it) => it.id !== id)
    .map((it) => ({ ...it, subitems: it.subitems ? treeRemove(it.subitems, id) : it.subitems }));
}
function treeFind(items: ChecklistItem[], id: string): ChecklistItem | undefined {
  for (const it of items) {
    if (it.id === id) return it;
    if (it.subitems) {
      const f = treeFind(it.subitems, id);
      if (f) return f;
    }
  }
  return undefined;
}

export interface ItemOps {
  toggle: (id: string) => void;
  setField: (id: string, patch: Partial<ChecklistItem>) => void;
  remove: (id: string) => void;
  addChild: (parentId: string, text: string) => void;
  addTop: (text: string) => void;
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
  const [openId, setOpenId] = useState<string | null>(null);

  const setItems = (items: ChecklistItem[]) => update(list.id, { items });
  const ops: ItemOps = {
    toggle: (id) => setItems(treeUpdate(list.items, id, (it) => ({ ...it, done: !it.done }))),
    setField: (id, patch) => setItems(treeUpdate(list.items, id, (it) => ({ ...it, ...patch }))),
    remove: (id) => setItems(treeRemove(list.items, id)),
    addChild: (parentId, text) =>
      setItems(
        treeUpdate(list.items, parentId, (it) => ({
          ...it,
          subitems: [...(it.subitems ?? []), newItem(text)],
        })),
      ),
    addTop: (text) => setItems([...list.items, newItem(text)]),
  };

  function addItem(e: React.FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    ops.addTop(t);
    setDraft('');
  }

  const done = list.items.filter((it) => it.done).length;
  const openItem = openId ? treeFind(list.items, openId) : undefined;

  return (
    <div className="cl-card">
      <div className="cl-card-head">
        <input
          className="cl-title"
          placeholder="Название списка"
          value={list.title}
          onChange={(e) => update(list.id, { title: e.target.value })}
        />
        {list.items.length > 0 && (
          <span className="cl-count muted small">
            {done}/{list.items.length}
          </span>
        )}
        <button className="icon-btn cl-del-list" onClick={() => remove(list.id)} aria-label="Удалить список">
          ✕
        </button>
      </div>

      <ul className="cl-items">
        {list.items.map((it) => (
          <ItemRow key={it.id} item={it} depth={0} ops={ops} onOpen={setOpenId} />
        ))}
      </ul>

      <form className="cl-add" onSubmit={addItem}>
        <input
          className="cl-add-input"
          placeholder="+ задача"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>

      {openItem && (
        <TaskModal
          item={openItem}
          ops={ops}
          notes={notes}
          onOpen={setOpenId}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function ItemRow({
  item,
  depth,
  ops,
  onOpen,
}: {
  item: ChecklistItem;
  depth: number;
  ops: ItemOps;
  onOpen: (id: string) => void;
}) {
  const sub = item.subitems ?? [];
  return (
    <li className={`cl-item ${item.done ? 'done' : ''}`}>
      <div className="cl-item-row">
        <button className="cl-check" onClick={() => ops.toggle(item.id)} aria-label="Отметить">
          {item.done ? '✓' : ''}
        </button>
        <input
          className="cl-item-text"
          value={item.text}
          onChange={(e) => ops.setField(item.id, { text: e.target.value })}
        />
        <span className="cl-badges" onClick={() => onOpen(item.id)}>
          {item.desc ? <span title="Описание">≡</span> : null}
          {item.noteId ? <span title="Заметка">📄</span> : null}
          {item.remindAt ? <span title="Напоминание">🔔</span> : null}
          {sub.length > 0 ? <span className="cl-subcount">{sub.length}</span> : null}
        </span>
        <button className="icon-btn cl-act" onClick={() => onOpen(item.id)} title="Открыть" aria-label="Открыть">
          ›
        </button>
        <button className="icon-btn cl-del" onClick={() => ops.remove(item.id)} aria-label="Удалить">
          ✕
        </button>
      </div>

      {sub.length > 0 && (
        <ul className="cl-subitems">
          {sub.map((s) => (
            <ItemRow key={s.id} item={s} depth={depth + 1} ops={ops} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Формат метки времени -> значение для input[type=datetime-local]. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function TaskModal({
  item,
  ops,
  notes,
  onOpen,
  onClose,
}: {
  item: ChecklistItem;
  ops: ItemOps;
  notes: Note[];
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [subDraft, setSubDraft] = useState('');
  const note = item.noteId ? notes.find((n) => n.id === item.noteId) : undefined;
  const sub = item.subitems ?? [];

  function setRemind(value: string) {
    if (!value) {
      ops.setField(item.id, { remindAt: null });
      return;
    }
    ops.setField(item.id, { remindAt: new Date(value).getTime() });
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function addSub(e: React.FormEvent) {
    e.preventDefault();
    const t = subDraft.trim();
    if (!t) return;
    ops.addChild(item.id, t);
    setSubDraft('');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <label className="modal-check">
            <input type="checkbox" checked={item.done} onChange={() => ops.toggle(item.id)} />
            {item.done ? 'Выполнено' : 'Не выполнено'}
          </label>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <input
          className="input modal-title"
          placeholder="Задача"
          value={item.text}
          onChange={(e) => ops.setField(item.id, { text: e.target.value })}
        />

        <label className="field">
          <span className="field-label">Описание</span>
          <textarea
            className="input"
            rows={5}
            placeholder="Подробности…"
            value={item.desc ?? ''}
            onChange={(e) => ops.setField(item.id, { desc: e.target.value })}
          />
        </label>

        <div className="modal-row">
          <label className="field">
            <span className="field-label">Дата</span>
            <input
              className="input"
              type="date"
              value={item.date ?? ''}
              onChange={(e) => ops.setField(item.id, { date: e.target.value || null })}
            />
          </label>
          <label className="field">
            <span className="field-label">Напоминание</span>
            <input
              className="input"
              type="datetime-local"
              value={item.remindAt ? toLocalInput(item.remindAt) : ''}
              onChange={(e) => setRemind(e.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Заметка</span>
          <select
            className="input"
            value={item.noteId ?? ''}
            onChange={(e) => ops.setField(item.id, { noteId: e.target.value || null })}
          >
            <option value="">— нет —</option>
            {notes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title || 'Без названия'}
              </option>
            ))}
          </select>
          {note && note.body && <p className="cl-note-body">{note.body}</p>}
        </label>

        <div className="field">
          <span className="field-label">Подзадачи</span>
          <ul className="cl-items modal-subs">
            {sub.map((s) => (
              <li key={s.id} className={`cl-item ${s.done ? 'done' : ''}`}>
                <div className="cl-item-row">
                  <button className="cl-check" onClick={() => ops.toggle(s.id)} aria-label="Отметить">
                    {s.done ? '✓' : ''}
                  </button>
                  <input
                    className="cl-item-text"
                    value={s.text}
                    onChange={(e) => ops.setField(s.id, { text: e.target.value })}
                  />
                  <button className="icon-btn cl-act" onClick={() => onOpen(s.id)} title="Открыть" aria-label="Открыть">
                    ›
                  </button>
                  <button className="icon-btn cl-del" onClick={() => ops.remove(s.id)} aria-label="Удалить">
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <form className="cl-add" onSubmit={addSub}>
            <input
              className="cl-add-input"
              placeholder="+ подзадача"
              value={subDraft}
              onChange={(e) => setSubDraft(e.target.value)}
            />
          </form>
        </div>

        <div className="modal-foot">
          <button
            className="btn cl-danger"
            onClick={() => {
              ops.remove(item.id);
              onClose();
            }}
          >
            Удалить задачу
          </button>
        </div>
      </div>
    </div>
  );
}
