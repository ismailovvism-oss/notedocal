// Поиск и замена в тексте заметки (как в «Вычитке»: Ctrl+F, Ctrl+H). Все совпадения подсвечены,
// текущее — ярче; счётчик «2 из 7». Регистр по умолчанию не различается; арабский ищется без
// учёта огласовок (набрал без харакятов — найдёт с ними). Замена — обычной правкой: Ctrl+Z
// отменяет, «Заменить всё» — одним шагом.

import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

interface FindState {
  query: string;
  cased: boolean;
  /** Номер текущего совпадения (с 0); -1 — нет. */
  cur: number;
  ranges: { from: number; to: number }[];
}

const AR_LETTER = /[ء-يٱ-ۓ]/;
const HARAKAT = '[\\u064b-\\u065f\\u0670\\u0640\\u06d6-\\u06ed]*';

/** Строка поиска → выражение: дословно, а после арабской буквы допускаются огласовки. */
function toRegex(query: string, cased: boolean): RegExp | null {
  if (!query) return null;
  let src = '';
  for (const ch of query.replace(/[ً-ٰٟـ]/g, '')) {
    src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (AR_LETTER.test(ch)) src += HARAKAT;
  }
  try {
    return new RegExp(src, cased ? 'gu' : 'giu');
  } catch {
    return null;
  }
}

function matches(doc: string, query: string, cased: boolean) {
  const re = toRegex(query, cased);
  const out: { from: number; to: number }[] = [];
  if (!re) return out;
  for (const m of doc.matchAll(re)) {
    if (!m[0].length) continue;
    out.push({ from: m.index!, to: m.index! + m[0].length });
    if (out.length >= 5000) break;
  }
  return out;
}

const setFind = StateEffect.define<{ query: string; cased: boolean; cur?: number }>();

const mark = Decoration.mark({ class: 'cm-find' });
const markCur = Decoration.mark({ class: 'cm-find cm-find-cur' });

const field = StateField.define<FindState>({
  create: () => ({ query: '', cased: false, cur: -1, ranges: [] }),
  update(v, tr) {
    let next = v;
    for (const e of tr.effects) {
      if (!e.is(setFind)) continue;
      const ranges = matches(tr.state.doc.toString(), e.value.query, e.value.cased);
      const cur = e.value.cur !== undefined ? e.value.cur : ranges.length ? 0 : -1;
      next = { query: e.value.query, cased: e.value.cased, ranges, cur: ranges.length ? Math.min(Math.max(cur, 0), ranges.length - 1) : -1 };
    }
    if (tr.docChanged && next.query && next === v) {
      const ranges = matches(tr.state.doc.toString(), v.query, v.cased);
      next = { ...v, ranges, cur: ranges.length ? Math.min(Math.max(v.cur, 0), ranges.length - 1) : -1 };
    }
    return next;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (v): DecorationSet =>
      Decoration.set(v.ranges.map((r, i) => (i === v.cur ? markCur : mark).range(r.from, r.to))),
    ),
});

export const findExt: Extension = field;

export interface FindInfo {
  /** Номер текущего совпадения с 1 (0 — нет совпадений). */
  i: number;
  n: number;
}

const info = (view: EditorView): FindInfo => {
  const s = view.state.field(field);
  return { i: s.cur + 1, n: s.ranges.length };
};

const show = (view: EditorView) => {
  const s = view.state.field(field);
  const r = s.ranges[s.cur];
  if (r) view.dispatch({ effects: EditorView.scrollIntoView(r.from, { y: 'center' }) });
};

/** Искать: подсветить всё, текущим сделать ближайшее от курсора вниз. */
export function find(view: EditorView, query: string, cased: boolean): FindInfo {
  const head = view.state.selection.main.from;
  const ranges = matches(view.state.doc.toString(), query, cased);
  const near = ranges.findIndex((r) => r.to >= head);
  view.dispatch({ effects: setFind.of({ query, cased, cur: near < 0 ? 0 : near }) });
  show(view);
  return info(view);
}

/** К следующему (dir = 1) или предыдущему (-1) совпадению, по кругу. */
export function findStep(view: EditorView, dir: 1 | -1): FindInfo {
  const s = view.state.field(field);
  if (!s.ranges.length) return { i: 0, n: 0 };
  const cur = (s.cur + dir + s.ranges.length) % s.ranges.length;
  view.dispatch({ effects: setFind.of({ query: s.query, cased: s.cased, cur }) });
  show(view);
  return info(view);
}

/** Заменить текущее совпадение и перейти к следующему. */
export function replaceOne(view: EditorView, text: string): FindInfo {
  const s = view.state.field(field);
  const r = s.ranges[s.cur];
  if (!r) return info(view);
  view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, filter: false });
  // после замены совпадения пересчитались; текущим остаётся то же место в списке
  const after = view.state.field(field);
  view.dispatch({ effects: setFind.of({ query: after.query, cased: after.cased, cur: Math.min(s.cur, after.ranges.length - 1) }) });
  show(view);
  return info(view);
}

/** Заменить все совпадения одним шагом (Ctrl+Z вернёт разом); сколько заменено. */
export function replaceAll(view: EditorView, text: string): number {
  const s = view.state.field(field);
  if (!s.ranges.length) return 0;
  view.dispatch({ changes: s.ranges.map((r) => ({ from: r.from, to: r.to, insert: text })), filter: false });
  return s.ranges.length;
}

/** Убрать подсветку поиска. */
export function findClear(view: EditorView) {
  view.dispatch({ effects: setFind.of({ query: '', cased: false }) });
}
