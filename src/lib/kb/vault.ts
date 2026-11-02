// Хранилище-папка на компьютере ↔ заметки (окно «База», docs/ЗАМЕТКИ.md, раздел 10).
//
// Файл .md — заметка: название — имя файла, свойства — заголовок (frontmatter), как в Obsidian.
// Любой другой файл (PDF, картинка…) — отдельный пункт со своим видом: открывается просмотром.
// Папки — узлы дерева (связи child строятся по путям, а не хранятся). id заметки — путь
// с приставкой: `v:` — .md, `f:` — файл, `d:` — папка; переименовали — id меняется.
//
// Заголовок файла переписывается, только если свойства действительно поменялись: иначе
// каждая правка текста перекраивала бы чужой (Obsidian) frontmatter.
//
// Без React: функции проверяются тестами (scripts/kbvault.test.mjs).

import { stringify } from 'yaml';
import type { Note, Relation } from '../../types.ts';
import { fileNameOf, splitFrontmatter } from './markdownFile.ts';

export interface VaultEntry {
  path: string;
  kind: 'md' | 'file' | 'dir';
  mtime?: number;
  size?: number;
}

export const vid = {
  md: (p: string) => 'v:' + p,
  file: (p: string) => 'f:' + p,
  dir: (p: string) => 'd:' + p,
};
/** Заметка из хранилища (а не из облака). */
export const inVault = (id: string) => /^[vfd]:/.test(id);
export const pathOfId = (id: string) => id.slice(2);
export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const idOf = (e: VaultEntry) => (e.kind === 'md' ? vid.md : e.kind === 'dir' ? vid.dir : vid.file)(e.path);

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  txt: 'text/plain',
  json: 'application/json',
  epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
export const mimeOf = (name: string) => MIME[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

/** Поля приложения, которые идут в ключ `notedocal:` заголовка (как у markdownFile.ts). */
const SERVICE = ['type', 'versions', 'currentVersion', 'lang', 'inBase', 'dictations', 'voiceResults', 'toPhone', 'cloud'] as const;

/** Сравнение без учёта порядка ключей. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const list = (v: unknown): string[] =>
  typeof v === 'string' ? v.split(/[,\s]+/).filter(Boolean) : Array.isArray(v) ? v.map(String).filter(Boolean) : [];

/** Файл .md → заметка. */
export function noteFromVault(e: VaultEntry, text: string): Note {
  const m = text.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  const { data, body } = splitFrontmatter(text);
  const front = m && body !== text ? m[0] : '';
  const { tags, aliases, notedocal, ...props } = data;
  const svc = notedocal && typeof notedocal === 'object' ? (notedocal as Partial<Note>) : {};
  const t = list(tags).map((s) => s.replace(/^#/, ''));
  const a = list(aliases);
  const at = e.mtime ?? 0;
  const note: Note = {
    ...svc,
    id: vid.md(e.path),
    title: baseName(e.path).replace(/\.md$/i, ''),
    body,
    ...(t.length ? { tags: t } : {}),
    ...(a.length ? { aliases: a } : {}),
    ...(Object.keys(props).length ? { props } : {}),
    date: null,
    createdAt: at,
    updatedAt: at,
    vault: { path: e.path, front },
  };
  // ключ — из тех же полей, из каких запись соберёт заголовок: «tags: а» и «tags: [а]» — одно
  note.vault!.key = canon(frontData(note));
  return note;
}

/** Не-md файл → пункт дерева: название с расширением (поиск «.pdf» его найдёт). */
export function fileFromVault(e: VaultEntry): Note {
  return {
    id: vid.file(e.path),
    title: baseName(e.path),
    body: '',
    date: null,
    createdAt: e.mtime ?? 0,
    updatedAt: e.mtime ?? 0,
    attachments: [],
    vault: { path: e.path, mime: mimeOf(e.path) },
  };
}

/** Заметки и папки хранилища, связи «папка → содержимое» — по путям. */
export function vaultNotes(entries: VaultEntry[], texts: Map<string, string>): { notes: Note[]; relations: Relation[] } {
  const notes: Note[] = [];
  const relations: Relation[] = [];
  for (const e of entries) {
    if (e.kind === 'dir') {
      notes.push({ id: vid.dir(e.path), title: baseName(e.path), body: '', type: 'folder', date: null, createdAt: 0, updatedAt: 0, vault: { path: e.path } });
    } else if (e.kind === 'md') {
      notes.push(noteFromVault(e, texts.get(e.path) ?? ''));
    } else {
      notes.push(fileFromVault(e));
    }
    const d = dirName(e.path);
    if (d) relations.push({ id: `vr:${e.path}`, from: vid.dir(d), to: idOf(e), type: 'child', position: 0, createdAt: 0, updatedAt: 0 });
  }
  return { notes, relations };
}

/** Что заметка кладёт в заголовок файла. */
function frontData(note: Note): Record<string, unknown> {
  const data: Record<string, unknown> = { ...(note.props ?? {}) };
  if (note.aliases?.length) data.aliases = note.aliases;
  if (note.tags?.length) data.tags = note.tags;
  const svc: Record<string, unknown> = {};
  for (const k of SERVICE) {
    const v = note[k];
    if (v === undefined || v === null || v === '' || (k === 'type' && v === 'note')) continue;
    if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length) continue;
    if (Array.isArray(v) && !v.length) continue;
    svc[k] = v;
  }
  if (Object.keys(svc).length) data.notedocal = svc;
  return data;
}

/** Заметка → текст файла. Заголовок — прежний, если свойства не менялись. */
export function vaultMarkdown(note: Note): string {
  const data = frontData(note);
  const same = note.vault?.key !== undefined && canon(data) === note.vault.key;
  const front = same ? (note.vault?.front ?? '') : Object.keys(data).length ? `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n` : '';
  return front + (note.body ?? '');
}

/** Свежий ключ заголовка после записи (чтобы следующая правка текста его не трогала). */
export function vaultKey(note: Note): { front: string; key: string } {
  const text = vaultMarkdown(note);
  const m = text.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return { front: m ? m[0] : '', key: canon(frontData(note)) };
}

/** Путь новой заметки в папке: имя из названия, занятое — с номером. */
export function newNotePath(dir: string, title: string, taken: (path: string) => boolean): string {
  const name = fileNameOf(title).replace(/\.md$/, '');
  const at = (n: string) => (dir ? `${dir}/${n}.md` : `${n}.md`);
  let p = at(name);
  for (let i = 2; taken(p); i++) p = at(`${name} ${i}`);
  return p;
}
