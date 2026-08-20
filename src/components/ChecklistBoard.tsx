import { useMemo, useState } from 'react';
import type {
  Attachment,
  Checklist,
  ChecklistItem,
  Note,
  Repeat,
  TaskPriority,
  TaskStatus,
} from '../types';
import { uid, useListActions, useLocalStorage } from '../lib/storage';
import { deleteAttachment } from '../lib/attachments';
import { repeatLabel } from '../lib/recurrence';
import {
  PRIORITY_META,
  SIZES,
  STATUS_META,
  type TaskFilter,
  extractTags,
  matchesFilter,
  normTag,
  sizeLabel,
  tagCounts,
  taskPriority,
  taskStatus,
  toggleWithRepeat,
} from '../lib/tasks';
import { AttachmentAdder, AttachmentList } from './Attachments';

interface Props {
  /** День (YYYY-MM-DD) или null для общих (недатированных) списков. */
  date: string | null;
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  notes: Note[];
}

// ---- Операции над деревом задач (по уникальному id) ----
// Теги можно писать прямо в строке ввода: «Купить масло #купить».
const newItem = (raw: string): ChecklistItem => {
  const { text, tags } = extractTags(raw);
  return tags.length ? { id: uid(), text, done: false, tags } : { id: uid(), text, done: false };
};

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
  const [quick, setQuick] = useState('');
  const [filter, setFilter] = useLocalStorage<TaskFilter>('ndc.taskFilter', {});

  const lists = useMemo(
    () =>
      checklists
        .filter((c) => (c.date ?? null) === date)
        .sort((a, b) => a.createdAt - b.createdAt),
    [checklists, date],
  );

  const tags = useMemo(() => tagCounts(checklists), [checklists]);
  const filterOn =
    !!filter.tags?.length ||
    !!filter.statuses?.length ||
    !!filter.minPriority ||
    !!filter.maxSize ||
    !!filter.withDone ||
    !!filter.query;

  function addList() {
    const now = Date.now();
    add({ id: uid(), title: '', date, items: [], createdAt: now, updatedAt: now });
  }

  // Быстрая одиночная задача: без создания списка вручную — попадает в общий
  // список без названия (создаётся при необходимости).
  function addQuickTask(e: React.FormEvent) {
    e.preventDefault();
    const t = quick.trim();
    if (!t) return;
    const target = lists.find((l) => !l.title.trim());
    if (target) {
      update(target.id, { items: [...target.items, newItem(t)] });
    } else {
      const now = Date.now();
      add({ id: uid(), title: '', date, items: [newItem(t)], createdAt: now, updatedAt: now });
    }
    setQuick('');
  }

  return (
    <div className="cl-board">
      <form className="cl-quick" onSubmit={addQuickTask}>
        <input
          className="input cl-quick-input"
          placeholder="＋ Задача — быстро, без списка"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
        />
      </form>

      <TaskFilterBar filter={filter} setFilter={setFilter} tags={tags} />

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
        <p className="cl-empty muted small">
          Пусто — добавьте задачу в строке выше или создайте список.
        </p>
      ) : (
        <div className="cl-grid" style={{ ['--cols' as string]: cols }}>
          {lists.map((c) => (
            <ChecklistCard
              key={c.id}
              list={c}
              notes={notes}
              update={update}
              remove={remove}
              filter={filter}
              filterOn={filterOn}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Панель срезов: поиск, состояние, размер, важность и теги.
 *  Фильтр держится в localStorage — чтобы привычный срез не сбрасывался. */
function TaskFilterBar({
  filter,
  setFilter,
  tags,
}: {
  filter: TaskFilter;
  setFilter: React.Dispatch<React.SetStateAction<TaskFilter>>;
  tags: { tag: string; count: number }[];
}) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<TaskFilter>) => setFilter((f) => ({ ...f, ...p }));

  const toggleStatus = (s: TaskStatus) =>
    setFilter((f) => {
      const cur = f.statuses ?? [];
      return { ...f, statuses: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] };
    });
  const toggleTag = (t: string) =>
    setFilter((f) => {
      const cur = f.tags ?? [];
      return { ...f, tags: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] };
    });

  return (
    <div className="cl-filter">
      <div className="cl-filter-row">
        <input
          className="input cl-filter-search"
          placeholder="🔎 Поиск по задачам"
          value={filter.query ?? ''}
          onChange={(e) => patch({ query: e.target.value })}
        />
        <button
          className={`btn btn-small ${open ? 'active' : ''}`}
          onClick={() => setOpen((v) => !v)}
        >
          Срезы
        </button>
      </div>

      {open && (
        <div className="cl-filter-body">
          <div className="cl-chips">
            {(Object.keys(STATUS_META) as TaskStatus[]).map((s) => (
              <button
                key={s}
                className={`chip ${filter.statuses?.includes(s) ? 'active' : ''}`}
                title={STATUS_META[s].hint}
                onClick={() => toggleStatus(s)}
              >
                {STATUS_META[s].icon} {STATUS_META[s].label}
              </button>
            ))}
          </div>

          <div className="cl-chips">
            {SIZES.map((s) => (
              <button
                key={s}
                className={`chip ${filter.maxSize === s ? 'active' : ''}`}
                title={`Что закрыть за ${sizeLabel(s)}`}
                onClick={() => patch({ maxSize: filter.maxSize === s ? undefined : s })}
              >
                ≤ {sizeLabel(s)}
              </button>
            ))}
            <button
              className={`chip ${filter.minPriority === 'high' ? 'active' : ''}`}
              onClick={() =>
                patch({ minPriority: filter.minPriority === 'high' ? undefined : 'high' })
              }
            >
              ‼️ Только важное
            </button>
            <button
              className={`chip ${filter.withDone ? 'active' : ''}`}
              onClick={() => patch({ withDone: !filter.withDone })}
            >
              ✓ Со сделанными
            </button>
          </div>

          {tags.length > 0 && (
            <div className="cl-chips">
              {tags.map(({ tag, count }) => (
                <button
                  key={tag}
                  className={`chip ${filter.tags?.includes(tag) ? 'active' : ''}`}
                  onClick={() => toggleTag(tag)}
                >
                  #{tag} <span className="muted small">{count}</span>
                </button>
              ))}
            </div>
          )}

          <button className="btn btn-small" onClick={() => setFilter({})}>
            Сбросить
          </button>
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
  filter,
  filterOn,
}: {
  list: Checklist;
  notes: Note[];
  update: (id: string, patch: Partial<Checklist>) => void;
  remove: (id: string) => void;
  filter: TaskFilter;
  filterOn: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const setItems = (items: ChecklistItem[]) => update(list.id, { items });
  const ops: ItemOps = {
    // Повторяющаяся задача не закрывается, а уезжает на следующий срок.
    toggle: (id) => setItems(treeUpdate(list.items, id, (it) => toggleWithRepeat(it))),
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

  // Под срезом показываем только подходящие пункты; список без единого
  // совпадения не занимает место на экране.
  const shown = list.items.filter((it) => matchesFilter(it, filter));
  if (filterOn && shown.length === 0) return null;

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
        {shown.map((it) => (
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
          {taskPriority(item) !== 'normal' ? (
            <span title={PRIORITY_META[taskPriority(item)].label}>
              {PRIORITY_META[taskPriority(item)].icon}
            </span>
          ) : null}
          {taskStatus(item) !== 'active' ? (
            <span title={STATUS_META[taskStatus(item)].label}>
              {STATUS_META[taskStatus(item)].icon}
            </span>
          ) : null}
          {item.sizeMin ? <span className="cl-size">{sizeLabel(item.sizeMin)}</span> : null}
          {item.repeat && item.repeat !== 'none' ? <span title="Повтор">🔁</span> : null}
          {item.desc ? <span title="Описание">≡</span> : null}
          {item.noteId ? <span title="Заметка">📄</span> : null}
          {item.attachments && item.attachments.length > 0 ? <span title="Файлы">📎</span> : null}
          {item.remindAt ? <span title="Напоминание">🔔</span> : null}
          {sub.length > 0 ? <span className="cl-subcount">{sub.length}</span> : null}
        </span>
        {item.tags && item.tags.length > 0 && (
          <span className="cl-tags">
            {item.tags.map((t) => (
              <span key={t} className="cl-tag">
                #{t}
              </span>
            ))}
          </span>
        )}
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

/** Редактор тегов: чипы с крестиком плюс строка ввода. */
function TagEditor({ item, ops }: { item: ChecklistItem; ops: ItemOps }) {
  const [draft, setDraft] = useState('');
  const tags = item.tags ?? [];

  function addTag(e: React.FormEvent) {
    e.preventDefault();
    const t = normTag(draft);
    if (!t) return;
    if (!tags.includes(t)) ops.setField(item.id, { tags: [...tags, t] });
    setDraft('');
  }

  return (
    <div className="field">
      <span className="field-label">Теги</span>
      <div className="cl-chips">
        {tags.map((t) => (
          <button
            key={t}
            className="chip active"
            title="Убрать тег"
            onClick={() => ops.setField(item.id, { tags: tags.filter((x) => x !== t) })}
          >
            #{t} ✕
          </button>
        ))}
      </div>
      <form onSubmit={addTag}>
        <input
          className="input"
          placeholder="+ тег (например: купить, позвонить, оформить)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
    </div>
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

        <div className="modal-row">
          <label className="field">
            <span className="field-label">Состояние</span>
            <select
              className="input"
              value={taskStatus(item)}
              onChange={(e) => ops.setField(item.id, { status: e.target.value as TaskStatus })}
            >
              {(Object.keys(STATUS_META) as TaskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].icon} {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Важность</span>
            <select
              className="input"
              value={taskPriority(item)}
              onChange={(e) => ops.setField(item.id, { priority: e.target.value as TaskPriority })}
            >
              {(['high', 'normal', 'low'] as TaskPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {taskStatus(item) === 'waiting' && (
          <label className="field">
            <span className="field-label">Жду от кого / чего</span>
            <input
              className="input"
              placeholder="Например: ответ по заявке"
              value={item.waitingFor ?? ''}
              onChange={(e) => ops.setField(item.id, { waitingFor: e.target.value })}
            />
          </label>
        )}

        <div className="field">
          <span className="field-label">Размер</span>
          <div className="cl-chips">
            {SIZES.map((s) => (
              <button
                key={s}
                className={`chip ${item.sizeMin === s ? 'active' : ''}`}
                onClick={() =>
                  ops.setField(item.id, { sizeMin: item.sizeMin === s ? undefined : s })
                }
              >
                {sizeLabel(s)}
              </button>
            ))}
          </div>
        </div>

        <TagEditor item={item} ops={ops} />

        <div className="modal-row">
          <label className="field">
            <span className="field-label">Повтор</span>
            <select
              className="input"
              value={item.repeat ?? 'none'}
              onChange={(e) => ops.setField(item.id, { repeat: e.target.value as Repeat })}
            >
              {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as Repeat[]).map((r) => (
                <option key={r} value={r}>
                  {repeatLabel(r)}
                </option>
              ))}
            </select>
          </label>
          {item.repeat && item.repeat !== 'none' && (
            <label className="field">
              <span className="field-label">Повторять до</span>
              <input
                className="input"
                type="date"
                value={item.repeatUntil ?? ''}
                onChange={(e) => ops.setField(item.id, { repeatUntil: e.target.value || null })}
              />
            </label>
          )}
        </div>
        {item.repeat && item.repeat !== 'none' && (
          <p className="muted small">
            При отметке задача не закроется, а уедет на следующий срок.
          </p>
        )}

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
          <span className="field-label">Файлы</span>
          <AttachmentList
            items={item.attachments}
            onRemove={(a) => {
              deleteAttachment(a);
              ops.setField(item.id, {
                attachments: (item.attachments ?? []).filter((x) => x.id !== a.id),
              });
            }}
          />
          <AttachmentAdder
            onAdd={(added: Attachment[]) =>
              ops.setField(item.id, { attachments: [...(item.attachments ?? []), ...added] })
            }
          />
        </div>

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
