// Заметка ↔ файл .md волта Obsidian (frontmatter + текст), без потерь в обе стороны
// (docs/ЗАМЕТКИ.md, принцип 0). Название заметки — имя файла.
//
// Во frontmatter: свойства (props) как есть, затем aliases и tags — их понимает Obsidian.
// Служебные поля приложения (роль, дата, вложения, версии быстрых заметок…) — в одном
// ключе `notedocal:`: Obsidian его просто показывает, а загрузка возвращает поля на место.

import { parse, stringify } from 'yaml';
import type { Note } from '../../types.ts';

/** Поля, которые живут в своих местах файла, а не в `notedocal:`. */
const OWN = new Set(['title', 'body', 'tags', 'aliases', 'props']);

const empty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || v === false;

/** Разделить текст файла на frontmatter и тело. Нет frontmatter — пустой объект.
 *  Frontmatter с ошибкой (`иснад: цепь: …` — два двоеточия без кавычек; Obsidian такой тоже
 *  не читает) остаётся частью текста: файл вернётся при выгрузке байт в байт. */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: {}, body: text };
  let data: unknown;
  try {
    data = parse(m[1]);
  } catch {
    return { data: {}, body: text };
  }
  return {
    data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
    body: text.slice(m[0].length),
  };
}

/** Строка или список строк → список строк (Obsidian допускает и `tags: a`, и `tags: [a, b]`). */
function list(v: unknown): string[] {
  if (typeof v === 'string') return v.split(/[,\s]+/).map((s) => s.replace(/^#/, '')).filter(Boolean);
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return [];
}

/** Файл .md → поля заметки. `title` — имя файла без .md. */
export function noteFromMarkdown(text: string, title: string): Partial<Note> {
  const { data, body } = splitFrontmatter(text);
  const { tags, aliases, notedocal, ...props } = data;
  const res: Partial<Note> = { ...(notedocal && typeof notedocal === 'object' ? (notedocal as Partial<Note>) : {}) };
  res.title = title;
  res.body = body;
  const t = list(tags).map((s) => s.replace(/^#/, ''));
  const a = typeof aliases === 'string' ? [aliases] : list(aliases);
  if (t.length) res.tags = t;
  if (a.length) res.aliases = a;
  if (Object.keys(props).length) res.props = props;
  return res;
}

/** Заметка → текст файла .md. Пароли не выгружаются: их секрет зашифрован под приложение. */
export function noteToMarkdown(note: Note): string {
  const front: Record<string, unknown> = { ...(note.props ?? {}) };
  if (note.aliases?.length) front.aliases = note.aliases;
  if (note.tags?.length) front.tags = note.tags;
  const service: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(note)) {
    if (OWN.has(k) || empty(v)) continue;
    if (k === 'type' && v === 'note') continue;
    if (k === 'secret' || k === 'login') continue;
    service[k] = v;
  }
  if (Object.keys(service).length) front.notedocal = service;
  const head = Object.keys(front).length ? `---\n${stringify(front, { lineWidth: 0 }).trimEnd()}\n---\n` : '';
  return head + (note.body ?? '');
}

/** Имя файла из названия: без знаков, которые не пускает файловая система и Obsidian. */
export function fileNameOf(title: string): string {
  return (title || 'Без названия').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() + '.md';
}
