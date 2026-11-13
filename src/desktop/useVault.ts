// Заметки хранилища-папки в окне «База» (src/lib/kb/vault.ts — перевод, papka.py — диск).
// Список и тексты приходят от окна; правки со стороны (Obsidian) — событием; свои правки
// пишутся в файл сразу. Переименование заметки — переименование файла: id меняется, окно
// узнаёт об этом через onRenamed (вкладки, раскрытые папки).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, Relation } from '../types';
import {
  baseName,
  dirName,
  newNotePath,
  noteFromVault,
  fileFromVault,
  pathOfId,
  vid,
  vaultMarkdown,
  type VaultEntry,
} from '../lib/kb/vault';
import { native, vaultApi, type VaultInfo } from './native';

export interface Vault {
  /** Открытое хранилище; null — не выбрано (или окна нет: обычный браузер). */
  info: VaultInfo | null;
  notes: Note[];
  relations: Relation[];
  loading: boolean;
  /** Список и тексты открытого хранилища прочитаны: до этого сверять с телефоном нельзя —
   *  пустой список выглядел бы как «все файлы удалены». */
  loaded: boolean;
  error: string;
  choose: () => Promise<void>;
  open: (path: string) => Promise<void>;
  /** Новая заметка в папке хранилища (dir — путь, '' — корень); id новой. */
  create: (dir: string, fields: Partial<Note>) => Promise<string>;
  update: (id: string, patch: Partial<Note>) => Promise<void>;
  /** Дописать в конец текста — к тексту, какой он сейчас на диске, а не в прошлой отрисовке. */
  append: (id: string, text: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  mkdir: (dir: string, name: string) => Promise<void>;
  /** Перечитать список файлов (после скачивания в `_файлы/` — не ждать опроса). */
  refresh: () => Promise<void>;
  /** Переложить заметку, файл или папку в другую папку ('' — корень). */
  move: (id: string, toDir: string) => Promise<void>;
  importFiles: () => Promise<string[]>;
  importData: (f: File) => Promise<string[]>;
}

export function useVault(onRenamed: (from: string, to: string) => void): Vault {
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const entries = useRef(new Map<string, VaultEntry>());
  const texts = useRef(new Map<string, string>());
  // готовые заметки по пути: тот же текст — та же заметка (разбор указателя не повторяется)
  const cache = useRef(new Map<string, { text: string; mtime?: number; note: Note }>());
  const [version, setVersion] = useState(0);
  const renamedRef = useRef(onRenamed);
  renamedRef.current = onRenamed;
  // старый id → новый: правка, посланная под прежним именем (заметку переименовали, пока
  // в ней печатали), идёт в новый файл, а не пропадает. Только пока по старому пути пусто:
  // 13.11.2026 новая «Без названия» (то же имя, что было у переименованной) уводила свои правки
  // в старую заметку — та переименовывалась, её текст затирался, удаление стирало её.
  const renames = useRef(new Map<string, string>());
  const resolve = (id: string) => {
    for (let i = 0; i < 20 && !entries.current.has(pathOfId(id)) && renames.current.has(id); i++) id = renames.current.get(id)!;
    return id;
  };
  // своя запись по пути: чтение правки со стороны, начатое до неё, её не затирает
  const stamps = useRef(new Map<string, number>());
  // правки идут по одной: правка во время переименования пишет уже в новый файл
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const queued = <T,>(job: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(job, job);
    chain.current = next.catch(() => {});
    return next;
  };

  const built = useMemo(() => {
    void version;
    const notes: Note[] = [];
    const relations: Relation[] = [];
    for (const e of entries.current.values()) {
      if (e.kind === 'dir') {
        notes.push({ id: vid.dir(e.path), title: baseName(e.path), body: '', type: 'folder', date: null, createdAt: 0, updatedAt: 0, vault: { path: e.path } });
      } else if (e.kind === 'md') {
        const text = texts.current.get(e.path) ?? '';
        const hit = cache.current.get(e.path);
        if (hit && hit.text === text && hit.mtime === e.mtime) notes.push(hit.note);
        else {
          const note = noteFromVault(e, text);
          cache.current.set(e.path, { text, mtime: e.mtime, note });
          notes.push(note);
        }
      } else notes.push(fileFromVault(e));
      const d = dirName(e.path);
      const id = e.kind === 'md' ? vid.md(e.path) : e.kind === 'dir' ? vid.dir(e.path) : vid.file(e.path);
      if (d) relations.push({ id: `vr:${e.path}`, from: vid.dir(d), to: id, type: 'child', position: 0, createdAt: 0, updatedAt: 0 });
    }
    return { notes, relations };
  }, [version]);
  const bump = () => setVersion((v) => v + 1);

  const load = useCallback(async () => {
    setLoading(true);
    setLoaded(false);
    setError('');
    try {
      const list = await vaultApi.scan();
      entries.current = new Map(list.map((e) => [e.path, e]));
      texts.current = new Map();
      cache.current = new Map();
      const md = list.filter((e) => e.kind === 'md').map((e) => e.path);
      for (let i = 0; i < md.length; i += 300) {
        const got = await vaultApi.read(md.slice(i, i + 300));
        for (const [p, t] of Object.entries(got)) texts.current.set(p, t);
      }
      bump();
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // окно подключается не сразу (QWebChannel): ждём его, потом — что открыто
  useEffect(() => {
    let alive = true;
    const t = setInterval(() => {
      if (!native.available()) return;
      clearInterval(t);
      vaultApi
        .info()
        .then((i) => {
          if (!alive) return;
          setInfo(i.path ? i : null);
          if (i.path) void load();
        })
        .catch((e) => setError((e as Error).message));
    }, 200);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [load]);

  // правки со стороны: Obsidian, файловый менеджер
  useEffect(
    () =>
      vaultApi.onChange(async (c) => {
        for (const p of c.removed) {
          entries.current.delete(p);
          texts.current.delete(p);
        }
        const md: string[] = [];
        for (const e of c.changed) {
          entries.current.set(e.path, e);
          if (e.kind === 'md') md.push(e.path);
        }
        if (md.length) {
          const before = new Map(md.map((p) => [p, stamps.current.get(p) ?? 0]));
          const got = await vaultApi.read(md).catch(() => ({}) as Record<string, string>);
          for (const [p, t] of Object.entries(got)) if ((stamps.current.get(p) ?? 0) === before.get(p)) texts.current.set(p, t);
        }
        bump();
      }),
    [],
  );

  const choose = useCallback(async () => {
    const i = await vaultApi.choose();
    setInfo(i.path ? i : null);
    if (i.path) await load();
  }, [load]);
  const open = useCallback(
    async (path: string) => {
      const i = await vaultApi.open(path);
      setInfo(i.path ? i : null);
      await load();
    },
    [load],
  );

  const taken = (p: string) => entries.current.has(p);
  const write = async (path: string, text: string) => {
    stamps.current.set(path, (stamps.current.get(path) ?? 0) + 1);
    texts.current.set(path, text);
    const { mtime } = await vaultApi.write(path, text);
    entries.current.set(path, { path, kind: 'md', mtime, size: text.length });
    bump();
  };
  /** Переименовать на диске; вложенное в папку — тоже переезжает. */
  const relocate = async (from: string, to: string, kind: VaultEntry['kind']) => {
    await vaultApi.move(from, to);
    // папки, которых не было (под заметку — её папка дочерних), окно создало само; опрос о них
    // не скажет (свои изменения он не приносит) — завести здесь
    for (let d = dirName(to); d; d = dirName(d)) if (!entries.current.has(d)) entries.current.set(d, { path: d, kind: 'dir' });
    const moved: [string, VaultEntry][] = [];
    for (const [p, e] of entries.current) {
      if (p === from || p.startsWith(from + '/')) moved.push([p, e]);
    }
    for (const [p, e] of moved) {
      const np = to + p.slice(from.length);
      entries.current.delete(p);
      entries.current.set(np, { ...e, path: np });
      const t = texts.current.get(p);
      if (t !== undefined) {
        texts.current.delete(p);
        texts.current.set(np, t);
      }
      const prefix = e.kind === 'md' ? 'v:' : e.kind === 'dir' ? 'd:' : 'f:';
      renames.current.set(prefix + p, prefix + np);
      renames.current.delete(prefix + np);
      renamedRef.current(prefix + p, prefix + np);
    }
    // у заметки есть дочерние (папка с тем же именем рядом, как в Obsidian) — папка едет следом
    if (kind === 'md') {
      const a = from.replace(/\.md$/i, '');
      const b = to.replace(/\.md$/i, '');
      if (entries.current.get(a)?.kind === 'dir' && !entries.current.has(b)) await relocate(a, b, 'dir');
    }
    bump();
  };

  const builtRef = useRef(built);
  builtRef.current = built;
  // заметка .md — из последнего записанного текста, а не из прошлой отрисовки: две правки подряд
  // (текст, следом тег) не должны затирать друг друга
  const byId = (id: string) => {
    if (id.startsWith('v:')) {
      const p = pathOfId(id);
      const t = texts.current.get(p);
      if (t !== undefined) return noteFromVault(entries.current.get(p) ?? { path: p, kind: 'md' }, t);
    }
    return builtRef.current.notes.find((n) => n.id === id);
  };

  const create = useCallback(async (dir: string, fields: Partial<Note>) => {
    const path = newNotePath(dir, fields.title?.trim() || 'Без названия', taken);
    const note = { id: vid.md(path), title: '', body: '', date: null, createdAt: 0, updatedAt: 0, ...fields, vault: { path } } as Note;
    // папки, которых ещё нет, окно создаст само; в дереве их видно сразу, не через опрос
    for (let d = dirName(path); d; d = dirName(d)) if (!entries.current.has(d)) entries.current.set(d, { path: d, kind: 'dir' });
    renames.current.delete(vid.md(path));
    await write(path, vaultMarkdown(note));
    return vid.md(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Текст файла ещё не читали (новый со стороны, пришёл со списком) — прочитать: иначе запись
   *  заменила бы настоящий текст пустым. */
  const ensureText = async (path: string) => {
    if (texts.current.has(path) || !entries.current.has(path)) return;
    const got = await vaultApi.read([path]);
    if (got[path] === undefined) throw new Error(`не прочитать ${path}`);
    if (!texts.current.has(path)) texts.current.set(path, got[path]);
  };

  /** Папка дочерних (`А/` рядом с `А.md`) опустела — убрать её: заметка снова без дочерних. */
  const pruneEmpty = async (dir: string) => {
    if (!dir || entries.current.get(dir)?.kind !== 'dir' || !entries.current.has(dir + '.md')) return;
    for (const p of entries.current.keys()) if (p.startsWith(dir + '/')) return;
    await vaultApi.remove(dir).catch(() => {});
    entries.current.delete(dir);
    bump();
  };

  const update = (id: string, patch: Partial<Note>) => queued(() => doUpdate(resolve(id), patch));
  const append = (id: string, text: string) =>
    queued(async () => {
      const rid = resolve(id);
      if (!rid.startsWith('v:')) return;
      await ensureText(pathOfId(rid));
      const b = (byId(rid)?.body ?? '').trimEnd();
      await doUpdate(rid, { body: `${b}${b ? '\n\n' : ''}${text}` });
    });
  const doUpdate = async (id: string, patch: Partial<Note>) => {
    if (id.startsWith('v:')) await ensureText(pathOfId(id));
    const n = byId(id);
    if (!n?.vault) return;
    let path = n.vault.path;
    const kind: VaultEntry['kind'] = id.startsWith('v:') ? 'md' : id.startsWith('d:') ? 'dir' : 'file';
    // новое название — новое имя файла (у PDF и папки — тоже, расширение то же)
    if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== n.title) {
      const dir = dirName(path);
      const ext = kind === 'file' ? path.slice(path.lastIndexOf('.')) : '';
      const clean = patch.title.trim().replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ');
      const target =
        kind === 'md'
          ? newNotePath(dir, clean, (p) => p !== path && taken(p))
          : (dir ? dir + '/' : '') + (kind === 'file' && !clean.toLowerCase().endsWith(ext.toLowerCase()) ? clean + ext : clean);
      if (target !== path) {
        await relocate(path, target, kind);
        path = target;
      }
    }
    const { title: _t, ...rest } = patch;
    void _t;
    // папке написали текст (теги, свойства) — она становится заметкой с дочерними: рядом `А.md`
    if (kind === 'dir' && Object.keys(rest).some((k) => k !== 'inBase' && k !== 'toPhone')) {
      const mdPath = path + '.md';
      if (!entries.current.has(mdPath)) {
        const note = { id: vid.md(mdPath), title: baseName(path), body: '', date: null, createdAt: 0, updatedAt: 0, ...rest, vault: { path: mdPath } } as Note;
        delete (note as Partial<Note>).type; // роль «папка» — у самой папки, у заметки обычная
        await write(mdPath, vaultMarkdown(note));
        renamedRef.current(vid.dir(path), vid.md(mdPath));
        return;
      }
      return doUpdate(vid.md(mdPath), rest);
    }
    if (kind !== 'md') return;
    if (!Object.keys(rest).length) return;
    const fresh = byId(vid.md(path)) ?? { ...n, vault: { ...n.vault, path } };
    await write(path, vaultMarkdown({ ...fresh, ...rest, vault: { ...n.vault, path } }));
  };

  // удалить и переложить — только то, что названо: по старому имени — ничего, а не «куда переехало»
  const remove = (id: string) => queued(() => doRemove(id));
  const doRemove = async (id: string) => {
    const path = pathOfId(id);
    await vaultApi.remove(path);
    for (const p of [...entries.current.keys()]) if (p === path || p.startsWith(path + '/')) entries.current.delete(p);
    texts.current.delete(path);
    bump();
    await pruneEmpty(dirName(path));
  };
  const mkdir = async (dir: string, name: string) => {
    const path = (dir ? dir + '/' : '') + name.replace(/[\\/:*?"<>|]/g, ' ').trim();
    await vaultApi.mkdir(path);
    entries.current.set(path, { path, kind: 'dir' });
    bump();
  };
  const move = (id: string, toDir: string) => queued(() => doMove(id, toDir));
  const doMove = async (id: string, toDir: string) => {
    const path = pathOfId(id);
    const target = (toDir ? toDir + '/' : '') + baseName(path);
    if (target === path || toDir === path || toDir.startsWith(path + '/')) return;
    // заметку — не в собственные дочерние
    const stem = path.replace(/\.md$/i, '');
    if (id.startsWith('v:') && (toDir === stem || toDir.startsWith(stem + '/'))) throw new Error('Заметку нельзя сделать дочерней к её собственной дочерней');
    const kind: VaultEntry['kind'] = id.startsWith('v:') ? 'md' : id.startsWith('d:') ? 'dir' : 'file';
    await relocate(path, target, kind);
    await pruneEmpty(dirName(path));
  };
  /** Перечитать список; новые и изменённые .md — вместе с текстом (иначе были бы пустыми,
   *  а у изменённых — новое время при старом тексте). */
  const rescan = async () => {
    const list = await vaultApi.scan();
    const md = new Set(list.filter((e) => e.kind === 'md' && (!texts.current.has(e.path) || entries.current.get(e.path)?.mtime !== e.mtime)).map((e) => e.path));
    const before = new Map([...md].map((p) => [p, stamps.current.get(p) ?? 0]));
    const got = md.size ? await vaultApi.read([...md]).catch(() => ({}) as Record<string, string>) : {};
    const next = new Map<string, VaultEntry>();
    for (const e of list) {
      if (e.kind === 'md' && md.has(e.path)) {
        // текст не прочитался или его только что переписали здесь — оставить, что было
        if (got[e.path] === undefined || (stamps.current.get(e.path) ?? 0) !== before.get(e.path)) {
          next.set(e.path, entries.current.get(e.path) ?? e);
          continue;
        }
        texts.current.set(e.path, got[e.path]);
      }
      next.set(e.path, e);
    }
    for (const p of [...texts.current.keys()]) if (!next.has(p)) texts.current.delete(p);
    entries.current = next;
    bump();
  };
  const refresh = () => rescan();
  const importFiles = async () => {
    const got = await vaultApi.importFiles();
    await rescan();
    return got;
  };
  const importData = async (f: File) => {
    const got = await vaultApi.importData(f);
    await rescan();
    return got;
  };

  // один объект, пока данные те же: окно строит от него правки и указатель — без лишних пересчётов
  const fns = useRef({ create, update, append, remove, mkdir, move, importFiles, importData, refresh });
  fns.current = { create, update, append, remove, mkdir, move, importFiles, importData, refresh };
  return useMemo(
    () => ({
      info,
      notes: built.notes,
      relations: built.relations,
      loading,
      loaded,
      error,
      choose,
      open,
      create: (dir: string, f: Partial<Note>) => fns.current.create(dir, f),
      update: (id: string, p: Partial<Note>) => fns.current.update(id, p),
      append: (id: string, t: string) => fns.current.append(id, t),
      remove: (id: string) => fns.current.remove(id),
      mkdir: (dir: string, name: string) => fns.current.mkdir(dir, name),
      move: (id: string, to: string) => fns.current.move(id, to),
      importFiles: () => fns.current.importFiles(),
      importData: (f: File) => fns.current.importData(f),
      refresh: () => fns.current.refresh(),
    }),
    [info, built, loading, loaded, error, choose, open],
  );
}
