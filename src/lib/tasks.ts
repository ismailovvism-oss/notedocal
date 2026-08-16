// Логика задач поверх чек-листов: измерения (теги, статус, важность, размер),
// фильтрация, порядок «что делать сейчас» и повтор.
//
// Список задаёт сферу (Дом / Работа / Ислам), а всё остальное живёт на самом
// пункте. Раньше измерение было одно, поэтому «Нужно» превращался в свалку:
// туда падало всё, что не подошло ни в одну категорию.

import type { Checklist, ChecklistItem, Repeat, TaskPriority, TaskStatus } from '../types';
import { addDaysKey, todayKey } from './dates';

/** Список-свалка: сюда падает всё надиктованное, пока не разобрано. */
export const INBOX_TITLE = 'Входящие';

export const STATUS_META: Record<TaskStatus, { label: string; icon: string; hint: string }> = {
  active: { label: 'В работе', icon: '•', hint: 'Обычная задача' },
  someday: { label: 'Когда-нибудь', icon: '💭', hint: 'Замысел, не для списка дня' },
  waiting: { label: 'Жду', icon: '⏳', hint: 'Мяч на чужой стороне' },
};

export const PRIORITY_META: Record<TaskPriority, { label: string; icon: string; rank: number }> = {
  high: { label: 'Важное', icon: '‼️', rank: 0 },
  normal: { label: 'Обычное', icon: '', rank: 1 },
  low: { label: 'Не горит', icon: '↓', rank: 2 },
};

/** Размеры задачи в минутах — ровно три, чтобы выбор был мгновенным. */
export const SIZES = [5, 15, 60] as const;

export const sizeLabel = (min?: number): string =>
  !min ? '' : min < 60 ? `${min} мин` : `${Math.round(min / 60)} ч`;

export const taskStatus = (it: ChecklistItem): TaskStatus => it.status ?? 'active';
export const taskPriority = (it: ChecklistItem): TaskPriority => it.priority ?? 'normal';

/** Задача с координатами: из какого списка, на какой день. */
export interface TaskRef {
  item: ChecklistItem;
  listId: string;
  listTitle: string;
  /** День задачи по правилу приложения: свой, иначе — день списка. */
  date: string | null;
  /** Путь для показа: «Родитель / подзадача». */
  path: string;
}

/** Плоский обход всех задач (включая подзадачи) со ссылкой на список. */
export function flattenTasks(checklists: Checklist[]): TaskRef[] {
  const out: TaskRef[] = [];
  const walk = (items: ChecklistItem[], list: Checklist, prefix: string) => {
    for (const it of items ?? []) {
      const path = prefix ? `${prefix} / ${it.text}` : it.text;
      out.push({
        item: it,
        listId: list.id,
        listTitle: (list.title ?? '').trim() || 'Без названия',
        date: it.date ?? list.date ?? null,
        path,
      });
      if (it.subitems?.length) walk(it.subitems, list, path);
    }
  };
  for (const c of checklists) {
    if (c.deleted) continue;
    walk(c.items ?? [], c, '');
  }
  return out;
}

