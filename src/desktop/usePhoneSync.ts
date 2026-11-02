// «📱 На телефон» в окне «База»: исполняет сверку хранилища-папки с облаком notedocal
// (решение — src/lib/kb/phone.ts). Копия заметки — облачная заметка в папке «🗄 <хранилище>»:
// её видит и правит приложение на телефоне. Сверка идёт сама через секунду после любых
// изменений с обеих сторон, только когда облако уже сверено (иначе плодились бы двойники).
//
// Файлы: «только текст» — вложение-название с пометкой «на компьютере» (local), «текст и
// файлы» — файл загружается в облако (vaultFile — какой это `![[…]]`). Файл, прикреплённый на
// телефоне, скачивается в `_файлы/` хранилища и встаёт в текст `![[имя]]`.

import { useEffect, useRef, useState } from 'react';
import type { Attachment, Note, Relation } from '../types';
import { uid } from '../lib/storage';
import { embeddedFiles, planPhoneSync, type PhoneMode, type VaultSync } from '../lib/kb/phone';
import { baseName, mimeOf } from '../lib/kb/vault';
import { vaultApi } from './native';
import { sendBridge } from './bridge';
import type { Vault } from './useVault';

const FLAGS = '.zametki/телефон.json';

export interface PhoneSync {
  /** Отметки папок: путь → режим (`''` — всё хранилище). */
  folders: Record<string, PhoneMode | 'off'>;
  setFolder: (dir: string, mode: PhoneMode | 'off' | null) => void;
  /** Что сейчас делается — для строки состояния. */
  busy: string;
}

