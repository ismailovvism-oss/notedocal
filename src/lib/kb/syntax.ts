// Разбор текста заметки: вики-ссылки, метки фрагментов, теги, заголовки.
// Формат — markdown Obsidian плюс свои метки на словах (docs/ЗАМЕТКИ.md, раздел 3.1).
//
// Модуль без зависимостей от React и Firebase: его импортируют и веб-приложение,
// и scripts/secretary.mjs (Node запускает .ts сам). Поэтому импорты — с расширением .ts.

/** Вики-ссылка `[[цель#заголовок|подпись]]`, `[[цель#^метка]]`, встраивание `![[…]]`. */
export interface WikiLink {
  /** Как написано целиком, вместе со скобками. */
  raw: string;
  embed: boolean;
  /** Название цели. Пусто — ссылка внутри той же заметки (`[[#^k3f9]]`). */
  target: string;
  /** Заголовок цели (последний из цепочки `H1#H2`). */
  heading?: string;
  /** Метка цели без `^`. */
  anchor?: string;
  /** Подпись — исходные слова ссылки. */
  alias?: string;
  /** Положение в тексте. */
  start: number;
  end: number;
}

/** Кусок фрагмента: метка абзаца (` ^k3f9` в конце) или метка на словах. */
export interface AnchorPiece {
  kind: 'block' | 'span';
  /** Текст куска без разметки метки. */
  text: string;
  start: number;
  end: number;
}

export interface Heading {
  level: number;
  text: string;
  start: number;
}

export interface ParsedBody {
  links: WikiLink[];
  /** Теги из текста (`#тема/фикх`), без решётки, в порядке появления, без повторов. */
  tags: string[];
  /** Метки: имя → куски. Одна метка на нескольких кусках — разбросанный фрагмент. */
  anchors: Map<string, AnchorPiece[]>;
  headings: Heading[];
}

/** Имя метки: латиница, цифры, дефис — как id блока в Obsidian. */
export const ANCHOR_NAME = /^[A-Za-z0-9-]+$/;

const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const BLOCK_ID = /(^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/gm;
const SPAN_TAG = /<span\b[^>]*>|<\/span\s*>/gi;
const DATA_A = /\bdata-a\s*=\s*"([A-Za-z0-9-]+)"/i;
// Тег Obsidian: после начала строки или пробела, буквы/цифры/_-/, хотя бы одна не цифра.
const INLINE_TAG = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;

/**
 * Участки, где разметка не действует: блоки и строки кода, `%%скрытое%%`, `<!-- -->`
 * (`comments: false` — `%%` не глушить: показу нужно найти и убрать их самому).
 * Возвращает текст той же длины, где эти участки забиты пробелами (переносы строк
 * оставлены) — так положения находок совпадают с исходником.
 */
export function maskInert(text: string, opts: { comments?: boolean } = {}): string {
  // Один проход по строкам: регулярки с [\s\S]*? на непарной кавычке просматривали текст
  // до конца — по волту (34 МБ) это было 3,4 с.
  const dead = new Uint8Array(text.length);
  const blank = (from: number, to: number) => dead.fill(1, from, to);

  // 1. ограждённые блоки кода ``` и ~~~: от открывающей строки до закрывающей (или до конца)
  let fence: { ch: string; len: number } | null = null;
  let fenceStart = 0;
  for (let pos = 0; pos < text.length; ) {
    const nl = text.indexOf('\n', pos);
    const end = nl < 0 ? text.length : nl;
    const m = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(text.slice(pos, Math.min(end, pos + 40)));
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && !text.slice(pos, end).trim().slice(m[1].length).trim()) {
        blank(fenceStart, end);
        fence = null;
      }
    } else if (m) {
      fence = { ch: m[1][0], len: m[1].length };
      fenceStart = pos;
    }
    pos = end + 1;
  }
  if (fence) blank(fenceStart, text.length);

  // 2. `код` в строке: та же длина ряда кавычек с двух сторон, в пределах абзаца
  for (let i = 0; i < text.length; i++) {
    if (dead[i] || text[i] !== '`') continue;
    let k = 1;
    while (text[i + k] === '`') k++;
    const para = text.indexOf('\n\n', i);
    const limit = para < 0 ? text.length : para;
    let j = text.indexOf('`'.repeat(k), i + k);
    while (j >= 0 && j < limit && (text[j + k] === '`' || text[j - 1] === '`')) {
      let r = j;
      while (text[r] === '`') r++;
      j = text.indexOf('`'.repeat(k), r);
    }
    if (j >= 0 && j < limit) {
      blank(i, j + k);
      i = j + k - 1;
    } else i += k - 1;
  }

  // 3. %%скрытое%% и <!-- --> (могут занимать несколько строк)
  const hidden = opts.comments === false ? [['<!--', '-->']] : [['%%', '%%'], ['<!--', '-->']];
  for (const [open, close] of hidden) {
    let i = text.indexOf(open);
    while (i >= 0) {
      if (dead[i]) {
        i = text.indexOf(open, i + 1);
        continue;
      }
      const j = text.indexOf(close, i + open.length);
      const end = j < 0 ? text.length : j + close.length;
      blank(i, end);
      i = j < 0 ? -1 : text.indexOf(open, end);
    }
  }

  let out = '';
  let from = 0;
  for (let i = 0; i <= text.length; i++) {
    const run = i < text.length && dead[i] && text[i] !== '\n';
    if (run) {
      if (from < i) out += text.slice(from, i);
      let j = i;
      while (j < text.length && dead[j] && text[j] !== '\n') j++;
      out += ' '.repeat(j - i);
      from = j;
      i = j - 1;
    }
  }
  return out + text.slice(from);
}

