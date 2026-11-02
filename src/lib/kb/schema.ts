// Свойства, схемы и виды — «база данных» (docs/ЗАМЕТКИ.md, 3.4, этап 4).
//
// Схема — заметка роли «схема»: для каких тегов она (`для`) и какие у заметок поля (`поля`).
// Поле: имя, вид (текст, число, дата, выбор, ссылка, ссылки, список, да-нет), обязательно ли,
// варианты для выбора. Всё лежит в свойствах, как frontmatter, — Obsidian видит то же самое.
//
// Вид — заметка роли «вид»: сохранённая выборка (теги, условия на свойства, текст) и как её
// показать: таблицей, карточками или доской. Без React: эти функции зовёт и секретарь.

import type { Note } from '../../types.ts';
import type { KbIndex } from './index.ts';
import { notesWithTag, resolveName } from './index.ts';
import { normTag, plainText } from './syntax.ts';

export const FIELD_KINDS = ['текст', 'число', 'дата', 'выбор', 'ссылка', 'ссылки', 'список', 'да-нет'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface Field {
  name: string;
  kind: FieldKind;
  required?: boolean;
  options?: string[];
}

export interface Schema {
  note: Note;
  /** Теги, к заметкам с которыми (и ниже по пути) схема относится. */
  for: string[];
  fields: Field[];
}

const yes = (v: unknown) => v === true || v === 'да' || v === 'true' || v === 'yes';
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

/** Поля схемы из её свойств. Неизвестный вид считается текстом. */
export function parseFields(v: unknown): Field[] {
  if (!Array.isArray(v)) return [];
  const res: Field[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = String(r['имя'] ?? r.name ?? '').trim();
    if (!name) continue;
    const kind = String(r['вид'] ?? r.kind ?? 'текст') as FieldKind;
    const f: Field = { name, kind: FIELD_KINDS.includes(kind) ? kind : 'текст' };
    if (yes(r['обязательно'] ?? r.required)) f.required = true;
    const opts = list(r['варианты'] ?? r.options);
    if (opts.length) f.options = opts;
    res.push(f);
  }
  return res;
}

/** Поля → вид для свойства `поля` (как в frontmatter). */
export function fieldsToProps(fields: Field[]): Record<string, unknown>[] {
  return fields.map((f) => ({
    имя: f.name,
    вид: f.kind,
    ...(f.required ? { обязательно: true } : {}),
    ...(f.options?.length ? { варианты: f.options } : {}),
  }));
}

export function schemas(notes: Iterable<Note>): Schema[] {
  const res: Schema[] = [];
  for (const n of notes) {
    if (n.deleted || n.type !== 'schema') continue;
    res.push({ note: n, for: list(n.props?.['для']).map(normTag), fields: parseFields(n.props?.['поля']) });
  }
  return res;
}

/** Схемы заметки — по её тегам (тег схемы или ниже по пути). */
export function schemasOf(all: Schema[], tags: string[]): Schema[] {
  const keys = tags.map((t) => normTag(t).toLowerCase());
  return all.filter((s) => s.for.some((f) => keys.some((t) => t === f.toLowerCase() || t.startsWith(f.toLowerCase() + '/'))));
}

/** Поля для заметки: из всех её схем, одно имя — один раз (первая схема главнее). */
export function fieldsOf(all: Schema[], tags: string[]): Field[] {
  const seen = new Set<string>();
  const res: Field[] = [];
  for (const s of schemasOf(all, tags)) {
    for (const f of s.fields) {
      if (seen.has(f.name.toLowerCase())) continue;
      seen.add(f.name.toLowerCase());
      res.push(f);
    }
  }
  return res;
}

/** Ключи свойств, которые карточка показывает по-своему (карточка тега, схема, вид). */
export const OWN_KEYS: Record<string, string[]> = {
  tag: ['смотри-также', 'родители', 'слит-в'],
  schema: ['для', 'поля'],
  view: ['вид', 'теги', 'условия', 'текст', 'столбцы', 'группа', 'сортировка'],
};

export const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Чего не хватает и что заполнено не так. */
export function checkProps(props: Record<string, unknown> | undefined, fields: Field[]): { missing: string[]; wrong: string[] } {
  const missing: string[] = [];
  const wrong: string[] = [];
  for (const f of fields) {
    const v = props?.[f.name];
    if (isEmpty(v)) {
      if (f.required) missing.push(f.name);
      continue;
    }
    if (f.kind === 'число' && Number.isNaN(Number(v))) wrong.push(f.name);
    if (f.kind === 'дата' && !/^\d{4}-\d{2}-\d{2}/.test(String(v))) wrong.push(f.name);
    if (f.kind === 'выбор' && f.options?.length && !f.options.includes(String(v))) wrong.push(f.name);
  }
  return { missing, wrong };
}

/** Значение из поля ввода — в значение свойства нужного вида. Пусто — undefined (свойство убрать). */
export function fromInput(f: Field, raw: string | boolean): unknown {
  if (f.kind === 'да-нет') return raw === true || raw === 'да' ? true : raw === false ? false : undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (f.kind === 'число') return Number.isNaN(Number(s.replace(',', '.'))) ? s : Number(s.replace(',', '.'));
  if (f.kind === 'ссылки' || f.kind === 'список') {
    const parts = (f.kind === 'ссылки' ? s.split(/\n|,(?![^[]*\]\])/) : s.split('\n')).map((x) => x.trim()).filter(Boolean);
    return parts.map((p) => (f.kind === 'ссылки' && !p.startsWith('[[') ? `[[${p}]]` : p));
  }
  if (f.kind === 'ссылка') return s.startsWith('[[') ? s : `[[${s}]]`;
  return s;
}

