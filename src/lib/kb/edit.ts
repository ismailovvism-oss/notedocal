// Правки текста заметки под действия редактора (docs/ЗАМЕТКИ.md, 3.1): поставить метку на
// выделенные слова или абзац, снять её, заменить слова ссылкой, найти в тексте место,
// которое выделили на экране. Работает с исходным markdown, без React — его же зовут тесты.
//
// Главная забота — не сломать разметку. Метка на словах — `<span data-a>`, и теги HTML
// не должны перекрещиваться ни с другими метками, ни с `**жирным**`, ни с переносом строки.
// Поэтому выделение режется на куски по «значкам», пара которых осталась снаружи, и каждый
// кусок оборачивается своей обёрткой с той же меткой — это и есть фрагмент из нескольких кусков.

import { findAnchors, maskInert, newAnchorName, splitLinkInner } from './syntax.ts';

export interface Span {
  from: number;
  to: number;
}

/** Значок разметки: его не видно в тексте «как видишь». `pair` — парный значок. */
interface Mark extends Span {
  kind: 'prefix' | 'delim' | 'open' | 'close' | 'hidden';
  pair?: Mark;
  name?: string;
}

/** Целое, которое нельзя резать: ссылка, код, тег — выделение расширяется до его краёв. */
type Atom = Span;

const LINE_PREFIX = /^([ \t]*(?:>[ \t]?)*)(?:(#{1,6}[ \t]+)|([-*+][ \t]+(?:\[[ xX]\][ \t]+)?)|(\d+[.)][ \t]+(?:\[[ xX]\][ \t]+)?))?(?:\[![\w-]+\][-+]?[ \t]*)?/;
const BLOCK_ID_AT_END = /[ \t]\^([A-Za-z0-9-]+)[ \t]*$/;

/** Разобрать текст на значки разметки и неделимые куски. */
function scan(src: string): { marks: Mark[]; atoms: Atom[]; masked: string } {
  const masked = maskInert(src, { comments: false });
  const marks: Mark[] = [];
  const atoms: Atom[] = [];

  // %%скрытое%% — целиком невидимо
  const withHidden = maskInert(src);
  for (let i = 0; i < src.length; i++) {
    if (withHidden[i] === ' ' && masked[i] !== ' ' && src.slice(i, i + 2) === '%%') {
      const j = src.indexOf('%%', i + 2);
      const end = j < 0 ? src.length : j + 2;
      marks.push({ from: i, to: end, kind: 'hidden' });
      i = end - 1;
    }
  }

  let lineStart = 0;
  let fenced = false;
  while (lineStart <= src.length) {
    const nl = src.indexOf('\n', lineStart);
    const lineEnd = nl < 0 ? src.length : nl;
    const line = src.slice(lineStart, lineEnd);
    if (/^[ \t]{0,3}(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      marks.push({ from: lineStart, to: lineEnd, kind: 'hidden' });
    } else if (fenced) {
      atoms.push({ from: lineStart, to: lineEnd });
    } else if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && line.includes('|')) {
      marks.push({ from: lineStart, to: lineEnd, kind: 'hidden' }); // строка-разделитель таблицы
    } else {
      const p = LINE_PREFIX.exec(line);
      if (p && p[0].length) marks.push({ from: lineStart, to: lineStart + p[0].length, kind: 'prefix' });
      const b = BLOCK_ID_AT_END.exec(masked.slice(lineStart, lineEnd));
      if (b) marks.push({ from: lineStart + b.index, to: lineEnd, kind: 'hidden', name: b[1] });
      if (/^\s*\|/.test(line)) {
        for (let i = line.indexOf('|'); i >= 0; i = line.indexOf('|', i + 1)) {
          if (line[i - 1] !== '\\') marks.push({ from: lineStart + i, to: lineStart + i + 1, kind: 'prefix' });
        }
      }
    }
    if (nl < 0) break;
    lineStart = nl + 1;
  }

  // неделимое: код в строке, вики-ссылки и встраивания, ссылки markdown, теги
  for (let i = 0; i < src.length; i++) {
    if (masked[i] === ' ' && src[i] === '`') {
      let j = i;
      while (j < src.length && masked[j] === ' ' && src[j] !== '\n') j++;
      atoms.push({ from: i, to: j });
      i = j - 1;
    }
  }
  for (const m of masked.matchAll(/!?\[\[[^[\]\n]+?\]\]/g)) atoms.push({ from: m.index!, to: m.index! + m[0].length });
  for (const m of masked.matchAll(/!?\[[^\]\n]*\]\([^)\n]*\)/g)) atoms.push({ from: m.index!, to: m.index! + m[0].length });
  for (const m of masked.matchAll(/(^|[\s(])(#[\p{L}\p{N}_/-]*[\p{L}_-][\p{L}\p{N}_/-]*)/gu)) {
    const from = m.index! + m[1].length;
    atoms.push({ from, to: from + m[2].length });
  }

  // теги HTML: пары по имени тега, стеком
  const stacks = new Map<string, number[]>();
  for (const m of masked.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^<>\n]*?(\/?)>/g)) {
    if (m[3]) continue; // <br/>
    const tag = m[2].toLowerCase();
    if (!m[1] && ['br', 'img', 'hr', 'input', 'wbr'].includes(tag)) continue;
    const idx = marks.length;
    const name = !m[1] ? m[0].match(/\bdata-a\s*=\s*"([A-Za-z0-9-]+)"/i)?.[1] : undefined;
    marks.push({ from: m.index!, to: m.index! + m[0].length, kind: m[1] ? 'close' : 'open', name });
    const st = stacks.get(tag) ?? [];
    stacks.set(tag, st);
    if (!m[1]) st.push(idx);
    else {
      const o = st.pop();
      if (o !== undefined) {
        marks[o].pair = marks[idx];
        marks[idx].pair = marks[o];
      }
    }
  }

  // значки оформления: ** __ ~~ == * _ — пары в пределах абзаца, по порядку
  const inAtom = (i: number) => atoms.some((a) => i >= a.from && i < a.to);
  const inMark = (i: number) => marks.some((m) => i >= m.from && i < m.to);
  const DELIM = /\*\*|__|~~|==|\*|_/g;
  let paraStart = 0;
  const paras = masked.split(/\n[ \t]*\n/);
  for (const para of paras) {
    const open = new Map<string, number>();
    for (const m of para.matchAll(DELIM)) {
      const at = paraStart + m.index!;
      if (inAtom(at) || inMark(at)) continue;
      const d = m[0];
      if (d === '_' || d === '__') {
        // _ внутри слова — не значок (snake_case)
        const before = src[at - 1] ?? ' ';
        const after = src[at + d.length] ?? ' ';
        if (/[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)) continue;
      }
      if (d === '*' && (src[at + 1] === ' ' || src[at + 1] === undefined) && (src[at - 1] === ' ' || at === 0)) continue;
      const idx = marks.length;
      marks.push({ from: at, to: at + d.length, kind: 'delim' });
      const o = open.get(d);
      if (o === undefined) open.set(d, idx);
      else {
        marks[o].pair = marks[idx];
        marks[idx].pair = marks[o];
        open.delete(d);
      }
    }
    paraStart += para.length + (masked.slice(paraStart + para.length).match(/^\n[ \t]*\n/)?.[0].length ?? 0);
  }

  // \* — экранирование: обратная косая не видна
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\\' && /[*_~=`#[\]\\|<>]/.test(src[i + 1] ?? '') && masked[i] === '\\') {
      marks.push({ from: i, to: i + 1, kind: 'hidden' });
      i++;
    }
  }

  marks.sort((a, b) => a.from - b.from);
  return { marks, atoms, masked };
}

