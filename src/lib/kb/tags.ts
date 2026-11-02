// Теги и фасеты (docs/ЗАМЕТКИ.md, 3.3, этап 3). Тег — путь `тема/таухид/сыфаты`; фасет — первая
// часть пути (`тема`). Отбор как в магазине: внутри фасета значения через «или», между
// фасетами — через «и»; у каждого значения видно, сколько заметок оно даст.
//
// Словарь тегов — заметки роли «тег» с названием-путём. В карточке: описание (текст),
// синонимы (`aliases`, в том числе по-арабски), свойства `смотри-также`, `родители` (вторые
// родители — тег стоит и в другой ветке) и `слит-в` (тег-предшественник). Без React: эти же
// функции зовёт secretary.mjs.

import type { Note } from '../../types.ts';
import type { KbIndex } from './index.ts';
import { maskInert, normTag } from './syntax.ts';

/** Фасеты волта — идут первыми, в этом порядке. Свои (личные) появляются сами, когда ими пишут. */
export const FACET_ROOTS = ['тип', 'тема', 'статус', 'источник', 'назначение', 'проект'];
/** Фасет тегов без «/» — «прочее». */
export const OTHER = '';

const key = (s: string) => normTag(s).toLowerCase();
const parentPath = (tag: string) => (tag.includes('/') ? tag.slice(0, tag.lastIndexOf('/')) : '');
export const facetOf = (tag: string) => (tag.includes('/') ? tag.slice(0, tag.indexOf('/')) : OTHER);

export interface TagCard {
  note: Note;
  tag: string;
  synonyms: string[];
  seeAlso: string[];
  parents: string[];
  mergedInto?: string;
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') return v.split(',').map(normTag).filter(Boolean);
  if (Array.isArray(v)) return v.map((x) => normTag(String(x))).filter(Boolean);
  return [];
}

/** Карточки тегов: тег в нижнем регистре → карточка. */
export function tagCards(notes: Iterable<Note>): Map<string, TagCard> {
  const res = new Map<string, TagCard>();
  for (const n of notes) {
    if (n.deleted || n.type !== 'tag' || !normTag(n.title)) continue;
    const merged = strings(n.props?.['слит-в'])[0];
    res.set(key(n.title), {
      note: n,
      tag: normTag(n.title),
      synonyms: n.aliases ?? [],
      seeAlso: strings(n.props?.['смотри-также']),
      parents: strings(n.props?.['родители']),
      ...(merged ? { mergedInto: merged } : {}),
    });
  }
  return res;
}