/** `цель#H1#H2|подпись` или `цель#^метка` → части. `\|` (в таблицах) — тоже разделитель. */
export function splitLinkInner(inner: string): Pick<WikiLink, 'target' | 'heading' | 'anchor' | 'alias'> {
  const bar = inner.search(/\\?\|/);
  const head = bar >= 0 ? inner.slice(0, bar) : inner;
  const alias = bar >= 0 ? inner.slice(bar).replace(/^\\?\|/, '').trim() : undefined;
  const [target, ...rest] = head.split('#');
  const res: Pick<WikiLink, 'target' | 'heading' | 'anchor' | 'alias'> = { target: target.trim() };
  if (alias) res.alias = alias;
  const last = rest.map((s) => s.trim()).filter(Boolean).pop();
  if (last?.startsWith('^')) res.anchor = last.slice(1);
  else if (last) res.heading = last;
  return res;
}

/** Собрать вики-ссылку обратно из частей. */
export function formatLink(l: Pick<WikiLink, 'embed' | 'target' | 'heading' | 'anchor' | 'alias'>): string {
  let inner = l.target;
  if (l.anchor) inner += `#^${l.anchor}`;
  else if (l.heading) inner += `#${l.heading}`;
  if (l.alias) inner += `|${l.alias}`;
  return `${l.embed ? '!' : ''}[[${inner}]]`;
}

/** Вики-ссылки текста (кроме тех, что в коде и скрытом). */
export function findLinks(text: string, masked = maskInert(text)): WikiLink[] {
  const links: WikiLink[] = [];
  for (const m of masked.matchAll(WIKILINK)) {
    const start = m.index!;
    const raw = text.slice(start, start + m[0].length);
    const inner = raw.slice(m[1] ? 3 : 2, -2);
    links.push({ raw, embed: !!m[1], ...splitLinkInner(inner), start, end: start + raw.length });
  }
  return links;
}

/** Начало абзаца или пункта списка, которому принадлежит строка с меткой ` ^id`. */
function blockStart(text: string, lineStart: number): number {
  const nl = text.indexOf('\n', lineStart);
  const line = text.slice(lineStart, nl < 0 ? undefined : nl);
  if (/^\s*([-*+]|\d+[.)])\s/.test(line)) return lineStart; // пункт списка — сам по себе
  let s = lineStart;
  while (s > 0) {
    const prevEnd = s - 1;
    const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1;
    const prev = text.slice(prevStart, prevEnd);
    if (!prev.trim() || /^\s*([-*+]|\d+[.)])\s|^#{1,6}\s/.test(prev)) break;
    s = prevStart;
  }
  return s;
}

