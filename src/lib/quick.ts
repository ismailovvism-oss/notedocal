// Быстрые заметки — то же, что окно `zametki` на компьютере (~/projects/apps/zametki), но в вебе:
// с телефона и из Windows (docs/ЗАМЕТКИ.md, раздел 8 «notedocal не отстаёт от окна»).
// Заметки лежат в папках «Быстрые заметки» и «Голосом» (связи child), поля — как у окна:
// versions/currentVersion/lang, заказы окну — request/requestError.

import type { Note } from '../types';

export const QUICK_FOLDER = 'Быстрые заметки';
export const VOICE_FOLDER = 'Голосом';

/** Языки распознавания — как в окне (golos.py, ЯЗЫКИ). */
export const LANGS: [string, string][] = [
  ['ru', 'Русский'],
  ['ar', 'Арабский'],
  ['ar-dia', 'Диалект'],
  ['en', 'Английский'],
];
export const LANG_NAME: Record<string, string> = { ru: 'русский', ar: 'арабский', 'ar-dia': 'диалект', en: 'английский' };
/** Переводы — как в окне (ПЕРЕВОДЫ). */
export const TRANSLATIONS: [string, string][] = [
  ['ru', 'На русский'],
  ['ar', 'На арабский'],
  ['en', 'На английский'],
];

/** Markdown без разметки — для названия и строки списка (как `голый` в окне). */
export function bare(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/<[^>\n]+>/g, '')
    .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|```\w*)/gm, '')
    .replace(/\*\*|__|`|~~|==/g, '')
    .replace(/[ \t]\^[A-Za-z0-9-]+[ \t]*$/gm, '');
}

/** Название заметки — первая непустая строка, не длиннее 80 знаков (как `поля()` в окне). */
export function quickTitle(text: string): string {
  const first = bare(text)
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean) ?? '';
  if (first.length <= 80) return first;
  const cut = first.slice(0, 80);
  return (cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : cut) + '…';
}

/** Язык написанного — для «Очистить» (как `язык_текста` в окне). */
export function textLang(text: string): string {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  const ar = letters.filter((c) => c >= '؀' && c <= 'ۿ').length;
  if (ar * 2 > letters.length) return 'ar';
  const lat = letters.filter((c) => /[a-z]/i.test(c)).length;
  const cyr = letters.filter((c) => /[а-яё]/i.test(c)).length;
  return lat > cyr ? 'en' : 'ru';
}

export function versionName(v: string): string {
  if (v.startsWith('перевод-')) return 'Перевод: ' + (LANG_NAME[v.slice(8)] ?? v.slice(8));
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/** Версии заметки; у заметки не из окна — одна, «оригинал». */
export function versionsOf(n: Note): { versions: Record<string, string>; current: string } {
  const versions = { ...(n.versions && Object.keys(n.versions).length ? n.versions : { оригинал: n.body ?? '' }) };
  let current = n.currentVersion && n.currentVersion in versions ? n.currentVersion : Object.keys(versions)[0];
  // правили body мимо версий (секретарь, старый клиент) — текущая версия и есть body
  if ((n.body ?? '') !== versions[current]) versions[current] = n.body ?? '';
  if (!current) current = 'оригинал';
  return { versions, current };
}

/** Поля для новой версии текста: окно увидит её в `versions`, телефон — в `body`. */
export function withText(n: Note, text: string, version?: string): Partial<Note> {
  const { versions, current } = versionsOf(n);
  const v = version ?? current;
  return { versions: { ...versions, [v]: text }, currentVersion: v, body: text, title: quickTitle(text) || n.title };
}

/** Склеить заметки в первую по времени (как `склеить` в окне). Возвращает поля первой. */
export function mergeQuick(list: Note[]): { keep: Note; patch: Partial<Note>; drop: Note[] } {
  const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
  const [keep, ...drop] = sorted;
  const orig = sorted
    .map((n) => versionsOf(n).versions['оригинал'])
    .filter(Boolean)
    .join('\n\n');
  const joined = sorted.map((n) => n.body ?? '').join('\n\n');
  const versions: Record<string, string> = { оригинал: orig };
  if (joined !== orig) versions['склеено'] = joined;
  const current = Object.keys(versions).pop()!;
  return { keep, drop, patch: { versions, currentVersion: current, body: versions[current], title: quickTitle(versions[current]) } };
}

/** Когда записана: «сегодня 14:05», «вчера 09:12», «28.10 18:30». */
export function when(ms: number): string {
  const d = new Date(ms);
  const day0 = new Date();
  day0.setHours(0, 0, 0, 0);
  const days = Math.round((day0.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const day = days === 0 ? 'сегодня' : days === 1 ? 'вчера' : days < 300 ? `${dd}.${mm}` : `${dd}.${mm}.${d.getFullYear()}`;
  return `${day} ${hm}`;
}

export const REQUEST_LABEL: Record<string, string> = {
  clean: 'чистит',
  connect: 'собирает связно',
  translate: 'переводит',
  transcribe: 'распознаёт запись',
};
