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

/** Строки замечания к абзацу, начиная с i: [последняя строка, текст] или null. */
function parAt(L: Line[], i: number): [number, string] | null {
  const t = L[i].text.trim();
  if (t.startsWith('{>>')) {
    for (let j = i; j < L.length; j++) {
      if (L[j].text.trimEnd().endsWith('<<}')) {
        const raw = L.slice(i, j + 1).map((l) => l.text).join('\n').trim();
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
    .map((l) => l.replace(/^\s*(#{1,6}\s|>\s?(\[![^\]]*\][+-]?\s*)?|([-*+]|\d+[.)])\s+(\[[ xX]\]\s)?)/, ''))
    .join(' ')
    .replace(/<[^>\n]+>/g, '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~=`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Все замечания по порядку: общие, потом к абзацам. */
export function parseRemarks(doc: string): Remark[] {
  const L = linesOf(doc);
  const out: Remark[] = [];
  const g = genBlock(L);
  for (const it of g?.items ?? []) out.push({ kind: 'gen', n: 0, raw: it.text, ...parseInner(it.text), from: L[it.line].from, to: L[it.last].to });
  let fence = false;
  for (let i = 0; i < L.length; i++) {
    if (/^\s*(```|~~~)/.test(L[i].text)) fence = !fence;
    if (fence || (g && i >= g.a && i <= g.b)) continue;
    const hit = parAt(L, i);
    if (!hit) {
      // замечание посреди строки — к этой строке
      for (const m of L[i].text.matchAll(/\{>>(.*?)<<\}/g)) {
        const at = plain(L[i].text);
        out.push({
          kind: 'par',
          n: 0,
          inline: true,
          raw: m[1].trim(),
          ...parseInner(m[1].trim()),
          from: L[i].from + m.index!,
          to: L[i].from + m.index! + m[0].length,
          anchor: at.length > 110 ? at.slice(0, 110) + '…' : at || '(в строке)',
          anchorAt: L[i].from,
        });
      }
      continue;
    }
    const [j, text] = hit;
    // абзац выше: ближайшая непустая строка, не замечание
    let k = i - 1;
    while (k >= 0 && !L[k].text.trim()) k--;
    let start = k;
    while (start > 0 && L[start - 1].text.trim() && !parAt(L, start - 1)) start--;
    const anchor = k >= 0 ? plain(L.slice(start, k + 1).map((l) => l.text).join('\n')) : '';
    out.push({
      kind: 'par',
      n: 0,
      raw: text,
      ...parseInner(text),
      from: L[i].from,
      to: L[j].to,
      anchor: anchor ? (anchor.length > 110 ? anchor.slice(0, 110) + '…' : anchor) : '(начало текста)',
      anchorAt: k >= 0 ? L[start].from : undefined,
    });
    i = j;
  }
  out.forEach((r, i) => (r.n = i + 1));
  return out;
}

/** Замечание к абзацу, где стоит курсор: уже есть — где его текст (править); нет — что вставить.
 *  `cursor` — куда поставить курсор после вставки (внутрь `{>>|<<}`). */
export function remarkAt(doc: string, pos: number): { existing: Remark } | { change: Change; cursor: number } {
  const L = linesOf(doc);
  let i = L.findIndex((l) => pos >= l.from && pos <= l.to);
  if (i < 0) i = L.length - 1;
  // стоим на самом замечании — его и править
  const here = parseRemarks(doc).find((r) => r.kind === 'par' && pos >= r.from && pos <= r.to);
  if (here) return { existing: here };
  // пустая строка — к абзацу выше
  while (i > 0 && !L[i].text.trim()) i--;
  // конец абзаца
  let j = i;
  while (j + 1 < L.length && L[j + 1].text.trim() && !parAt(L, j + 1)) j++;
  // сразу за абзацем уже есть замечание — его и править
  let k = j + 1;
  while (k < L.length && !L[k].text.trim()) k++;
  if (k < L.length && k - j <= 2 && parAt(L, k)) {
    const r = parseRemarks(doc).find((x) => x.kind === 'par' && x.from === L[k].from);
    if (r) return { existing: r };
  }
  const at = L[j].to;
  return { change: { from: at, to: at, insert: '\n\n{>><<}' }, cursor: at + 5 };
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

/** Замечание к блоку текста [from, to): уже стоит сразу за ним — оно; нет — куда вставить новое. */
export function remarkAfter(doc: string, from: number, to: number, text: string, phrase?: string): Change {
  const end = from + doc.slice(from, to).trimEnd().length;
  return { from: end, to: end, insert: `\n\n{>>${buildInner({ text, phrase })}<<}` };
}

/** Общие замечания списком (без номеров). */
export function generalItems(doc: string): string[] {
  return (genBlock(linesOf(doc))?.items ?? []).map((x) => x.text);
}

/** Убрать строки a..b и одну пустую рядом (чтобы не копились пустые строки). */
function cut(doc: string, L: Line[], a: number, b: number): Change {
  let from = L[a].from;
  let to = L[b].to;
  if (a > 0 && !L[a - 1].text.trim()) from = L[a - 1].from - (a > 1 ? 1 : 0);
  else if (b + 1 < L.length && !L[b + 1].text.trim()) to = L[b + 1].to;
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
  return { from: r.from, to: r.to, insert: `{>>${r.inline ? raw.replace(/\n/g, ' ⏎ ') : raw}<<}` };
}

/** Новые слова автора на старом месте (фраза и переписка остаются). */
export function editRemark(doc: string, r: Remark, text: string): Change {
  return setRaw(doc, r, buildInner({ ...r, text }));
}

/** Дописать в замечание: ответ Claude (✓ сделано, ❓ вопрос, ✗ не принято) или приписку автора (↩). */
export function replyRemark(doc: string, r: Remark, mark: Mark, text: string): Change {
  return setRaw(doc, r, buildInner({ ...r, thread: [...r.thread, { by: mark === '↩' ? 'author' : 'claude', mark, text: text.trim() || (mark === '↩' ? 'вернул' : '') }] }));
}

/** Перенести замечание к другому блоку [from, to) (или из общих — к абзацу). Правки — по
 *  возрастанию места, для applyAll. */
export function moveRemark(doc: string, r: Remark, from: number, to: number): Change[] {
  const inner = buildInner({ ...r, gone: undefined });
  const end = from + doc.slice(from, to).trimEnd().length;
  return [removeRemark(doc, r), { from: end, to: end, insert: `\n\n{>>${inner}<<}` }].sort((a, b) => a.from - b.from);
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

/** Пустые замечания `{>><<}` (нажали ✎ и ничего не написали) в файл не идут: строка убирается
 *  вместе с пустой строкой перед ней. */
export function dropEmptyRemarks(doc: string): string {
  if (!doc.includes('{>>')) return doc;
  return doc.replace(/(?:\n[ \t]*)?\n[ \t]*\{>>\s*<<\}[ \t]*(?=\n|$)/g, '').replace(/^[ \t]*\{>>\s*<<\}[ \t]*\n?/, '');
}