/** Видимый текст заметки и откуда в исходнике каждая его буква. */
export interface Plain {
  text: string;
  /** map[i] — позиция буквы i в исходнике; map[text.length] — конец исходника. */
  map: number[];
}

/** Текст «как видишь»: без значков разметки, встраиваний и скрытого. */
export function plainOf(src: string): Plain {
  const { marks } = scan(src);
  const hide = new Uint8Array(src.length);
  for (const m of marks) hide.fill(1, m.from, m.to);
  for (const m of src.matchAll(/!\[\[[^[\]\n]+?\]\]/g)) hide.fill(1, m.index!, m.index! + m[0].length);
  // у вики-ссылки видна подпись, а без неё — название
  for (const m of maskInert(src).matchAll(/(?<!!)\[\[([^[\]\n]+?)\]\]/g)) {
    const inner = m[1];
    const bar = inner.indexOf('|');
    const start = m.index! + 2;
    hide.fill(1, m.index!, m.index! + m[0].length);
    if (bar >= 0) hide.fill(0, start + bar + 1, start + inner.length);
    else {
      const hash = inner.indexOf('#');
      hide.fill(0, start, start + (hash >= 0 ? hash : inner.length));
    }
  }
  // у ссылки markdown видна только подпись
  for (const m of maskInert(src).matchAll(/(?<!!)\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    hide[m.index!] = 1;
    hide.fill(1, m.index! + 1 + m[1].length, m.index! + m[0].length);
  }
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (hide[i]) continue;
    text += src[i];
    map.push(i);
  }
  map.push(src.length);
  return { text, map };
}