/** Значение свойства — в текст для поля ввода. */
export function toInput(f: Field, v: unknown): string {
  if (isEmpty(v)) return '';
  if (f.kind === 'ссылки' || f.kind === 'список') return (Array.isArray(v) ? v : [v]).map(String).join('\n');
  return String(v);
}

/** Значение для показа: ссылки без скобок, списки через запятую, да/нет. */
export function display(v: unknown): string {
  if (isEmpty(v)) return '';
  if (Array.isArray(v)) return v.map(display).join(', ');
  if (v === true) return 'да';
  if (v === false) return 'нет';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).replace(/^\[\[([^\]|]*\|)?([^\]]*)\]\]$/, (_, a, b) => (a ? b : b));
}

// ---------- виды ----------

export type ViewKind = 'таблица' | 'карточки' | 'доска';

export interface Condition {
  field: string;
  op: '=' | '!=' | 'есть' | 'нет' | '>' | '<' | '~';
  value?: string;
}

export interface ViewSpec {
  tags: string[];
  conditions: Condition[];
  text: string;
  kind: ViewKind;
  columns: string[];
  group: string;
  sort: string;
}

/** Условие строкой: «чьё = автор», «надёжность != C», «места есть», «id нет», «год > 1400», «кто ~ Таймия». */
export function parseCondition(s: string): Condition | null {
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(.+?)\s+(есть|нет)$/);
  if (m) return { field: m[1].trim(), op: m[2] as Condition['op'] };
  m = t.match(/^(.+?)\s*(!=|=|>|<|~)\s*(.*)$/);
  if (m) return { field: m[1].trim(), op: m[2] as Condition['op'], value: m[3].trim() };
  return null;
}

export const conditionText = (c: Condition) => (c.op === 'есть' || c.op === 'нет' ? `${c.field} ${c.op}` : `${c.field} ${c.op} ${c.value ?? ''}`);

export function parseView(n: Note): ViewSpec {
  const p = n.props ?? {};
  const kind = String(p['вид'] ?? 'таблица') as ViewKind;
  return {
    tags: list(p['теги']).map(normTag),
    conditions: list(p['условия'])
      .map(parseCondition)
      .filter((c): c is Condition => !!c),
    text: String(p['текст'] ?? ''),
    kind: (['таблица', 'карточки', 'доска'] as ViewKind[]).includes(kind) ? kind : 'таблица',
    columns: list(p['столбцы']),
    group: String(p['группа'] ?? ''),
    sort: String(p['сортировка'] ?? ''),
  };
}

export function viewToProps(v: ViewSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { вид: v.kind };
  if (v.tags.length) out['теги'] = v.tags;
  if (v.conditions.length) out['условия'] = v.conditions.map(conditionText);
  if (v.text) out['текст'] = v.text;
  if (v.columns.length) out['столбцы'] = v.columns;
  if (v.group) out['группа'] = v.group;
  if (v.sort) out['сортировка'] = v.sort;
  return out;
}

