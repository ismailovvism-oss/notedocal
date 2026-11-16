// Блоки текста — абзац, список, таблица, выноска, заголовок — с местом в тексте и своими
// замечаниями. На них стоят кружки ✎ в просмотре (src/desktop/Preview.tsx) и перестановка:
// блок переезжает вместе с замечаниями, которые лежат сразу за ним (Alt+↑/↓ в правке,
// ручка в просмотре), — при вычитке автор свободно меняет абзацы местами.
//
// Без React и CodeMirror; тесты — scripts/kbblocks.test.mjs.

import { marked } from 'marked';
import { generalRange, parseRemarks, type Change, type Remark } from './remarks.ts';

export interface Block {
  from: number;
  to: number;
  raw: string;
  /** Замечания, стоящие сразу за блоком. */
  notes: Remark[];
}

const REMARK_ONLY = /^\s*(\{>>[\s\S]*<<\}|%%(?!🎤:)[\s\S]*%%)\s*$/;
const FOOT_DEF = /^\s*\[\^[^\]\s]+\]:/;

/** Блоки верхнего уровня; замечания-строки — при своём блоке. Блок общих замечаний и
 *  определения сносок блоками не считаются. null — разбор не сошёлся с текстом. */
export function blocksOf(src: string, remarks: Remark[] = parseRemarks(src)): Block[] | null {
  const tokens = marked.lexer(src);
  // места считаются по исходным кускам: разбор обязан вернуть текст как есть
  if (tokens.map((t) => t.raw).join('') !== src) return null;
  const gen = generalRange(src);
  const standalone = new Map(remarks.filter((r) => r.kind === 'par' && !r.inline).map((r) => [r.from, r]));
  const out: Block[] = [];
  let at = 0;
  for (const t of tokens) {
    const from = at;
    at += t.raw.length;
    if (t.type === 'space') continue;
    if (gen && from < gen.to && at > gen.from) continue;
    if (FOOT_DEF.test(t.raw)) continue;
    if (REMARK_ONLY.test(t.raw)) {
      // в одном куске разбора может лежать несколько замечаний подряд
      const mine = [...standalone.values()].filter((r) => r.from >= from && r.from < at);
      if (mine.length) {
        if (out.length) out[out.length - 1].notes.push(...mine);
        else out.push({ from, to: from, raw: '', notes: mine }); // замечание в самом начале текста
        continue;
      }
    }
    out.push({ from, to: at, raw: t.raw, notes: [] });
  }
  return out;
}

/** Блок вместе со своими замечаниями: откуда и докуда в тексте. */
export function unitRange(b: Block): { from: number; to: number } {
  const end = b.from + b.raw.trimEnd().length;
  return { from: b.from, to: b.notes.length ? Math.max(end, ...b.notes.map((r) => r.to)) : end };
}

/** Какой блок под этим местом (или ближайший выше); -1 — блоков нет. */
export function blockAt(blocks: Block[], pos: number): number {
  let hit = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].from <= pos) hit = i;
    else break;
  }
  return hit;
}

/** Переставить блок i (с его замечаниями) так, чтобы он встал перед блоком j (j = blocks.length —
 *  в самый конец). Правки — по исходному тексту; start — где блок окажется. null — некуда. */
export function moveUnit(doc: string, blocks: Block[], i: number, j: number): { changes: Change[]; start: number } | null {
  if (i < 0 || i >= blocks.length || j < 0 || j > blocks.length || j === i || j === i + 1) return null;
  const u = unitRange(blocks[i]);
  const text = doc.slice(u.from, u.to);
  // убрать блок вместе с пустыми строками после него (последний в тексте — с пустыми перед ним)
  let rmFrom = u.from;
  let rmTo = u.to + (doc.slice(u.to).match(/^\s*/)?.[0].length ?? 0);
  if (rmTo >= doc.length) {
    rmTo = doc.length;
    rmFrom = u.from - (doc.slice(0, u.from).match(/\s*$/)?.[0].length ?? 0);
  }
  const ins: Change =
    j < blocks.length
      ? { from: blocks[j].from, to: blocks[j].from, insert: text + '\n\n' }
      : (() => {
          const end = unitRange(blocks[blocks.length - 1]).to;
          return { from: end, to: end, insert: '\n\n' + text };
        })();
  const rm: Change = { from: rmFrom, to: rmTo, insert: rmTo >= doc.length && doc.endsWith('\n') ? '\n' : '' };
  // где окажется: место вставки минус то, что убрали до него, плюс перевод строки перед текстом
  const start = ins.from - (rm.from < ins.from ? rm.to - rm.from - rm.insert.length : 0) + (j < blocks.length ? 0 : 2);
  return { changes: [rm, ins].sort((a, b) => a.from - b.from), start };
}

/** Alt+↑ / Alt+↓: блок под курсором — на одно место вверх или вниз; cursor — где он теперь. */
export function shiftUnit(doc: string, pos: number, dir: -1 | 1): { changes: Change[]; cursor: number } | null {
  const blocks = blocksOf(doc);
  if (!blocks) return null;
  const i = blockAt(blocks, pos);
  if (i < 0) return null;
  const m = moveUnit(doc, blocks, i, dir < 0 ? i - 1 : i + 2);
  if (!m) return null;
  // курсор остаётся на том же месте внутри блока
  const u = unitRange(blocks[i]);
  return { changes: m.changes, cursor: m.start + Math.min(Math.max(pos - u.from, 0), u.to - u.from) };
}

