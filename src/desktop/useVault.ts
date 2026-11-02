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
  error: string;
  choose: () => Promise<void>;
  open: (path: string) => Promise<void>;
  /** Новая заметка в папке хранилища (dir — путь, '' — корень); id новой. */
  create: (dir: string, fields: Partial<Note>) => Promise<string>;
  update: (id: string, patch: Partial<Note>) => Promise<void>;
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
  const [error, setError] = useState('');
  const entries = useRef(new Map<string, VaultEntry>());
  const texts = useRef(new Map<string, string>());
  // готовые заметки по пути: тот же текст — та же заметка (разбор указателя не повторяется)
  const cache = useRef(new Map<string, { text: string; mtime?: number; note: Note }>());
  const [version, setVersion] = useState(0);
  const renamedRef = useRef(onRenamed);
  renamedRef.current = onRenamed;

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
          const got = await vaultApi.read(md).catch(() => ({}) as Record<string, string>);
          for (const [p, t] of Object.entries(got)) texts.current.set(p, t);
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
    texts.current.set(path, text);
    const { mtime } = await vaultApi.write(path, text);
    entries.current.set(path, { path, kind: 'md', mtime, size: text.length });
    bump();
  };
  /** Переименовать на диске; вложенное в папку — тоже переезжает. */
  const relocate = async (from: string, to: string, kind: VaultEntry['kind']) => {
    await vaultApi.move(from, to);
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
      renamedRef.current(prefix + p, prefix + np);
    }
    void kind;
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
    await write(path, vaultMarkdown(note));
    return vid.md(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = async (id: string, patch: Partial<Note>) => {
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
    if (kind !== 'md') return;
    const { title: _t, ...rest } = patch;
    void _t;
    if (!Object.keys(rest).length) return;
    const fresh = byId(vid.md(path)) ?? { ...n, vault: { ...n.vault, path } };
    await write(path, vaultMarkdown({ ...fresh, ...rest, vault: { ...n.vault, path } }));
  };

  const remove = async (id: string) => {
    const path = pathOfId(id);
    await vaultApi.remove(path);
    for (const p of [...entries.current.keys()]) if (p === path || p.startsWith(path + '/')) entries.current.delete(p);
    texts.current.delete(path);
    bump();
  };
  const mkdir = async (dir: string, name: string) => {
    const path = (dir ? dir + '/' : '') + name.replace(/[\\/:*?"<>|]/g, ' ').trim();
    await vaultApi.mkdir(path);
    entries.current.set(path, { path, kind: 'dir' });
    bump();
  };
  const move = async (id: string, toDir: string) => {
    const path = pathOfId(id);
    const target = (toDir ? toDir + '/' : '') + baseName(path);
    if (target === path || toDir === path || toDir.startsWith(path + '/')) return;
    const kind: VaultEntry['kind'] = id.startsWith('v:') ? 'md' : id.startsWith('d:') ? 'dir' : 'file';
    await relocate(path, target, kind);
  };
  const refresh = async () => {
    const list = await vaultApi.scan();
    for (const e of list) if (!entries.current.has(e.path) || e.kind !== 'md') entries.current.set(e.path, e);
    bump();
  };
  const importFiles = async () => {
    const got = await vaultApi.importFiles();
    const list = await vaultApi.scan();
    entries.current = new Map(list.map((e) => [e.path, e]));
    bump();
    return got;
  };
  const importData = async (f: File) => {
    const got = await vaultApi.importData(f);
    const list = await vaultApi.scan();
    entries.current = new Map(list.map((e) => [e.path, e]));
    bump();
    return got;
  };

  // один объект, пока данные те же: окно строит от него правки и указатель — без лишних пересчётов
  const fns = useRef({ create, update, remove, mkdir, move, importFiles, importData, refresh });
  fns.current = { create, update, remove, mkdir, move, importFiles, importData, refresh };
  return useMemo(
    () => ({
      info,
      notes: built.notes,
      relations: built.relations,
      loading,
      error,
      choose,
      open,
      create: (dir: string, f: Partial<Note>) => fns.current.create(dir, f),
      update: (id: string, p: Partial<Note>) => fns.current.update(id, p),
      remove: (id: string) => fns.current.remove(id),
      mkdir: (dir: string, name: string) => fns.current.mkdir(dir, name),
      move: (id: string, to: string) => fns.current.move(id, to),
      importFiles: () => fns.current.importFiles(),
      importData: (f: File) => fns.current.importData(f),
      refresh: () => fns.current.refresh(),
    }),
    [info, built, loading, error, choose, open],
  );
}
