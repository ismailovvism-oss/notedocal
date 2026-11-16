// Замечания к тексту — как в md-редакторе (~/projects/apps/md-redaktor), в самом файле:
//
// - к абзацу — строкой CriticMarkup `{>>текст<<}` сразу после абзаца (через пустую строку).
//   Лежит рядом со своим местом, поэтому не отвязывается, как ни переписывай текст. Читается и
//   отдельная строка Obsidian `%%текст%%`, пишется всегда `{>>…<<}`;
// - общие — нумерованным списком в блоке `%%замечания … %%` в конце файла (Obsidian его прячет).
//
// Нумерация сквозная: общие первыми, к абзацам следом — «замечание четыре» понятно обоим.
// Замечание всегда отдельной строкой: внутри арабской строки скобки прыгали бы не туда.
//
// Вычитка (16.11.2026, вместо артефакта «Редактура»): переписка лежит в самом замечании,
// следующими строками, — отдельной базы нет:
//
//     {>>[к словам: довод слабый] Найди другой довод
//     ✓ Заменил на хадис Ибн Умара<<}
//
// Внутри списка, выноски и цитаты (16.11.2026) замечание лежит строкой прямо под своим местом,
// с тем же отступом и знаками `>`, что у текста, — иначе оно уезжало в конец всего списка:
//
//     - пункт один
//       {>>замечание к первому пункту<<}
//     - пункт два
//
//     > первый абзац выноски
//     > {>>замечание к нему<<}
//
// В таблицу строку не вставить (она стала бы строкой таблицы): замечание — за таблицей, с
// `[к словам: …]` из ячейки под курсором. Внутри блока кода — за блоком, а не в коде.
//
// Первая часть — слова автора (в начале может стоять `[к словам: …]` — фраза, к которой
// замечание, или `[к удалённому: …]` — абзац удалили, начало его текста). Дальше — ответы,
// каждый с новой строки и со значка: `✓` сделано, `❓` вопрос автору, `✗` не принято — пишет
// Claude; `↩` — приписка автора (ответ на вопрос, «не то»). Состояние — по последнему значку:
// ✓ учтено, ❓ вопрос, ✗ не принято, иначе открыто. «Принять» — замечание убирается из файла.
//
// Без React и CodeMirror: правки — изменения {from, to, insert} по тексту; тесты —
// scripts/kbremarks.test.mjs.

export type RemarkStatus = 'open' | 'done' | 'ask' | 'no';
export type Mark = '✓' | '❓' | '✗' | '↩';
export interface Msg {
  /** Кто: Claude (✓ ❓ ✗) или автор (↩). */
  by: 'claude' | 'author';
  mark: Mark;
  text: string;
}

/** Разобранное нутро замечания. */
export interface Inner {
  /** Слова автора — само замечание. */
  text: string;
  /** Фраза абзаца, к которой замечание (`[к словам: …]`). */
  phrase?: string;
  /** Абзац удалён — начало его текста (`[к удалённому: …]`). */
  gone?: string;
  thread: Msg[];
  status: RemarkStatus;
}

const MARKS: Record<Mark, RemarkStatus> = { '✓': 'done', '❓': 'ask', '✗': 'no', '↩': 'open' };
const MARK_LINE = /^\s*(✓|❓|✗|↩)\s*(.*)$/u;

/** Нутро замечания: фраза, слова автора, переписка, состояние. */
export function parseInner(raw: string): Inner {
  const lines = raw.replace(/ ⏎ /g, '\n').split('\n');
  const head: string[] = [];
  const thread: Msg[] = [];
  for (const l of lines) {
    const m = l.match(MARK_LINE);
    // первая строка — всегда слова автора, даже если начинается со значка
    if (m && (head.length || thread.length)) thread.push({ by: m[1] === '↩' ? 'author' : 'claude', mark: m[1] as Mark, text: m[2].trim() });
    else if (thread.length) thread[thread.length - 1].text += '\n' + l.trim();
    else head.push(l);
  }
  let text = head.join('\n').trim();
  let phrase: string | undefined;
  let gone: string | undefined;
  for (;;) {
    const m = text.match(/^\[(к словам|к удалённому):\s*([^\]]*)\]\s*/i);
    if (!m) break;
    if (m[1].toLowerCase() === 'к словам') phrase = m[2].trim();
    else gone = m[2].trim();
    text = text.slice(m[0].length);
  }
  const last = thread[thread.length - 1];
  return { text, phrase, gone, thread, status: last ? MARKS[last.mark] : 'open' };
}

