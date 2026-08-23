// Матрица «важно / срочно» — ответ на вопрос «за что взяться», когда открытых
// задач полсотни и все в одну кучу.
//
// Квадрант не хранится отдельным полем: это проекция того, что уже есть на
// задаче. Важность — `priority`, срочность — дата (ближе порога = срочно).
// Иначе появилось бы третье место, где живёт одно и то же, и оно бы разъехалось
// с датой в календаре.
//
// Фокус дня (`focus`) — единственное новое поле: три дела, взятые на сегодня.
// Хранится днём (YYYY-MM-DD), а не галочкой, чтобы вчерашний выбор сам сходил
// на нет и не тянулся в новый день.

import type { Checklist, ChecklistItem } from '../types';
import { addDaysKey, todayKey } from './dates';
import { PRIORITY_META, flattenTasks, taskPriority, taskStatus, type TaskRef } from './tasks';

/** Сколько дней вперёд считаются «срочно». Дальше — уже не горит. */
export const URGENT_DAYS = 3;

/** Сколько дел берём в фокус дня. Больше трёх — это уже не выбор, а список. */
export const FOCUS_MAX = 3;

export type QuadrantId = 'do' | 'plan' | 'delegate' | 'drop';

export interface QuadrantMeta {
  id: QuadrantId;
  title: string;
  hint: string;
  important: boolean;
  urgent: boolean;
}

export const QUADRANTS: QuadrantMeta[] = [
  {
    id: 'do',
    title: 'Срочно и важно',
    hint: 'Делать сегодня',
    important: true,
    urgent: true,
  },
  {
    id: 'plan',
    title: 'Важно, не срочно',
    hint: 'Главное в жизни: книги, курсы, здоровье. Сюда — время по плану, иначе переедет налево',
    important: true,
    urgent: false,
  },
  {
    id: 'delegate',
    title: 'Срочно, не важно',
    hint: 'Мелочь со сроком: сделать быстро или передать',
    important: false,
    urgent: true,
  },
  {
    id: 'drop',
    title: 'Ни то ни другое',
    hint: 'Замыслы и «когда-нибудь». Не выбрасываем, но и не тянем в день',
    important: false,
    urgent: false,
  },
];

/** Важной считается только `high`: если важно всё, не важно ничего. */
export const isImportant = (it: ChecklistItem): boolean => taskPriority(it) === 'high';

/** Срочно — есть день, и он не дальше порога (просроченное тоже срочно). */
export function isUrgent(date: string | null, today = todayKey(), days = URGENT_DAYS): boolean {
  if (!date) return false;
  return date <= addDaysKey(today, days);
}

export function quadrantOf(ref: TaskRef, today = todayKey()): QuadrantId {
  const important = isImportant(ref.item);
  const urgent = isUrgent(ref.date, today);
  if (important) return urgent ? 'do' : 'plan';
  return urgent ? 'delegate' : 'drop';
}

/** Задача в фокусе именно этого дня (вчерашний фокус не считается). */
export const inFocus = (it: ChecklistItem, today = todayKey()): boolean => it.focus === today;

export interface Board {
  /** Задачи по квадрантам, внутри — по срочности (см. byUrgency). */
  cells: Record<QuadrantId, TaskRef[]>;
  /** Взятое на сегодня, в порядке добавления. */
  focus: TaskRef[];
}

/**
 * Раскладка доски. Замыслы (`someday`) сюда не идут: их место — «Когда-нибудь»,
 * а не квадрант, из которого их каждый раз приходится выкидывать глазами.
 * «Жду» тоже не показываем — мяч на чужой стороне, делать нечего.
 */
export function buildBoard(checklists: Checklist[], today = todayKey()): Board {
  const cells: Record<QuadrantId, TaskRef[]> = { do: [], plan: [], delegate: [], drop: [] };
  const focus: TaskRef[] = [];

  const refs = flattenTasks(checklists).filter(
    (r) => !r.item.done && taskStatus(r.item) === 'active',
  );

  for (const ref of refs) {
    cells[quadrantOf(ref, today)].push(ref);
    if (inFocus(ref.item, today)) focus.push(ref);
  }

  for (const id of Object.keys(cells) as QuadrantId[]) cells[id].sort(boardOrder);
  return { cells, focus };
}

/** Порядок внутри квадранта: ближний срок → важность → мелкое вперёд. */
export function boardOrder(a: TaskRef, b: TaskRef): number {
  const da = a.date ?? '9999-99-99';
  const db = b.date ?? '9999-99-99';
  if (da !== db) return da.localeCompare(db);
  const pa = PRIORITY_META[taskPriority(a.item)].rank;
  const pb = PRIORITY_META[taskPriority(b.item)].rank;
  if (pa !== pb) return pa - pb;
  return (a.item.sizeMin ?? 999) - (b.item.sizeMin ?? 999);
}

/**
 * Что поменять в задаче, чтобы она оказалась в нужном квадранте.
 *
 * Важность меняется прямо (`priority`), а срочность — только датой: «срочно»
 * ставит сегодняшний день, «не срочно» снимает дату. Повторяющуюся задачу
 * дата держит в цикле, поэтому у неё дату не трогаем — вернём `null`
 * (переносить нечего, скажем об этом в интерфейсе).
 */
export function moveToQuadrant(
  ref: TaskRef,
  to: QuadrantId,
  today = todayKey(),
): Partial<ChecklistItem> | null {
  const target = QUADRANTS.find((q) => q.id === to);
  if (!target) return null;
  const patch: Partial<ChecklistItem> = {};

  if (target.important !== isImportant(ref.item)) {
    // Из «не важно» поднимаем в high; вниз опускаем в normal, а не в low —
    // «не горит» он ставит сам, и затирать эту пометку доска не должна.
    patch.priority = target.important ? 'high' : 'normal';
  }

  if (target.urgent !== isUrgent(ref.date, today)) {
    const repeating = (ref.item.repeat ?? 'none') !== 'none';
    if (repeating) return Object.keys(patch).length ? patch : null;
    // Дата у списка целиком (`list.date`) с карточки не снимается: там она
    // общая для всех пунктов, и правка тронула бы соседей.
    if (!target.urgent && !ref.item.date) return Object.keys(patch).length ? patch : null;
    patch.date = target.urgent ? today : null;
  }

  return Object.keys(patch).length ? patch : null;
}

/** Взять/снять дело с фокуса дня. Больше FOCUS_MAX не берём. */
export function toggleFocus(
  it: ChecklistItem,
  focusCount: number,
  today = todayKey(),
): Partial<ChecklistItem> | null {
  if (inFocus(it, today)) return { focus: null };
  if (focusCount >= FOCUS_MAX) return null;
  return { focus: today };
}