export function usePhoneSync(
  vault: Vault,
  cloud: Note[],
  setCloud: React.Dispatch<React.SetStateAction<Note[]>>,
  relations: Relation[],
  addRelation: (r: Relation) => void,
  ready: boolean,
): PhoneSync {
  const [folders, setFolders] = useState<Record<string, PhoneMode | 'off'>>({});
  const [busy, setBusy] = useState('');
  const inflight = useRef(new Set<string>());

  // отметки папок — файл в хранилище
  useEffect(() => {
    if (!vault.info) return;
    vaultApi
      .read([FLAGS])
      .then((r) => setFolders(r[FLAGS] ? JSON.parse(r[FLAGS]) : {}))
      .catch(() => setFolders({}));
  }, [vault.info]);
  const setFolder = (dir: string, mode: PhoneMode | 'off' | null) => {
    const next = { ...folders };
    if (mode) next[dir] = mode;
    else delete next[dir];
    setFolders(next);
    void vaultApi.write(FLAGS, JSON.stringify(next, null, 1));
  };

  /** Записать копию с явным временем: `cloudAt` = updatedAt — наша запись не «правка с телефона». */
  const putCopy = (c: Note, sync: Omit<VaultSync, 'cloudAt'>) => {
    const t = Date.now();
    const next = { ...c, updatedAt: t, deleted: false, vaultSync: { ...sync, cloudAt: t } };
    setCloud((list) => (list.some((n) => n.id === c.id) ? list.map((n) => (n.id === c.id ? next : n)) : [next, ...list]));
  };

  // папка «🗄 <хранилище>» в облаке — туда кладутся копии, телефон видит их там
  const folderId = useRef<string | null>(null);
  const ensureFolder = (name: string, list: Note[]) => {
    const title = `🗄 ${name}`;
    const f = list.find((n) => !n.deleted && n.type === 'folder' && n.title === title);
    if (f) return (folderId.current = f.id);
    if (folderId.current) return folderId.current;
    const id = uid();
    const now = Date.now();
    setCloud((l) => [{ id, title, body: '', type: 'folder', date: null, createdAt: now, updatedAt: now }, ...l]);
    return (folderId.current = id);
  };

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!vault.info || !ready) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), 1000);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.notes, cloud, folders, ready, vault.info]);

  async function run() {
    const name = vault.info!.name;
    const plan = planPhoneSync(name, vault.notes, cloud, folders, uid);
    if (!plan.assign.length && !plan.push.length && !plan.pull.length && !plan.baseline.length && !plan.drop.length) {
      // файлы с телефона к копиям — скачать (каждую сверку: вдруг прикрепили)
      void fetchPhoneFiles();
      return setBusy('');
    }
    setBusy('сверяю с телефоном…');
    // постоянный id — в заголовок файла; отправка — на следующем круге (время файла сменится)
    for (const a of plan.assign) await vault.update(a.id, { cloud: a.cloud }).catch(() => {});
    for (const b of plan.baseline) putCopy(b.copy, { ...(b.copy.vaultSync as VaultSync), at: b.at });
    for (const { note, copy } of plan.pull) {
      const { title, body, tags, props, aliases } = copy;
      await vault.update(note.id, { title, body, tags, props, aliases }).catch(() => {});
      putCopy(copy, { ...(copy.vaultSync as VaultSync), at: -1 });
    }
    const fid = plan.push.length ? ensureFolder(name, cloud) : null;
    for (const { note, cloud: cid, mode } of plan.push) {
      const prev = cloud.find((c) => c.id === cid);
      const names = embeddedFiles(note.body ?? '');
      // файлы: «текст» — названия; «с файлами» — что уже загружено, остальное догрузится ниже
      const keep = (prev?.attachments ?? []).filter((a) => a.vaultFile && names.includes(a.vaultFile) && !a.local && mode === 'files');
      const attachments: Attachment[] =
        mode === 'files'
          ? keep
          : names.map((n) => ({ id: `vf:${n}`, name: n, size: 0, type: mimeOf(n), url: `local:${n}`, path: fileRel(n) ?? n, createdAt: 0, local: true, vaultFile: n }));
      // загруженные, которые больше не нужны (сняли «с файлами», убрали из текста) — стереть
      for (const a of prev?.attachments ?? []) if (a.vaultFile && !a.local && !keep.includes(a) && a.path) sendBridge({ op: 'rmfile', path: a.path });
      const { title, body, tags, props, aliases, type } = note;
      const copy: Note = {
        ...(prev ?? {}),
        id: cid,
        title,
        body,
        tags,
        props,
        aliases,
        type: type ?? 'note',
        date: null,
        createdAt: prev?.createdAt ?? Date.now(),
        updatedAt: 0,
        attachments: [...attachments, ...(prev?.attachments ?? []).filter((a) => !a.vaultFile)],
      };
      putCopy(copy, { vault: name, path: note.vault!.path, at: note.updatedAt, mode });
      // в папку «🗄 хранилище» — если копия ещё ни в какой папке (забранная из облака остаётся в своей)
      if (fid && !relations.some((r) => !r.deleted && r.type === 'child' && r.to === cid)) {
        addRelation({ id: uid(), from: fid, to: cid, type: 'child', position: 0, createdAt: Date.now(), updatedAt: Date.now() });
      }
      if (mode === 'files') for (const n of names) if (!keep.some((a) => a.vaultFile === n)) void uploadFile(cid, n);
    }
    for (const c of plan.drop) {
      for (const a of c.attachments ?? []) if (!a.local && a.path) sendBridge({ op: 'rmfile', path: a.path });
      setCloud((list) => list.map((n) => (n.id === c.id ? { ...n, deleted: true, updatedAt: Date.now() } : n)));
    }
    setBusy('');
  }

  /** Путь файла в хранилище по имени из `![[имя]]` (сначала в `_файлы/`). */
  function fileRel(name: string): string | undefined {
    const files = vault.notes.filter((n) => n.vault?.mime && baseName(n.vault.path) === name);
    return (files.find((n) => n.vault!.path.startsWith('_файлы/')) ?? files[0])?.vault?.path;
  }

  async function uploadFile(cid: string, name: string) {
    const key = `${cid}:${name}`;
    const rel = fileRel(name);
    if (!rel || inflight.current.has(key)) return;
    inflight.current.add(key);
    setBusy(`загружаю на телефон: ${name}`);
    const r = await vaultApi.upload(rel);
    inflight.current.delete(key);
    setBusy('');
    const a = r.attachments[0];
    if (!a) return;
    setCloud((list) =>
      list.map((c) => {
        if (c.id !== cid) return c;
        const t = Date.now();
        const s = c.vaultSync as VaultSync;
        return { ...c, attachments: [...(c.attachments ?? []).filter((x) => x.vaultFile !== name), { ...a, vaultFile: name }], updatedAt: t, vaultSync: { ...s, cloudAt: t } };
      }),
    );
  }

  /** Прикрепили файл к копии на телефоне — скачать в хранилище и встроить в текст заметки. */
  async function fetchPhoneFiles() {
    for (const c of cloud) {
      const s = c.vaultSync as VaultSync | undefined;
      if (!s || c.deleted || s.vault !== vault.info?.name) continue;
      for (const a of c.attachments ?? []) {
        if (a.vaultFile || a.local || !a.path) continue;
        const key = `dl:${c.id}:${a.id}`;
        if (inflight.current.has(key)) continue;
        inflight.current.add(key);
        setBusy(`скачиваю с телефона: ${a.name}`);
        const r = await vaultApi.download(a.path, a.name);
        setBusy('');
        const rel = r.paths?.[0];
        if (!rel) {
          inflight.current.delete(key);
          continue;
        }
        const note = vault.notes.find((n) => n.cloud === c.id);
        if (note) {
          const b = (note.body ?? '').trimEnd();
          await vault.update(note.id, { body: `${b}${b ? '\n\n' : ''}![[${baseName(rel)}]]` }).catch(() => {});
        }
        setCloud((list) =>
          list.map((x) => {
            if (x.id !== c.id) return x;
            const t = Date.now();
            const vs = x.vaultSync as VaultSync;
            return {
              ...x,
              attachments: (x.attachments ?? []).map((y) => (y.id === a.id ? { ...y, vaultFile: baseName(rel) } : y)),
              updatedAt: t,
              vaultSync: { ...vs, cloudAt: t },
            };
          }),
        );
      }
    }
  }

  return { folders, setFolder, busy };
}
