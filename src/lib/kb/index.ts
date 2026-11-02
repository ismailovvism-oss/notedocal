// Указатель связей базы знаний: строится в памяти из текстов всех заметок
// (docs/ЗАМЕТКИ.md, раздел 4). Текст — источник правды, указатель — производное:
// руками его не правят, поэтому он не расходится с текстами.

import type { Note } from '../../types.ts';
import {
  type AnchorPiece,
  type ParsedBody,
  type WikiLink,
  contextAround,
  findLinks,
  formatLink,
  maskInert,
  normTag,
  parseBody,
  plainText,
} from './syntax.ts';

/** Свойства-связи со смыслом (как в волте). Значение без `[[…]]` — тоже ссылка: название
 *  или постоянный id ('к-0311'). `к` — цели комментария. Прочие свойства считаются связью,
 *  только если в значении стоит `[[…]]`. */
export const RELATION_PROPS = [
  'к',
  'доказывает',
  'доказывает-вместе-с',
  'опровергает',
  'ограничивает',
  'требует',
  'объясняет',
  'заменяет',
  'приложить-к',
  'повтор-чего',
];

/** Подписи видов связи для интерфейса. */
export const KIND_LABELS: Record<string, string> = {
  mention: 'упоминает',
  embed: 'встраивает',
  comment: 'комментарий',
};

export interface LinkRef {
  /** id заметки-источника. */
  from: string;
  /** id цели; null — такой заметки нет (ссылка «пустая»). */
  to: string | null;
  /** Название цели, как написано. */
  target: string;
  heading?: string;
  anchor?: string;
  alias?: string;
  /** 'mention' — в тексте, 'embed' — встраивание, 'comment' — из свойства к, иначе имя свойства. */
  kind: string;
  /** Текст вокруг ссылки — для «Обратных ссылок». */
  context: string;
  /** Метки источника, внутри которых стоит ссылка: ссылка «с фрагмента». */
  fromAnchors: string[];
  /** По названию нашлось несколько заметок — взята самая свежая. */
  ambiguous?: boolean;
}

export interface KbIndex {
  byId: Map<string, Note>;
  /** Название и псевдонимы в нижнем регистре → заметки. */
  byName: Map<string, Note[]>;
  parsed: Map<string, ParsedBody>;
  outgoing: Map<string, LinkRef[]>;
  incoming: Map<string, LinkRef[]>;
  /** Тег в нижнем регистре → id заметок, помеченных ровно им. */
  tagged: Map<string, Set<string>>;
  /** Тег в нижнем регистре → как его пишут. */
  tagNames: Map<string, string>;
  /** id заметки → все её теги (свойство tags + из текста). */
  noteTags: Map<string, string[]>;
}

const key = (s: string) => s.trim().toLowerCase();

/** В указатель не идут пароли: их текст — секрет. */
const indexable = (n: Note) => !n.deleted && n.type !== 'credential';

/** Строки значения свойства: строка или список строк; прочее не ссылка. */
function propStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

/** Ссылки из свойств заметки: `доказывает: ["[[Тезис]]"]`, `к: "[[X#^k3f9]]"`, `приложить-к: к-0311`. */
export function propLinks(props: Record<string, unknown> | undefined): (WikiLink & { kind: string })[] {
  const out: (WikiLink & { kind: string })[] = [];
  for (const [name, value] of Object.entries(props ?? {})) {
    const kind = name === 'к' ? 'comment' : name;
    for (const s of propStrings(value)) {
      // без `[[` разбор не нужен: свойств в волте тысячи, а сборка указателя — на каждую правку
      const links = s.includes('[[') ? findLinks(s) : [];
      if (links.length) out.push(...links.map((l) => ({ ...l, kind })));
      else if (RELATION_PROPS.includes(name) && s.trim()) {
        out.push({ raw: s, embed: false, target: s.trim(), start: 0, end: s.length, kind });
      }
    }
  }
  return out;
}

