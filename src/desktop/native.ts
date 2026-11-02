import type { Attachment } from '../types';
import type { VaultEntry } from '../lib/kb/vault';

// Что умеет только окно на компьютере (~/projects/apps/zametki, baza.py): голос с микрофона,
// кнопки Claude, команды ★ и кнопки на микрофоне. Связь — тот же объект QWebChannel `most`,
// что и мост к базе (./bridge.ts). В обычном браузере (npm run dev) этого нет: available() — false.

export interface QtLink {
  message: { connect: (cb: (s: string) => void) => void };
  voiceEvent: { connect: (cb: (s: string) => void) => void };
  processed: { connect: (cb: (s: string) => void) => void };
  command: { connect: (cb: (s: string) => void) => void };
  attached: { connect: (cb: (s: string) => void) => void };
  send: (s: string) => void;
  attach: (ref: string) => void;
  attachLocal: (ref: string) => void;
  attachData: (s: string) => void;
  localUrl: (s: string, cb: (url: string) => void) => void;
  reveal: (path: string) => void;
  vaultEvent: { connect: (cb: (s: string) => void) => void };
  vaultInfo: (cb: (s: string) => void) => void;
  vaultChoose: (cb: (s: string) => void) => void;
  vaultOpen: (path: string, cb: (s: string) => void) => void;
  vaultScan: (cb: (s: string) => void) => void;
  vaultRead: (paths: string, cb: (s: string) => void) => void;
  vaultWrite: (s: string, cb: (s: string) => void) => void;
  vaultMove: (s: string, cb: (s: string) => void) => void;
  vaultDelete: (path: string, cb: (s: string) => void) => void;
  vaultMkdir: (path: string, cb: (s: string) => void) => void;
  vaultImport: (cb: (s: string) => void) => void;
  vaultImportData: (s: string, cb: (s: string) => void) => void;
  vaultReveal: (path: string) => void;
  voice: (s: string) => void;
  process: (s: string) => void;
  mics: (cb: (s: string) => void) => void;
  ready: (cb: (ok: boolean) => void) => void;
}

/** Событие голоса из окна. */
export type VoiceEvent =
  | { event: 'state'; id: string | null; state: 'rec' | 'pause' | 'wait' | 'idle'; seconds: number; level: number; waiting: number; mic: string }
  | { event: 'text'; id: string; text: string }
  | { event: 'done'; id: string }
  | { event: 'error'; message: string };

let link: QtLink | null = null;
const vaultListeners = new Set<(c: VaultChanges) => void>();

/** Хранилище-папка (окно, papka.py). */
export interface VaultInfo {
  path: string;
  name: string;
  recent: string[];
}
export interface VaultChanges {
  changed: VaultEntry[];
  removed: string[];
}
const voiceListeners = new Set<(e: VoiceEvent) => void>();
const commandListeners = new Set<(op: string) => void>();
const waiting = new Map<string, (text: string) => void>();
const uploads = new Map<string, (r: Attached) => void>();

/** Что прикрепилось: готовые вложения для заметки и что не вышло. */
export interface Attached {
  attachments: Attachment[];
  errors: string[];
}
let num = 0;

const parse = <T,>(s: string): T | null => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

/** Окно подключилось (./bridge.ts). */
export function attachNative(l: QtLink) {
  link = l;
  l.voiceEvent.connect((s) => {
    const e = parse<VoiceEvent>(s);
    if (e) for (const cb of voiceListeners) cb(e);
  });
  l.processed.connect((s) => {
    const r = parse<{ ref: string; text: string }>(s);
    if (!r) return;
    waiting.get(r.ref)?.(r.text);
    waiting.delete(r.ref);
  });
  l.attached.connect((s) => {
    const r = parse<Attached & { ref: string }>(s);
    if (!r) return;
    uploads.get(r.ref)?.(r);
    uploads.delete(r.ref);
  });
  l.vaultEvent.connect((s) => {
    const c = parse<VaultChanges>(s);
    if (c) for (const cb of vaultListeners) cb(c);
  });
  l.command.connect((s) => {
    const c = parse<{ op: string }>(s);
    if (c) for (const cb of commandListeners) cb(c.op);
  });
}

/** Откуда писать: имя источника PipeWire, `mic` — по умолчанию, `monitor` — звук компьютера. */
export interface Mics {
  default: string;
  list: { name: string; title: string }[];
}

/** Вызов окна с ответом JSON; ошибка окна ({error}) — исключение. */
function ask<T>(fn: (l: QtLink, done: (s: string) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!link) return reject(new Error('Хранилище — только в окне на компьютере'));
    fn(link, (s) => {
      const r = parse<T & { error?: string }>(s);
      if (!r) return reject(new Error('окно ответило не JSON'));
      if (r && typeof r === 'object' && 'error' in r && r.error) return reject(new Error(r.error));
      resolve(r as T);
    });
  });
}

