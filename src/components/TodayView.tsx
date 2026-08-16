import { useMemo, useState } from 'react';
import type { CalEvent, Checklist, ChecklistItem } from '../types';
import { useListActions } from '../lib/storage';
import { todayKey } from '../lib/dates';
import { eventsOnDay } from '../lib/recurrence';
import {
  PRIORITY_META,
  SIZES,
  type TaskRef,
  sizeLabel,
  taskPriority,
  todayPlan,
  toggleWithRepeat,
} from '../lib/tasks';

interface Props {
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  events: CalEvent[];
}

function treeToggle(items: ChecklistItem[], id: string, today: string): ChecklistItem[] {
  return items.map((it) =>
    it.id === id
      ? toggleWithRepeat(it, today)
      : { ...it, subitems: it.subitems ? treeToggle(it.subitems, id, today) : it.subitems },
  );
}

/**
 * Экран «Сегодня» — ответ на вопрос «чем заняться», а не «что у меня есть».
 *
 * Порядок сознательный: сначала просроченное (оно уже подвело), потом дела
 * этого дня, потом короткий список предложений из недатированного. Остальное
 * живёт на вкладке «Задачи» и сюда не лезет.
 */
export function TodayView({ checklists, setChecklists, events }: Props) {
  const { update } = useListActions(setChecklists);
  const today = todayKey();
  const [maxSize, setMaxSize] = useState<number | undefined>();

  const plan = useMemo(() => todayPlan(checklists, today), [checklists, today]);
  const dayEvents = useMemo(() => eventsOnDay(events, today), [events, today]);

  function toggle(ref: TaskRef) {
    const list = checklists.find((c) => c.id === ref.listId);
    if (!list) return;
    update(list.id, { items: treeToggle(list.items, ref.item.id, today) });
  }

  const fits = (r: TaskRef) => !maxSize || (r.item.sizeMin ?? Infinity) <= maxSize;
  const suggestions = plan.suggestions.filter(fits);
  const nothing =
    plan.overdue.length === 0 &&
    plan.dueToday.length === 0 &&
    dayEvents.length === 0 &&
    suggestions.length === 0;

  return (
    <section className="view view-narrow">
      <div className="view-head">
        <h2>Сегодня</h2>
        <span className="muted">
          {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </div>

      <div className="cl-chips td-sizes">
        <span className="muted small">Есть времени:</span>
        {SIZES.map((s) => (
          <button
            key={s}
            className={`chip ${maxSize === s ? 'active' : ''}`}
            onClick={() => setMaxSize(maxSize === s ? undefined : s)}
          >
            {sizeLabel(s)}
          </button>
        ))}
      </div>

      {nothing && <p className="empty">На сегодня чисто — и просроченного нет</p>}

      <TaskGroup title="Просрочено" cls="td-overdue" refs={plan.overdue} onToggle={toggle} showDate />
      <TaskGroup title="На сегодня" cls="td-due" refs={plan.dueToday} onToggle={toggle} />

      {dayEvents.length > 0 && (
        <div className="td-group">
          <h3 className="td-title">События</h3>
          {dayEvents.map((e) => (
            <div key={e.id} className="db-row db-ev">
              <span className="db-time">{e.start || '—'}</span>
              <span className="db-text">{e.title}</span>
            </div>
          ))}
        </div>
      )}

      <TaskGroup
        title={maxSize ? `Можно закрыть за ${sizeLabel(maxSize)}` : 'Предложения'}
        cls="td-suggest"
        refs={suggestions}
        onToggle={toggle}
        hint="Из недатированного — важное и мелкое вперёд"
      />

      {plan.waiting.length > 0 && (
        <div className="td-group">
          <h3 className="td-title">⏳ Жду ответа</h3>
          {plan.waiting.map((r) => (
            <div key={r.item.id} className="db-row td-waiting">
              <span className="db-text">{r.item.text}</span>
              <span className="db-list muted small">
                {r.item.waitingFor ? `от: ${r.item.waitingFor}` : r.listTitle}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TaskGroup({
  title,
  cls,
  refs,
  onToggle,
  showDate,
  hint,
}: {
  title: string;
  cls: string;
  refs: TaskRef[];
  onToggle: (r: TaskRef) => void;
  showDate?: boolean;
  hint?: string;
}) {
  if (refs.length === 0) return null;
  return (
    <div className={`td-group ${cls}`}>
      <h3 className="td-title">
        {title} <span className="muted small">{refs.length}</span>
      </h3>
      {hint && <p className="muted small td-hint">{hint}</p>}
      {refs.map((r) => (
        <div key={r.item.id} className="db-row db-task">
          <button className="cl-check" onClick={() => onToggle(r)} aria-label="Отметить" />
          <span className="db-text">
            {taskPriority(r.item) !== 'normal' && PRIORITY_META[taskPriority(r.item)].icon}{' '}
            {r.item.text || '—'}
            {r.item.sizeMin ? <span className="cl-size"> {sizeLabel(r.item.sizeMin)}</span> : null}
          </span>
          <span className="db-list muted small">
            {showDate && r.date ? `${r.date} · ` : ''}
            {r.listTitle}
          </span>
        </div>
      ))}
    </div>
  );
}