/** Схлопнуть пробелы — для сравнения выделенного на экране с текстом заметки. */
function squeeze(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) {
      if (!space && text) {
        text += ' ';
        map.push(i);
      }
      space = true;
    } else {
      text += s[i];
      map.push(i);
      space = false;
    }
  }
  map.push(s.length);
  return { text, map };
}

/**
 * Найти в исходнике то, что выделили на экране. `before` — видимый текст перед выделением:
 * по нему понятно, какое по счёту это вхождение, если слова повторяются.
 * Не нашлось — null (экран и текст разошлись: таблица, сноска…).
 */
export function locateSelection(src: string, selected: string, before = ''): Span | null {
  const plain = plainOf(src);
  const sq = squeeze(plain.text);
  const want = squeeze(selected).text.trim();
  if (!want) return null;
  const prior = squeeze(before + selected).text;
  let nth = 0;
  for (let i = prior.indexOf(want); i >= 0 && i < prior.length - want.length; i = prior.indexOf(want, i + 1)) nth++;
  let at = -1;
  const hits: number[] = [];
  for (let i = sq.text.indexOf(want); i >= 0; i = sq.text.indexOf(want, i + 1)) hits.push(i);
  if (!hits.length) return null;
  at = hits[Math.min(nth, hits.length - 1)];
  const pFrom = sq.map[at];
  const pTo = sq.map[at + want.length - 1] + 1;
  return { from: plain.map[pFrom], to: plain.map[pTo - 1] + 1 };
}

