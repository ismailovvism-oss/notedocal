// Редактор «как видишь» на CodeMirror 6 — как живой просмотр Obsidian (docs/ЗАМЕТКИ.md, этап 2).
// Текст остаётся markdown один в один, значки разметки просто не показываются: там, где
// стоит курсор, они проступают, чтобы их можно было поправить. Поэтому правка ничего не
// теряет — ни свойства Obsidian, ни таблицы, ни метки на словах.
//
// Метки на словах (`<span data-a>`) не проступают никогда: это служебное. Их теги нельзя
// стереть наполовину — Backspace перешагивает их, а удаление выделения оставляет теги
// на месте (пустые обёртки убирает dropEmptyAnchors при сохранении).

import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { KbIndex } from './index.ts';
import { anchorCounts, fragmentOf, resolveName } from './index.ts';
import { maskInert, splitLinkInner } from './syntax.ts';
import { calloutMeta } from './callouts.ts';

/** Что редактор знает о базе: указатель (для ссылок и встраиваний) и чья это заметка. */
export interface LiveCtx {
  index?: KbIndex;
  noteId?: string;
  render?: (md: string, noteId: string) => string;
}

export const setLiveCtx = StateEffect.define<LiveCtx>();
const ctxField = StateField.define<LiveCtx>({
  create: () => ({}),
  update: (v, tr) => tr.effects.find((e) => e.is(setLiveCtx))?.value ?? v,
});

/** Отложенные куски будущего фрагмента («＋ кусок»): подсвечены и сдвигаются вместе с текстом. */
export const addPiece = StateEffect.define<{ from: number; to: number }>();
export const clearPieces = StateEffect.define<null>();
const pieceMark = Decoration.mark({ class: 'cm-piece' });
export const piecesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    v = v.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(addPiece) && e.value.to > e.value.from) v = v.update({ add: [pieceMark.range(e.value.from, e.value.to)], sort: true });
      if (e.is(clearPieces)) v = Decoration.none;
    }
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Куски, отложенные кнопкой «＋ кусок». */
export function pendingPieces(state: EditorState): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  state.field(piecesField, false)?.between(0, state.doc.length, (from, to) => {
    out.push({ from, to });
  });
  return out;
}

class Bullet extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-bullet';
    s.textContent = '•';
    return s;
  }
}

class Checkbox extends WidgetType {
  readonly checked: boolean;
  readonly pos: number;
  constructor(checked: boolean, pos: number) {
    super();
    this.checked = checked;
    this.pos = pos;
  }
  eq(o: Checkbox) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-task';
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

/** Иконка выноски (и заголовок по умолчанию, если своего нет) вместо `[!type]`. */
class CalloutHead extends WidgetType {
  readonly type: string;
  readonly withTitle: boolean;
  constructor(type: string, withTitle: boolean) {
    super();
    this.type = type;
    this.withTitle = withTitle;
  }
  eq(o: CalloutHead) {
    return o.type === this.type && o.withTitle === this.withTitle;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-callout-icon';
    const m = calloutMeta(this.type);
    s.textContent = this.withTitle ? `${m.icon} ${m.title}` : `${m.icon} `;
    return s;
  }
}

class BlockIdMark extends WidgetType {
  readonly name: string;
  readonly links: number;
  readonly comments: number;
  constructor(name: string, links: number, comments: number) {
    super();
    this.name = name;
    this.links = links;
    this.comments = comments;
  }
  eq(o: BlockIdMark) {
    return o.name === this.name && o.links === this.links && o.comments === this.comments;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-blockid';
    s.dataset.blk = this.name;
    s.textContent = `${this.comments ? `💬${this.comments}` : ''}${this.links ? `↩${this.links}` : ''}` || '¶';
    s.title = `Метка абзаца ^${this.name}`;
    return s;
  }
}

class HtmlBlock extends WidgetType {
  readonly html: string;
  readonly cls: string;
  constructor(html: string, cls: string) {
    super();
    this.html = html;
    this.cls = cls;
  }
  eq(o: HtmlBlock) {
    return o.html === this.html;
  }
  toDOM() {
    const d = document.createElement('div');
    d.className = `md ${this.cls}`;
    d.innerHTML = this.html;
    return d;
  }
  ignoreEvent() {
    return false;
  }
}

class VoiceMark extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'kb-voice';
    s.textContent = '🎤 …';
    s.title = 'Сюда встанет надиктованное, когда окно на компьютере его распознает';
    return s;
  }
}

const hide = Decoration.replace({});
const mark = (cls: string, attrs?: Record<string, string>) => Decoration.mark({ class: cls, attributes: attrs });

