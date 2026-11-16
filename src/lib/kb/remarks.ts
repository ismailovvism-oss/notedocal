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
// Без React и CodeMirror: правки — изменения {from, to, insert} по тексту; тесты —
// scripts/kbremarks.test.mjs.

export interface Remark {
  kind: 'gen' | 'par';
  /** Сквозной номер с 1. */
  n: number;
  text: string;
  /** Где лежит в тексте: строка(и) замечания (у общего — его строка в блоке). */
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
function genBlock(L: Line[]): { a: number; b: number; items: { text: string; line: number }[] } | null {
  for (let i = 0; i < L.length; i++) {
    if (!GEN_OPEN.test(L[i].text)) continue;
    let j = i + 1;
    while (j < L.length && !GEN_CLOSE.test(L[j].text)) j++;
    const items: { text: string; line: number }[] = [];
    for (let k = i + 1; k < j && k < L.length; k++) {
      if (L[k].text.trim()) items.push({ text: L[k].text.replace(/^\s*\d+[.)]\s*/, '').trim(), line: k });
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
    .replace(/^\s*(#{1,6}\s|>\s?(\[![^\]]*\][+-]?\s*)?|[-*+]\s|\d+[.)]\s)/, '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/[*_~=`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Все замечания по порядку: общие, потом к абзацам. */
export function parseRemarks(doc: string): Remark[] {
  const L = linesOf(doc);
  const out: Remark[] = [];
  const g = genBlock(L);
  for (const it of g?.items ?? []) out.push({ kind: 'gen', n: 0, text: it.text, from: L[it.line].from, to: L[it.line].to });
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
          text: m[1].trim(),
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
    const anchor = k >= 0 ? plain(L.slice(start, k + 1).map((l) => l.text).join(' ')) : '';
    out.push({
      kind: 'par',
      n: 0,
      text,
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
  const body = list.length ? '%%замечания\n' + list.map((t, i) => `${i + 1}. ${t}`).join('\n') + '\n%%' : '';
  if (g) {
    if (body) return { from: L[g.a].from, to: L[g.b].to, insert: body };
    return cut(doc, L, g.a, g.b);
  }
  if (!body) return { from: 0, to: 0, insert: '' };
  const end = doc.length;
  const sep = !doc ? '' : doc.endsWith('\n\n') ? '' : doc.endsWith('\n') ? '\n' : '\n\n';
  return { from: end, to: end, insert: sep + body + '\n' };
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
  const L = linesOf(doc);
  const a = L.findIndex((l) => l.from === r.from);
  const b = L.findIndex((l) => l.to === r.to);
  return cut(doc, L, a, b < 0 ? a : b);
}

/** Новый текст замечания на старом месте. */
export function editRemark(doc: string, r: Remark, text: string): Change {
  if (r.kind === 'gen') {
    const items = generalItems(doc);
    const idx = parseRemarks(doc).filter((x) => x.kind === 'gen').findIndex((x) => x.from === r.from);
    items[idx] = text;
    return writeGeneral(doc, items);
  }
  return { from: r.from, to: r.to, insert: `{>>${text.replace(/\n{2,}/g, '\n').trim()}<<}` };
}

/** Все замечания одним куском — отдать Claude. */
export function remarksText(list: Remark[]): string {
  return list.map((r) => (r.kind === 'gen' ? `${r.n}. (общее) ${r.text}` : `${r.n}. К «${r.anchor}»:\n   ${r.text}`)).join('\n');
}

/** Применить изменение к строке (для тестов и записи без редактора). */
export function apply(doc: string, c: Change): string {
  return doc.slice(0, c.from) + c.insert + doc.slice(c.to);
}