// --- кто что изменил: сравнение двух версий текста по блокам ---

export interface BlockChange {
  /** Блок новой версии: не тронут, переписан, добавлен или переставлен. */
  kind: 'same' | 'changed' | 'added' | 'moved';
  /** Текст блока в новой версии. */
  raw: string;
  /** Как было (у переписанного). */
  was?: string;
}
export interface BlocksDiff {
  /** По блокам новой версии, по порядку. */
  now: BlockChange[];
  /** Убранные блоки: текст и перед каким блоком новой версии стоял (now.length — в конце). */
  removed: { raw: string; before: number }[];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const words = (s: string) => norm(s).toLowerCase().split(' ');
/** Насколько два абзаца — один и тот же, переписанный (0…1): доля общих слов. */
function alike(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  const left = new Map<string, number>();
  for (const w of wa) left.set(w, (left.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) {
    const n = left.get(w) ?? 0;
    if (n > 0) {
      common++;
      left.set(w, n - 1);
    }
  }
  return (2 * common) / (wa.length + wb.length || 1);
}

/** Тексты блоков без замечаний: переписка в замечаниях правкой текста не считается. */
function texts(doc: string): string[] {
  return (blocksOf(doc) ?? []).filter((b) => b.raw.trim()).map((b) => b.raw.trimEnd());
}

/** Что изменилось от старой версии к новой — по блокам. */
export function diffBlocks(oldDoc: string, newDoc: string): BlocksDiff {
  // сравниваем без учёта пробелов и переносов, отдаём текст как есть (с разметкой и строками)
  const rawA = texts(oldDoc);
  const rawB = texts(newDoc);
  const A = rawA.map(norm);
  const B = rawB.map(norm);
  // самая длинная общая последовательность неизменных блоков
  const L: number[][] = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const now: BlockChange[] = rawB.map((raw) => ({ kind: 'added', raw }));
  const usedA = new Set<number>();
  const gaps: { a: number[]; b: number[] }[] = [];
  let gap = { a: [] as number[], b: [] as number[] };
  for (let i = 0, j = 0; i < A.length || j < B.length; ) {
    if (i < A.length && j < B.length && A[i] === B[j]) {
      now[j].kind = 'same';
      usedA.add(i);
      gaps.push(gap);
      gap = { a: [], b: [] };
      i++;
      j++;
    } else if (j < B.length && (i >= A.length || L[i][j + 1] >= L[i + 1][j])) gap.b.push(j++);
    else gap.a.push(i++);
  }
  gaps.push(gap);
  // переставленные: тот же текст, но не на своём месте
  const free = new Map<string, number[]>();
  A.forEach((t, i) => !usedA.has(i) && free.set(t, [...(free.get(t) ?? []), i]));
  B.forEach((t, j) => {
    if (now[j].kind !== 'added') return;
    const i = free.get(t)?.shift();
    if (i === undefined) return;
    now[j].kind = 'moved';
    usedA.add(i);
  });
  // в одном промежутке: старый и новый блок похожи — переписан; иначе — убран и добавлен
  const removed: BlocksDiff['removed'] = [];
  let nextB = 0;
  for (const g of gaps) {
    const olds = g.a.filter((i) => !usedA.has(i));
    const news = g.b.filter((j) => now[j].kind === 'added');
    for (const j of news) {
      let best = -1;
      let score = 0.34;
      for (const i of olds) {
        if (usedA.has(i)) continue;
        const s = alike(A[i], B[j]);
        if (s > score) {
          score = s;
          best = i;
        }
      }
      if (best >= 0) {
        now[j] = { kind: 'changed', raw: rawB[j], was: rawA[best] };
        usedA.add(best);
      }
    }
    const at = g.b.length ? g.b[g.b.length - 1] + 1 : nextB;
    for (const i of olds) if (!usedA.has(i)) removed.push({ raw: rawA[i], before: at });
    nextB = at + 1;
  }
  return { now, removed };
}

/** Правки Claude, которые ещё стоят в тексте: по блокам нынешнего текста (в том же порядке, что
 *  blocksOf без пустых) — что он переписал или добавил, и что убрал. Считается от снимка «до» его
 *  круга; блок, который автор потом поправил сам, правкой Claude уже не считается. */
export function claudeChanges(before: string, after: string, current: string): BlocksDiff {
  const d = diffBlocks(before, current);
  const inAfter = new Set(texts(after).map(norm));
  const inBefore = new Set(texts(before).map(norm));
  return {
    now: d.now.map((b) => ((b.kind === 'changed' || b.kind === 'added') && inAfter.has(norm(b.raw)) && !inBefore.has(norm(b.raw)) ? b : { kind: 'same', raw: b.raw })),
    removed: d.removed.filter((r) => !inAfter.has(norm(r.raw))),
  };
}
