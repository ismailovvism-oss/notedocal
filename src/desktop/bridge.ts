// Связь окна «База» с notedocal — через мост секретаря (scripts/secretary.mjs bridge, op `base`).
//
// В настольной программе (~/projects/apps/zametki, baza.py) страница живёт внутри окна Qt, а мост
// держит само окно: сообщения идут через QWebChannel. Входа через Google здесь нет и не нужно —
// мост ходит в базу с ключом сервиса. Для проверки в обычном браузере `npm run dev` поднимает
// тот же мост сам (vite.config.ts, /bridge/*).

import { useEffect, useRef, useState } from 'react';
import type { Note, Relation } from '../types';
import { mergeById } from '../lib/storage';
import { cleanNote, cleanRelation } from '../lib/clean';
import { loadMeta, saveMeta } from '../lib/notesStore';

type Msg = Record<string, unknown> & { event?: string; ref?: string };

interface Transport {
  send: (cmd: Record<string, unknown>) => void;
  /** Мост уже поднят (ready пришёл раньше, чем страница подключилась). */
  ready: boolean;
}

declare global {
  interface Window {
    qt?: { webChannelTransport: unknown };
    QWebChannel?: new (t: unknown, cb: (ch: { objects: Record<string, QtLink> }) => void) => unknown;
  }
}
interface QtLink {
  message: { connect: (cb: (s: string) => void) => void };
  send: (s: string) => void;
  ready: (cb: (ok: boolean) => void) => void;
}

/** Подключиться: окно Qt или сервер разработки. Сообщения — в onMsg. */
function connect(onMsg: (m: Msg) => void): Promise<Transport> {
  if (window.qt && window.QWebChannel) {
    return new Promise((resolve) => {
      new window.QWebChannel!(window.qt!.webChannelTransport, (ch) => {
        const link = ch.objects.most;
        link.message.connect((s) => {
          try {
            onMsg(JSON.parse(s));
          } catch {
            /* не JSON — пропустить */
          }
        });
        link.ready((ok) => resolve({ send: (c) => link.send(JSON.stringify(c)), ready: ok }));
      });
    });
  }
  const es = new EventSource('/bridge/events');
  es.onmessage = (e) => {
    try {
      onMsg(JSON.parse(e.data));
    } catch {
      /* пропустить */
    }
  };
  const send = (c: Record<string, unknown>) =>
    void fetch('/bridge/send', { method: 'POST', body: JSON.stringify(c) }).catch(() => {});
  return Promise.resolve({ send, ready: false });
}

export type BridgeStatus = 'подключаюсь' | 'загружаю' | 'есть' | 'нет связи';

interface Meta {
  since: number;
  notes: Record<string, string>;
  relations: Record<string, string>;
}

const DAY = 24 * 3600 * 1000;
const sigOf = (x: { updatedAt: number; deleted?: boolean }) => `${x.updatedAt}:${x.deleted ? 1 : 0}`;

/**
 * Заметки и связи через мост: при подключении — изменённое с прошлого раза (запас 2 суток
 * на часы устройств), дальше — изменения по мере появления. Свои правки уходят пачкой через
 * 600 мс; мост пишет их, если в базе не новее. Что уже сверено — хранится на устройстве,
 * как у приложения (src/lib/sync.ts).
 */
