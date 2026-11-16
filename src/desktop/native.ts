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
  vaultUpload: (s: string) => void;
  vaultDownload: (s: string) => void;
  openFiles: { connect: (cb: () => void) => void };
  extPending: (cb: (s: string) => void) => void;
  extRead: (path: string, cb: (s: string) => void) => void;
  extWrite: (s: string, cb: (s: string) => void) => void;
  extRename: (s: string, cb: (s: string) => void) => void;
  extMove: (s: string, cb: (s: string) => void) => void;
  extReveal: (path: string) => void;
  /** «Открыть файл…» обычным окном выбора (в окне со старой программой этого нет). */
  extChoose?: (cb: (s: string) => void) => void;
  /** Режим тестировщика (baza.py bug*, zamechaniya.py); в окне со старой программой их нет. */
  /** Вычитка: снимки и замок на время правки Claude (baza.py review*). */
  reviewState?: (path: string, cb: (s: string) => void) => void;
  reviewAccept?: (path: string, cb: (s: string) => void) => void;
  bugNotes?: (cb: (s: string) => void) => void;
  bugDo?: (s: string, cb: (s: string) => void) => void;
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
  /** Скачанное в хранилище (vaultDownload): пути в нём. */
  paths?: string[];
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
  // «Открыть с помощью»: файлы, просившие открыться до загрузки страницы, тоже ждут в окне
  l.openFiles?.connect(() => void pullOpen());
  void pullOpen();
}

const openListeners = new Set<(files: ExtOpen[]) => void>();
let openQueue: ExtOpen[] = [];
async function pullOpen() {
  if (!link?.extPending) return;
  const got = await ask<ExtOpen[]>((l, d) => l.extPending(d)).catch(() => []);
  if (!got.length) return;
  if (openListeners.size) for (const cb of openListeners) cb(got);
  else openQueue.push(...got); // окно ещё не подписалось — отдать, когда подпишется
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
/** .md вне хранилища, открытый из системы: путь и — если он всё же в хранилище — путь там. */
export interface ExtOpen {
  path: string;
  vault: string | null;
}
export interface ExtFile {
  path: string;
  text: string;
  mtime: number;
  /** false — не UTF-8: показать можно, записывать окно откажется. */
  utf8: boolean;
}

/** .md вне хранилища — правится на месте (baza.py ext*). */
export const extApi = {
  read: (path: string) => ask<ExtFile>((l, d) => l.extRead(path, d)),
  write: (path: string, text: string, mtime: number) => ask<{ mtime: number }>((l, d) => l.extWrite(JSON.stringify({ path, text, mtime }), d)),
  rename: (path: string, name: string) => ask<{ path: string }>((l, d) => l.extRename(JSON.stringify({ path, name }), d)),
  /** Переложить в хранилище (dir — папка в нём): путь там. */
  move: (path: string, dir: string) => ask<{ path: string }>((l, d) => l.extMove(JSON.stringify({ path, dir }), d)),
  /** Показать в проводнике (файл — выделенным): полный путь любого файла или папки. */
  reveal: (path: string) => link?.extReveal(path),
  /** Можно ли открыть файл окном выбора прямо из программы. */
  canChoose: () => !!link?.extChoose,
  /** Выбрать .md с диска — править на месте; пусто — отменили. */
  choose: (): Promise<ExtOpen[]> => (link?.extChoose ? ask<ExtOpen[]>((l, d) => l.extChoose!(d)).catch(() => []) : Promise.resolve([])),
  onOpen: (cb: (files: ExtOpen[]) => void) => {
    openListeners.add(cb);
    if (openQueue.length) {
      const q = openQueue;
      openQueue = [];
      cb(q);
    }
    return () => void openListeners.delete(cb);
  },
};

/** Вычитка статьи: Claude сейчас правит файл (lock); текст до его круга и после (с шапкой файла). */
export interface ReviewState {
  lock: boolean;
  before: string | null;
  after: string | null;
}
export const reviewApi = {
  /** null — окно этого ещё не умеет (старая программа) или его нет. */
  state: (path: string): Promise<ReviewState | null> => (link?.reviewState ? ask<ReviewState>((l, d) => l.reviewState!(path, d)).catch(() => null) : Promise.resolve(null)),
  /** Автор принял правки: снимок «до» убрать — подсветка гаснет. */
  accept: (path: string): Promise<unknown> => (link?.reviewAccept ? ask((l, d) => l.reviewAccept!(path, d)).catch(() => null) : Promise.resolve(null)),
};

/** Замечание тестировщика (как в Чатпате): где это было и что не так; ответ — от Claude. */
export interface BugNote {
  id: number;
  ts: number;
  when: string;
  account: string;
  place: string;
  selector: string;
  target: string;
  ctx?: Record<string, unknown> | null;
  note: string;
  status: 'new' | 'ask' | 'done' | 'wont';
  reply: string;
  done_ts: number;
}
export type BugReq =
  | { do: 'add'; note: string; place: string; selector: string; target: string; html: string; ctx: Record<string, unknown> }
  | { do: 'edit'; id: number; note: string }
  | { do: 'status'; id: number; status: BugNote['status']; reply?: string }
  | { do: 'del'; id: number }
  | { do: 'clear' };

// Запас без окна (сервер разработки) и в окне со старой программой: замечания лежат в браузере
// и сами переезжают в общую базу, как только у окна появятся нужные команды.
const LOCAL_BUGS = 'dk.bugs';
const localBugs = {
  list(): BugNote[] {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_BUGS) || '[]') as BugNote[];
    } catch {
      return [];
    }
  },
  save(list: BugNote[]) {
    try {
      localStorage.setItem(LOCAL_BUGS, JSON.stringify(list));
    } catch {
      /* переполнено — не страшно */
    }
  },
  act(r: BugReq) {
    let list = this.list();
    const now = Math.floor(Date.now() / 1000);
    if (r.do === 'add') {
      const id = Math.max(0, ...list.map((n) => n.id)) + 1;
      const d = new Date();
      const p = (x: number) => String(x).padStart(2, '0');
      list.unshift({
        id, ts: now, when: `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`, account: 'База',
        place: r.place, selector: r.selector, target: r.target, ctx: r.ctx, note: r.note, status: 'new', reply: '', done_ts: 0,
      });
    } else if (r.do === 'edit') list = list.map((n) => (n.id === r.id ? { ...n, note: r.note } : n));
    else if (r.do === 'status') list = list.map((n) => (n.id === r.id ? { ...n, status: r.status, reply: r.reply || n.reply, done_ts: r.status === 'done' || r.status === 'wont' ? now : 0 } : n));
    else if (r.do === 'del') list = list.filter((n) => n.id !== r.id);
    else if (r.do === 'clear') list = list.filter((n) => n.status === 'new' || n.status === 'ask');
    this.save(list);
  },
};

