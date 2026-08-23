import { useMemo, useState } from 'react';
import type { Checklist, ChecklistItem } from '../types';
import { useListActions, useLocalStorage } from '../lib/storage';
import { todayKey } from '../lib/dates';
import { PRIORITY_META, sizeLabel, taskPriority, toggleWithRepeat } from '../lib/tasks';
import type { TaskRef } from '../lib/tasks';
import {
  FOCUS_MAX,
  QUADRANTS,
  type QuadrantId,
  URGENT_DAYS,
  buildBoard,
  inFocus,
  isUrgent,
  moveToQuadrant,
  toggleFocus,
} from '../lib/planner';

interface Props {
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
}

/** Сколько карточек показываем в квадранте, пока не попросили «все». */
const PREVIEW = 6;

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

/**
 * «Карта дел» — матрица важно/срочно плюс три дела на сегодня.
 *
 * Экран «Сегодня» отвечает, что делать в ближайший час; здесь решается, что
 * вообще заслуживает дня. Квадрант — не отдельное поле, а проекция важности и
 * даты (см. lib/planner.ts), поэтому перенос карточки меняет саму задачу и
 * сразу виден в календаре и в «Сегодня».
 *
 * Перетаскивание работает мышкой, а на телефоне — кнопками на карточке:
 * HTML5-drag в мобильных браузерах не срабатывает, а доска нужна и там.
 */