/** Тег с учётом «слит в»: старое имя ведёт к новому (цепочка — не длиннее 8 шагов). */
export function canonicalTag(cards: Map<string, TagCard>, tag: string): string {
  let t = normTag(tag);
  for (let i = 0; i < 8; i++) {
    // слит может быть и предок: `фикх/старое/x` при `фикх/старое` → `фикх/новое`
    const parts = t.split('/');
    let moved = false;
    for (let j = parts.length; j > 0; j--) {
      const c = cards.get(key(parts.slice(0, j).join('/')));
      if (c?.mergedInto) {
        t = [c.mergedInto, ...parts.slice(j)].join('/');
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return t;
}

/** Все теги-«предки» тега: части пути и вторые родители из карточек (с их предками). */
export function ancestorsOf(cards: Map<string, TagCard>, tag: string): Set<string> {
  const res = new Set<string>();
  const walk = (t: string, depth: number) => {
    if (!t || res.has(key(t)) || depth > 20) return;
    res.add(key(t));
    walk(parentPath(t), depth + 1);
    for (const p of cards.get(key(t))?.parents ?? []) walk(p, depth + 1);
  };
  walk(normTag(tag), 0);
  return res;
}

/** Теги каждой заметки — уже с учётом «слит в». Карточки тегов сами в отбор не идут. */
export function tagsByNote(index: KbIndex, cards: Map<string, TagCard>): Map<string, string[]> {
  const res = new Map<string, string[]>();
  for (const [id, tags] of index.noteTags) {
    if (index.byId.get(id)?.type === 'tag') continue;
    const seen = new Map<string, string>();
    for (const t of tags) {
      const c = canonicalTag(cards, t);
      if (!seen.has(key(c))) seen.set(key(c), c);
    }
    if (seen.size) res.set(id, [...seen.values()]);
  }
  return res;
}

/** Выбор в фасетах: фасет → выбранные теги (в нижнем регистре). */
export type Selection = Map<string, Set<string>>;

/** Выбрать или снять значение в его фасете. */
export function toggleTag(sel: Selection, tag: string): Selection {
  const f = facetOf(tag);
  const next: Selection = new Map([...sel].map(([x, s]) => [x, new Set(s)]));
  const set = next.get(f) ?? new Set<string>();
  if (set.has(key(tag))) set.delete(key(tag));
  else set.add(key(tag));
  if (set.size) next.set(f, set);
  else next.delete(f);
  return next;
}

/** Все выбранные теги одним списком. */
export const selectedTags = (sel: Selection) => [...sel.values()].flatMap((s) => [...s]);

function matchesFacet(anc: Set<string>[], chosen: Set<string>): boolean {
  for (const a of anc) for (const c of chosen) if (a.has(c)) return true;
  return false;
}

/** Подходит ли заметка с такими тегами под выбор; `skip` — фасет, который не проверять. */
function matchesAll(anc: Set<string>[], sel: Selection, skip?: string): boolean {
  for (const [facet, chosen] of sel) {
    if (facet === skip || !chosen.size) continue;
    if (!matchesFacet(anc, chosen)) return false;
  }
  return true;
}

export interface FacetNode {
  tag: string;
  /** Последняя часть пути — подпись в дереве. */
  name: string;
  /** Сколько заметок даст выбор этого значения при остальных выбранных фасетах. */
  count: number;
  children: FacetNode[];
}

export interface Facets {
  /** Фасет → дерево значений; FACET_ROOTS первыми, затем свои по алфавиту, «прочее» последним. */
  facets: { facet: string; values: FacetNode[] }[];
  /** id заметок, подходящих под выбор. */
  matching: string[];
}

/** Счётчики фасетов и подходящие заметки — всё за один проход по заметкам. */
export function computeFacets(index: KbIndex, cards: Map<string, TagCard>, sel: Selection): Facets {
  const byNote = tagsByNote(index, cards);
  const all = new Map<string, string>(); // тег → как пишется (вместе с предками по пути)
  const addPath = (t: string) => {
    const parts = t.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (!all.has(key(p))) all.set(key(p), p);
    }
  };
  const ancOf = new Map<string, Set<string>>();
  for (const tags of byNote.values()) {
    for (const t of tags) {
      addPath(t);
      if (!ancOf.has(key(t))) ancOf.set(key(t), ancestorsOf(cards, t));
    }
  }
  // карточки тегов и их вторые родители видны в дереве, даже пока ими никто не помечен
  for (const c of cards.values()) {
    if (c.mergedInto) continue;
    addPath(c.tag);
    for (const p of c.parents) addPath(p);
  }

  const counts = new Map<string, number>();
  const matching: string[] = [];
  for (const [id, tags] of byNote) {
    const anc = tags.map((t) => ancOf.get(key(t))!);
    if (matchesAll(anc, sel)) matching.push(id);
    // для счётчика значения фасета F выбор в самом F не учитывается (там «или»)
    const facetsOfNote = new Set<string>();
    for (const a of anc) for (const k of a) facetsOfNote.add(facetOf(all.get(k) ?? k));
    const hits = new Set<string>();
    for (const f of new Set([...facetsOfNote, ...sel.keys()])) {
      if (!matchesAll(anc, sel, f)) continue;
      for (const a of anc) for (const k of a) if (facetOf(all.get(k) ?? k) === f) hits.add(k);
    }
    for (const k of hits) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (!sel.size || [...sel.values()].every((s) => !s.size)) {
    matching.length = 0;
  }

  // дерево: дети по пути и по вторым родителям
  const kids = new Map<string, string[]>();
  const addKid = (parent: string, child: string) => {
    const list = kids.get(parent) ?? [];
    if (!list.includes(child)) list.push(child);
    kids.set(parent, list);
  };
  for (const k of all.keys()) {
    const t = all.get(k)!;
    addKid(key(parentPath(t)), k);
    for (const p of cards.get(k)?.parents ?? []) if (all.has(key(p))) addKid(key(p), k);
  }
  const node = (k: string, seen: Set<string>): FacetNode => {
    const t = all.get(k)!;
    const children = seen.has(k)
      ? []
      : (kids.get(k) ?? [])
          .map((c) => node(c, new Set([...seen, k])))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return { tag: t, name: t.split('/').pop()!, count: counts.get(k) ?? 0, children };
  };
  const roots = (kids.get('') ?? []).map((k) => all.get(k)!);
  const facetNames = new Set(roots.filter((r) => kids.has(key(r))).map((r) => r));
  const order = (f: string) => {
    const i = FACET_ROOTS.indexOf(f.toLowerCase());
    return i >= 0 ? i : FACET_ROOTS.length;
  };
  const facets = [...facetNames]
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((f) => ({ facet: f, values: node(key(f), new Set()).children }));
  const loose = roots.filter((r) => !facetNames.has(r)).map((r) => node(key(r), new Set()));
  if (loose.length) facets.push({ facet: OTHER, values: loose.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) });
  return { facets, matching };
}

/** Найти теги по части имени или синониму (в том числе по-арабски). */
export function searchTags(index: KbIndex, cards: Map<string, TagCard>, q: string): string[] {
  const want = q.trim().toLowerCase().replace(/^#/, '');
  if (!want) return [];
  const res = new Set<string>();
  for (const t of index.tagNames.values()) if (t.toLowerCase().includes(want)) res.add(canonicalTag(cards, t));
  for (const c of cards.values()) {
    if (c.tag.toLowerCase().includes(want) || c.synonyms.some((s) => s.toLowerCase().includes(want))) {
      res.add(c.mergedInto ? canonicalTag(cards, c.tag) : c.tag);
    }
  }
  return [...res].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 30);
}

/** Расстояние Левенштейна — чтобы поймать опечатку в новом теге. */
function distance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return dp[b.length];
}

/** Тег новый? Тогда — похожие существующие (опечатка, другой регистр, тот же лист в другой ветке). */
export function checkNewTag(index: KbIndex, cards: Map<string, TagCard>, tag: string): { exists: boolean; similar: string[] } {
  const t = normTag(tag);
  const k = key(t);
  const known = new Map<string, string>([...index.tagNames, ...[...cards.values()].map((c) => [key(c.tag), c.tag] as [string, string])]);
  if (known.has(k)) return { exists: true, similar: [] };
  const leaf = k.split('/').pop()!;
  const similar: string[] = [];
  for (const [kk, name] of known) {
    const l = kk.split('/').pop()!;
    const close = distance(kk, k) <= Math.max(1, Math.floor(k.length / 8)) || (l === leaf && kk !== k) || distance(l, leaf) <= 1;
    if (close) similar.push(canonicalTag(cards, name));
  }
  return { exists: false, similar: [...new Set(similar)].slice(0, 5) };
}

/** Переписать тег `#old` (и `#old/…`) в тексте на `new`. Код и %%скрытое%% не трогаются. */
export function renameTagInText(text: string, oldTag: string, newTag: string): string {
  const masked = maskInert(text);
  const old = normTag(oldTag);
  const neu = normTag(newTag);
  const re = new RegExp(`(^|[\\s(])#(${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|/|[^\\p{L}\\p{N}_/-])`, 'giu');
  let out = '';
  let pos = 0;
  for (const m of masked.matchAll(re)) {
    const from = m.index! + m[1].length + 1;
    // заголовок `# Тема` — не тег
    if (m[1] === '' && /^#{1,6}\s/.test(masked.slice(m.index!))) continue;
    out += text.slice(pos, from) + neu;
    pos = from + m[2].length;
  }
  return out + text.slice(pos);
}

const under = (t: string, old: string) => key(t) === key(old) || key(t).startsWith(key(old) + '/');
const moveTag = (t: string, old: string, neu: string) => normTag(neu) + normTag(t).slice(normTag(old).length);

export interface TagPatch {
  id: string;
  tags?: string[];
  body?: string;
  title?: string;
  props?: Record<string, unknown>;
}

/**
 * Переименовать или слить тег: `old` (и всё под ним) → `new` во всех заметках — в свойстве
 * `tags`, в тексте и в карточках тегов. Если карточка `new` уже есть — это слияние: карточка
 * `old` остаётся с пометкой `слит-в`, иначе она просто переименовывается.
 */
export function planTagRename(notes: Iterable<Note>, oldTag: string, newTag: string): TagPatch[] {
  const old = normTag(oldTag);
  const neu = normTag(newTag);
  if (!old || !neu || key(old) === key(neu)) return [];
  const list = [...notes].filter((n) => !n.deleted && n.type !== 'credential');
  const cards = tagCards(list);
  const merge = cards.has(key(neu));
  const patches: TagPatch[] = [];
  for (const n of list) {
    const p: TagPatch = { id: n.id };
    if (n.tags?.some((t) => under(t, old))) {
      const seen = new Map<string, string>();
      for (const t of n.tags.map((t) => (under(t, old) ? moveTag(t, old, neu) : t))) if (!seen.has(key(t))) seen.set(key(t), t);
      p.tags = [...seen.values()];
    }
    if (n.body && n.body.toLowerCase().includes('#' + key(old))) {
      const body = renameTagInText(n.body, old, neu);
      if (body !== n.body) p.body = body;
    }
    if (n.type === 'tag') {
      if (under(n.title, old)) {
        if (merge && key(n.title) === key(old)) p.props = { ...(n.props ?? {}), 'слит-в': neu };
        else if (!cards.has(key(moveTag(n.title, old, neu)))) p.title = moveTag(n.title, old, neu);
      }
      const props = { ...(p.props ?? n.props ?? {}) };
      let changed = false;
      for (const k of ['смотри-также', 'родители', 'слит-в']) {
        const v = props[k];
        const fix = (s: string) => (under(normTag(s), old) ? moveTag(normTag(s), old, neu) : s);
        if (typeof v === 'string' && under(normTag(v), old)) {
          props[k] = fix(v);
          changed = true;
        } else if (Array.isArray(v) && v.some((s) => under(normTag(String(s)), old))) {
          props[k] = v.map((s) => fix(String(s)));
          changed = true;
        }
      }
      if (changed) p.props = props;
    }
    if (Object.keys(p).length > 1) patches.push(p);
  }
  return patches;
}