/** Найти заметку по названию, псевдониму или постоянному id. */
export function resolveName(index: Pick<KbIndex, 'byName'>, name: string): { note: Note | null; ambiguous: boolean } {
  const list = index.byName.get(key(name)) ?? [];
  if (list.length === 0) return { note: null, ambiguous: false };
  const best = list.reduce((a, b) => ((b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a));
  return { note: best, ambiguous: list.length > 1 };
}

/** Метки, внутри которых стоит место `pos` (ссылка «с фрагмента»). */
function anchorsAt(anchors: Map<string, AnchorPiece[]>, pos: number): string[] {
  const res: string[] = [];
  for (const [name, pieces] of anchors) {
    if (pieces.some((p) => p.start <= pos && pos < p.end)) res.push(name);
  }
  return res;
}

/** Всё, что выводится из одного текста и не зависит от других заметок. */
export interface BodyParse {
  parsed: ParsedBody;
  /** Для каждой ссылки из `parsed.links`: текст вокруг и метки, внутри которых она стоит. */
  ctx: string[];
  at: string[][];
  /** Начало текста без разметки — подпись ссылок из свойств. */
  head: string;
}

// Разбор запоминается по заметке: на волте (8 800 заметок, 57 МБ) полный разбор — 2,3 с,
// а после правки заново разбирается одна заметка. `body` сверяется целиком (строки из одного
// источника сравниваются мгновенно); у разбора, поднятого с диска, текста нет — там подпись
// «когда изменена : длина».
const parseCache = new Map<string, { body?: string; sig: string; bp: BodyParse }>();
let parseFresh = new Set<string>();
let parseGone = new Set<string>();
const sigOf = (n: Note) => `${n.updatedAt ?? 0}:${(n.body ?? '').length}`;

function parseNote(n: Note): BodyParse {
  const body = n.body ?? '';
  const hit = parseCache.get(n.id);
  if (hit && (hit.body === body || (hit.body === undefined && hit.sig === sigOf(n)))) {
    hit.body = body;
    return hit.bp;
  }
  const parsed = parseBody(body);
  const bp: BodyParse = {
    parsed,
    ctx: parsed.links.map((l) => contextAround(body, l.start, l.end)),
    at: parsed.links.map((l) => anchorsAt(parsed.anchors, l.start)),
    head: plainText(body.slice(0, 2000)).slice(0, 160),
  };
  parseCache.set(n.id, { body, sig: sigOf(n), bp });
  parseFresh.add(n.id);
  parseGone.delete(n.id);
  return bp;
}

/** Разбор, сохранённый на устройстве (src/lib/notesStore.ts): поднять до первой сборки. */
export function seedParseCache(entries: Iterable<[string, { sig: string; bp: BodyParse }]>): void {
  for (const [id, e] of entries) if (!parseCache.has(id)) parseCache.set(id, { sig: e.sig, bp: e.bp });
}

/** Что сохранить на устройстве с прошлого раза: новые разборы и id исчезнувших заметок. */
export function takeParseUpdates(): { put: [string, { sig: string; bp: BodyParse }][]; del: string[] } {
  const put: [string, { sig: string; bp: BodyParse }][] = [];
  for (const id of parseFresh) {
    const e = parseCache.get(id);
    if (e) put.push([id, { sig: e.sig, bp: e.bp }]);
  }
  const del = [...parseGone];
  parseFresh = new Set();
  parseGone = new Set();
  return { put, del };
}

export function buildIndex(notes: Note[]): KbIndex {
  const live = notes.filter(indexable);
  const byId = new Map(live.map((n) => [n.id, n]));
  const byName = new Map<string, Note[]>();
  const addName = (name: string | undefined, n: Note) => {
    if (!name?.trim()) return;
    const list = byName.get(key(name));
    if (!list) byName.set(key(name), [n]);
    else if (!list.includes(n)) list.push(n);
  };
  for (const n of live) {
    addName(n.title, n);
    for (const a of n.aliases ?? []) addName(a, n);
  }

  const index: KbIndex = {
    byId,
    byName,
    parsed: new Map(),
    outgoing: new Map(),
    incoming: new Map(),
    tagged: new Map(),
    tagNames: new Map(),
    noteTags: new Map(),
  };

  for (const n of live) {
    const bp = parseNote(n);
    const parsed = bp.parsed;
    index.parsed.set(n.id, parsed);

    const refs: LinkRef[] = [];
    const toRef = (l: WikiLink, kind: string, context: string, fromAnchors: string[]): LinkRef => {
      const { note, ambiguous } = l.target ? resolveName(index, l.target) : { note: n, ambiguous: false };
      const ref: LinkRef = { from: n.id, to: note?.id ?? null, target: l.target, kind, context, fromAnchors };
      if (l.heading) ref.heading = l.heading;
      if (l.anchor) ref.anchor = l.anchor;
      if (l.alias) ref.alias = l.alias;
      if (ambiguous) ref.ambiguous = true;
      return ref;
    };
    parsed.links.forEach((l, i) => refs.push(toRef(l, l.embed ? 'embed' : 'mention', bp.ctx[i], bp.at[i])));
    for (const l of propLinks(n.props)) {
      const label = l.kind === 'comment' ? 'комментарий' : l.kind;
      refs.push(toRef(l, l.kind, `${label}: ${bp.head}`, []));
    }
    index.outgoing.set(n.id, refs);
    for (const r of refs) {
      if (!r.to) continue;
      const list = index.incoming.get(r.to);
      if (list) list.push(r);
      else index.incoming.set(r.to, [r]);
    }

    const tags = new Map<string, string>();
    for (const t of [...(n.tags ?? []), ...parsed.tags]) {
      const tag = normTag(t);
      if (tag && !tags.has(key(tag))) tags.set(key(tag), tag);
    }
    index.noteTags.set(n.id, [...tags.values()]);
    for (const [k, tag] of tags) {
      if (!index.tagNames.has(k)) index.tagNames.set(k, tag);
      const set = index.tagged.get(k);
      if (set) set.add(n.id);
      else index.tagged.set(k, new Set([n.id]));
    }
  }
  // заметки, которых больше нет, забываем — и на устройстве тоже
  for (const id of parseCache.keys()) {
    if (byId.has(id)) continue;
    parseCache.delete(id);
    parseFresh.delete(id);
    parseGone.add(id);
  }
  return index;
}

/** Обратные ссылки на заметку; с `anchor` — только на этот фрагмент. Свои на себя — тоже. */
export function backlinks(index: KbIndex, noteId: string, anchor?: string): LinkRef[] {
  const all = index.incoming.get(noteId) ?? [];
  return anchor ? all.filter((r) => r.anchor?.toLowerCase() === anchor.toLowerCase()) : all;
}

/** Сколько ссылок ведёт на каждую метку заметки — для счётчиков ↩ у фрагментов. */
export function anchorCounts(index: KbIndex, noteId: string): Map<string, { links: number; comments: number }> {
  const res = new Map<string, { links: number; comments: number }>();
  for (const r of index.incoming.get(noteId) ?? []) {
    if (!r.anchor) continue;
    const name = r.anchor.toLowerCase();
    const c = res.get(name) ?? { links: 0, comments: 0 };
    if (r.kind === 'comment') c.comments++;
    else c.links++;
    res.set(name, c);
  }
  return res;
}

/** Заметки с тегом; `withChildren` — и с тегами ниже по пути (`тема/таухид` → `тема/таухид/сыфаты`). */
export function notesWithTag(index: KbIndex, tag: string, withChildren = true): Set<string> {
  const want = key(normTag(tag));
  const res = new Set<string>();
  for (const [t, ids] of index.tagged) {
    if (t === want || (withChildren && t.startsWith(want + '/'))) for (const id of ids) res.add(id);
  }
  return res;
}

/** Дерево тегов: каждый путь со всеми предками и сколько заметок под ним (с потомками). */
export function tagTree(index: KbIndex): Map<string, { name: string; count: number }> {
  const res = new Map<string, { name: string; count: number }>();
  for (const k of index.tagged.keys()) {
    const parts = index.tagNames.get(k)!.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      if (!res.has(key(path))) res.set(key(path), { name: path, count: 0 });
    }
  }
  for (const [k, node] of res) node.count = notesWithTag(index, k).size;
  return res;
}