/** Собрать нутро обратно в текст. */
export function buildInner(x: Pick<Inner, 'text'> & Partial<Inner>): string {
  const tag = (x.gone ? `[к удалённому: ${x.gone.replace(/[\]\n]/g, ' ')}] ` : '') + (x.phrase ? `[к словам: ${x.phrase.replace(/[\]\n]/g, ' ')}] ` : '');
  const one = (t: string) => t.replace(/\n\s*\n+/g, '\n').trim();
  return [tag + one(x.text), ...(x.thread ?? []).map((m) => `${m.mark} ${one(m.text)}`)].join('\n').replace(/<<\}/g, '<< }');
}

export interface Remark extends Inner {
  kind: 'gen' | 'par';
  /** Сквозной номер с 1. */
  n: number;
  /** Нутро как в файле (с фразой и перепиской). */
  raw: string;
  /** Замечание посреди строки (а не отдельной строкой) — так писал md-редактор. */
  inline?: boolean;
  /** Где лежит в тексте: строка(и) замечания (у общего — его пункт в блоке). */
  from: number;
  to: number;
  /** К какому месту (у замечания к абзацу) — начало абзаца выше, коротко. */
  anchor?: string;
  /** Где абзац, к которому замечание: начало его первой строки. */
  anchorAt?: number;
  /** Где кончается свой текст замечания — абзац или слова пункта списка. */
  anchorTo?: number;
}

export interface Change {
  from: number;
  to: number;
  insert: string;
}

interface Line {
  text: string;
  from: number;
  to: number;
}

function linesOf(doc: string): Line[] {
  const out: Line[] = [];
  let p = 0;
  for (const text of doc.split('\n')) {
    out.push({ text, from: p, to: p + text.length });
    p += text.length + 1;
  }
  return out;
}

const GEN_OPEN = /^\s*%%\s*замечания\s*$/i;
const GEN_CLOSE = /^\s*%%\s*$/;
const VOICE = /^%%🎤:[a-z0-9]+%%$/;

/** Блок общих замечаний: строки начала и конца, пункты. null — блока нет. */
function genBlock(L: Line[]): { a: number; b: number; items: { text: string; line: number; last: number }[] } | null {
  for (let i = 0; i < L.length; i++) {
    if (!GEN_OPEN.test(L[i].text)) continue;
    let j = i + 1;
    while (j < L.length && !GEN_CLOSE.test(L[j].text)) j++;
    // пункт — строка с номером; следующие без номера — его продолжение (переписка)
    const items: { text: string; line: number; last: number }[] = [];
    for (let k = i + 1; k < j && k < L.length; k++) {
      const t = L[k].text;
      if (!t.trim()) continue;
      if (/^\s*\d+[.)]\s/.test(t) || !items.length) items.push({ text: t.replace(/^\s*\d+[.)]\s*/, '').trim(), line: k, last: k });
      else {
        const it = items[items.length - 1];
        it.text += '\n' + t.trim();
        it.last = k;
      }
    }
    return { a: i, b: Math.min(j, L.length - 1), items };
  }
  return null;
}

// --- строение строк: цитаты, пункты списка, код, таблицы ---

/** Знаки цитаты в начале строки (`> `, `> > `): сколько их и сколько знаков занимают. */
function quoteOf(s: string, max = 99): { d: number; len: number } {
  let i = 0;
  let d = 0;
  while (d < max) {
    let k = i;
    while (k - i < 3 && s[k] === ' ') k++;
    if (s[k] !== '>') break;
    i = s[k + 1] === ' ' ? k + 2 : k + 1;
    d++;
  }
  return { d, len: i };
}
/** Строка без первых d знаков цитаты; null — строка вне этой цитаты. */
function inQuote(s: string, d: number): string | null {
  if (!d) return s;
  const q = quoteOf(s, d);
  return q.d < d ? null : s.slice(q.len);
}
/** Строка без всех знаков цитаты. */
const bodyOf = (s: string) => s.slice(quoteOf(s).len);