/** Значение «поля» заметки: свойство или служебное — название, теги, изменена, создана. */
export function valueOf(index: KbIndex, n: Note, field: string): unknown {
  const f = field.trim().toLowerCase();
  if (f === 'название') return n.title;
  if (f === 'теги') return index.noteTags.get(n.id) ?? [];
  if (f === 'изменена') return new Date(n.updatedAt).toISOString().slice(0, 10);
  if (f === 'создана') return new Date(n.createdAt).toISOString().slice(0, 10);
  if (f === 'роль') return n.type ?? 'note';
  const props = n.props ?? {};
  const k = Object.keys(props).find((x) => x.toLowerCase() === f);
  return k ? props[k] : undefined;
}

const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

function test(index: KbIndex, n: Note, c: Condition): boolean {
  const v = valueOf(index, n, c.field);
  if (c.op === 'есть') return !isEmpty(v);
  if (c.op === 'нет') return isEmpty(v);
  const vals = (Array.isArray(v) ? v : [v]).filter((x) => !isEmpty(x)).map(display);
  const want = c.value ?? '';
  // ссылка: сравниваем и по названию цели, и по тому, куда она ведёт (псевдоним, id)
  const target = (s: string) => resolveName(index, s.split('#')[0]).note?.id;
  const same = (s: string) =>
    fold(s) === fold(want) || (!!target(want) && target(s) === target(want));
  if (c.op === '=') return vals.some(same);
  if (c.op === '!=') return !vals.some(same);
  if (c.op === '~') return vals.some((s) => fold(s).includes(fold(want)));
  const num = (s: string) => (Number.isNaN(Number(s)) ? s : Number(s));
  if (c.op === '>') return vals.some((s) => num(s) > num(want));
  if (c.op === '<') return vals.some((s) => num(s) < num(want));
  return false;
}

/** Заметки вида: все теги (каждый — с тегами ниже), все условия, текст; затем сортировка. */
export function runView(index: KbIndex, spec: ViewSpec, selfId?: string): Note[] {
  let ids = null as Set<string> | null;
  for (const t of spec.tags) {
    const got = notesWithTag(index, t);
    ids = ids ? new Set([...ids].filter((x) => got.has(x))) : got;
  }
  let notes = ids ? [...ids].map((id) => index.byId.get(id)!).filter(Boolean) : [...index.byId.values()];
  notes = notes.filter((n) => n.id !== selfId && n.type !== 'view' && n.type !== 'schema' && n.type !== 'folder');
  for (const c of spec.conditions) notes = notes.filter((n) => test(index, n, c));
  if (spec.text.trim()) {
    const q = fold(spec.text.trim());
    notes = notes.filter((n) => fold(n.title).includes(q) || fold(plainText(n.body ?? '')).includes(q));
  }
  const sort = spec.sort.trim();
  if (sort) {
    const desc = sort.startsWith('-');
    const field = sort.replace(/^-/, '');
    const key = (n: Note) => display(valueOf(index, n, field));
    notes.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const nx = Number(x);
      const ny = Number(y);
      const r = x && y && !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : x.localeCompare(y, 'ru');
      return desc ? -r : r;
    });
  } else notes.sort((a, b) => b.updatedAt - a.updatedAt);
  return notes;
}

/** Доска: столбцы по значению поля (список — заметка в каждом своём столбце). */
export function groupBy(index: KbIndex, notes: Note[], field: string, options?: string[]): { value: string; notes: Note[] }[] {
  const groups = new Map<string, Note[]>();
  for (const o of options ?? []) groups.set(o, []);
  for (const n of notes) {
    const v = valueOf(index, n, field);
    const vals = isEmpty(v) ? [''] : (Array.isArray(v) ? v : [v]).map(display);
    for (const x of vals) {
      const list = groups.get(x) ?? [];
      list.push(n);
      groups.set(x, list);
    }
  }
  return [...groups].map(([value, notes]) => ({ value, notes })).sort((a, b) => (a.value === '' ? 1 : b.value === '' ? -1 : 0));
}

/** Заметки под схемой и неполные среди них. */
export function schemaCoverage(index: KbIndex, s: Schema): { notes: Note[]; incomplete: { note: Note; missing: string[] }[] } {
  const ids = new Set<string>();
  for (const t of s.for) for (const id of notesWithTag(index, t)) ids.add(id);
  const notes = [...ids].map((id) => index.byId.get(id)!).filter((n) => n && n.type !== 'tag');
  const incomplete = notes
    .map((note) => ({ note, missing: checkProps(note.props, s.fields).missing }))
    .filter((x) => x.missing.length);
  return { notes, incomplete };
}
