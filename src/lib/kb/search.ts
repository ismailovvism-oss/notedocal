// Полнотекстовый поиск по заметкам (docs/ЗАМЕТКИ.md, раздел 5, этап 5).
//
// Арабское находится как написано и без огласовок: запрос приводится к простому виду
// (без огласовок и татвиля, хамзы — к одной букве, та марбута = ха, алиф максура = йа),
// а по тексту ищет регулярка, которой огласовки между буквами безразличны. Так тексты
// не приходится хранить второй раз в «нормальном» виде (волт — 57 МБ), а найденное место
// указывает прямо в исходник — по нему и подсветка.
//
// Без React: этот же модуль зовёт secretary.mjs.

import type { Note } from '../../types.ts';
import { plainText } from './syntax.ts';

/** Простой вид буквы. Хамза на любой подставке — `ء`: «مسئلة» и «مسألة» — одно слово. */
const MAIN = new Map<string, string>([
  ...[...'أإآؤئ'].map((ch) => [ch, 'ء'] as [string, string]),
  ['ٱ', 'ا'],
  ['ى', 'ي'],
  ['ی', 'ي'],
  ['ة', 'ه'],
  ['ک', 'ك'],
  ['ё', 'е'],
]);
/** Что находит буква запроса. Хамза — любую хамзу или голый алиф (пишут и без неё); голые
 *  алиф, вав, йа — ещё и себя с хамзой, но не другие подставки. */
const CLASS = new Map([
  ['ء', '[ءأإآؤئٱا]'],
  ['ا', '[اأإآٱ]'],
  ['و', '[وؤ]'],
  ['ي', '[يىئی]'],
  ['ه', '[هة]'],
  ['ك', '[كک]'],
  ['е', '[её]'],
]);

/** Огласовки, знаки чтения Корана, ударения и татвиль — их между буквами не замечаем. */
const MARKS = /[\p{M}ـ]/gu;
const GAP = '[\\p{M}\\u0640]*';

/** Простой вид строки: без огласовок, нижний регистр, близкие буквы — к одной. */
export function normalize(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC').replace(MARKS, '').toLowerCase()) out += MAIN.get(ch) ?? ch;
  return out;
}

const esc = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** Регулярка для слова в простом виде: каждая буква — со своими вариантами и огласовками после. */
function wordPattern(word: string): string {
  let p = '';
  for (const ch of word) p += (CLASS.get(ch) ?? esc(ch)) + GAP;
  return p;
}

/** Части запроса: слова и фразы в кавычках. Каждая должна найтись (в любом порядке). */
export function parseQuery(q: string): string[] {
  const parts: string[] = [];
  for (const m of q.matchAll(/"([^"]*)"|«([^»]*)»|(\S+)/g)) {
    const p = normalize((m[1] ?? m[2] ?? m[3]).trim()).replace(/\s+/g, ' ');
    if (p) parts.push(p);
  }
  return parts;
}

/** Регулярки запроса (по одной на часть); пусто — искать нечего. */
export function compileQuery(q: string): RegExp[] {
  return parseQuery(q).map((p) => new RegExp(p.split(' ').map(wordPattern).join('\\s+'), 'giu'));
}

/** Где в тексте стоят совпадения: [начало, конец), по порядку, без наложений. */
export function matchRanges(text: string, res: RegExp[], max = 50): [number, number][] {
  const out: [number, number][] = [];
  for (const re of res) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m && out.length < max; m = re.exec(text)) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      out.push([m.index, m.index + m[0].length]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.filter((r, i) => i === 0 || r[0] >= out[i - 1][1]);
}

export interface SearchHit {
  note: Note;
  score: number;
  /** Кусок текста вокруг первого совпадения (без разметки) и подсветка в нём. */
  snippet: string;
  marks: [number, number][];
}

/** Сколько раз встречается (не больше `cap`). */
function count(re: RegExp, text: string, cap: number): number {
  re.lastIndex = 0;
  let n = 0;
  while (n < cap && re.exec(text)) n++;
  return n;
}

/** Кусок вокруг места `pos`: ~ `len` знаков, без разметки, в одну строку. */
function snippetAt(body: string, pos: number, res: RegExp[], len = 180): { snippet: string; marks: [number, number][] } {
  const from = Math.max(0, pos - Math.floor(len / 3));
  // края — по пробелу, чтобы не резать слово
  const left = from > 0 ? body.indexOf(' ', from) + 1 || from : 0;
  const right = Math.min(body.length, left + len);
  const cut = right < body.length ? body.lastIndexOf(' ', right) : right;
  const piece = plainText(body.slice(left, cut > left ? cut : right)).replace(/\s+/g, ' ');
  const snippet = (left > 0 ? '…' : '') + piece + (right < body.length ? '…' : '');
  return { snippet, marks: matchRanges(snippet, res) };
}

/** Найти заметки: все части запроса должны найтись в названии, псевдонимах или тексте.
 *  Выше — где нашлось в названии, потом — где чаще, потом — свежие. */
export function searchNotes(notes: Iterable<Note>, q: string, limit = 200): { hits: SearchHit[]; total: number } {
  const parts = parseQuery(q);
  if (!parts.length || parts.join('').length < 2) return { hits: [], total: 0 };
  // длинные части обычно редкие: с них отсев быстрее («ибн таймийя» — сначала «таймийя»)
  const res = compileQuery(q).map((re, i) => ({ re, len: parts[i].length })).sort((a, b) => b.len - a.len).map((x) => x.re);
  const found: { note: Note; score: number; first: number }[] = [];
  for (const n of notes) {
    if (n.deleted || n.type === 'credential') continue;
    const title = [n.title ?? '', ...(n.aliases ?? [])].join('\n');
    const body = n.body ?? '';
    let first = -1;
    let ok = true;
    for (const re of res) {
      re.lastIndex = 0;
      const m = re.exec(body);
      if (!m && !count(re, title, 1)) {
        ok = false;
        break;
      }
      if (m && (first < 0 || m.index < first)) first = m.index;
    }
    if (!ok) continue;
    // вес считаем только у подошедших
    let score = 0;
    for (const re of res) score += count(re, title, 1) * 100 + count(re, body, 20);
    found.push({ note: n, score, first });
  }
  found.sort((a, b) => b.score - a.score || (b.note.updatedAt ?? 0) - (a.note.updatedAt ?? 0));
  const hits = found.slice(0, limit).map(({ note, score, first }) => {
    const body = note.body ?? '';
    const s = first >= 0 ? snippetAt(body, first, res) : { snippet: plainText(body.slice(0, 200)).replace(/\s+/g, ' '), marks: [] };
    return { note, score, ...s };
  });
  return { hits, total: found.length };
}
