import { useMemo, useState } from 'react';
import type { Checklist, ChecklistItem } from '../types';
import { uid, useListActions, useLocalStorage } from '../lib/storage';

interface Props {
  date: string;
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
}

export function ChecklistBoard({ date, checklists, setChecklists }: Props) {
  const { add, update, remove } = useListActions(setChecklists);
  const [cols, setCols] = useLocalStorage<number>('ndc.cols', 1);

  const lists = useMemo(
    () =>
      checklists
        .filter((c) => c.date === date)
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
            <ChecklistCard key={c.id} list={c} update={update} remove={remove} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChecklistCard({
  list,
  update,
  remove,
}: {
  list: Checklist;
  update: (id: string, patch: Partial<Checklist>) => void;
  remove: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const setItems = (items: ChecklistItem[]) => update(list.id, { items });
  const toggle = (id: string) =>
    setItems(list.items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
  const editText = (id: string, text: string) =>
    setItems(list.items.map((it) => (it.id === id ? { ...it, text } : it)));
  const removeItem = (id: string) => setItems(list.items.filter((it) => it.id !== id));

  function addItem(e: React.FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    setItems([...list.items, { id: uid(), text: t, done: false }]);
    setDraft('');
  }

  const doneCount = list.items.filter((it) => it.done).length;

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
            {doneCount}/{list.items.length}
          </span>
        )}
        <button className="icon-btn cl-del-list" onClick={() => remove(list.id)} aria-label="Удалить список">
          ✕
        </button>
      </div>

      <ul className="cl-items">
        {list.items.map((it) => (
          <li key={it.id} className={`cl-item ${it.done ? 'done' : ''}`}>
            <button className="cl-check" onClick={() => toggle(it.id)} aria-label="Отметить">
              {it.done ? '✓' : ''}
            </button>
            <input
              className="cl-item-text"
              value={it.text}
              onChange={(e) => editText(it.id, e.target.value)}
            />
            <button className="icon-btn cl-del" onClick={() => removeItem(it.id)} aria-label="Удалить пункт">
              ✕
            </button>
          </li>
        ))}
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