/** Что показывать на месте встраивания и ссылки: кусок заметки по метке или заголовку (markdown). */
export function fragmentOf(index: KbIndex, noteId: string, sel: { anchor?: string; heading?: string }): string | null {
  const note = index.byId.get(noteId);
  if (!note) return null;
  const body = note.body ?? '';
  if (sel.anchor) {
    const pieces = [...(index.parsed.get(noteId)?.anchors ?? new Map<string, AnchorPiece[]>())].find(
      ([name]) => name.toLowerCase() === sel.anchor!.toLowerCase(),
    )?.[1];
    if (!pieces) return null;
    return pieces.map((p) => body.slice(p.start, p.end).trim()).join('\n\n…\n\n');
  }
  if (sel.heading) {
    const heads = index.parsed.get(noteId)?.headings ?? [];
    const i = heads.findIndex((h) => key(h.text) === key(sel.heading!));
    if (i < 0) return null;
    const next = heads.slice(i + 1).find((h) => h.level <= heads[i].level);
    return body.slice(heads[i].start, next ? next.start : undefined).trim();
  }
  return body;
}

// ---------- Переименование ----------

/** Переписать в тексте ссылки на `oldNames` (нижний регистр) так, чтобы вели к `newTitle`.
 *  Заголовок, метка и подпись сохраняются. Ссылки в коде не трогаются. */