const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const FENCE = /^[ \t]*(```|~~~)/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
function indentOf(s: string): number {
  let n = 0;
  for (const c of s) {
    if (c === ' ') n++;
    else if (c === '\t') n += 4;
    else break;
  }
  return n;
}
/** Отступ текста пункта списка: где начинаются его слова. */
const padOf = (m: RegExpMatchArray) => indentOf(m[1]) + m[2].length + (m[3].length >= 1 && m[3].length <= 4 ? m[3].length : 1);
/** Замечание строками: перед каждой — отступ и знаки цитаты своего места. */
const lines = (inner: string, pfx = '') => pfx + '{>>' + inner.replace(/\n/g, '\n' + pfx) + '<<}';

/** Строки замечания отдельной строкой, начиная с i: [последняя строка, текст] или null.
 *  Перед замечанием могут стоять знаки цитаты и отступ пункта списка — у каждой его строки. */
function parAt(L: Line[], i: number): [number, string] | null {
  const q = quoteOf(L[i].text);
  const t = L[i].text.slice(q.len).trim();
  if (t.startsWith('{>>')) {
    for (let j = i; j < L.length; j++) {
      if (L[j].text.trimEnd().endsWith('<<}')) {
        const raw = L.slice(i, j + 1)
          .map((l) => (inQuote(l.text, q.d) ?? l.text).trim())
          .join('\n');
        return [j, raw.replace(/^\{>>/, '').replace(/<<\}$/, '').trim()];
      }
    }
    return null;
  }
  // отдельная строка %%…%% (но не блок общих и не метка диктовки)
  if (t.startsWith('%%') && t.endsWith('%%') && t.length > 4 && !GEN_OPEN.test(t) && !VOICE.test(t)) {
    return [i, t.slice(2, -2).trim()];
  }
  return null;
}

const plain = (s: string) =>
  s
    .replace(/\{>>[\s\S]*?<<\}/g, '')
    .replace(/\{(==|\+\+|--)([\s\S]*?)(==|\+\+|--)\}/g, '$2')
    .replace(/\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g, '$2')
    .split('\n')
    .map((l) => {
      const q = quoteOf(l);
      const t = q.d ? l.slice(q.len).replace(/^\[![^\]]*\][+-]?\s*/, '') : l;
      return t.replace(/^\s*(#{1,6}\s|([-*+]|\d+[.)])\s+(\[[ xX]\]\s)?)/, '');
    })
    .join(' ')
    .replace(/<[^>\n]+>/g, '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~=`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Строки одной цитаты (глубины d; 0 — весь текст) и то, что по ним видно: пункты списка,
 *  блоки кода, таблицы, абзацы. `rem[k]` — строка k занята замечанием. */
function reader(L: Line[], rem: boolean[], d: number) {
  const T = (k: number): string | null => (k < 0 || k >= L.length ? null : inQuote(L[k].text, d));
  /** Строка с текстом (не пустая, не замечание, внутри цитаты). */
  const live = (k: number) => !!T(k)?.trim() && !rem[k];
  const memo = new Map<number, RegExpMatchArray | null>();
  /** Строка k начинает пункт списка. Номер (кроме 1) посреди абзаца — не список, а слова
   *  («…в\n1986. году»): так считает и сама разметка. */
  const isItem = (k: number): RegExpMatchArray | null => {
    if (memo.has(k)) return memo.get(k)!;
    let out: RegExpMatchArray | null = null;
    const t = T(k);
    const m = t !== null && !rem[k] ? t.match(ITEM) : null;
    if (m) {
      const up = T(k - 1);
      if (up === null || !up.trim() || rem[k - 1]) out = m; // с начала куска
      else if (/[-*+]/.test(m[2]) ? t!.trim().length > 1 : /^1[.)]$/.test(m[2])) out = m; // может прервать абзац
      else if (itemOf(k - 1)) out = m; // продолжает список
    }
    memo.set(k, out);
    return out;
  };
  /** Пункт списка, в тексте которого строка i: строка с маркером и отступ его слов. */
  const itemOf = (i: number): { head: number; pad: number } | null => {
    const me = T(i);
    if (me === null) return null;
    const self = isItem(i);
    if (self) return { head: i, pad: padOf(self) };
    const my = indentOf(me);
    let gap = false;
    for (let k = i - 1; k >= 0; k--) {
      const t = T(k);
      if (t === null) return null;
      if (rem[k]) continue;
      if (!t.trim()) {
        if (my === 0) return null;
        gap = true;
        continue;
      }
      const m = isItem(k);
      if (m) {
        if (!gap || my >= padOf(m)) return { head: k, pad: padOf(m) };
        continue; // пункт глубже нашей строки — ищем внешний
      }
      if (gap && indentOf(t) === 0) return null; // за пустой строкой абзац без отступа — список кончился
    }
    return null;
  };
  /** Последняя строка своего текста, начиная с i: до пустой строки, замечания, пункта, кода. */
  const ownEnd = (i: number, stop = L.length) => {
    let j = i;
    while (j + 1 < stop && live(j + 1) && !isItem(j + 1) && !FENCE.test(T(j + 1)!)) j++;
    return j;
  };
  /** К какому тексту замечание в строке i: строки от a до b. null — выше ничего нет. */
  const ownerOf = (i: number): { a: number; b: number } | null => {
    const me = T(i);
    if (me === null) return null;
    const my = indentOf(me);
    let k = i - 1;
    let gap = false;
    for (; k >= 0; k--) {
      const t = T(k);
      if (t === null) return null;
      if (rem[k]) continue;
      if (t.trim()) break;
      gap = true;
    }
    if (k < 0) return null;
    // пункт списка: ближайшая строка с маркером левее замечания (без отступа и без пустой
    // строки — просто ближайшая: так замечание читает и разметка)
    for (let h = k; h >= 0; h--) {
      const t = T(h);
      if (t === null) break;
      if (rem[h]) continue;
      if (!t.trim()) break;
      const m = isItem(h);
      if (!m) continue;
      if (my === 0 ? !gap : indentOf(m[1]) < my && (!gap || my >= padOf(m))) return { a: h, b: ownEnd(h, i) };
      if (my === 0) break;
    }
    // иначе — кусок текста выше, до пустой строки; замечания, прижатые к тексту, — внутри него
    let a = k;
    for (;;) {
      let p = a - 1;
      while (p >= 0 && rem[p]) p--;
      const t = T(p);
      if (t === null || !t.trim()) break;
      a = p;
    }
    return { a, b: k };
  };
  /** Блок кода, в котором строка i: [первая, последняя] или null. */
  const fenceAt = (i: number): [number, number] | null => {
    let open = -1;
    for (let k = 0; k < L.length; k++) {
      const t = T(k);
      if (t === null) {
        if (open >= 0 && i >= open && i < k) return [open, k - 1];
        open = -1;
      } else if (FENCE.test(t)) {
        if (open < 0) open = k;
        else {
          if (i >= open && i <= k) return [open, k];
          open = -1;
        }
      }
      if (open < 0 && k >= i) return null;
    }
    return open >= 0 && i >= open ? [open, L.length - 1] : null;
  };
  /** Строка k — заголовок таблицы (под ней строка-разделитель). */
  const tableHead = (k: number) => live(k) && live(k + 1) && T(k)!.includes('|') && T(k + 1)!.includes('|') && DELIM.test(T(k + 1)!);
  /** Таблица, в которой строка i: [заголовок, последняя строка] или null. */
  const tableAt = (i: number): [number, number] | null => {
    if (!live(i)) return null;
    let s = i;
    while (live(s - 1)) s--;
    let e = i;
    while (live(e + 1)) e++;
    for (let k = s; k < e; k++) if (tableHead(k)) return i >= k ? [k, e] : null;
    return null;
  };
  /** Со строки k начинается другой блок: абзац выше на ней кончился. */
  const starts = (k: number) => {
    const t = T(k)!;
    return !!isItem(k) || FENCE.test(t) || HEADING.test(t) || quoteOf(t).d > 0 || tableHead(k);
  };
  return { T, live, isItem, itemOf, ownEnd, ownerOf, fenceAt, tableAt, starts };
}

