// Сноски markdown: в тексте ссылка `[^1]` (id — любой), определение — отдельной строкой
// `[^1]: текст` (продолжение — строками с отступом). Как в «Вычитке» (~/projects/apps/translator-panel):
// «＋ Сноска» ставит ссылку у курсора и заводит определение в конце текста, список сносок — во
// вкладке справа, в чтении номер раскрывает определение под абзацем.
//
// Без React и CodeMirror: правки — изменения {from, to, insert}; тесты — scripts/kbfootnotes.test.mjs.

import { generalRange, type Change } from './remarks.ts';

export interface Footnote {
  id: string;
  /** Номер по порядку первой ссылки в тексте (с 1); 0 — на сноску никто не ссылается. */
  n: number;
  text: string;
  /** Где определение (вся строка с продолжениями); нет определения — undefined. */
  defFrom?: number;
  defTo?: number;
  /** Места ссылок `[^id]` в тексте. */
  refs: number[];
}

const DEF = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const REF = /\[\^([^\]\s]+)\](?!:)/g;

/** Сноски текста: сначала по порядку ссылок, потом определения без ссылок. */
export function parseFootnotes(doc: string): Footnote[] {
  const defs = new Map<string, { text: string; from: number; to: number }>();
  const lines = doc.split('\n');
  const defLines = new Set<number>();
  let p = 0;
  const starts: number[] = [];
  for (const l of lines) {
    starts.push(p);
    p += l.length + 1;
  }
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    if (fence) continue;
    const m = lines[i].match(DEF);
    if (!m) continue;
    let j = i;
    const body = [m[2]];
    // продолжение: строки с отступом (и пустые между ними)
    while (j + 1 < lines.length && (/^( {2,}|\t)\S/.test(lines[j + 1]) || (lines[j + 1].trim() === '' && j + 2 < lines.length && /^( {2,}|\t)\S/.test(lines[j + 2])))) {
      j++;
      body.push(lines[j].trim());
    }
    for (let k = i; k <= j; k++) defLines.add(k);
    if (!defs.has(m[1])) defs.set(m[1], { text: body.join('\n').trim(), from: starts[i], to: starts[j] + lines[j].length });
    i = j;
  }
  const out = new Map<string, Footnote>();
  fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    if (fence || defLines.has(i)) continue;
    for (const m of lines[i].matchAll(REF)) {
      const id = m[1];
      const at = starts[i] + m.index!;
      const f = out.get(id);
      if (f) f.refs.push(at);
      else {
        const d = defs.get(id);
        out.set(id, { id, n: out.size + 1, text: d?.text ?? '', defFrom: d?.from, defTo: d?.to, refs: [at] });
      }
    }
  }
  const list = [...out.values()];
  for (const [id, d] of defs) if (!out.has(id)) list.push({ id, n: 0, text: d.text, defFrom: d.from, defTo: d.to, refs: [] });
  return list;
}

/** Следующий свободный номер-id. */
function nextId(doc: string): string {
  let max = 0;
  for (const m of doc.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(m[1]));
  return String(max + 1);
}

/** Куда ставить новое определение: в конец текста, но перед блоком общих замечаний. */
function defPlace(doc: string): { at: number; before: string; after: string } {
  const g = generalRange(doc);
  const end = g ? g.from : doc.length;
  const head = doc.slice(0, end);
  const trimmed = head.trimEnd().length;
  const last = head.slice(0, trimmed).split('\n').pop() ?? '';
  // после другого определения — следующей строкой, иначе через пустую
  const before = !trimmed ? '' : DEF.test(last) ? '\n' : '\n\n';
  return { at: trimmed, before, after: g ? '\n\n' : '\n' };
}

/** Новая сноска у курсора: ссылка `[^n]` на месте и пустое определение в конце.
 *  Изменения идут по возрастанию места; id — чтобы открыть поле сноски. */
export function addFootnote(doc: string, pos: number): { changes: Change[]; id: string } {
  const id = nextId(doc);
  const place = defPlace(doc);
  // курсор не дальше места определений (стоял в хвосте — ссылка встаёт перед определениями)
  const at = Math.min(pos, place.at);
  const g = generalRange(doc);
  const tailFrom = place.at;
  const tailTo = g ? g.from : doc.length;
  return {
    id,
    changes: [
      { from: at, to: at, insert: `[^${id}]` },
      { from: tailFrom, to: tailTo, insert: `${place.before}[^${id}]: ${place.after}` },
    ],
  };
}

/** Новый текст определения (нет определения — завести). Многострочный — с отступом. */
export function editFootnote(doc: string, f: Footnote, text: string): Change {
  const body = text
    .trim()
    .split('\n')
    .map((l, i) => (i ? '    ' + l.trim() : l.trim()))
    .filter((l, i) => i === 0 || l.trim())
    .join('\n');
  const line = `[^${f.id}]: ${body}`;
  if (f.defFrom !== undefined && f.defTo !== undefined) return { from: f.defFrom, to: f.defTo, insert: line };
  const place = defPlace(doc);
  const g = generalRange(doc);
  return { from: place.at, to: g ? g.from : doc.length, insert: `${place.before}${line}${place.after}` };
}

/** Убрать сноску: определение и все ссылки на неё. Изменения — по возрастанию места. */
export function removeFootnote(doc: string, f: Footnote): Change[] {
  const out: Change[] = f.refs.map((at) => ({ from: at, to: at + `[^${f.id}]`.length, insert: '' }));
  if (f.defFrom !== undefined && f.defTo !== undefined) {
    // строку определения — вместе с переводом строки перед ней (и пустой строкой, если осталась одна)
    let from = f.defFrom;
    if (from > 0 && doc[from - 1] === '\n') from--;
    const prevLine = doc.slice(0, from).split('\n').pop() ?? '';
    const nextStart = Math.min(doc.length, f.defTo + 1);
    const nextLine = doc.slice(nextStart).split('\n')[0] ?? '';
    if (!prevLine.trim() && from > 0 && (!nextLine.trim() || f.defTo >= doc.length)) from--;
    out.push({ from: Math.max(0, from), to: f.defTo, insert: '' });
  }
  return out.sort((a, b) => a.from - b.from);
}

export { applyAll } from './remarks.ts';
