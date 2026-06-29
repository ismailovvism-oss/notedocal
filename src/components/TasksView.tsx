import { useMemo, useState } from 'react';
import type { Task } from '../types';
import { uid, useListActions } from '../lib/storage';
import { fromKey, hijriFull, todayKey } from '../lib/dates';

interface Props {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  /** Если задан — форма заранее привязывает задачи к этому дню. */
  fixedDate?: string;
}

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  high: 'Высокий',
  normal: 'Обычный',
  low: 'Низкий',
};

export function TasksView({ tasks, setTasks, fixedDate }: Props) {
  const { add, update, remove } = useListActions(setTasks);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(fixedDate ?? '');
  const [priority, setPriority] = useState<Task['priority']>('normal');
  const [showDone, setShowDone] = useState(true);

  const list = useMemo(() => {
    const base = fixedDate ? tasks.filter((t) => t.due === fixedDate) : tasks;
    const filtered = showDone ? base : base.filter((t) => !t.done);
    return [...filtered].sort(sortTasks);
  }, [tasks, fixedDate, showDone]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    add({
      id: uid(),
      title: trimmed,
      done: false,
      due: (fixedDate ?? due) || null,
      priority,
      createdAt: Date.now(),
    });
    setTitle('');
    if (!fixedDate) setDue('');
    setPriority('normal');
  }

  const activeCount = list.filter((t) => !t.done).length;

  return (
    <section className="view">
      {!fixedDate && (
        <div className="view-head">
          <h2>Задачи</h2>
          <span className="muted">{activeCount} активных</span>
        </div>
      )}

      <form className="task-form" onSubmit={submit}>
        <input
          className="input"
          placeholder="Новая задача…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="task-form-row">
          {!fixedDate && (
            <input
              className="input input-date"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          )}
          <select
            className="input input-select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Task['priority'])}
          >
            <option value="high">Высокий</option>
            <option value="normal">Обычный</option>
            <option value="low">Низкий</option>
          </select>
          <button className="btn btn-primary" type="submit">
            Добавить
          </button>
        </div>
      </form>

      {!fixedDate && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Показывать выполненные
        </label>
      )}

      <ul className="list">
        {list.length === 0 && <li className="empty">Задач пока нет</li>}
        {list.map((t) => (
          <li key={t.id} className={`task ${t.done ? 'done' : ''}`}>
            <button
              className={`check prio-${t.priority}`}
              onClick={() => update(t.id, { done: !t.done })}
              aria-label="Отметить выполненной"
            >
              {t.done ? '✓' : ''}
            </button>
            <div className="task-body">
              <span className="task-title">{t.title}</span>
              <div className="task-meta">
                {!fixedDate && t.due && (
                  <span className="chip" title={hijriFull(fromKey(t.due))}>
                    {formatDue(t.due)}
                  </span>
                )}
                <span className={`chip chip-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
              </div>
            </div>
            <button className="icon-btn" onClick={() => remove(t.id)} aria-label="Удалить">
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function sortTasks(a: Task, b: Task): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  const order = { high: 0, normal: 1, low: 2 } as const;
  return order[a.priority] - order[b.priority];
}

function formatDue(key: string): string {
  const d = fromKey(key);
  const label = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  if (key === todayKey()) return `Сегодня`;
  return label;
}
