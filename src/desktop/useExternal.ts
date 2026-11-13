// .md вне хранилища, открытые из системы («Открыть с помощью → База знаний»): правятся на месте,
// там, где лежат; видны в дереве папкой «📄 Открытые файлы», пока их не убрали из списка или не
// переложили в хранилище. id — `x:` + полный путь. Запись — только если файл не меняли снаружи
// с прошлого чтения (иначе перечитываем и говорим об этом), как и в хранилище: по одной.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '../types';
import { noteFromVault, vaultMarkdown } from '../lib/kb/vault';
import { extApi, native, type ExtFile } from './native';
import { useLocalStorage } from '../lib/storage';

export const EXT = 'x:';
export const isExt = (id: string) => id.startsWith(EXT) && id.length > 2;
export const extPath = (id: string) => id.slice(2);

export interface External {
  notes: Note[];
  /** Открыть (прочитать) и вернуть id; уже открыт — перечитать. */
  open: (path: string) => Promise<string>;
  update: (id: string, patch: Partial<Note>) => Promise<void>;
  /** Убрать из списка — файл остаётся, где был. */
  forget: (id: string) => void;
  /** Файл ушёл (переложили в хранилище) — убрать без следа. */
  dropped: (id: string) => void;
}

/** Заметка из файла: как у хранилища, но с id `x:путь`; разбор заголовка — для записи обратно. */
function toNote(f: ExtFile): { note: Note; meta: Note['vault'] } {
  const n = noteFromVault({ path: f.path, kind: 'md', mtime: f.mtime }, f.text);
  const title = f.path.slice(f.path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
  const { vault: meta, ...rest } = n;
  return { note: { ...rest, id: EXT + f.path, title }, meta };
}

export function useExternal(onRenamed: (from: string, to: string) => void, onError: (msg: string) => void): External {
  const [paths, setPaths] = useLocalStorage<string[]>('dk.ext', []);
  const [files, setFiles] = useState(new Map<string, ExtFile>());
  const filesRef = useRef(files);
  filesRef.current = files;
  const renamedRef = useRef(onRenamed);
  renamedRef.current = onRenamed;
  const errRef = useRef(onError);
  errRef.current = onError;
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const queued = <T,>(job: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(job, job);
    chain.current = next.catch(() => {});
    return next;
  };
  const put = (f: ExtFile) =>
    setFiles((m) => {
      const n = new Map(m);
      n.set(f.path, f);
      filesRef.current = n;
      return n;
    });

  // открытые в прошлый раз — прочитать снова; пропавшие с диска — убрать из списка
  useEffect(() => {
    if (!paths.length) return;
    const t = setInterval(() => {
      if (!native.available()) return;
      clearInterval(t);
      for (const p of paths) {
        extApi
          .read(p)
          .then(put)
          .catch(() => setPaths((l) => l.filter((x) => x !== p)));
      }
    }, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // вернулись в окно — перечитать: файл могли поправить в другой программе
  useEffect(() => {
    const onFocus = () => {
      for (const [p, f] of filesRef.current) {
        void extApi
          .read(p)
          .then((g) => g.mtime !== f.mtime && put(g))
          .catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const open = useCallback(
    async (path: string) => {
      const f = await extApi.read(path);
      put(f);
      setPaths((l) => (l.includes(f.path) ? l : [...l, f.path]));
      return EXT + f.path;
    },
    [setPaths],
  );

  const doUpdate = async (id: string, patch: Partial<Note>) => {
    let path = extPath(id);
    let f = filesRef.current.get(path);
    if (!f) return;
    const { note, meta } = toNote(f);
    if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== note.title) {
      const r = await extApi.rename(path, patch.title.trim().replace(/[\\/:*?"<>|]/g, ' '));
      // старый путь — в константу: сеттеры ниже выполнятся позже, когда path уже новый
      const old = path;
      const moved = { ...f, path: r.path };
      setFiles((m) => {
        const n = new Map(m);
        n.delete(old);
        n.set(r.path, moved);
        filesRef.current = n;
        return n;
      });
      setPaths((l) => l.map((x) => (x === old ? r.path : x)));
      renamedRef.current(EXT + old, EXT + r.path);
      path = r.path;
      f = { ...f, path };
    }
    const { title: _t, ...rest } = patch;
    void _t;
    if (!Object.keys(rest).length) return;
    const text = vaultMarkdown({ ...note, ...rest, vault: meta });
    try {
      const { mtime } = await extApi.write(path, text, f.mtime);
      put({ ...f, text, mtime });
    } catch (e) {
      // меняли снаружи (или не UTF-8) — показать, что на диске, и сказать
      errRef.current(`«${note.title}»: ${(e as Error).message}`);
      await extApi.read(path).then(put).catch(() => {});
    }
  };
  const update = (id: string, patch: Partial<Note>) => queued(() => doUpdate(id, patch));

  const drop = useCallback(
    (id: string) => {
      const p = extPath(id);
      setFiles((m) => {
        const n = new Map(m);
        n.delete(p);
        filesRef.current = n;
        return n;
      });
      setPaths((l) => l.filter((x) => x !== p));
    },
    [setPaths],
  );

  const notes = useMemo(() => [...files.values()].map((f) => toNote(f).note), [files]);
  const fns = useRef({ update });
  fns.current = { update };
  return useMemo(
    () => ({
      notes,
      open,
      update: (id: string, p: Partial<Note>) => fns.current.update(id, p),
      forget: drop,
      dropped: drop,
    }),
    [notes, open, drop],
  );
}