export function PlannerView({ checklists, setChecklists }: Props) {
  const { update } = useListActions(setChecklists);
  const today = todayKey();
  const [listFilter, setListFilter] = useLocalStorage<string>('ndc.plannerList', '');
  const [openAll, setOpenAll] = useState<Set<QuadrantId>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCell, setOverCell] = useState<QuadrantId | null>(null);

  const board = useMemo(() => buildBoard(checklists, today), [checklists, today]);

  const lists = useMemo(() => {
    const seen = new Map<string, number>();
    for (const id of Object.keys(board.cells) as QuadrantId[]) {
      for (const r of board.cells[id]) seen.set(r.listTitle, (seen.get(r.listTitle) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [board]);

  const visible = (refs: TaskRef[]) =>
    listFilter ? refs.filter((r) => r.listTitle === listFilter) : refs;

  function patch(ref: TaskRef, fields: Partial<ChecklistItem>) {
    const list = checklists.find((c) => c.id === ref.listId);
    if (!list) return;
    update(list.id, {
      items: treeUpdate(list.items, ref.item.id, (it) => ({ ...it, ...fields })),
    });
  }

  function toggleDone(ref: TaskRef) {
    const list = checklists.find((c) => c.id === ref.listId);
    if (!list) return;
    update(list.id, {
      items: treeUpdate(list.items, ref.item.id, (it) => toggleWithRepeat(it, today)),
    });
  }

  function move(ref: TaskRef, to: QuadrantId) {
    const fields = moveToQuadrant(ref, to, today);
    if (fields) patch(ref, fields);
  }

  function focus(ref: TaskRef) {
    const fields = toggleFocus(ref.item, board.focus.length, today);
    if (fields) patch(ref, fields);
  }

  function drop(to: QuadrantId) {
    setOverCell(null);
    if (!dragId) return;
    const all = (Object.keys(board.cells) as QuadrantId[]).flatMap((id) => board.cells[id]);
    const ref = all.find((r) => r.item.id === dragId);
    setDragId(null);
    if (ref) move(ref, to);
  }

  const total = (Object.keys(board.cells) as QuadrantId[]).reduce(
    (n, id) => n + board.cells[id].length,
    0,
  );

  return (
    <section className="view">
      <div className="view-head">
        <h2>Карта дел</h2>
        <span className="muted">
          {total} открытых · срочно = срок в ближайшие {URGENT_DAYS} дня
        </span>
      </div>

      <div className="pl-focus">
        <h3 className="pl-focus-title">
          Сегодня делаю <span className="muted small">{board.focus.length} из {FOCUS_MAX}</span>
        </h3>
        {board.focus.length === 0 ? (
          <p className="muted small pl-focus-empty">
            Пусто. Возьми звёздочкой ⭐ не больше трёх дел — это и есть план дня.
          </p>
        ) : (
          <ol className="pl-focus-list">
            {board.focus.map((r) => (
              <li key={r.item.id}>
                <button className="cl-check" onClick={() => toggleDone(r)} aria-label="Отметить" />
                <span className="pl-focus-text">{r.item.text || '—'}</span>
                <span className="muted small">{r.listTitle}</span>
                <button className="icon-btn" onClick={() => focus(r)} aria-label="Убрать из плана">
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {lists.length > 1 && (
        <div className="cl-chips pl-lists">
          <button
            className={`chip ${listFilter === '' ? 'active' : ''}`}
            onClick={() => setListFilter('')}
          >
            Все сферы
          </button>
          {lists.map(([title, count]) => (
            <button
              key={title}
              className={`chip ${listFilter === title ? 'active' : ''}`}
              onClick={() => setListFilter(listFilter === title ? '' : title)}
            >
              {title} {count}
            </button>
          ))}
        </div>
      )}

      <div className="pl-grid">
        {QUADRANTS.map((q) => {
          const refs = visible(board.cells[q.id]);
          const all = openAll.has(q.id);
          const shown = all ? refs : refs.slice(0, PREVIEW);
          return (
            <div
              key={q.id}
              className={`pl-cell pl-${q.id} ${overCell === q.id ? 'pl-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCell(q.id);
              }}
              onDragLeave={() => setOverCell((c) => (c === q.id ? null : c))}
              onDrop={() => drop(q.id)}
            >
              <div className="pl-cell-head">
                <h3>
                  {q.title} <span className="muted small">{refs.length}</span>
                </h3>
                <p className="muted small pl-cell-hint">{q.hint}</p>
              </div>

              {refs.length === 0 && <p className="empty pl-empty">Пусто</p>}

              {shown.map((r) => (
                <Card
                  key={r.item.id}
                  ref_={r}
                  today={today}
                  focusFull={board.focus.length >= FOCUS_MAX}
                  onDone={() => toggleDone(r)}
                  onFocus={() => focus(r)}
                  onMove={(to) => move(r, to)}
                  onDragStart={() => setDragId(r.item.id)}
                  onDragEnd={() => setDragId(null)}
                />
              ))}

              {refs.length > PREVIEW && (
                <button
                  className="btn btn-small pl-more"
                  onClick={() =>
                    setOpenAll((prev) => {
                      const next = new Set(prev);
                      if (next.has(q.id)) next.delete(q.id);
                      else next.add(q.id);
                      return next;
                    })
                  }
                >
                  {all ? 'Свернуть' : `Показать все ${refs.length}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted small pl-legend">
        Мышкой — перетащить карточку в другой квадрант. С телефона — кнопками:
        ‼️ важность, ⏰ срок на сегодня или снять. У повторяющихся задач срок не
        снимаем — он держит цикл.
      </p>
    </section>
  );
}

function Card({
  ref_,
  today,
  focusFull,
  onDone,
  onFocus,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  ref_: TaskRef;
  today: string;
  focusFull: boolean;
  onDone: () => void;
  onFocus: () => void;
  onMove: (to: QuadrantId) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const it = ref_.item;
  const picked = inFocus(it, today);
  const important = taskPriority(it) === 'high';
  const urgent = isUrgent(ref_.date, today);
  const overdue = !!ref_.date && ref_.date < today;
  const repeating = (it.repeat ?? 'none') !== 'none';

  // Куда уедет карточка при переключении одной оси — вторая остаётся как есть.
  const flipImportant = QUADRANTS.find((q) => q.important !== important && q.urgent === urgent)!.id;
  const flipUrgent = QUADRANTS.find((q) => q.important === important && q.urgent !== urgent)!.id;

  return (
    <div
      className={`pl-card ${picked ? 'pl-picked' : ''} ${overdue ? 'pl-overdue' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <button className="cl-check" onClick={onDone} aria-label="Отметить" />
      <div className="pl-card-body">
        <span className="pl-card-text">{it.text || '—'}</span>
        <span className="pl-card-meta muted small">
          {ref_.listTitle}
          {it.sizeMin ? ` · ${sizeLabel(it.sizeMin)}` : ''}
          {ref_.date ? ` · ${overdue ? 'просрочено ' : ''}${ref_.date.slice(5)}` : ''}
          {repeating ? ' · 🔁' : ''}
        </span>
      </div>
      <div className="pl-card-acts">
        <button
          className={`icon-btn ${picked ? 'pl-on' : ''}`}
          onClick={onFocus}
          disabled={!picked && focusFull}
          title={picked ? 'Убрать из плана дня' : focusFull ? 'В плане уже три дела' : 'В план на сегодня'}
        >
          {picked ? '★' : '☆'}
        </button>
        <button
          className={`icon-btn ${important ? 'pl-on' : ''}`}
          onClick={() => onMove(flipImportant)}
          title={important ? 'Снять важность' : 'Пометить важным'}
        >
          {PRIORITY_META.high.icon}
        </button>
        <button
          className={`icon-btn ${urgent ? 'pl-on' : ''}`}
          onClick={() => onMove(flipUrgent)}
          disabled={repeating}
          title={
            repeating
              ? 'Повторяющаяся: срок двигается сам'
              : urgent
                ? 'Снять срок'
                : 'Срок — сегодня'
          }
        >
          ⏰
        </button>
      </div>
    </div>
  );
}
