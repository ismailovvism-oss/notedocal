// Что умеет только окно на компьютере (~/projects/apps/zametki, baza.py): голос с микрофона,
// кнопки Claude, команды ★ и кнопки на микрофоне. Связь — тот же объект QWebChannel `most`,
// что и мост к базе (./bridge.ts). В обычном браузере (npm run dev) этого нет: available() — false.

export interface QtLink {
  message: { connect: (cb: (s: string) => void) => void };
  voiceEvent: { connect: (cb: (s: string) => void) => void };
  processed: { connect: (cb: (s: string) => void) => void };
  command: { connect: (cb: (s: string) => void) => void };
  send: (s: string) => void;
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
const voiceListeners = new Set<(e: VoiceEvent) => void>();
const commandListeners = new Set<(op: string) => void>();
const waiting = new Map<string, (text: string) => void>();
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
  onVoice: (cb: (e: VoiceEvent) => void) => {
    voiceListeners.add(cb);
    return () => void voiceListeners.delete(cb);
  },
  onCommand: (cb: (op: string) => void) => {
    commandListeners.add(cb);
    return () => void commandListeners.delete(cb);
  },
};