/** Все теги с числом задач — для панели фильтров. */
export function tagCounts(checklists: Checklist[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const { item } of flattenTasks(checklists)) {
    if (item.done) continue;
    for (const t of item.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Нормализация тега: без решётки, без пробелов по краям, нижним регистром. */
export const normTag = (raw: string): string => raw.trim().replace(/^#/, '').toLowerCase();

/** Вынимает «#теги» из текста задачи: «Купить масло #купить» → текст + теги.
 *  Так теги можно надиктовывать прямо в строке ввода. */
export function extractTags(text: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const cleaned = text
    .replace(/(^|\s)#([^\s#]+)/g, (_m, space: string, tag: string) => {
      const t = normTag(tag);
      if (t && !tags.includes(t)) tags.push(t);
      return space;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: cleaned, tags };
}

export interface TaskFilter {
  /** Показывать только эти теги (И — задача должна иметь все). */
  tags?: string[];
  /** Показывать только эти статусы; пусто — все, кроме 'someday'. */
  statuses?: TaskStatus[];
  /** Только эта важность и выше. */
  minPriority?: TaskPriority;
  /** Не длиннее стольких минут. */
  maxSize?: number;
  /** Показывать выполненные. */
  withDone?: boolean;
  /** Поиск по тексту. */
  query?: string;
}

export function matchesFilter(it: ChecklistItem, f: TaskFilter): boolean {
  if (!f.withDone && it.done) return false;
  const status = taskStatus(it);
  if (f.statuses?.length) {
    if (!f.statuses.includes(status)) return false;
  } else if (status === 'someday') {
    // Замыслы не мешаются в общем списке, пока их не спросили явно.
    return false;
  }
  if (f.tags?.length && !f.tags.every((t) => (it.tags ?? []).includes(t))) return false;
  if (f.minPriority && PRIORITY_META[taskPriority(it)].rank > PRIORITY_META[f.minPriority].rank) {
    return false;
  }
  if (f.maxSize && (it.sizeMin ?? Infinity) > f.maxSize) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    const hay = `${it.text} ${it.desc ?? ''} ${(it.tags ?? []).join(' ')}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Просрочена ли задача (есть день, он в прошлом, и она не сделана). */
export const isOverdue = (ref: TaskRef, today = todayKey()): boolean =>
  !ref.item.done && !!ref.date && ref.date < today && taskStatus(ref.item) === 'active';

/** Порядок «чем заняться»: важное выше, потом мелкое (его закрывают быстрее),
 *  потом по дате. */
export function byUrgency(a: TaskRef, b: TaskRef): number {
  const pa = PRIORITY_META[taskPriority(a.item)].rank;
  const pb = PRIORITY_META[taskPriority(b.item)].rank;
  if (pa !== pb) return pa - pb;
  const sa = a.item.sizeMin ?? 999;
  const sb = b.item.sizeMin ?? 999;
  if (sa !== sb) return sa - sb;
  return (a.date ?? '9999').localeCompare(b.date ?? '9999');
}

/** Разбор дня: просрочено, на сегодня, «жду» и предложения из бэклога.
 *  Это ответ на вопрос «что мне делать», а не «что у меня вообще есть». */
export function todayPlan(checklists: Checklist[], today = todayKey(), suggest = 3) {
  const all = flattenTasks(checklists).filter((r) => !r.item.done);
  const active = all.filter((r) => taskStatus(r.item) === 'active');

  const overdue = active.filter((r) => r.date && r.date < today).sort(byUrgency);
  const dueToday = active.filter((r) => r.date === today).sort(byUrgency);
  const waiting = all.filter((r) => taskStatus(r.item) === 'waiting').sort(byUrgency);

  // Предложения — недатированные активные задачи: важные и мелкие вперёд.
  const suggestions = active
    .filter((r) => !r.date)
    .sort(byUrgency)
    .slice(0, suggest);

  return { overdue, dueToday, waiting, suggestions };
}

/** Следующий срок повторяющейся задачи. */
export function nextDate(dateKey: string, repeat: Repeat): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  switch (repeat) {
    case 'daily':
      return addDaysKey(dateKey, 1);
    case 'weekly':
      return addDaysKey(dateKey, 7);
    case 'monthly': {
      const next = new Date(y, m, d); // месяц +1: Date сам нормализует 31-е
      return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(
        next.getDate(),
      ).padStart(2, '0')}`;
    }
    case 'yearly':
      return `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    default:
      return dateKey;
  }
}

/**
 * Отметка «сделано» с учётом повтора.
 *
 * Обычная задача просто меняет галочку. Повторяющаяся не закрывается, а уезжает
 * на следующий срок — иначе пришлось бы каждый раз заводить её заново (сейчас
 * так живут уколы и оплата света, но событиями, без галочки).
 */
export function toggleWithRepeat(it: ChecklistItem, today = todayKey()): ChecklistItem {
  const repeat = it.repeat ?? 'none';
  if (it.done || repeat === 'none') return { ...it, done: !it.done };

  const from = it.date && it.date >= today ? it.date : today;
  const next = nextDate(from, repeat);
  if (it.repeatUntil && next > it.repeatUntil) return { ...it, done: true };
  return { ...it, done: false, date: next, remindAt: null };
}