/** Хранилище-папка на компьютере: что открыто, список, чтение, запись, перемещение, корзина. */
export const vaultApi = {
  info: () => ask<VaultInfo>((l, d) => l.vaultInfo(d)),
  choose: () => ask<VaultInfo>((l, d) => l.vaultChoose(d)),
  open: (path: string) => ask<VaultInfo>((l, d) => l.vaultOpen(path, d)),
  scan: () => ask<VaultEntry[]>((l, d) => l.vaultScan(d)),
  read: (paths: string[]) => ask<Record<string, string>>((l, d) => l.vaultRead(JSON.stringify(paths), d)),
  write: (path: string, text: string) => ask<{ mtime: number }>((l, d) => l.vaultWrite(JSON.stringify({ path, text }), d)),
  move: (from: string, to: string) => ask<{ ok: true }>((l, d) => l.vaultMove(JSON.stringify({ from, to }), d)),
  remove: (path: string) => ask<{ ok: true }>((l, d) => l.vaultDelete(path, d)),
  mkdir: (path: string) => ask<{ ok: true }>((l, d) => l.vaultMkdir(path, d)),
  /** 📎 — выбрать файлы, скопировать в `_файлы/`; пути в хранилище. */
  importFiles: () => ask<string[]>((l, d) => l.vaultImport(d)),
  importData: (file: File) =>
    new Promise<string[]>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () =>
        ask<string[]>((l, d) => l.vaultImportData(JSON.stringify({ name: file.name, data: String(r.result).split(',')[1] ?? '' }), d)).then(resolve, reject);
      r.onerror = () => reject(new Error(`${file.name}: не прочитался`));
      r.readAsDataURL(file);
    }),
  reveal: (path: string) => link?.vaultReveal(path),
  onChange: (cb: (c: VaultChanges) => void) => {
    vaultListeners.add(cb);
    return () => void vaultListeners.delete(cb);
  },
};

export const native = {
  available: () => !!link,
  voice: (cmd: { op: 'start'; id: string; lang: string; mic: string } | { op: 'mic'; mic: string } | { op: 'pause' | 'resume' | 'stop' }) =>
    link?.voice(JSON.stringify(cmd)),
  /** Микрофоны системы (спрашивает окно у PipeWire каждый раз: BOYA могли подключить). */
  mics: () =>
    new Promise<Mics>((resolve) => {
      if (!link) return resolve({ default: '', list: [] });
      link.mics((s) => resolve(parse<Mics>(s) ?? { default: '', list: [] }));
    }),
  /** Claude: очистить, связно, перевести. Пустая строка — не вышло. */
  process: (kind: 'clean' | 'connect' | 'translate', text: string, opts: { lang?: string; to?: string } = {}) =>
    new Promise<string>((resolve) => {
      if (!link) return resolve('');
      const ref = `p${++num}`;
      waiting.set(ref, resolve);
      link.process(JSON.stringify({ ref, kind, text, ...opts }));
    }),
  /** 📎 — окно спросит файлы обычным диалогом и положит их в хранилище. */
  attach: () =>
    new Promise<Attached>((resolve) => {
      if (!link) return resolve({ attachments: [], errors: ['Прикреплять файлы — только в окне на компьютере'] });
      const ref = `a${++num}`;
      uploads.set(ref, resolve);
      link.attach(ref);
    }),
  /** 📎 «только на этом компьютере»: файл остаётся на диске, в заметку — ссылка на него. */
  attachLocal: () =>
    new Promise<Attached>((resolve) => {
      if (!link) return resolve({ attachments: [], errors: ['Только в окне на компьютере'] });
      const ref = `a${++num}`;
      uploads.set(ref, resolve);
      link.attachLocal(ref);
    }),
  /** Адрес для просмотра файла «на компьютере»; пусто — по этому пути его нет. */
  localUrl: (a: Attachment) =>
    new Promise<string>((resolve) => {
      if (!link) return resolve('');
      link.localUrl(JSON.stringify({ id: a.id, path: a.path }), resolve);
    }),
  /** Показать файл в папке (проводник). */
  reveal: (path: string) => link?.reveal(path),
  /** Файл перетащили в заметку: содержимое — окну, оно положит в хранилище. */
  attachFile: (file: File) =>
    new Promise<Attached>((resolve) => {
      if (!link) return resolve({ attachments: [], errors: ['Прикреплять файлы — только в окне на компьютере'] });
      const ref = `a${++num}`;
      const r = new FileReader();
      r.onload = () => {
        uploads.set(ref, resolve);
        const data = String(r.result).split(',')[1] ?? '';
        link!.attachData(JSON.stringify({ ref, name: file.name, data }));
      };
      r.onerror = () => resolve({ attachments: [], errors: [`${file.name}: не прочитался`] });
      r.readAsDataURL(file);
    }),
  onVoice: (cb: (e: VoiceEvent) => void) => {
    voiceListeners.add(cb);
    return () => void voiceListeners.delete(cb);
  },
  onCommand: (cb: (op: string) => void) => {
    commandListeners.add(cb);
    return () => void commandListeners.delete(cb);
  },
};