/** Текст без разметки — для подписей, контекста и снимков фрагментов. */
export function plainText(md: string): string {
  return md
    .replace(/<span\b[^>]*>|<\/span\s*>/gi, '')
    .replace(/!?\[\[([^[\]\n]+?)\]\]/g, (_, inner: string) => {
      const p = splitLinkInner(inner);
      return p.alias ?? p.heading ?? p.target;
    })
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|[ \t])\^[A-Za-z0-9-]+[ \t]*$/gm, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/\*\*|__|==|~~|`/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Снимок куска для показа и памяти указателя: без разметки, в одну строку. */
const oneLine = (md: string) => plainText(md).replace(/\s+/g, ' ');

/** Метки: абзацные (` ^id` в конце строки) и на словах (`<span data-a="id">`). */
export function findAnchors(text: string, masked = maskInert(text)): Map<string, AnchorPiece[]> {
  const anchors = new Map<string, AnchorPiece[]>();
  const add = (name: string, piece: AnchorPiece) => {
    const list = anchors.get(name);
    if (list) list.push(piece);
    else anchors.set(name, [piece]);
  };
  for (const m of masked.matchAll(BLOCK_ID)) {
    const idStart = m.index! + m[1].length;
    const lineStart = text.lastIndexOf('\n', idStart - 1) + 1;
    const start = blockStart(text, lineStart);
    add(m[2], { kind: 'block', text: oneLine(text.slice(start, idStart)), start, end: idStart });
  }
  // <span> могут быть вложены (в том числе обычные, без метки) — идём стеком
  const stack: { name: string | null; contentStart: number }[] = [];
  for (const m of masked.matchAll(SPAN_TAG)) {
    if (m[0].startsWith('</')) {
      const open = stack.pop();
      if (open?.name) {
        add(open.name, {
          kind: 'span',
          text: oneLine(text.slice(open.contentStart, m.index!)),
          start: open.contentStart,
          end: m.index!,
        });
      }
    } else {
      stack.push({ name: m[0].match(DATA_A)?.[1] ?? null, contentStart: m.index! + m[0].length });
    }
  }
  for (const list of anchors.values()) list.sort((a, b) => a.start - b.start);
  return anchors;
}

/** Нормальный вид тега: без решётки и крайних косых. Сравнивать — в нижнем регистре. */
export function normTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, '');
}

/** Теги из текста. Чисто цифровые (`#2026`) тегами не считаются — как в Obsidian. */
export function findTags(masked: string): string[] {
  const seen = new Map<string, string>();
  for (const m of masked.matchAll(INLINE_TAG)) {
    const tag = normTag(m[2]);
    if (!tag || /^[\d/]+$/.test(tag)) continue;
    const key = tag.toLowerCase();
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
}

export function findHeadings(masked: string): Heading[] {
  return [...masked.matchAll(HEADING)].map((m) => ({
    level: m[1].length,
    text: plainText(m[2]),
    start: m.index!,
  }));
}

/** Разобрать текст заметки целиком. */
export function parseBody(text: string): ParsedBody {
  const masked = maskInert(text ?? '');
  // в заголовке `# …` решётка — не тег; в ссылке `[[x#y]]` тоже — их забиваем перед поиском тегов
  const forTags = masked
    .replace(/^#{1,6}[ \t]/gm, (s) => ' '.repeat(s.length))
    .replace(/!?\[\[[^[\]\n]+?\]\]/g, (s) => ' '.repeat(s.length))
    .replace(/<[^>\n]*>/g, (s) => ' '.repeat(s.length));
  return {
    links: findLinks(text, masked),
    tags: findTags(forTags),
    anchors: findAnchors(text, masked),
    headings: findHeadings(masked),
  };
}

/** Новое имя метки: 4 знака, не занятое в этой заметке. */
export function newAnchorName(taken: Iterable<string>, random: () => number = Math.random): string {
  const busy = new Set([...taken].map((s) => s.toLowerCase()));
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789'; // без l, o, 0, 1 — их путают
  for (;;) {
    let name = '';
    for (let i = 0; i < 4; i++) name += abc[Math.floor(random() * abc.length)];
    if (!/^\d+$/.test(name) && !busy.has(name)) return name;
  }
}

/** ~maxLen знаков вокруг места [start, end) — для «Обратных ссылок». */
export function contextAround(text: string, start: number, end: number, maxLen = 200): string {
  // ищем край абзаца только в окне вокруг ссылки: поиск по всему тексту на каждую ссылку
  // занимал 1,7 с на волте
  const half = Math.floor(maxLen / 2);
  const winFrom = Math.max(0, start - half);
  const before = text.slice(winFrom, start).lastIndexOf('\n\n');
  const after = text.slice(end, end + half).indexOf('\n\n');
  const from = before < 0 ? winFrom : winFrom + before + 2;
  const to = after < 0 ? Math.min(text.length, end + half) : end + after;
  const piece = plainText(text.slice(from, to)).replace(/\s+/g, ' ');
  return (from > 0 ? '…' : '') + piece + (to < text.length ? '…' : '');
}
