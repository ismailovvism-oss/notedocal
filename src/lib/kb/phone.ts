// «📱 На телефон»: какие заметки хранилища-папки отражаются в облаке notedocal и что с ними
// делать при сверке (docs/ЗАМЕТКИ.md, раздел 10). Здесь только решение — без записи: окно «База»
// (src/desktop/usePhoneSync.ts) исполняет его.
//
// Отметка: у заметки — `toPhone` в её заголовке (notedocal:), у папки — в `.zametki/телефон.json`
// хранилища; действует ближайшая. `text` — на телефон только текст (файлы видны названием),
// `files` — и файлы. Облачная копия — заметка с постоянным id (`cloud` в заголовке файла),
// поле `vaultSync` хранит, с какими версиями файла и облака сверялись в последний раз.

import type { Note } from '../../types.ts';
import { dirName } from './vault.ts';

export type PhoneMode = 'text' | 'files';

/** Чем сверялись: время файла и время облачной копии на момент последней сверки. */
export interface VaultSync {
  /** Хранилище, откуда копия (полный путь папки) — копии разных хранилищ не путаются,
   *  даже если папки называются одинаково. */
  vault: string;
  path: string;
  /** mtime файла, когда сверялись; -1 — только что записали правку с телефона в файл, его новое
   *  время ещё не известно: на следующей сверке взять его за точку отсчёта. */
  at: number;
  /** updatedAt копии, когда сверялись: позже — её правили на телефоне. */
  cloudAt: number;
  mode: PhoneMode;
}

/** Режим заметки: её отметка или ближайшей папки; `off` у заметки — «не надо», хоть папка и отмечена. */
export function phoneMode(note: Note, folders: Record<string, PhoneMode | 'off'>): PhoneMode | null {
  const own = note.toPhone;
  if (own === 'off') return null;
  if (own) return own;
  for (let d = dirName(note.vault?.path ?? ''); ; d = dirName(d)) {
    const m = folders[d];
    if (m === 'off') return null;
    if (m) return m;
    if (!d) return null;
  }
}

export interface PhonePlan {
  /** Заметкам без постоянного id — выдать (записать в заголовок файла), сверка — на следующем круге. */
  assign: { id: string; cloud: string }[];
  /** Файл новее — в облако (создать или обновить копию). */
  push: { note: Note; cloud: string; mode: PhoneMode }[];
  /** Копию правили на телефоне — в файл. */
  pull: { note: Note; copy: Note }[];
  /** Правку с телефона уже записали в файл — запомнить его новое время. */
  baseline: { copy: Note; at: number }[];
  /** Копии, которым больше нечего отражать (сняли отметку, удалили файл) — убрать из облака. */
  drop: Note[];
  /** Не уходят на телефон: облако такую заметку не примет (больше ~900 КБ, вложенные списки). */
  skip: { note: Note; reason: string }[];
}

/** Firestore не берёт документ больше 1 МиБ и список прямо внутри списка. */
const LIMIT = 900_000;
const nestedArray = (v: unknown): boolean =>
  Array.isArray(v) ? v.some((x) => Array.isArray(x) || nestedArray(x)) : !!v && typeof v === 'object' && Object.values(v).some(nestedArray);

/** Почему заметку нельзя отправить на телефон; '' — можно. */
export function phoneProblem(note: Note): string {
  const size = new TextEncoder().encode(JSON.stringify({ b: note.body, p: note.props, t: note.tags })).length;
  if (size > LIMIT) return `слишком большая для телефона (${Math.round(size / 1024)} КБ)`;
  if (nestedArray(note.props)) return 'в свойствах список внутри списка — облако такое не принимает';
  return '';
}

/** Что сделать, чтобы облако и хранилище сошлись. `makeId` — новый постоянный id. */
export function planPhoneSync(
  vaultName: string,
  vaultNotes: Note[],
  cloud: Note[],
  folders: Record<string, PhoneMode | 'off'>,
  makeId: () => string,
): PhonePlan {
  const plan: PhonePlan = { assign: [], push: [], pull: [], baseline: [], drop: [], skip: [] };
  const byId = new Map<string, Note>();
  const copies = new Map<string, Note>();
  for (const c of cloud) {
    byId.set(c.id, c);
    const s = c.vaultSync as VaultSync | undefined;
    if (s && s.vault === vaultName && !c.deleted) copies.set(c.id, c);
  }
  // кто из файлов хозяин копии: один id у двух файлов (копия файла в Obsidian, шаблон) —
  // хозяин тот, с чьего пути копия сделана, остальным — новый id; иначе копия металась бы
  // между ними каждую секунду
  const marked: { n: Note; mode: PhoneMode }[] = [];
  const owner = new Map<string, Note>();
  for (const n of vaultNotes) {
    if (!n.id.startsWith('v:') || !n.vault) continue;
    const mode = phoneMode(n, folders);
    if (!mode) continue;
    marked.push({ n, mode });
    const id = n.cloud as string | undefined;
    if (!id) continue;
    const s = copies.get(id)?.vaultSync as VaultSync | undefined;
    const cur = owner.get(id);
    if (!cur || (s && s.path === n.vault.path && cur.vault!.path !== s.path)) owner.set(id, n);
  }
  const wanted = new Set<string>();
  for (const { n, mode } of marked) {
    const id = n.cloud as string | undefined;
    // без id, чужой id (файл перенесли из другого хранилища, облачная заметка не копия) — новый
    const other = id ? byId.get(id) : undefined;
    const foreign = !!other && !other.deleted && !copies.has(id!) && (!!other.vaultSync || other.type === 'folder');
    if (!id || owner.get(id) !== n || foreign) {
      plan.assign.push({ id: n.id, cloud: makeId() });
      continue;
    }
    wanted.add(id);
    const problem = phoneProblem(n);
    if (problem) {
      plan.skip.push({ note: n, reason: problem });
      continue;
    }
    const c = copies.get(id);
    const s = c?.vaultSync as VaultSync | undefined;
    if (!c || !s) {
      plan.push.push({ note: n, cloud: id, mode });
      continue;
    }
    const cloudNew = c.updatedAt > s.cloudAt;
    if (s.at === -1) {
      // правку с телефона только что записали в файл; пока ждали — пришла ещё одна: её тоже в файл
      if (cloudNew) plan.pull.push({ note: n, copy: c });
      else plan.baseline.push({ copy: c, at: n.updatedAt });
      continue;
    }
    const fileNew = n.updatedAt > s.at || s.mode !== mode || s.path !== n.vault!.path;
    if (fileNew && cloudNew) {
      // правили и там и там — побеждает позднее
      if (c.updatedAt > n.updatedAt) plan.pull.push({ note: n, copy: c });
      else plan.push.push({ note: n, cloud: id, mode });
    } else if (cloudNew) plan.pull.push({ note: n, copy: c });
    else if (fileNew) plan.push.push({ note: n, cloud: id, mode });
  }
  for (const [id, c] of copies) if (!wanted.has(id)) plan.drop.push(c);
  return plan;
}

/** Файлы, встроенные в текст (`![[книга.pdf]]` — не .md): имена. */
export function embeddedFiles(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/!\[\[([^\]|#]+?\.(?!md\])[a-z0-9]{2,5})(?:[|#][^\]]*)?\]\]/gi)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