/** Абзац (или пункт списка), в котором стоит позиция: начало первой строки и конец последней. */
export function blockAt(src: string, pos: number): Span {
  let from = src.lastIndexOf('\n', pos - 1) + 1;
  let to = src.indexOf('\n', pos);
  if (to < 0) to = src.length;
  const isItem = (line: string) => /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s/.test(line) || /^\s*#{1,6}\s/.test(line);
  const lineAt = (s: number) => src.slice(s, (src.indexOf('\n', s) + 1 || src.length + 1) - 1);
  if (!isItem(lineAt(from))) {
    while (from > 0) {
      const prevStart = src.lastIndexOf('\n', from - 2) + 1;
      const prev = lineAt(prevStart);
      if (!prev.trim() || isItem(prev) || /^\s*(`{3,}|~{3,})/.test(prev)) break;
      from = prevStart;
    }
  }
  while (to < src.length) {
    const next = lineAt(to + 1);
    if (!next.trim() || isItem(next) || /^\s*(`{3,}|~{3,})/.test(next)) break;
    to = to + 1 + next.length;
  }
  return { from, to };
}

/** Позиция внутри ограждённого блока кода ``` (вместе со строками ограды). */
function inFence(src: string, pos: number): boolean {
  let fenced = false;
  for (let at = 0; at <= pos && at <= src.length; ) {
    const nl = src.indexOf('\n', at);
    const end = nl < 0 ? src.length : nl;
    const isFence = /^[ \t]{0,3}(`{3,}|~{3,})/.test(src.slice(at, end));
    if (pos <= end) return fenced || isFence;
    if (isFence) fenced = !fenced;
    if (nl < 0) break;
    at = nl + 1;
  }
  return false;
}

/** Видимый текст куска исходника, со схлопнутыми пробелами. */
function visible(src: string, span: Span): string {
  const p = plainOf(src);
  let s = '';
  for (let i = 0; i < p.text.length; i++) if (p.map[i] >= span.from && p.map[i] < span.to) s += p.text[i];
  return squeeze(s).text.trim();
}

/** Сузить кусок, чтобы по краям не было пробелов. Огласовку от буквы не отрывать: край,
 *  попавший между буквой и её харакатом, сдвигается так, чтобы буква осталась с огласовкой. */
function trimSpan(src: string, s: Span): Span {
  let { from, to } = s;
  while (from < to && /\s/.test(src[from])) from++;
  while (to > from && /\s/.test(src[to - 1])) to--;
  while (from > 0 && /\p{M}/u.test(src[from])) from--;
  while (to < src.length && /\p{M}/u.test(src[to])) to++;
  return { from, to };
}

export interface AnchorResult {
  text: string;
  name: string;
  /** Метка уже была на ровно этих словах — текст не менялся. */
  existed?: boolean;
  /** Метка поставлена абзацу (` ^name`), а не словам. */
  block?: boolean;
}

/** Метки, которые уже есть в заметке, — чтобы новая не совпала. */
export function anchorNames(src: string): string[] {
  return [...findAnchors(src).keys()];
}

/**
 * Поставить метку на выделенные куски. Один кусок, равный целому абзацу, — метка абзаца
 * ` ^name` (её понимает и Obsidian); иначе — `<span data-a="name">` на каждом куске.
 * Если ровно на этих словах метка уже есть — вернуть её, ничего не меняя.
 */
export function addAnchor(src: string, spans: Span[], opts: { name?: string; random?: () => number } = {}): AnchorResult {
  const pieces = spans.map((s) => trimSpan(src, s)).filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
  if (!pieces.length) throw new Error('Выделите слова');
  const anchors = findAnchors(src);
  if (pieces.some((p) => inFence(src, p.from) || inFence(src, p.to - 1))) throw new Error('В блоке кода метки не ставятся');

  // та же метка на тех же словах — не плодить вторую
  const want = pieces.map((p) => visible(src, p)).join(' | ');
  for (const [name, list] of anchors) {
    if (list.map((p) => visible(src, { from: p.start, to: p.end })).join(' | ') === want) {
      return { text: src, name, existed: true, block: list[0].kind === 'block' };
    }
  }

  const name = opts.name ?? newAnchorName(anchors.keys(), opts.random);

  if (pieces.length === 1) {
    const b = blockAt(src, pieces[0].from);
    const fullBlock = b.to >= pieces[0].to && visible(src, b).replace(/\s*\^[A-Za-z0-9-]+$/, '') === visible(src, pieces[0]);
    if (fullBlock && !/^\s*#{1,6}\s/.test(src.slice(b.from, b.to))) {
      const line = src.slice(b.from, b.to);
      const had = BLOCK_ID_AT_END.exec(line.slice(line.lastIndexOf('\n') + 1));
      if (had) return { text: src, name: had[1], existed: true, block: true };
      const end = b.to - (line.length - line.trimEnd().length);
      return { text: src.slice(0, end) + ` ^${name}` + src.slice(end), name, block: true };
    }
  }

  const runs = pieces.flatMap((p) => splitRuns(src, p));
  if (!runs.length) throw new Error('Выделите слова');
  let text = src;
  for (const r of [...runs].reverse()) {
    text = text.slice(0, r.from) + `<span data-a="${name}">` + text.slice(r.from, r.to) + '</span>' + text.slice(r.to);
  }
  return { text, name };
}

/**
 * Разрезать кусок на части, внутри которых нет перевода строки и нет «полузначков» —
 * значков, чья пара осталась снаружи куска. Неделимое (ссылка, код, тег) на краю
 * забирается целиком.
 */
export function splitRuns(src: string, span: Span): Span[] {
  const { marks, atoms } = scan(src);
  let { from, to } = span;
  for (const a of atoms) {
    if (a.from < from && a.to > from) from = a.from;
    if (a.from < to && a.to > to) to = a.to;
  }
  // значки, пересекающие края, — край сдвигается за них (внутрь куска)
  for (const m of marks) {
    if (m.from < from && m.to > from) from = m.to;
    if (m.from < to && m.to > to) to = m.from;
  }
  const breaks: Span[] = [];
  for (const m of marks) {
    if (m.to <= from || m.from >= to) continue;
    if (m.kind === 'prefix' || m.kind === 'hidden') {
      breaks.push(m);
      continue;
    }
    const pair = m.pair;
    if (!pair || pair.from < from || pair.to > to) breaks.push(m);
  }
  for (let i = src.indexOf('\n', from); i >= 0 && i < to; i = src.indexOf('\n', i + 1)) breaks.push({ from: i, to: i + 1 });
  breaks.sort((a, b) => a.from - b.from);
  const runs: Span[] = [];
  let at = from;
  for (const b of breaks) {
    if (b.from > at) runs.push({ from: at, to: b.from });
    at = Math.max(at, b.to);
  }
  if (at < to) runs.push({ from: at, to });
  return runs.map((r) => trimSpan(src, r)).filter((r) => r.to > r.from && src.slice(r.from, r.to).trim());
}

/** Снять метку: обёртки `<span data-a>` раскрываются, ` ^name` у абзаца убирается. */
export function removeAnchor(src: string, name: string): string {
  const masked = maskInert(src, { comments: false });
  const cut: Span[] = [];
  const stack: { name: string | null; open: Span }[] = [];
  for (const m of masked.matchAll(/<span\b[^>]*>|<\/span\s*>/gi)) {
    const at = { from: m.index!, to: m.index! + m[0].length };
    if (m[0].startsWith('</')) {
      const o = stack.pop();
      if (o?.name?.toLowerCase() === name.toLowerCase()) cut.push(o.open, at);
    } else stack.push({ name: m[0].match(/\bdata-a\s*=\s*"([A-Za-z0-9-]+)"/i)?.[1] ?? null, open: at });
  }
  for (const m of masked.matchAll(/[ \t]\^([A-Za-z0-9-]+)[ \t]*$/gm)) {
    if (m[1].toLowerCase() === name.toLowerCase()) cut.push({ from: m.index!, to: m.index! + m[0].length });
  }
  cut.sort((a, b) => b.from - a.from);
  let text = src;
  for (const c of cut) text = text.slice(0, c.from) + text.slice(c.to);
  return text;
}

/** Убрать пустые обёртки меток: слова удалили целиком, а теги остались. */
export function dropEmptyAnchors(src: string): string {
  let prev;
  let text = src;
  do {
    prev = text;
    text = text.replace(/<span\s+data-a="[A-Za-z0-9-]+">(\s*)<\/span>/g, '$1');
  } while (text !== prev);
  return text;
}

/** Метки, внутри которых стоит позиция (от внешней к внутренней), и метка абзаца. */
export function anchorsAt(src: string, pos: number): string[] {
  const out: string[] = [];
  for (const [name, list] of findAnchors(src)) {
    if (list.some((p) => (p.kind === 'span' ? pos >= p.start && pos <= p.end : pos >= p.start && pos <= p.end + 1 + name.length + 1)))
      out.push(name);
  }
  return out;
}

export interface LinkTarget {
  title: string;
  anchor?: string;
  heading?: string;
}

/** Вики-ссылка на цель с подписью. Подпись равна названию — без подписи, как пишет Obsidian. */
export function linkText(t: LinkTarget, alias?: string, sameNote = false): string {
  const target = (sameNote ? '' : t.title) + (t.heading ? `#${t.heading}` : '') + (t.anchor ? `#^${t.anchor}` : '');
  const a = alias?.replace(/[[\]|\n]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!a || (!t.anchor && !t.heading && a.toLowerCase() === t.title.toLowerCase())) return `[[${target}]]`;
  return `[[${target}|${a}]]`;
}

/**
 * Заменить выделенные слова ссылкой: подпись — сами слова. Метки, стоявшие на этих словах,
 * не теряются: их обёртки встают вокруг ссылки.
 */
export function replaceWithLink(src: string, span: Span, target: LinkTarget, sameNote = false): { text: string; at: Span } {
  const s = trimSpan(src, span);
  const { marks, atoms } = scan(src);
  let { from, to } = s;
  for (const a of atoms) {
    if (a.from < from && a.to > from) from = a.from;
    if (a.from < to && a.to > to) to = a.to;
  }
  const inside = marks.filter((m) => m.from >= from && m.to <= to && (m.kind === 'open' || m.kind === 'close'));
  const before: string[] = [];
  const opens: string[] = [];
  const closes: string[] = [];
  const after: string[] = [];
  for (const m of inside) {
    const p = m.pair;
    const pairInside = p && p.from >= from && p.to <= to;
    const tag = src.slice(m.from, m.to);
    if (m.kind === 'open') (pairInside ? opens : after).push(tag);
    else (pairInside ? closes : before).push(tag);
  }
  const alias = visible(src, { from, to });
  // подпись старой ссылки внутри выделения уже видна как текст — она и станет подписью
  const link = linkText(target, alias, sameNote);
  const piece = before.join('') + opens.join('') + link + closes.join('') + after.join('');
  const linkFrom = from + before.join('').length + opens.join('').length;
  return { text: src.slice(0, from) + piece + src.slice(to), at: { from: linkFrom, to: linkFrom + link.length } };
}

/** Короткая выдержка видимого текста — для названия комментария и подписи. */
export function excerpt(src: string, spans: Span[], max = 40): string {
  const s = spans.map((p) => visible(src, p)).join(' … ');
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + '…' : s;
}

/** Цели комментария из свойства `к`: ссылки в виде строк. */
export function commentTargets(props: Record<string, unknown> | undefined): string[] {
  const v = props?.['к'];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.map(String);
  return [];
}

/** Разобрать `[[Название#^метка]]` из свойства — для поиска комментариев к метке. */
export function parseLinkString(s: string) {
  const m = s.match(/^\s*!?\[\[([^[\]\n]+?)\]\]\s*$/);
  return m ? splitLinkInner(m[1]) : null;
}