export function useBridgeSync(
  notes: Note[],
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>,
  relations: Relation[],
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>,
  loaded: boolean,
): BridgeStatus {
  const [status, setStatus] = useState<BridgeStatus>('подключаюсь');
  const [known, setKnown] = useState(false);
  // не записалось или мост перезапустился — повторить отправку
  const [retry, setRetry] = useState(0);
  const tr = useRef<Transport | null>(null);
  const synced = useRef({ notes: new Map<string, string>(), relations: new Map<string, string>() });
  // отправлено, ответа ещё нет: ref → что отметить сверенным
  const inflight = useRef(new Map<string, { notes: Note[]; relations: Relation[] }>());
  const sending = useRef(new Map<string, string>());
  const since = useRef(0);
  const num = useRef(0);
  const metaTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saveSoon = () => {
    if (metaTimer.current) return;
    metaTimer.current = setTimeout(() => {
      metaTimer.current = undefined;
      const m: Meta = {
        since: since.current,
        notes: Object.fromEntries(synced.current.notes),
        relations: Object.fromEntries(synced.current.relations),
      };
      void saveMeta('bridge', m);
    }, 2000);
  };

  // подключение — когда заметки с устройства уже подняты: иначе пришедшее затёрло бы их
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    (async () => {
      const meta = await loadMeta<Meta>('bridge');
      if (meta) {
        since.current = meta.since;
        synced.current.notes = new Map(Object.entries(meta.notes));
        synced.current.relations = new Map(Object.entries(meta.relations));
      }
      const subscribe = () => {
        setStatus('загружаю');
        tr.current?.send({ op: 'base', ref: 'b-sub', since: since.current ? since.current - 2 * DAY : 0 });
      };
      const t = await connect((m) => {
        if (!alive) return;
        if (m.event === 'ready') {
          // мост перезапустился: неотвеченное пропало — отправить заново
          inflight.current.clear();
          sending.current.clear();
          subscribe();
          setRetry((x) => x + 1);
        }
        else if (m.event === 'down') setStatus('нет связи');
        else if (m.event === 'base') {
          const now = Date.now();
          if (Array.isArray(m.notes)) {
            const list = m.notes as Note[];
            for (const n of list) {
              synced.current.notes.set(n.id, sigOf(n));
              if (n.updatedAt > since.current) since.current = Math.min(n.updatedAt, now);
            }
            setNotes((cur) => mergeById(list, cur));
          }
          if (Array.isArray(m.relations)) {
            const list = m.relations as Relation[];
            for (const r of list) synced.current.relations.set(r.id, sigOf(r));
            setRelations((cur) => mergeById(list, cur));
          }
          if (m.done) {
            setKnown(true);
            setStatus('есть');
          }
          saveSoon();
        } else if (m.ref && inflight.current.has(m.ref)) {
          const sent = inflight.current.get(m.ref)!;
          inflight.current.delete(m.ref);
          for (const n of sent.notes) sending.current.delete('n' + n.id);
          for (const r of sent.relations) sending.current.delete('r' + r.id);
          if (m.event === 'ok') {
            for (const n of sent.notes) synced.current.notes.set(n.id, sigOf(n));
            for (const r of sent.relations) synced.current.relations.set(r.id, sigOf(r));
            saveSoon();
          } else {
            setStatus('нет связи');
            setTimeout(() => setRetry((x) => x + 1), 5000);
          }
        }
      });
      if (!alive) return;
      tr.current = t;
      if (t.ready) subscribe();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // свои правки — в базу
  useEffect(() => {
    if (!known || !tr.current) return;
    const t = setTimeout(() => {
      const fresh = <T extends { id: string; updatedAt: number; deleted?: boolean }>(list: T[], kind: 'n' | 'r', m: Map<string, string>) =>
        list.filter((x) => m.get(x.id) !== sigOf(x) && sending.current.get(kind + x.id) !== sigOf(x));
      const ns = fresh(notes, 'n', synced.current.notes);
      const rs = fresh(relations, 'r', synced.current.relations);
      if (!ns.length && !rs.length) return;
      const ref = `b-${Date.now()}-${++num.current}`;
      inflight.current.set(ref, { notes: ns, relations: rs });
      for (const n of ns) sending.current.set('n' + n.id, sigOf(n));
      for (const r of rs) sending.current.set('r' + r.id, sigOf(r));
      tr.current!.send({ op: 'base-put', ref, notes: ns.map(cleanNote), relations: rs.map(cleanRelation) });
    }, 600);
    return () => clearTimeout(t);
  }, [notes, relations, known, retry]);

  return status;
}