export function renameLinksInText(text: string, oldNames: Set<string>, newTitle: string): string {
  const links = findLinks(text, maskInert(text)).filter((l) => l.target && oldNames.has(key(l.target)));
  if (!links.length) return text;
  let out = '';
  let pos = 0;
  for (const l of links) {
    out += text.slice(pos, l.start) + formatLink({ ...l, target: newTitle });
    pos = l.end;
  }
  return out + text.slice(pos);
}

function renameInProps(
  props: Record<string, unknown> | undefined,
  oldNames: Set<string>,
  newTitle: string,
): Record<string, unknown> | undefined {
  if (!props) return undefined;
  let changed = false;
  const one = (name: string, s: string) => {
    const next = findLinks(s).length
      ? renameLinksInText(s, oldNames, newTitle)
      : RELATION_PROPS.includes(name) && oldNames.has(key(s))
        ? newTitle
        : s;
    if (next !== s) changed = true;
    return next;
  };
  const res: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(props)) {
    res[name] = typeof v === 'string' ? one(name, v) : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? one(name, x) : x)) : v;
  }
  return changed ? res : undefined;
}

/** Правки других заметок после переименования `noteId` из `oldTitle` в `newTitle`.
 *  Указатель — состояние ДО переименования. Если старое название вело не только к этой
 *  заметке, ничего не трогаем: чьи это ссылки — не угадать. */
export function planRename(
  index: KbIndex,
  noteId: string,
  oldTitle: string,
  newTitle: string,
): { id: string; body?: string; props?: Record<string, unknown> }[] {
  if (!oldTitle.trim() || key(oldTitle) === key(newTitle)) return [];
  const owners = index.byName.get(key(oldTitle)) ?? [];
  if (owners.length !== 1 || owners[0].id !== noteId) return [];
  const old = new Set([key(oldTitle)]);
  const sources = new Set((index.incoming.get(noteId) ?? []).filter((r) => key(r.target) === key(oldTitle)).map((r) => r.from));
  const patches: { id: string; body?: string; props?: Record<string, unknown> }[] = [];
  for (const id of sources) {
    const n = index.byId.get(id);
    if (!n) continue;
    const body = renameLinksInText(n.body ?? '', old, newTitle);
    const props = renameInProps(n.props, old, newTitle);
    const patch: { id: string; body?: string; props?: Record<string, unknown> } = { id };
    if (body !== (n.body ?? '')) patch.body = body;
    if (props) patch.props = props;
    if (patch.body !== undefined || patch.props) patches.push(patch);
  }
  return patches;
}