interface Built {
  deco: DecorationSet;
  atomic: DecorationSet;
}

function touches(state: EditorState, from: number, to: number): boolean {
  if (!state.selection) return false;
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function build(state: EditorState): Built {
  const doc = state.doc.toString();
  const ctx = state.field(ctxField);
  const out: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const hidden = new Set<string>(); // чтобы не скрыть один кусок дважды
  const hideRange = (from: number, to: number) => {
    if (to <= from || hidden.has(`${from}:${to}`)) return;
    hidden.add(`${from}:${to}`);
    out.push(hide.range(from, to));
  };
  const lineOf = (pos: number) => state.doc.lineAt(pos);
  const onLine = (pos: number) => {
    const l = lineOf(pos);
    return touches(state, l.from, l.to);
  };
  const tableLines: [number, number][] = [];

  syntaxTree(state).iterate({
    enter: (n) => {
      const name = n.name;
      const h = /^ATXHeading(\d)$/.exec(name);
      if (h) {
        out.push(Decoration.line({ class: `cm-h cm-h${h[1]}` }).range(lineOf(n.from).from));
        return;
      }
      switch (name) {
        case 'HeaderMark': {
          if (!onLine(n.from)) {
            const after = doc[n.to] === ' ' ? n.to + 1 : n.to;
            hideRange(n.from, after);
          }
          return;
        }
        case 'Blockquote': {
          // выноска Obsidian `> [!type] Заголовок`: рамка с иконкой; разметка видна, только когда
          // курсор внутри неё
          const first = lineOf(n.from);
          const co = /^(\s*>\s?)\[!([\w-]+)\]([+-]?)[ \t]*/.exec(first.text);
          const last = lineOf(n.to).number;
          for (let l = first.number; l <= last; l++) {
            const cls = co
              ? `cm-callout cm-callout-${co[2].toLowerCase()}${l === first.number ? ' cm-callout-head' : ''}${l === last ? ' cm-callout-last' : ''}`
              : 'cm-quote';
            out.push(Decoration.line({ class: cls }).range(state.doc.line(l).from));
          }
          if (co && !touches(state, n.from, n.to)) {
            const start = first.from + co[1].length;
            const own = first.text.slice(co[0].length).trim();
            out.push(Decoration.replace({ widget: new CalloutHead(co[2], !own) }).range(start, first.from + co[0].length));
          }
          return;
        }
        case 'QuoteMark': {
          if (!onLine(n.from)) hideRange(n.from, doc[n.to] === ' ' ? n.to + 1 : n.to);
          return;
        }
        case 'FencedCode': {
          for (let l = lineOf(n.from).number; l <= lineOf(n.to).number; l++) {
            out.push(Decoration.line({ class: 'cm-fence' }).range(state.doc.line(l).from));
          }
          return false;
        }
        case 'ListMark': {
          const bullet = /[-*+]/.test(doc[n.from]);
          if (bullet && !touches(state, n.from, n.to)) out.push(Decoration.replace({ widget: new Bullet() }).range(n.from, n.to));
          return;
        }
        case 'TaskMarker': {
          if (!touches(state, n.from, n.to)) {
            out.push(Decoration.replace({ widget: new Checkbox(/x/i.test(doc[n.from + 1]), n.from) }).range(n.from, n.to));
          }
          return;
        }
        case 'StrongEmphasis':
        case 'Emphasis':
        case 'Strikethrough':
        case 'InlineCode': {
          const cls = { StrongEmphasis: 'cm-strong', Emphasis: 'cm-em', Strikethrough: 'cm-strike', InlineCode: 'cm-code' }[name]!;
          out.push(mark(cls).range(n.from, n.to));
          if (!touches(state, n.from, n.to)) {
            const marks = name === 'InlineCode' ? 'CodeMark' : name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark';
            for (let c = n.node.firstChild; c; c = c.nextSibling) if (c.name === marks) hideRange(c.from, c.to);
          }
          return name === 'InlineCode' ? false : undefined;
        }
        case 'Link': {
          const node = n.node;
          const marks = node.getChildren('LinkMark');
          if (marks.length >= 2 && doc[n.from] !== '!') {
            out.push(mark('cm-mdlink').range(marks[0].to, marks[1].from));
            if (!touches(state, n.from, n.to)) {
              hideRange(marks[0].from, marks[0].to);
              hideRange(marks[1].from, n.to);
            }
          }
          return false;
        }
        case 'Table': {
          tableLines.push([lineOf(n.from).from, lineOf(n.to).to]);
          return false;
        }
        case 'HorizontalRule': {
          if (!touches(state, n.from, n.to)) out.push(Decoration.line({ class: 'cm-hr' }).range(lineOf(n.from).from));
          return;
        }
      }
    },
  });

  // арабская строка — справа налево (стрелки и выделение тоже идут по ней правильно)
  for (let l = 1; l <= state.doc.lines; l++) {
    const line = state.doc.line(l);
    const letters = line.text.match(/\p{L}/gu)?.length ?? 0;
    const ar = line.text.match(/[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]/g)?.length ?? 0;
    if (letters && ar * 2 > letters) out.push(Decoration.line({ attributes: { dir: 'rtl' }, class: 'cm-rtl' }).range(line.from));
  }

  // своё: вики-ссылки, встраивания, теги, ==выделение==, метки — по тексту без кода
  const masked = maskInert(doc, { comments: false });
  const counts = ctx.index && ctx.noteId ? anchorCounts(ctx.index, ctx.noteId) : new Map();

  for (const m of masked.matchAll(/(!?)\[\[([^[\]\n]+?)\]\]/g)) {
    const from = m.index!;
    const to = from + m[0].length;
    const p = splitLinkInner(m[2]);
    const found = !p.target ? ctx.noteId : ctx.index ? resolveName(ctx.index, p.target).note?.id : undefined;
    if (m[1] && !touches(state, from, to) && ctx.index && found && ctx.render) {
      const piece = fragmentOf(ctx.index, found, p);
      const title = ctx.index.byId.get(found)?.title ?? p.target;
      const html =
        `<a class="kb-link kb-embed-head" href="#" data-target="${esc(p.target)}"${p.anchor ? ` data-anchor="${esc(p.anchor)}"` : ''}${p.heading ? ` data-heading="${esc(p.heading)}"` : ''}>↳ ${esc(title)}</a>` +
        (piece === null ? '<div class="kb-embed-gone">фрагмент удалён</div>' : `<div class="kb-embed-body">${ctx.render(piece, found)}</div>`);
      out.push(Decoration.replace({ widget: new HtmlBlock(html, 'kb-embed cm-embed') }).range(from, to));
      continue;
    }
    const attrs: Record<string, string> = { 'data-target': p.target };
    if (p.anchor) attrs['data-anchor'] = p.anchor;
    if (p.heading) attrs['data-heading'] = p.heading;
    const missing = ctx.index && p.target && !found;
    out.push(mark(`cm-wikilink kb-link${missing ? ' kb-missing' : ''}`, attrs).range(from, to));
    if (!touches(state, from, to)) {
      const inner = from + 2 + m[1].length;
      const bar = m[2].indexOf('|');
      if (bar >= 0) hideRange(from, inner + bar + 1);
      else {
        hideRange(from, inner);
        const hash = m[2].indexOf('#');
        if (hash > 0) hideRange(inner + hash, to - 2);
      }
      hideRange(to - 2, to);
    }
  }

  for (const m of masked.matchAll(/(^|[\s(])(#[\p{L}\p{N}_/-]*[\p{L}_-][\p{L}\p{N}_/-]*)/gu)) {
    const from = m.index! + m[1].length;
    if (lineOf(from).from === from && /^#{1,6}\s/.test(doc.slice(from))) continue;
    out.push(mark('kb-tag cm-tag').range(from, from + m[2].length));
  }

  for (const m of masked.matchAll(/==([^=\n](?:[^\n]*?[^=\n])?)==/g)) {
    const from = m.index!;
    const to = from + m[0].length;
    out.push(mark('cm-mark').range(from, to));
    if (!touches(state, from, to)) {
      hideRange(from, from + 2);
      hideRange(to - 2, to);
    }
  }

  // метка диктовки %%🎤:id%% — сюда окно поставит распознанное
  for (const m of masked.matchAll(/%%🎤:([a-z0-9]+)%%/g)) {
    out.push(Decoration.replace({ widget: new VoiceMark() }).range(m.index!, m.index! + m[0].length));
  }

  for (let i = doc.indexOf('%%'); i >= 0; ) {
    if (masked[i] !== '%') {
      i = doc.indexOf('%%', i + 2);
      continue;
    }
    const j = doc.indexOf('%%', i + 2);
    const end = j < 0 ? doc.length : j + 2;
    out.push(mark('cm-hidden-text').range(i, end));
    i = j < 0 ? -1 : doc.indexOf('%%', end);
  }

  for (const m of masked.matchAll(/[ \t]\^([A-Za-z0-9-]+)[ \t]*$/gm)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (touches(state, from, to)) {
      out.push(mark('cm-blockid-src').range(from, to));
      continue;
    }
    const c = counts.get(m[1].toLowerCase());
    out.push(Decoration.replace({ widget: new BlockIdMark(m[1], c?.links ?? 0, c?.comments ?? 0) }).range(from, to));
  }

  // метки на словах: теги всегда спрятаны и неделимы, слова подчёркнуты
  const stack: { name: string | null; from: number; to: number }[] = [];
  const seen = new Set<string>();
  for (const m of masked.matchAll(/<span\b[^>]*>|<\/span\s*>/gi)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (m[0].startsWith('</')) {
      const o = stack.pop();
      if (!o?.name) continue;
      hideRange(o.from, o.to);
      hideRange(from, to);
      atomic.push(hide.range(o.from, o.to), hide.range(from, to));
      if (o.to < from) {
        const key = o.name.toLowerCase();
        const c = counts.get(key);
        const attrs: Record<string, string> = { 'data-a': o.name };
        if (!seen.has(key)) {
          if (c?.links) attrs['data-n'] = String(c.links);
          if (c?.comments) attrs['data-c'] = String(c.comments);
        }
        seen.add(key);
        out.push(mark(`kb-a${c?.comments ? ' kb-commented' : ''}`, attrs).range(o.to, from));
      }
    } else {
      stack.push({ name: m[0].match(/\bdata-a\s*=\s*"([A-Za-z0-9-]+)"/i)?.[1] ?? null, from, to });
    }
  }
  for (const m of masked.matchAll(/<(u|mark|sub|sup)>([^<\n]*)<\/\1>/gi)) {
    const from = m.index!;
    const to = from + m[0].length;
    out.push(mark(`cm-html-${m[1].toLowerCase()}`).range(from, to));
    if (!touches(state, from, to)) {
      hideRange(from, from + m[1].length + 2);
      hideRange(to - m[1].length - 3, to);
    }
  }

  // таблица без курсора — готовой таблицей; с курсором — текстом
  for (const [from, to] of tableLines) {
    if (touches(state, from, to) || !ctx.render) continue;
    out.push(Decoration.replace({ widget: new HtmlBlock(ctx.render(doc.slice(from, to), ctx.noteId ?? ''), 'cm-table'), block: true }).range(from, to));
  }

  return { deco: Decoration.set(dedupe(out), true), atomic: Decoration.set(atomic, true) };
}

/** Замены не должны пересекаться: CodeMirror падает на перекрытых заменах. */
function dedupe(list: Range<Decoration>[]): Range<Decoration>[] {
  const replaces = list.filter((r) => r.value.spec.widget !== undefined || (r.from < r.to && r.value === hide) || r.value.spec.block);
  const others = list.filter((r) => !replaces.includes(r));
  replaces.sort((a, b) => a.from - b.from || b.to - a.to);
  const kept: Range<Decoration>[] = [];
  let end = -1;
  for (const r of replaces) {
    if (r.from < end) continue;
    if (r.from === r.to && r.from === end) continue;
    kept.push(r);
    end = r.to;
  }
  return [...others, ...kept];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const liveField = StateField.define<Built>({
  create: (state) => build(state),
  update(v, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setLiveCtx)) || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return build(tr.state);
    }
    return v;
  },
  provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), EditorView.atomicRanges.of((view) => view.state.field(f).atomic)],
});

/** Где спрятанные теги меток: правки внутри них не пропускаются (кроме своих, с filter: false). */
const protectTags = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged) return true;
  const set = tr.startState.field(liveField).atomic;
  const ranges: number[] = [];
  set.between(0, tr.startState.doc.length, (from, to) => {
    ranges.push(from, to);
  });
  return ranges.length ? ranges : true;
});

/** Backspace и Delete перешагивают спрятанные теги меток и стирают видимую букву за ними. */
export function deleteSkippingTags(view: EditorView, forward: boolean): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const set = state.field(liveField).atomic;
  let pos = sel.head;
  let moved = false;
  for (;;) {
    let jumped = false;
    set.between(forward ? pos : pos - 1, forward ? pos + 1 : pos, (from, to) => {
      if (forward ? from === pos : to === pos) {
        pos = forward ? to : from;
        jumped = true;
        moved = true;
        return false;
      }
    });
    if (!jumped) break;
  }
  if (!moved) return false;
  const target = forward ? pos + 1 : pos - 1;
  if (target < 0 || target > state.doc.length) return true;
  const from = Math.min(pos, target);
  const to = Math.max(pos, target);
  view.dispatch({ changes: { from, to }, selection: { anchor: forward ? sel.head : sel.head - 1 }, userEvent: 'delete' });
  return true;
}

export function livePreview(): Extension {
  return [ctxField, liveField, piecesField, protectTags];
}