export const bugApi = {
  /** Замечания доходят до Claude (`zametki замечания`): у окна есть общая база. */
  shared: () => !!link?.bugNotes && !!link?.bugDo,
  async list(): Promise<BugNote[]> {
    if (!bugApi.shared()) return localBugs.list();
    // записанное, пока общей базы не было, — перенести (один раз)
    const waiting = localBugs.list();
    if (waiting.length) {
      for (const n of [...waiting].reverse()) {
        await ask((l, d) => l.bugDo!(JSON.stringify({ do: 'add', note: n.note, place: n.place, selector: n.selector, target: n.target, html: '', ctx: n.ctx ?? {} }), d)).catch(() => {});
      }
      localBugs.save([]);
    }
    return ask<BugNote[]>((l, d) => l.bugNotes!(d));
  },
  async act(r: BugReq): Promise<void> {
    if (!bugApi.shared()) return localBugs.act(r);
    await ask((l, d) => l.bugDo!(JSON.stringify(r), d));
  },
};

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
  /** Файл хранилища — в облако (для «📱 текст и файлы»). */
  upload: (path: string) =>
    new Promise<Attached>((resolve) => {
      if (!link) return resolve({ attachments: [], errors: ['нет окна'] });
      const ref = `u${++num}`;
      uploads.set(ref, resolve);
      link.vaultUpload(JSON.stringify({ ref, path }));
    }),
  /** Файл из облака (прикреплённый на телефоне) — в `_файлы/` хранилища. */
  download: (storagePath: string, name: string) =>
    new Promise<Attached>((resolve) => {
      if (!link) return resolve({ attachments: [], errors: ['нет окна'] });
      const ref = `w${++num}`;
      uploads.set(ref, resolve);
      link.vaultDownload(JSON.stringify({ ref, storagePath, name }));
    }),
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