interface Scan {
  L: Line[];
  /** Строка занята замечанием (отдельной строкой). */
  rem: boolean[];
  list: Remark[];
  /** Читатель строк для цитаты глубины d. */
  at: (d: number) => ReturnType<typeof reader>;
}

function scan(doc: string): Scan {
  const L = linesOf(doc);
  const list: Remark[] = [];
  const g = genBlock(L);
  for (const it of g?.items ?? []) list.push({ kind: 'gen', n: 0, raw: it.text, ...parseInner(it.text), from: L[it.line].from, to: L[it.last].to });
  const rem = new Array<boolean>(L.length).fill(false);
  const own: { r: Remark; i: number }[] = [];
  let fence = false;
  for (let i = 0; i < L.length; i++) {
    if (/^\s*(```|~~~)/.test(L[i].text)) fence = !fence;
    if (fence || (g && i >= g.a && i <= g.b)) continue;
    const hit = parAt(L, i);
    if (!hit) {
      // замечание посреди строки — к этой строке
      for (const m of L[i].text.matchAll(/\{>>(.*?)<<\}/g)) {
        const at = plain(L[i].text);
        list.push({
          kind: 'par',
          n: 0,
          inline: true,
          raw: m[1].trim(),
          ...parseInner(m[1].trim()),
          from: L[i].from + m.index!,
          to: L[i].from + m.index! + m[0].length,
          anchor: at.length > 110 ? at.slice(0, 110) + '…' : at || '(в строке)',
          anchorAt: L[i].from,
          anchorTo: L[i].to,
        });
      }
      continue;
    }
    const [j, text] = hit;
    for (let k = i; k <= j; k++) rem[k] = true;
    const r: Remark = { kind: 'par', n: 0, raw: text, ...parseInner(text), from: L[i].from, to: L[j].to };
    list.push(r);
    own.push({ r, i });
    i = j;
  }
  const readers = new Map<number, ReturnType<typeof reader>>();
  const at = (d: number) => {
    let x = readers.get(d);
    if (!x) readers.set(d, (x = reader(L, rem, d)));
    return x;
  };
  // к какому тексту каждое: абзац выше или пункт списка, под которым оно стоит
  for (const { r, i } of own) {
    const o = at(quoteOf(L[i].text).d).ownerOf(i);
    const anchor = o ? plain(L.slice(o.a, o.b + 1).map((l) => l.text).join('\n')) : '';
    r.anchor = anchor ? (anchor.length > 110 ? anchor.slice(0, 110) + '…' : anchor) : '(начало текста)';
    if (o) {
      r.anchorAt = L[o.a].from;
      r.anchorTo = L[o.b].to;
    }
  }
  list.forEach((r, i) => (r.n = i + 1));
  return { L, rem, list, at };
}

/** Все замечания по порядку: общие, потом к абзацам. */
export function parseRemarks(doc: string): Remark[] {
  return scan(doc).list;
}

/** Слова ячейки таблицы под курсором (col — место в строке; 0 — первая непустая ячейка). */
function cellAt(row: string, col: number): string {
  const cells: { text: string; from: number; to: number }[] = [];
  let from = 0;
  for (let k = 0; k <= row.length; k++) {
    if (k === row.length || (row[k] === '|' && row[k - 1] !== '\\')) {
      cells.push({ text: plain(row.slice(from, k)), from, to: k });
      from = k + 1;
    }
  }
  const hit = col > 0 ? cells.find((c) => col >= c.from && col <= c.to && c.text) : undefined;
  let p = (hit ?? cells.find((c) => c.text))?.text ?? '';
  p = p.split(']')[0].trim(); // в `[к словам: …]` скобку не записать
  if (p.length > 80) {
    const cutAt = p.lastIndexOf(' ', 80);
    p = p.slice(0, cutAt > 40 ? cutAt : 80).trim();
  }
  return p;
}

/** Куда вписать замечание к пункту списка, который идёт через место `pos`: место и то, что
 *  стоит перед каждой строкой замечания (знаки цитаты и отступ). null — там не пункт списка. */
function itemSlot(S: Scan, pos: number): { at: number; pfx: string } | null {
  const i = S.L.findIndex((l) => pos >= l.from && pos <= l.to);
  if (i < 0) return null;
  const d = quoteOf(S.L[i].text).d;
  const R = S.at(d);
  const it = R.itemOf(i);
  if (!it) return null;
  return { at: S.L[R.ownEnd(i)].to, pfx: '> '.repeat(d) + ' '.repeat(it.pad) };
}

/** Замечание к месту, где стоит курсор: уже есть — где его текст (править); нет — что вставить.
 *  `cursor` — куда поставить курсор после вставки (внутрь `{>>|<<}`).
 *  Пункт списка и абзац выноски — замечание строкой прямо под ними; обычный абзац, таблица и
 *  блок кода — отдельным абзацем следом (в таблице — со словами ячейки под курсором). */
export function remarkAt(doc: string, pos: number): { existing: Remark } | { change: Change; cursor: number } {
  const S = scan(doc);
  const { L, rem, list } = S;
  let i = L.findIndex((l) => pos >= l.from && pos <= l.to);
  if (i < 0) i = L.length - 1;
  // стоим на самом замечании — его и править
  const here = list.find((r) => r.kind === 'par' && pos >= r.from && pos <= r.to);
  if (here) return { existing: here };
  // пустая строка — к тексту выше
  const row = i;
  while (i > 0 && !bodyOf(L[i].text).trim()) i--;
  const d = quoteOf(L[i].text).d;
  const R = S.at(d);
  const pre = '> '.repeat(d);
  /** Вставить за строкой j: `glue` — строкой прямо под текстом, иначе отдельным абзацем. */
  const put = (j: number, pfx: string, glue: boolean, tag = '') => {
    const next = R.T(j + 1);
    const blank = d ? `\n${pre.trimEnd()}` : '\n';
    const insert = (glue ? '\n' : blank + '\n') + lines(tag, pfx) + (!glue && next?.trim() ? blank : '');
    return { change: { from: L[j].to, to: L[j].to, insert }, cursor: L[j].to + insert.lastIndexOf('<<}') };
  };
  /** Сразу за строкой j уже стоит замечание к этому же тексту — его и править. */
  const below = (j: number, glue: boolean) => {
    let k = j + 1;
    // под пунктом списка — только прижатое к нему: за пустой строкой стоит замечание ко всему списку
    while (!glue && k < L.length && R.T(k) !== null && !R.T(k)!.trim()) k++;
    if (k >= L.length || k - j > 2 || !rem[k]) return null;
    return list.find((r) => r.kind === 'par' && !r.inline && r.from === L[k].from && r.anchorTo === L[j].to) ?? null;
  };
  const done = (j: number, pfx: string, glue: boolean) => {
    const r = below(j, glue);
    return r ? { existing: r } : put(j, pfx, glue);
  };
  // блок кода: замечание — за ним, а не внутри кода
  const code = R.fenceAt(i);
  if (code) return done(code[1], pre, false);
  // таблица: строку в неё не вставить — за таблицей, со словами ячейки под курсором
  const table = R.tableAt(i);
  if (table) {
    const t = R.T(i)!;
    const col = row === i ? pos - L[i].from - (L[i].text.length - t.length) : 0;
    const phrase = i > table[0] && DELIM.test(t) ? '' : cellAt(t, col);
    if (!phrase) return done(table[1], pre, false);
    return put(table[1], pre, false, buildInner({ text: '', phrase }));
  }
  // пункт списка: строкой под его словами, с отступом пункта
  const it = R.itemOf(i);
  if (it) return done(R.ownEnd(i), pre + ' '.repeat(it.pad), true);
  // абзац: вниз до пустой строки, замечания или начала другого блока
  let j = i;
  if (!HEADING.test(R.T(i)!)) while (R.live(j + 1) && !R.starts(j + 1)) j++;
  return done(j, pre, d > 0);
}

/** Переписать блок общих замечаний (номера — заново подряд); пусто — блок убрать. */
export function writeGeneral(doc: string, items: string[]): Change {
  const L = linesOf(doc);
  const g = genBlock(L);
  const list = items.map((t) => t.trim()).filter(Boolean);
  // переписка пункта — следующими строками с отступом
  const item = (t: string, i: number) =>
    t
      .split('\n')
      .filter((l) => l.trim())
      .map((l, k) => (k ? '   ' + l.trim() : `${i + 1}. ${l.trim()}`))
      .join('\n');
  const body = list.length ? '%%замечания\n' + list.map(item).join('\n') + '\n%%' : '';
  if (g) {
    if (body) return { from: L[g.a].from, to: L[g.b].to, insert: body };
    return cut(doc, L, g.a, g.b);
  }
  if (!body) return { from: 0, to: 0, insert: '' };
  const end = doc.length;
  const sep = !doc ? '' : doc.endsWith('\n\n') ? '' : doc.endsWith('\n') ? '\n' : '\n\n';
  return { from: end, to: end, insert: sep + body + '\n' };
}

/** Где в тексте блок общих замечаний (для просмотра: сам блок не показываем). */
export function generalRange(doc: string): { from: number; to: number } | null {
  const L = linesOf(doc);
  const g = genBlock(L);
  return g ? { from: L[g.a].from, to: L[g.b].to } : null;
}

/** Замечание отдельным абзацем за текстом, который кончается в месте end. Дальше сразу идёт
 *  другой блок (без пустой строки) — отделить и от него, иначе замечание слилось бы с ним. */
function apart(doc: string, end: number, inner: string): Change {
  const tail = /^\n[ \t]*\S/.test(doc.slice(end, end + 200)) ? '\n' : '';
  return { from: end, to: end, insert: `\n\n${lines(inner)}${tail}` };
}

/** Новое замечание к блоку текста [from, to) — отдельным абзацем сразу за ним. */
export function remarkAfter(doc: string, from: number, to: number, text: string, phrase?: string): Change {
  return apart(doc, from + doc.slice(from, to).trimEnd().length, buildInner({ text, phrase }));
}

/** Новое замечание к пункту списка, который идёт через место `pos`: строкой под его словами, с
 *  отступом пункта. Там не пункт списка — отдельным абзацем за этой строкой. */
export function remarkInItem(doc: string, pos: number, text: string, phrase?: string): Change {
  const inner = buildInner({ text, phrase });
  const slot = itemSlot(scan(doc), pos);
  if (slot) return { from: slot.at, to: slot.at, insert: '\n' + lines(inner, slot.pfx) };
  const end = doc.indexOf('\n', pos);
  return apart(doc, end < 0 ? doc.length : end, inner);
}

/** Общие замечания списком (без номеров). */
export function generalItems(doc: string): string[] {
  return (genBlock(linesOf(doc))?.items ?? []).map((x) => x.text);
}

/** Убрать строки a..b и одну пустую рядом (чтобы не копились пустые строки). */
function cut(doc: string, L: Line[], a: number, b: number): Change {
  let from = L[a].from;
  let to = L[b].to;
  // пустая строка рядом: у замечания в цитате ею служит и строка из одного знака `>`
  const empty = (k: number) => !(quoteOf(L[a].text).d ? bodyOf(L[k].text) : L[k].text).trim();
  if (a > 0 && empty(a - 1)) from = L[a - 1].from - (a > 1 ? 1 : 0);
  // замечание прижато к тексту (в списке, в цитате) — пустую строку после него не трогаем:
  // без неё следующий абзац слился бы с этим
  else if (a === 0 && b + 1 < L.length && !L[b + 1].text.trim()) to = L[b + 1].to;
  if (from > 0 && from === L[a].from) from -= 1; // перевод строки перед
  return { from: Math.max(0, from), to: Math.min(doc.length, to), insert: '' };
}

/** Убрать замечание (к абзацу — со строкой; общее — из блока с перенумерацией). */
export function removeRemark(doc: string, r: Remark): Change {
  if (r.kind === 'gen') {
    const items = generalItems(doc);
    const idx = parseRemarks(doc).filter((x) => x.kind === 'gen').findIndex((x) => x.from === r.from);
    items.splice(idx, 1);
    return writeGeneral(doc, items);
  }
  // посреди строки — только само замечание и пробел перед ним
  if (r.inline) return { from: r.from > 0 && doc[r.from - 1] === ' ' ? r.from - 1 : r.from, to: r.to, insert: '' };
  const L = linesOf(doc);
  const a = L.findIndex((l) => l.from === r.from);
  const b = L.findIndex((l) => l.to === r.to);
  return cut(doc, L, a, b < 0 ? a : b);
}

/** Записать нутро замечания на его место. */
export function setRaw(doc: string, r: Remark, raw: string): Change {
  if (r.kind === 'gen') {
    const items = generalItems(doc);
    const idx = parseRemarks(doc).filter((x) => x.kind === 'gen').findIndex((x) => x.from === r.from);
    items[idx] = raw;
    return writeGeneral(doc, items);
  }
  // посреди строки — одной строкой: перевод строки разорвал бы предложение
  if (r.inline) return { from: r.from, to: r.to, insert: `{>>${raw.replace(/\n/g, ' ⏎ ')}<<}` };
  // в списке и в цитате у каждой строки замечания — тот же отступ и знаки `>`, что у первой
  return { from: r.from, to: r.to, insert: lines(raw, doc.slice(r.from, r.to).match(/^[ \t>]*/)![0]) };
}

/** Новые слова автора на старом месте (фраза и переписка остаются). */
export function editRemark(doc: string, r: Remark, text: string): Change {
  return setRaw(doc, r, buildInner({ ...r, text }));
}

/** Дописать в замечание: ответ Claude (✓ сделано, ❓ вопрос, ✗ не принято) или приписку автора (↩). */
export function replyRemark(doc: string, r: Remark, mark: Mark, text: string): Change {
  return setRaw(doc, r, buildInner({ ...r, thread: [...r.thread, { by: mark === '↩' ? 'author' : 'claude', mark, text: text.trim() || (mark === '↩' ? 'вернул' : '') }] }));
}

/** Перенести замечание к другому блоку [from, to) (или из общих — к абзацу); `item` — к пункту
 *  списка, который начинается в месте from. Правки — по возрастанию места, для applyAll. */
export function moveRemark(doc: string, r: Remark, from: number, to: number, item = false): Change[] {
  const inner = buildInner({ ...r, gone: undefined });
  const slot = item ? itemSlot(scan(doc), from) : null;
  const ins = slot ? { from: slot.at, to: slot.at, insert: '\n' + lines(inner, slot.pfx) } : apart(doc, from + doc.slice(from, to).trimEnd().length, inner);
  const rm = removeRemark(doc, r);
  // новое место — там же, где снимаем: одна правка (а к своему же месту — ничего)
  if (r.kind === 'par' && ins.from >= rm.from && ins.from <= rm.to) return doc.slice(rm.from, rm.to) === ins.insert ? [] : [{ from: rm.from, to: rm.to, insert: ins.insert }];
  return [rm, ins].sort((a, b) => a.from - b.from);
}

/** Абзац удалили, а замечание к нему осталось: в общие, с началом удалённого текста. */
export function toGeneral(doc: string, r: Remark, gone: string): string {
  const without = apply(doc, removeRemark(doc, r));
  const raw = buildInner({ ...r, gone: gone.length > 80 ? gone.slice(0, 80) + '…' : gone });
  return apply(without, writeGeneral(without, [...generalItems(without), raw]));
}

/** Применить несколько изменений (места — по исходному тексту). */
export function applyAll(doc: string, changes: Change[]): string {
  let out = doc;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

export const STATUS_LABEL: Record<RemarkStatus, string> = { open: 'открыто', done: 'учтено', ask: 'вопрос', no: 'не принято' };

/** Все замечания одним куском — отдать Claude: место, фраза, слова автора, переписка. */
export function remarksText(list: Remark[]): string {
  return list
    .map((r) => {
      const where = r.kind === 'gen' ? (r.gone ? `(к удалённому абзацу «${r.gone}»)` : '(общее)') : `К «${r.anchor}»${r.phrase ? `, слова «${r.phrase}»` : ''}:`;
      const st = r.status === 'open' ? '' : ` [${STATUS_LABEL[r.status]}]`;
      return [`${r.n}.${st} ${where}`, `   ${r.text.replace(/\n/g, '\n   ')}`, ...r.thread.map((m) => `   ${m.mark} ${m.text.replace(/\n/g, '\n   ')}`)].join('\n');
    })
    .join('\n');
}

/** Применить изменение к строке (для тестов и записи без редактора). */
export function apply(doc: string, c: Change): string {
  return doc.slice(0, c.from) + c.insert + doc.slice(c.to);
}

/** Пустые замечания `{>><<}` (нажали ✎ и ничего не написали; в таблице — с одной лишь фразой
 *  `[к словам: …]`) в файл не идут: строка убирается вместе с пустой строкой перед ней. */
export function dropEmptyRemarks(doc: string): string {
  if (!doc.includes('{>>')) return doc;
  const EMPTY = String.raw`\{>>\s*(?:\[(?:к словам|к удалённому):[^\]\n]*\]\s*)*<<\}`;
  return doc
    .replace(new RegExp(String.raw`(?:\n[ \t>]*)?\n[ \t>]*${EMPTY}[ \t]*(?=\n|$)`, 'gi'), '')
    .replace(new RegExp(String.raw`^[ \t>]*${EMPTY}[ \t]*\n?`, 'i'), '');
}
