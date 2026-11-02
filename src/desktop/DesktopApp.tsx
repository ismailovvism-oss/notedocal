// Окно «База» — база знаний на компьютере (docs/ЗАМЕТКИ.md, раздел 10). Живёт внутри настольной
// программы ~/projects/apps/zametki (baza.py), данные — через мост секретаря (./bridge.ts).
//
// Раскладка как в Obsidian, без всплывающих окон: слева поиск и дерево папок (./Tree.tsx); в середине
// вкладки с открытыми заметками (у каждой — история «назад/вперёд»), заметка сразу правится;
// справа две вкладки — «Заметка» (оглавление, комментарии, кто ссылается сюда) и «Теги» (отбор). Ядро (src/lib/kb) и редактор — те же,
// что у приложения на телефоне.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attachment, Note, Relation } from '../types';
import { uid, useListActions, useLocalStorage, visible } from '../lib/storage';
import { persistParse, useNotesStore } from '../lib/notesStore';
import { buildIndex, planRename } from '../lib/kb/index';
import { KbContext, useCommentRefs, useKb, type KbApi, type KbFragment, type KbPicked } from '../lib/kb/ui';
import { OTHER, planTagRename, computeFacets, searchTags, selectedTags, tagCards, toggleTag, type Facets, type Selection } from '../lib/kb/tags';
import { normTag } from '../lib/kb/syntax';
import { linkText } from '../lib/kb/edit';
import { searchNotes } from '../lib/kb/search';
import { SERVICE_FOLDERS, folderTitles, scopeOf, type ScopeWhy } from '../lib/kb/scope';
import { TYPE_BADGE } from '../lib/noteTypes';
import { TagTree } from '../components/Facets';
import { FolderTree } from './Tree';
import { Backlinks } from '../components/Backlinks';
import { CommentComposer, LinkPicker, SetPicker } from '../components/KbDialogs';
import { PropsView } from '../components/Props';
import { NotePane, type PaneFocus } from './NotePane';
import { sendBridge, useBridgeSync, type BridgeStatus } from './bridge';
import { Guard } from './Guard';
import { native, vaultApi } from './native';
import { MenuHost, useMenu, type MenuItem } from './Menu';
import { FileView, fileIcon } from './FileView';
import { useVault, type Vault } from './useVault';
import { usePhoneSync } from './usePhoneSync';
import { phoneMode, type PhoneMode, type VaultSync } from '../lib/kb/phone';
import { dirName, inVault, pathOfId } from '../lib/kb/vault';

interface Target extends PaneFocus {
  id: string;
  /** Открыто вложение этой заметки (id файла) — во вкладке просмотр файла (./FileView.tsx). */
  file?: string;
  /** Номер перехода: тот же адрес второй раз — снова к фрагменту. */
  n: number;
}
interface Tab {
  key: string;
  hist: Target[];
  pos: number;
}

const PAGE = 200;
/** Облачные заметки (notedocal) при открытом хранилище — отдельной папкой дерева. */
const CLOUD = 'c:облако';
let seq = 0;
const newTab = (t: Target): Tab => ({ key: `t${++seq}`, hist: [t], pos: 0 });

export default function DesktopApp() {
  return (
    <MenuHost>
      <Desktop />
    </MenuHost>
  );
}

function Desktop() {
  const [notes, setNotes, loaded] = useNotesStore();
  const [relations, setRelations] = useLocalStorage<Relation[]>('ndc.relations', []);
  const status = useBridgeSync(notes, setNotes, relations, setRelations, loaded);
  const actions = useListActions(setNotes);
  const relActions = useListActions(setRelations);

  // Хранилище-папка на компьютере (./useVault.ts) — основа; облако notedocal — рядом, папкой ☁.
  // Переименование заметки хранилища меняет её id — вкладки и раскрытые папки идут следом.
  const renamedRef = useRef<(from: string, to: string) => void>(() => {});
  const vault = useVault((a, b) => renamedRef.current(a, b));
  const [vaultErr, setVaultErr] = useState('');
  const fail = useCallback((e: unknown) => setVaultErr((e as Error).message), []);
  /** Правка по адресу: заметка хранилища — в свой файл, облачная — в notedocal. */
  const store = useMemo(
    () => ({
      update: (id: string, patch: Partial<Note>) => (inVault(id) ? void vault.update(id, patch).catch(fail) : actions.update(id, patch)),
      remove: (id: string) => (inVault(id) ? void vault.remove(id).catch(fail) : actions.remove(id)),
    }),
    [vault, actions, fail],
  );
  // облачные копии заметок хранилища («📱 на телефон») в «Базе» не показываем: заметка есть файлом
  const cloudLive = useMemo(
    () => visible(notes).filter((n) => !n.vaultSync && !(vault.info && n.type === 'folder' && n.title === `🗄 ${vault.info.name}`)),
    [notes, vault.info],
  );
  const phone = usePhoneSync(vault, notes, setNotes, relations, relActions.add, status === 'есть');
  /** Режим «📱» заметки хранилища: свой или папки. */
  const phoneOf = useCallback((n: Note) => (n.vault && !n.vault.mime ? phoneMode(n, phone.folders) : null), [phone.folders]);
  const live = useMemo(
    () =>
      vault.info
        ? [...vault.notes, { id: CLOUD, title: '☁ notedocal', body: '', type: 'folder' as const, date: null, createdAt: 0, updatedAt: 0 }, ...cloudLive]
        : cloudLive,
    [vault.info, vault.notes, cloudLive],
  );
  // связи для дерева: папки хранилища по путям, облачное — внутри ☁
  const treeRelations = useMemo(() => {
    if (!vault.info) return relations;
    const hasParent = new Set(relations.filter((r) => !r.deleted && r.type === 'child').map((r) => r.to));
    const toCloud: Relation[] = cloudLive
      .filter((n) => !hasParent.has(n.id))
      .map((n) => ({ id: `cr:${n.id}`, from: CLOUD, to: n.id, type: 'child', position: 0, createdAt: 0, updatedAt: 0 }));
    return [...vault.relations, ...toCloud, ...relations];
  }, [vault.info, vault.relations, relations, cloudLive]);
  const index = useMemo(() => buildIndex(live), [live]);
  useEffect(() => {
    const t = setTimeout(() => void persistParse(), 2000);
    return () => clearTimeout(t);
  }, [index]);
  // Рабочее и служебное (src/lib/kb/scope.ts): хозяйство — здоровье, документы, контакты —
  // в списке, поиске и тегах не видно, пока не включено «показать служебное»
  const [hiddenFolders, setHiddenFolders] = useLocalStorage<string[]>('dk.hiddenFolders', SERVICE_FOLDERS);
  const [showAll, setShowAll] = useLocalStorage<boolean>('dk.showAll', false);
  const folders = useMemo(() => folderTitles(treeRelations, index.byId), [treeRelations, index]);
  const scope = useMemo(() => {
    const why = new Map<string, ScopeWhy>();
    for (const n of live) {
      // своё, из хранилища, — всегда рабочее (кроме спрятанного отметкой)
      if (inVault(n.id) || n.id === CLOUD) why.set(n.id, { shown: n.inBase !== false, why: n.inBase === false ? 'отметка' : '' });
      else why.set(n.id, scopeOf(n, folders.get(n.id), hiddenFolders));
    }
    return why;
  }, [live, folders, hiddenFolders]);
  const shown = useMemo(() => new Set([...scope].filter(([, w]) => w.shown).map(([id]) => id)), [scope]);
  // папки верхнего уровня — их можно прятать и показывать
  const topFolders = useMemo(() => {
    const hasParent = new Set(relations.filter((r) => !r.deleted && r.type === 'child').map((r) => r.to));
    return cloudLive.filter((n) => n.type === 'folder' && !hasParent.has(n.id)).map((n) => n.title).filter(Boolean).sort();
  }, [cloudLive, relations]);

  const isService = useCallback(
    (fid: string) => {
      if (inVault(fid) || fid === CLOUD) return false;
      const hidden = new Set(hiddenFolders.map((x) => x.trim().toLowerCase()));
      return [index.byId.get(fid)?.title ?? '', ...(folders.get(fid) ?? [])].some((t) => hidden.has(t.trim().toLowerCase()));
    },
    [index, folders, hiddenFolders],
  );
  const [open, setOpen] = useLocalStorage<string[]>('dk.open', []);

  // Отбор по тегам — во вкладке «Теги» справа; отобранное — слева вместо дерева
  const cards = useMemo(() => tagCards(live), [live]);
  const [sel, setSel] = useState<Selection>(new Map());
  const facets = useMemo(() => computeFacets(index, cards, sel, showAll ? undefined : shown), [index, cards, sel, showAll, shown]);
  const [rightTab, setRightTab] = useLocalStorage<'note' | 'tags'>('dk.right', 'note');

  // --- вкладки ---
  const [tabs, setTabs] = useLocalStorage<Tab[]>('dk.tabs', []);
  const [active, setActive] = useLocalStorage<string>('dk.active', '');
  const cur = tabs.find((t) => t.key === active) ?? tabs[0];
  const target = cur?.hist[cur.pos];

  /** Открыть: в текущей вкладке (с историей) или в новой. */
  const go = useCallback(
    (t: Omit<Target, 'n'>, inNew = false) => {
      const tt = { ...t, n: ++seq };
      setTabs((list) => {
        const c = list.find((x) => x.key === active) ?? list[0];
        if (!c || inNew) {
          const tab = newTab(tt);
          setActive(tab.key);
          return [...list, tab];
        }
        return list.map((x) => (x.key === c.key ? { ...x, hist: [...x.hist.slice(0, x.pos + 1), tt].slice(-50), pos: Math.min(x.pos + 1, 49) } : x));
      });
    },
    [active, setTabs, setActive],
  );
  const step = (d: number) =>
    cur && setTabs((list) => list.map((x) => (x.key === cur.key ? { ...x, pos: Math.max(0, Math.min(x.hist.length - 1, x.pos + d)) } : x)));
  const closeTab = (key: string) => {
    const i = tabs.findIndex((t) => t.key === key);
    const rest = tabs.filter((t) => t.key !== key);
    setTabs(rest);
    if (key === cur?.key) setActive(rest[Math.max(0, i - 1)]?.key ?? '');
  };

  // --- окна: сослаться, комментарий, набор; выбор слов в другой заметке ---
  const [dialog, setDialog] = useState<
    | { kind: 'link'; fromId?: string; resolve: (t: KbPicked | null) => void }
    | { kind: 'comment'; frag: KbFragment }
    | { kind: 'set'; frag: KbFragment }
    | null
  >(null);
  const [picking, setPicking] = useState<{ tab: string; id: string; resolve: (t: KbPicked | null) => void } | null>(null);

  const kb = useMemo<KbApi>(
    () => ({
      index,
      open: (t) => {
        let id = t.id;
        if (!id && t.name) {
          id = index.byName.get(t.name.trim().toLowerCase())?.[0]?.id;
          if (!id) {
            if (!confirm(`Заметки «${t.name}» нет. Создать?`)) return;
            if (vault.info) {
              void vault.create('', { title: t.name.trim() }).then((nid) => go({ id: nid })).catch(fail);
              return;
            }
            const now = Date.now();
            id = uid();
            actions.add({ id, title: t.name.trim(), body: '', type: 'note', date: null, createdAt: now, updatedAt: now });
          }
        }
        if (id) go({ id, anchor: t.anchor, heading: t.heading });
      },
      renamed: (id, oldTitle, newTitle) => {
        const patches = planRename(index, id, oldTitle, newTitle);
        if (!patches.length) return;
        for (const p of patches) store.update(p.id, { ...(p.body !== undefined ? { body: p.body } : {}), ...(p.props ? { props: p.props } : {}) });
      },
      pickLink: (fromId) => new Promise((resolve) => setDialog({ kind: 'link', fromId, resolve })),
      picking: !!picking,
      pickHere: (f) => {
        if (!picking) return;
        picking.resolve({ id: f.noteId, title: f.title, anchor: f.anchor });
        // вкладку, открытую для выбора, закрыть — вернуться туда, где ставили ссылку
        setTabs((list) => list.filter((t) => t.key !== picking.tab));
        setActive((a) => (a === picking.tab ? '' : a));
        setPicking(null);
      },
      comment: (frag) => setDialog({ kind: 'comment', frag }),
      addToSet: (frag) => setDialog({ kind: 'set', frag }),
      renameTag: (oldTag, newTag) => {
        const patches = planTagRename(live, oldTag, newTag);
        if (!patches.length) return 0;
        if (!confirm(`Переписать тег «${oldTag}» → «${newTag}» в заметках: ${patches.length}?`)) return 0;
        for (const p of patches) {
          const { id, ...rest } = p;
          store.update(id, rest);
        }
        return patches.length;
      },
      openTag: (tag) => {
        setSel(toggleTag(new Map(), normTag(tag)));
        setRightTab('tags');
      },
      updateNote: (id, patch) => store.update(id, patch),
      removeNote: (id) => store.remove(id),
    }),
    [index, actions, store, vault, fail, picking, live, go, setTabs, setActive, setRightTab],
  );

  function freeTitle(base: string) {
    let t = base;
    for (let i = 2; index.byName.has(t.toLowerCase()); i++) t = `${base} (${i})`;
    return t;
  }
  function saveComment(frag: KbFragment, text: string) {
    const now = Date.now();
    // комментарий к заметке хранилища — файлом рядом с ней
    if (vault.info && inVault(frag.noteId)) {
      void vault
        .create(dirName(pathOfId(frag.noteId)), {
          type: 'comment',
          title: freeTitle(`Комментарий — ${frag.excerpt}`.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80)),
          body: text,
          props: { к: [linkText({ title: frag.title, anchor: frag.anchor })] },
        })
        .catch(fail);
      setDialog(null);
      return;
    }
    actions.add({
      id: uid(),
      type: 'comment',
      title: freeTitle(`Комментарий: ${frag.excerpt}`),
      body: text,
      props: { к: [linkText({ title: frag.title, anchor: frag.anchor })] },
      date: null,
      createdAt: now,
      updatedAt: now,
    });
    setDialog(null);
  }
  function addToSet(frag: KbFragment, setId: string | null, title: string) {
    const embed = '!' + linkText({ title: frag.title, anchor: frag.anchor });
    const now = Date.now();
    if (setId) {
      const b = (index.byId.get(setId)?.body ?? '').trimEnd();
      store.update(setId, { body: (b ? b + '\n\n' : '') + embed });
    } else if (vault.info && inVault(frag.noteId)) {
      void vault.create(dirName(pathOfId(frag.noteId)), { type: 'set', title: freeTitle(title), body: embed }).catch(fail);
    } else {
      actions.add({ id: uid(), type: 'set', title: freeTitle(title), body: embed, date: null, createdAt: now, updatedAt: now });
    }
    setDialog(null);
  }
  /** Положить в папку (null — никуда). */
  function linkTo(parent: string | null, id: string, now: number) {
    if (!parent) return;
    relActions.add({ id: uid(), from: parent, to: id, type: 'child', position: 0, createdAt: now, updatedAt: now });
    setOpenFolder(parent);
  }
  /** Раскрыть папку в дереве (новое в ней должно быть видно). */
  const setOpenFolder = (id: string) => setOpen((o) => (o.includes(id) ? o : [...o, id]));
  function createNote(inNew = false, parent: string | null = null) {
    // в хранилище: в корень или в его папку; в облако — в папку ☁ и её подпапки
    if (vault.info && (parent === null || parent.startsWith('d:'))) {
      void vault
        .create(parent ? pathOfId(parent) : '', {})
        .then((id) => {
          madeHere.current.add(id);
          if (parent) setOpenFolder(parent);
          go({ id }, inNew);
          setTimeout(() => document.querySelector<HTMLInputElement>('.dk-title')?.select(), 80);
        })
        .catch(fail);
      return;
    }
    if (parent === CLOUD) parent = null;
    const now = Date.now();
    const id = uid();
    actions.add({ id, title: '', body: '', type: 'note', date: null, createdAt: now, updatedAt: now });
    madeHere.current.add(id);
    linkTo(parent, id, now);
    go({ id }, inNew);
    setTimeout(() => document.querySelector<HTMLInputElement>('.dk-title')?.focus(), 50);
  }
  function createFolder(parent: string | null) {
    const name = prompt('Название папки')?.trim();
    if (!name) return;
    if (vault.info && (parent === null || parent.startsWith('d:'))) {
      void vault.mkdir(parent ? pathOfId(parent) : '', name).catch(fail);
      if (parent) setOpenFolder(parent);
      return;
    }
    if (parent === CLOUD) parent = null;
    const now = Date.now();
    const id = uid();
    actions.add({ id, title: name, body: '', type: 'folder', date: null, createdAt: now, updatedAt: now });
    linkTo(parent, id, now);
  }
  /** Перенести заметку или папку из папки from в to (null — корень). */
  function move(id: string, from: string | null, to: string | null) {
    if (from === to) return;
    if (inVault(id)) {
      if (to === null || to.startsWith('d:')) {
        void vault.move(id, to ? pathOfId(to) : '').catch(fail);
        if (to) setOpenFolder(to);
      } else setVaultErr('Из хранилища на телефон — отметкой 📱 в шапке заметки или в меню папки, не перетаскиванием');
      return;
    }
    // облачную — в папку хранилища: забрать (и оставить на телефоне)
    if (to !== null && to.startsWith('d:')) {
      const dir = pathOfId(to);
      void takeToVault([id], () => dir, true);
      return;
    }
    if (from === CLOUD) from = null;
    if (to === CLOUD) to = null;
    if (from === to || id === CLOUD) return;
    const live = relations.filter((r) => !r.deleted && r.type === 'child');
    // папку нельзя положить в саму себя или в свою подпапку
    if (to) {
      const up = new Map<string, string[]>();
      for (const r of live) up.set(r.to, [...(up.get(r.to) ?? []), r.from]);
      const stack = [to];
      const seen = new Set<string>();
      while (stack.length) {
        const x = stack.pop()!;
        if (x === id) return;
        if (seen.has(x)) continue;
        seen.add(x);
        stack.push(...(up.get(x) ?? []));
      }
    }
    const old = from ? live.find((r) => r.from === from && r.to === id) : undefined;
    if (old) relActions.remove(old.id);
    if (to && !live.some((r) => r.from === to && r.to === id)) linkTo(to, id, Date.now());
  }

  const indexRef = useRef(index);
  indexRef.current = index;
  const storeRef = useRef(store);
  storeRef.current = store;
  // переименовали файл хранилища — id другой: вкладки и раскрытые папки — следом
  renamedRef.current = (from, to) => {
    setTabs((list) => list.map((t) => ({ ...t, hist: t.hist.map((h) => (h.id === from ? { ...h, id: to } : h)) })));
    setOpen((o) => o.map((x) => (x === from ? to : x)));
  };

  // --- быстрые заметки: ★ и кнопка на микрофоне (команды окна, ./native.ts) ---
  const [recordNew, setRecordNew] = useState<string | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  /** Новая заметка в папке «Быстрые заметки» (нет такой — завести). */
  function quickNote(record: boolean) {
    // быстрые заметки — в облаке: их видит телефон и обрабатывает окно (заказы)
    const folder = cloudLive.find((n) => n.type === 'folder' && n.title.trim().toLowerCase() === 'быстрые заметки');
    const now = Date.now();
    let fid = folder?.id ?? null;
    if (!fid) {
      fid = uid();
      actions.add({ id: fid, title: 'Быстрые заметки', body: '', type: 'folder', date: null, createdAt: now, updatedAt: now });
    }
    const id = uid();
    actions.add({ id, title: '', body: '', type: 'note', date: null, createdAt: now, updatedAt: now });
    madeHere.current.add(id);
    linkTo(fid, id, now);
    if (record) {
      setRecordNew(id);
      setTimeout(() => setRecordNew(null), 1000); // только при первом открытии
    }
    go({ id });
    if (!record) setTimeout(() => document.querySelector<HTMLElement>('.dk-page .cm-content')?.focus(), 80);
  }
  const quickRef = useRef(quickNote);
  quickRef.current = quickNote;
  const noteRef = useRef<string | undefined>(undefined);
  useEffect(
    () =>
      native.onCommand((op) => {
        if (op === 'quick') quickRef.current(false);
        // запись: открыта заметка — в неё с места курсора, нет — новая быстрая и сразу запись
        else if (op === 'record') {
          if (noteRef.current) window.dispatchEvent(new Event('dk-record'));
          else quickRef.current(true);
        }
      }),
    [],
  );

  // ушли с заметки посреди диктовки: дораспознанное — в её текст, на место метки
  const leftVoice = useRef(new Map<string, string>());
  useEffect(
    () =>
      native.onVoice((e) => {
        if (e.event !== 'text' && e.event !== 'done') return;
        const nid = leftVoice.current.get(e.id);
        if (!nid) return;
        const mark = `%%🎤:${e.id}%%`;
        const n = indexRef.current.byId.get(nid);
        if (n?.body?.includes(mark)) {
          const body =
            e.event === 'text' ? n.body.replace(mark, `${e.text ? e.text + ' ' : ''}${mark}`) : n.body.replace(` ${mark}`, '').replace(mark, '');
          storeRef.current.update(nid, { body });
        }
        if (e.event === 'done') leftVoice.current.delete(e.id);
      }),
    [],
  );

  // пустая новая заметка, с которой ушли, не нужна: ★ без единого слова не оставляет мусора
  const madeHere = useRef(new Set<string>());
  const prevNote = useRef<string | undefined>(undefined);

  // --- забрать облачные заметки в хранилище ---
  /** Путь облачной заметки по папкам (от верхней к ближайшей) — так же ляжет в хранилище. */
  function cloudPath(id: string): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (let cur = id; ; ) {
      const r = relations.find((x) => !x.deleted && x.type === 'child' && x.to === cur && index.byId.has(x.from));
      if (!r || seen.has(r.from)) break;
      seen.add(r.from);
      parts.unshift((index.byId.get(r.from)?.title || 'Без названия').replace(/[\\/:*?"<>|]/g, ' ').trim());
      cur = r.from;
    }
    return parts.join('/');
  }
  /** Облачные заметки — файлами в хранилище. Вложения — скачиваются в `_файлы/` и встают
   *  в текст `![[имя]]`. keep: облачная заметка становится «📱» копией (телефон её видит) —
   *  иначе она и её файлы убираются из облака. */
  async function takeToVault(ids: string[], dirOf: (n: Note) => string, keep: boolean) {
    if (!vault.info) return setVaultErr('Сначала выберите хранилище (🗄 вверху слева)');
    const list = ids.map((id) => index.byId.get(id)).filter((n): n is Note => !!n && !inVault(n.id) && n.type !== 'folder');
    let done = 0;
    const failed: string[] = [];
    for (const n of list) {
      setVaultErr(`Забираю в хранилище: ${++done} из ${list.length} — ${n.title || 'Без названия'}`);
      const embeds: string[] = [];
      const atts = (n.attachments ?? []).filter((a) => !a.local && a.path);
      const marked: Attachment[] = [];
      for (const a of atts) {
        const r = await vaultApi.download(a.path, a.name);
        const rel = r.paths?.[0];
        if (rel) {
          const name = rel.slice(rel.lastIndexOf('/') + 1);
          embeds.push(`![[${name}]]`);
          marked.push({ ...a, vaultFile: name });
        } else marked.push(a);
      }
      const b = (n.body ?? '').trimEnd();
      const body = embeds.length ? `${b}${b ? '\n\n' : ''}${embeds.join('\n')}\n` : n.body ?? '';
      const mode: PhoneMode = embeds.length ? 'files' : 'text';
      try {
        const vid = await vault.create(dirOf(n), {
          title: n.title || 'Без названия',
          body,
          tags: n.tags,
          props: n.props,
          aliases: n.aliases,
          type: n.type && n.type !== 'note' ? n.type : undefined,
          versions: n.versions,
          currentVersion: n.currentVersion,
          lang: n.lang,
          ...(keep ? { toPhone: mode, cloud: n.id } : {}),
        });
        if (keep) {
          // облачная — теперь копия: сверка возьмёт новое время файла за точку отсчёта
          const t = Date.now();
          const sync: VaultSync = { vault: vault.info.path, path: pathOfId(vid), at: -1, cloudAt: t, mode };
          setNotes((l) => l.map((x) => (x.id === n.id ? { ...x, attachments: [...marked, ...(x.attachments ?? []).filter((a) => a.local)], vaultSync: sync, updatedAt: t } : x)));
        } else if (marked.every((a) => a.vaultFile)) {
          for (const a of atts) sendBridge({ op: 'rmfile', path: a.path });
          actions.remove(n.id);
        } else {
          // какой-то файл не скачался — облачную заметку с её файлами не трогаем
          failed.push(n.title || 'Без названия');
        }
      } catch (e) {
        setVaultErr(`«${n.title}» не забрана: ${(e as Error).message}`);
        return;
      }
    }
    await vault.refresh().catch(() => {});
    if (failed.length) return setVaultErr(`Не все файлы скачались — в облаке оставлены как были: ${failed.join(', ')}`);
    setVaultErr(list.length ?`Забрано в хранилище: ${list.length}${keep ? ' — на телефоне остаются (📱)' : ' — из облака убраны'}` : '');
  }
  /** Все заметки облачной папки (с подпапками) — с путями от неё. */
  function cloudFolderNotes(fid: string): string[] {
    const out: string[] = [];
    const walk = (id: string, seen: Set<string>) => {
      for (const r of relations) {
        if (r.deleted || r.type !== 'child' || r.from !== id || seen.has(r.to)) continue;
        const n = index.byId.get(r.to);
        if (!n) continue;
        if (n.type === 'folder') walk(n.id, new Set([...seen, n.id]));
        else if (scope.get(n.id)?.shown || showAll) out.push(n.id);
      }
    };
    walk(fid, new Set([fid]));
    return out;
  }

  // --- меню по правой кнопке (./Menu.tsx) ---
  const menu = useMenu();
  /** Скопировать текст: буфер обмена, а нет доступа — через выделение. */
  const copyText = (text: string) =>
    void navigator.clipboard?.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  function renameNote(id: string) {
    const n = index.byId.get(id);
    if (!n) return;
    const t = prompt('Новое название', n.title)?.trim();
    if (!t || t === n.title) return;
    if (n.title) kb.renamed(id, n.title, t);
    store.update(id, { title: t });
  }
  /** Куда переложить: все видимые папки с путём. */
  function moveMenu(at: { clientX: number; clientY: number }, id: string, from: string | null) {
    const list = live
      .filter((n) => n.type === 'folder' && n.id !== id && (showAll || !isService(n.id)))
      .map((n) => ({ id: n.id, path: [...(folders.get(n.id) ?? [])].reverse().concat(n.title).join(' / ') }))
      .sort((a, b) => a.path.localeCompare(b.path, 'ru'));
    const items: MenuItem[] = [
      ...(from ? [{ label: 'В корень (без папки)', icon: '⤒', run: () => move(id, from, null) }, 'sep' as const] : []),
      ...list.map((f) => ({ label: f.path, icon: '📁', run: () => move(id, from, f.id), disabled: f.id === from })),
    ];
    menu({ ...at, preventDefault() {}, stopPropagation() {} } as unknown as MouseEvent, items);
  }
  function treeMenu(e: React.MouseEvent, node: { id: string; folder: boolean; parent: string | null } | null) {
    const at = { clientX: e.clientX, clientY: e.clientY };
    if (!node) {
      return menu(e, [
        { label: 'Новая заметка', icon: '✎', keys: 'Ctrl+N', run: () => createNote() },
        { label: 'Новая папка', icon: '📁', run: () => createFolder(null) },
      ]);
    }
    const n = index.byId.get(node.id);
    if (!n) return;
    const hidden = !scope.get(n.id)?.shown;
    const common: MenuItem[] = [
      { label: 'Переименовать', icon: '✏️', run: () => renameNote(n.id) },
      { label: 'Переложить в папку…', icon: '↪', run: () => setTimeout(() => moveMenu(at, n.id, node.parent), 0) },
    ];
    const cloud = !inVault(n.id) && n.id !== CLOUD && !!vault.info;
    const take: MenuItem[] = cloud
      ? node.folder
        ? [
            'sep',
            { label: 'Забрать папку в хранилище — оставить на телефоне', icon: '⬇', run: () => void takeToVault(cloudFolderNotes(n.id), (x) => cloudPath(x.id), true) },
            { label: 'Забрать папку в хранилище — убрать из облака', icon: '⬇', run: () => confirm(`Забрать «${n.title}» в хранилище и убрать эти заметки из облака (с телефона они пропадут)?`) && void takeToVault(cloudFolderNotes(n.id), (x) => cloudPath(x.id), false) },
          ]
        : [
            'sep',
            { label: 'Забрать в хранилище — оставить на телефоне', icon: '⬇', run: () => void takeToVault([n.id], (x) => cloudPath(x.id), true) },
            { label: 'Забрать в хранилище — убрать из облака', icon: '⬇', run: () => confirm(`Забрать «${n.title}» в хранилище и убрать из облака?`) && void takeToVault([n.id], (x) => cloudPath(x.id), false) },
          ]
      : [];
    if (n.id === CLOUD) {
      const all = cloudLive.filter((x) => x.type !== 'folder' && scope.get(x.id)?.shown).map((x) => x.id);
      return menu(e, [
        { label: `Забрать все рабочие заметки (${all.length}) — оставить на телефоне`, icon: '⬇', run: () => confirm(`Забрать ${all.length} заметок в хранилище? На телефоне они останутся (📱). Служебное не трогаю.`) && void takeToVault(all, (x) => cloudPath(x.id), true) },
        { label: 'Новая заметка в облаке', icon: '✎', run: () => createNote(false, CLOUD) },
      ]);
    }
    if (node.folder) {
      return menu(e, [
        { label: 'Новая заметка здесь', icon: '✎', run: () => createNote(false, n.id) },
        { label: 'Новая подпапка', icon: '📁', run: () => createFolder(n.id) },
        'sep',
        ...common,
        ...(n.id.startsWith('d:')
          ? (() => {
              const dir = n.id.slice(2);
              const cur = phone.folders[dir];
              const set = (m: PhoneMode | 'off' | null) => () => phone.setFolder(dir, m);
              return [
                'sep' as const,
                { label: `📱 Папку на телефон — только текст${cur === 'text' ? ' ✓' : ''}`, icon: '📱', run: set('text') },
                { label: `📱 Папку на телефон — текст и файлы${cur === 'files' ? ' ✓' : ''}`, icon: '📎', run: set('files') },
                { label: `Не на телефон${cur === 'off' ? ' ✓' : ''}`, icon: '🚫', run: set('off') },
                ...(cur ? [{ label: 'Как у папки выше', icon: '↺', run: set(null) }] : []),
                'sep' as const,
              ];
            })()
          : [{ label: 'Открыть папку как заметку', icon: '📄', run: () => go({ id: n.id }) }]),
        ...take,
        'sep',
        {
          label: 'Удалить папку',
          icon: '🗑',
          danger: true,
          run: () => {
            if (inVault(n.id)) {
              if (confirm(`Убрать папку «${n.title}» со всем содержимым в корзину хранилища (.trash)?`)) store.remove(n.id);
              return;
            }
            if (!confirm(`Удалить папку «${n.title}»? Заметки из неё не удалятся — окажутся выше.`)) return;
            for (const r of relations) if (!r.deleted && r.type === 'child' && r.from === n.id) relActions.remove(r.id);
            actions.remove(n.id);
          },
        },
      ]);
    }
    menu(e, [
      { label: 'Открыть', icon: '📄', run: () => go({ id: n.id }) },
      { label: 'Открыть в новой вкладке', icon: '⧉', keys: 'Ctrl+щелчок', run: () => go({ id: n.id }, true) },
      'sep',
      ...common,
      { label: 'Скопировать ссылку [[…]]', icon: '🔗', run: () => copyText(`[[${n.title}]]`), disabled: !n.title },
      ...take,
      {
        label: hidden ? 'Показывать в Базе' : 'Спрятать из Базы',
        icon: hidden ? '👁' : '🙈',
        run: () => store.update(n.id, { inBase: hidden }),
      },
      'sep',
      {
        label: 'Удалить',
        icon: '🗑',
        danger: true,
        run: () => confirm(`Удалить «${n.title || 'Без названия'}»?${inVault(n.id) ? ' (в корзину хранилища)' : ''}`) && store.remove(n.id),
      },
    ]);
  }
  function tabMenu(e: React.MouseEvent, key: string) {
    const t = tabs.find((x) => x.key === key);
    const id = t?.hist[t.pos]?.id;
    menu(e, [
      { label: 'Закрыть', icon: '×', keys: 'Ctrl+W', run: () => closeTab(key) },
      {
        label: 'Закрыть остальные',
        icon: '⊠',
        run: () => {
          setTabs((list) => list.filter((x) => x.key === key));
          setActive(key);
        },
        disabled: tabs.length < 2,
      },
      'sep',
      { label: 'Открыть копию в новой вкладке', icon: '⧉', run: () => id && go({ id }, true), disabled: !id },
    ]);
  }

  // --- клавиши: как в Obsidian ---
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        createNote(e.shiftKey);
      } else if (mod && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'o' || e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (mod && e.key.toLowerCase() === 'w' && cur) {
        e.preventDefault();
        closeTab(cur.key);
      } else if (e.altKey && e.key === 'ArrowLeft') step(-1);
      else if (e.altKey && e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const byId = index.byId;
  const note = target ? byId.get(target.id) : undefined;

  // Карточка файла хранилища: `X.md` рядом с `X.pdf` — его теги, свойства, иконка и заметки о нём.
  // В дереве пара — один пункт (сам файл), карточка открывается из шапки просмотра.
  const cardOf = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of vault.notes) {
      if (!n.vault?.mime) continue;
      const p = n.vault.path;
      const c = index.byId.get('v:' + p.slice(0, p.lastIndexOf('.')) + '.md');
      if (c) m.set(n.id, c);
    }
    return m;
  }, [vault.notes, index]);
  // Сколько файлов у заметки — видно в дереве и списке до открытия: облачные вложения или
  // встроенные в текст файлы хранилища (`![[книга.pdf]]` — не .md)
  const filesOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of live) {
      const embeds = (index.parsed.get(n.id)?.links ?? []).filter((l) => l.embed && /\.(?!md$)[a-z0-9]{2,5}$/i.test(l.target)).length;
      const k = (n.attachments?.length ?? 0) + embeds;
      if (k) m.set(n.id, k);
    }
    return m;
  }, [live, index]);
  const treeVisible = useMemo(() => {
    const cards = new Set([...cardOf.values()].map((c) => c.id));
    const ids = showAll ? live.map((n) => n.id) : [...shown];
    return new Set(ids.filter((id) => !cards.has(id)));
  }, [cardOf, showAll, live, shown]);
  const iconOf = useCallback(
    (n: Note) => (n.props?.icon as string) || (cardOf.get(n.id)?.props?.icon as string) || (n.vault?.mime ? fileIcon({ type: n.vault.mime } as never) : ''),
    [cardOf],
  );
  /** Записать в карточку файла; нет её — завести (`X.md` с `![[X.pdf]]`). */
  function toCard(file: Note, patch: Partial<Note>) {
    const c = cardOf.get(file.id);
    if (c) return store.update(c.id, patch);
    const p = file.vault!.path;
    const base = p.slice(p.lastIndexOf('/') + 1, p.lastIndexOf('.'));
    void vault.create(dirName(p), { title: base, body: `![[${file.title}]]\n`, ...patch }).catch(fail);
  }
  noteRef.current = note?.id;
  useEffect(() => {
    const prev = prevNote.current;
    prevNote.current = note?.id;
    if (!prev || prev === note?.id || !madeHere.current.has(prev)) return;
    // ушли — и в ней ни названия, ни текста, ни тегов: убрать (диктовка ещё идёт — оставить).
    // Смотрим свежий указатель: последнее несохранённое уходит в базу как раз при уходе.
    const t = setTimeout(() => {
      const m = indexRef.current.byId.get(prev);
      const blank = !m?.title.trim() || (inVault(prev) && m?.title === 'Без названия');
      if (m && blank && !(m.body ?? '').trim() && !(m.tags ?? []).length) {
        madeHere.current.delete(prev);
        storeRef.current.remove(prev);
      }
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  return (
    <KbContext.Provider value={kb}>
      <div className="dk">
        <Sidebar
          notes={live}
          scope={showAll ? null : shown}
          hiddenCount={live.length - shown.size}
          showAll={showAll}
          setShowAll={setShowAll}
          topFolders={topFolders}
          hiddenFolders={hiddenFolders}
          setHiddenFolders={setHiddenFolders}
          status={status}
          activeId={target?.id}
          searchRef={searchRef}
          relations={treeRelations}
          treeVisible={treeVisible}
          iconOf={iconOf}
          filesOf={filesOf}
          phoneOf={phoneOf}
          phoneBusy={phone.busy}
          vault={vault}
          vaultErr={vaultErr}
          clearVaultErr={() => setVaultErr('')}
          isService={isService}
          sel={sel}
          setSel={setSel}
          facets={facets}
          onOpen={(id, inNew) => go({ id }, inNew)}
          onCreate={(parent, kind) => (kind === 'folder' ? createFolder(parent) : createNote(false, parent))}
          onMove={move}
          open={open}
          setOpen={setOpen}
          onTreeMenu={treeMenu}
        />

        <main className="dk-main">
          <div className="dk-tabs">
            <button className="dk-icon" title="Назад (Alt+←)" disabled={!cur || cur.pos === 0} onClick={() => step(-1)}>
              ‹
            </button>
            <button className="dk-icon" title="Вперёд (Alt+→)" disabled={!cur || cur.pos >= cur.hist.length - 1} onClick={() => step(1)}>
              ›
            </button>
            <div className="dk-tablist">
              {tabs.map((t) => {
                const n = byId.get(t.hist[t.pos]?.id);
                const f = t.hist[t.pos]?.file ? n?.attachments?.find((a) => a.id === t.hist[t.pos].file) : undefined;
                return (
                  <div
                    key={t.key}
                    className={`dk-tab ${t.key === cur?.key ? 'on' : ''}`}
                    onClick={() => setActive(t.key)}
                    onAuxClick={(e) => e.button === 1 && closeTab(t.key)}
                    onContextMenu={(e) => tabMenu(e, t.key)}
                    title={n?.title}
                  >
                    <span className="dk-tab-title">{f ? `${fileIcon(f)} ${f.name}` : `${n && iconOf(n) ? iconOf(n) + ' ' : ''}${n?.title || 'Без названия'}`}</span>
                    <button
                      className="dk-tab-x"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t.key);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button className="dk-icon dk-tab-new" title="Новая заметка в новой вкладке (Ctrl+Shift+N)" onClick={() => createNote(true)}>
                ＋
              </button>
            </div>
          </div>
          <div className="dk-page">
            {note?.vault?.mime ? (
              <FileView
                meta={<CardBar file={note} card={cardOf.get(note.id)} onPatch={(p) => toCard(note, p)} onOpenCard={() => {
                  const c = cardOf.get(note.id);
                  if (c) go({ id: c.id });
                  else {
                    toCard(note, {});
                    setVaultErr('Карточка заведена — откройте её ещё раз через «📝»');
                  }
                }} />}
                note={note}
                file={{ id: note.id, name: note.title, type: note.vault.mime, url: '/vault/' + note.vault.path.split('/').map(encodeURIComponent).join('/'), size: 0, path: note.vault.path, createdAt: 0 }}
                onBack={() => step(-1)}
              />
            ) : note && target?.file && note.attachments?.some((a) => a.id === target.file) ? (
              <FileView note={note} file={note.attachments.find((a) => a.id === target.file)!} onBack={() => step(-1)} />
            ) : note ? (
              <Guard key={`${cur!.key}-${note.id}-${target!.n}`}>
              <NotePane
                note={note}
                focus={target}
                allNotes={live}
                scope={scope.get(note.id)}
                autoRecord={recordNew === note.id}
                onVoiceLeft={(vid, nid) => leftVoice.current.set(vid, nid)}
                toolsSlot={toolsSlot}
                onOpenFile={(fid, inNew) => go({ id: note.id, file: fid }, inNew)}
                vaultImport={inVault(note.id) ? { files: vault.importFiles, data: vault.importData } : undefined}
                phone={
                  note.vault && !note.vault.mime
                    ? { mode: phoneOf(note), own: note.toPhone, set: (v) => store.update(note.id, { toPhone: v ?? undefined }) }
                    : undefined
                }
                picking={!!picking && picking.tab === cur?.key}
                onDelete={() => {
                  store.remove(note.id);
                  if (cur!.pos > 0) step(-1);
                  else closeTab(cur!.key);
                }}
              />
              </Guard>
            ) : (
              <div className="dk-empty">
                <p>{loaded ? 'Откройте заметку слева или создайте новую.' : 'Поднимаю заметки…'}</p>
                <p className="muted small">Ctrl+K — поиск · Ctrl+N — новая заметка · Alt+← / Alt+→ — назад и вперёд · Ctrl+W — закрыть вкладку</p>
              </div>
            )}
          </div>
        </main>

        <aside className="dk-right">
          {/* панель инструментов открытой заметки: её рисует NotePane (createPortal) */}
          <div className="dk-tools-slot" ref={setToolsSlot} />
          <div className="dk-right-tabs">
            <button className={rightTab === 'note' ? 'on' : ''} onClick={() => setRightTab('note')}>
              Заметка
            </button>
            <button className={rightTab === 'tags' ? 'on' : ''} onClick={() => setRightTab('tags')}>
              Теги{selectedTags(sel).length ? ` · ${selectedTags(sel).length}` : ''}
            </button>
          </div>
          {rightTab === 'note' ? (
            note && <Context note={note} />
          ) : (
            <TagsPanel facets={facets} sel={sel} setSel={setSel} cards={cards} onCard={(tag) => {
              const c = cards.get(tag.toLowerCase());
              if (c) return go({ id: c.note.id });
              // карточки тегов — в облаке: название — путь тега с «/», файлом такое не назвать
              const now = Date.now();
              const id = uid();
              actions.add({ id, type: 'tag', title: tag, body: '', date: null, createdAt: now, updatedAt: now });
              go({ id });
            }} />
          )}
        </aside>
      </div>

      {dialog?.kind === 'link' && (
        <LinkPicker
          index={index}
          fromId={dialog.fromId}
          onPick={(t) => {
            dialog.resolve(t);
            setDialog(null);
          }}
          onSelectWords={(id) => {
            const tab = newTab({ id, n: ++seq });
            setTabs((list) => [...list, tab]);
            setActive(tab.key);
            setPicking({ tab: tab.key, id, resolve: dialog.resolve });
            setDialog(null);
          }}
          onClose={() => {
            dialog.resolve(null);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'comment' && (
        <CommentComposer frag={dialog.frag} onSave={(t) => saveComment(dialog.frag, t)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'set' && (
        <SetPicker index={index} frag={dialog.frag} onAdd={(id, title) => addToSet(dialog.frag, id, title)} onClose={() => setDialog(null)} />
      )}
    </KbContext.Provider>
  );
}

const STATUS: Record<BridgeStatus, string> = {
  подключаюсь: '⟳ подключаюсь к notedocal',
  загружаю: '⟳ получаю изменения',
  есть: '☁︎ сверено',
  'нет связи': '⚠︎ нет связи — правки подождут',
};

/** Левая колонка: поиск, отбор по тегам, список. */
function Sidebar({
  notes,
  scope,
  hiddenCount,
  showAll,
  setShowAll,
  topFolders,
  hiddenFolders,
  setHiddenFolders,
  status,
  activeId,
  searchRef,
  relations,
  isService,
  sel,
  setSel,
  facets,
  onOpen,
  onCreate,
  onMove,
  open,
  setOpen,
  onTreeMenu,
  vault,
  vaultErr,
  clearVaultErr,
  treeVisible,
  iconOf,
  filesOf,
  phoneOf,
  phoneBusy,
}: {
  phoneOf: (n: Note) => PhoneMode | null;
  phoneBusy: string;
  treeVisible: Set<string>;
  iconOf: (n: Note) => string;
  filesOf: Map<string, number>;
  vault: Vault;
  vaultErr: string;
  clearVaultErr: () => void;
  notes: Note[];
  /** Видимые заметки; null — показывать всё. */
  scope: Set<string> | null;
  hiddenCount: number;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  topFolders: string[];
  hiddenFolders: string[];
  setHiddenFolders: (v: string[]) => void;
  status: BridgeStatus;
  activeId?: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  relations: Relation[];
  isService: (folderId: string) => boolean;
  sel: Selection;
  setSel: (s: Selection) => void;
  facets: Facets;
  onOpen: (id: string, inNew: boolean) => void;
  onCreate: (parent: string | null, kind: 'note' | 'folder') => void;
  onMove: (id: string, from: string | null, to: string | null) => void;
  open: string[];
  setOpen: React.Dispatch<React.SetStateAction<string[]>>;
  onTreeMenu: (e: React.MouseEvent, node: { id: string; folder: boolean; parent: string | null } | null) => void;
}) {
  const kb = useKb()!;
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const isHidden = (f: string) => hiddenFolders.some((x) => x.toLowerCase() === f.toLowerCase());
  const chosen = selectedTags(sel);
  // отбор «с файлами» и порядок — запоминаются
  const [onlyFiles, setOnlyFiles] = useLocalStorage<boolean>('dk.onlyFiles', false);
  const [sortBy, setSortBy] = useLocalStorage<SortBy>('dk.sort', 'title');
  const filtering = chosen.length > 0 || onlyFiles;
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [query, sel]);

  const pool = useMemo(
    () =>
      (chosen.length
        ? facets.matching.map((id) => kb.index.byId.get(id)).filter((n): n is Note => !!n)
        : scope
          ? notes.filter((n) => scope.has(n.id))
          : notes
      ).filter((n) => !onlyFiles || filesOf.has(n.id) || !!n.vault?.mime),
    [chosen.length, facets, notes, kb.index, scope, onlyFiles, filesOf],
  );
  const found = useMemo(() => (query ? searchNotes(pool, query, shown) : null), [query, pool, shown]);
  // поиск или отбор по тегам — плоский список; иначе дерево папок
  const flat = found || filtering;
  const list = useMemo(
    () => (found ? found.hits.map((h) => h.note) : [...pool].filter((n) => n.type !== 'folder').sort(sorter(sortBy, filesOf))),
    [found, pool, sortBy, filesOf],
  );
  const hit = useMemo(() => new Map((found?.hits ?? []).map((h) => [h.note.id, h])), [found]);
  const total = found ? found.total : list.length;

  const menu = useMenu();
  const vaultMenu = (e: React.MouseEvent) =>
    menu(e, [
      { label: 'Открыть или создать папку-хранилище…', icon: '📂', run: () => void vault.choose().catch((x) => alert((x as Error).message)) },
      ...(vault.info ? [{ label: 'Показать в проводнике', icon: '🗂', run: () => vaultApi.reveal('_') /* папка этого пути — корень хранилища */ }] : []),
      'sep' as const,
      ...(vault.info?.recent ?? [])
        .filter((p) => p !== vault.info?.path)
        .map((p) => ({ label: p.replace(/^\/home\/[^/]+/, '~'), icon: '🗄', run: () => void vault.open(p).catch((x) => alert((x as Error).message)) })),
    ]);
  return (
    <aside className="dk-left">
      {native.available() && (
        <button className="dk-vault" title={vault.info?.path ?? 'Хранилище не выбрано'} onClick={vaultMenu}>
          🗄 {vault.info ? vault.info.name : 'Выбрать хранилище'} {vault.loading ? '…' : '▾'}
        </button>
      )}
      {(vaultErr || vault.error) && (
        <div className="dk-msg small" onClick={clearVaultErr} title="Скрыть">
          {vaultErr || vault.error}
        </div>
      )}
      <div className="dk-left-head">
        <input
          ref={searchRef}
          className="dk-search"
          type="search"
          dir="auto"
          placeholder="🔍 Поиск (Ctrl+K)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && found && list[0]) onOpen(list[0].id, e.ctrlKey);
            if (e.key === 'Escape') setQ('');
          }}
        />
        <button className="dk-icon" title="Новая заметка (Ctrl+N)" onClick={() => onCreate(null, 'note')}>
          ✎
        </button>
      </div>
      {filtering && (
        <div className="dk-chosen">
          {chosen.map((t) => (
            <button key={t} className="kb-tag" title="Убрать из отбора" onClick={() => setSel(toggleTag(sel, t))}>
              #{t} ×
            </button>
          ))}
          <button className="link-btn small" onClick={() => setSel(new Map())}>
            сбросить
          </button>
        </div>
      )}
      <div className="dk-filters">
        <button className={`dk-chip ${onlyFiles ? 'on' : ''}`} title="Только заметки с файлами и сами файлы" onClick={() => setOnlyFiles(!onlyFiles)}>
          📎 с файлами
        </button>
        <select className="dk-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} title="Порядок в дереве и списке">
          <option value="title">↕ по названию</option>
          <option value="updated">↕ сначала свежие</option>
          <option value="files">↕ больше файлов</option>
        </select>
      </div>
      {flat ? (
        <>
          <div className="dk-count muted small">{found ? `найдено: ${total}` : onlyFiles && !chosen.length ? `с файлами: ${total}` : `отобрано: ${total}`}</div>
          <div className="dk-list">
            {list.slice(0, shown).map((n) => {
              const h = hit.get(n.id);
              const t = n.type ?? 'note';
              return (
                <button
                  key={n.id}
                  className={`dk-row ${n.id === activeId ? 'on' : ''}`}
                  onClick={(e) => onOpen(n.id, e.ctrlKey || e.metaKey)}
                  onAuxClick={(e) => e.button === 1 && onOpen(n.id, true)}
                  dir="auto"
                >
                  <span className="dk-row-title">
                    {t !== 'note' && <span className={`type-badge type-${t}`}>{TYPE_BADGE[t]}</span>}
                    {n.title || 'Без названия'}
                    {filesOf.get(n.id) ? <span className="dk-files-badge" title="Файлов в заметке">📎{filesOf.get(n.id)}</span> : null}
                  </span>
                  {h?.snippet && (
                    <span className="dk-snippet">
                      <Marked text={h.snippet} marks={h.marks} />
                    </span>
                  )}
                </button>
              );
            })}
            {total > shown && (
              <button className="btn btn-small dk-more" onClick={() => setShown((x) => x + PAGE)}>
                Ещё {total - shown}
              </button>
            )}
          </div>
        </>
      ) : (
        <FolderTree
          notes={notes}
          relations={relations}
          visible={treeVisible}
          iconOf={iconOf}
          filesOf={filesOf}
          phoneOf={phoneOf}
          sortBy={sortBy}
          isService={isService}
          activeId={activeId}
          onOpen={onOpen}
          onCreate={onCreate}
          onMove={onMove}
          open={open}
          setOpen={setOpen}
          onMenu={onTreeMenu}
        />
      )}
      <div className="dk-scope small">
        <label title="Здоровье, документы, контакты, места, пароли — то, что заводит секретарь">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> показать служебное
          {!showAll && hiddenCount > 0 ? <span className="muted"> · скрыто {hiddenCount}</span> : null}
        </label>
        <button className={`dk-icon ${foldersOpen ? 'on' : ''}`} title="Какие папки — служебные" onClick={() => setFoldersOpen((v) => !v)}>
          ⚙
        </button>
      </div>
      {foldersOpen && (
        <div className="dk-folders small">
          <div className="muted">Служебные папки — их заметки не видны в Базе:</div>
          {topFolders.map((f) => (
            <label key={f}>
              <input
                type="checkbox"
                checked={isHidden(f)}
                onChange={(e) =>
                  setHiddenFolders(e.target.checked ? [...hiddenFolders, f] : hiddenFolders.filter((x) => x.toLowerCase() !== f.toLowerCase()))
                }
              />{' '}
              {f}
            </label>
          ))}
          <div className="muted">Отдельную заметку можно показать или спрятать кнопкой 👁 у неё самой.</div>
        </div>
      )}
      <div className="dk-status small muted">
        {STATUS[status]}
        {phoneBusy ? ` · 📱 ${phoneBusy}` : ''}
      </div>
    </aside>
  );
}

/** Вкладка «Теги» справа: дерево по фасетам с числами; галочка — в отбор (список — слева). */
function TagsPanel({
  facets,
  sel,
  setSel,
  cards,
  onCard,
}: {
  facets: Facets;
  sel: Selection;
  setSel: (s: Selection) => void;
  cards: ReturnType<typeof tagCards>;
  onCard: (tag: string) => void;
}) {
  const kb = useKb()!;
  const [q, setQ] = useState('');
  const found = q.trim() ? searchTags(kb.index, cards, q) : [];
  const rename = (tag: string) => {
    const next = prompt(`Новое имя тега «${tag}».\nЕсли такой тег уже есть — теги сольются.`, tag);
    if (next && normTag(next).toLowerCase() !== tag.toLowerCase()) kb.renameTag(tag, normTag(next));
  };
  return (
    <div className="dk-tags-panel">
      <input className="dk-search" placeholder="🔍 тег или синоним…" value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
      {found.length > 0 && (
        <div className="dk-chosen">
          {found.map((t) => (
            <button
              key={t}
              className="kb-tag"
              onClick={() => {
                setSel(toggleTag(sel, t));
                setQ('');
              }}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
      {facets.facets.length === 0 && <p className="muted small">Тегов пока нет. Тег ставится в шапке заметки или в тексте: #тема/фикх</p>}
      {facets.facets.map(({ facet, values }) => (
        <section key={facet || '—'}>
          <h4>{facet === OTHER ? 'прочее' : facet}</h4>
          <TagTree nodes={values} sel={sel} onToggle={(t) => setSel(toggleTag(sel, t))} onCard={onCard} onRename={rename} />
        </section>
      ))}
    </div>
  );
}

function Marked({ text, marks }: { text: string; marks: [number, number][] }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  marks.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={i}>{text.slice(s, e)}</mark>);
    at = e;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

/** Правая колонка: оглавление, кто ссылается сюда, комментарии. */
function Context({ note }: { note: Note }) {
  const kb = useKb()!;
  const [anchor, setAnchor] = useState('');
  useEffect(() => setAnchor(''), [note.id]);
  const headings = kb.index.parsed.get(note.id)?.headings ?? [];
  const comments = useCommentRefs(note.id);
  const anchors = kb.index.parsed.get(note.id)?.anchors;
  return (
    <div className="dk-context">
      {headings.length > 0 && (
        <section>
          <h4>Оглавление</h4>
          {headings.map((h, i) => (
            <button
              key={i}
              className="dk-outline"
              style={{ paddingInlineStart: (h.level - 1) * 12 + 4 }}
              onClick={() => kb.open({ id: note.id, heading: h.text })}
              dir="auto"
            >
              {h.text}
            </button>
          ))}
        </section>
      )}
      {comments.length > 0 && (
        <section>
          <h4>Комментарии · {comments.length}</h4>
          {comments.map((r, i) => {
            const c = kb.index.byId.get(r.from);
            const frag = r.anchor ? anchors?.get(r.anchor)?.map((p) => p.text).join(' … ') : r.heading;
            return (
              <button key={`${r.from}-${i}`} className="dk-comment" onClick={() => kb.open({ id: r.from })} dir="auto">
                {frag && <span className="dk-comment-frag">«{frag.slice(0, 80)}»</span>}
                <span>{(c?.body ?? '').slice(0, 240) || 'пусто'}</span>
              </button>
            );
          })}
        </section>
      )}
      <Backlinks noteId={note.id} anchor={anchor} setAnchor={setAnchor} />
    </div>
  );
}

const ICONS = ['📕', '📗', '📘', '📙', '📜', '📖', '🕌', '📿', '⭐', '💡', '❗', '❓', '🔖', '🧩', '🗂', '📝'];

/** Шапка файла хранилища: иконка, теги, свойства — в его карточку (`X.md` рядом). */
function CardBar({ file, card, onPatch, onOpenCard }: { file: Note; card?: Note; onPatch: (p: Partial<Note>) => void; onOpenCard: () => void }) {
  const menu = useMenu();
  const [tag, setTag] = useState('');
  const tags = card?.tags ?? [];
  const icon = (card?.props?.icon as string) || '';
  const add = () => {
    const t = tag.trim().replace(/^#/, '').replace(/\s+/g, '-');
    setTag('');
    if (t && !tags.includes(t)) onPatch({ tags: [...tags, t] });
  };
  return (
    <div className="dk-cardbar" dir="auto">
      <button
        className="dk-icon"
        title="Иконка файла"
        onClick={(e) =>
          menu(e, [
            ...ICONS.map((i) => ({ label: i, icon: i, run: () => onPatch({ props: { ...(card?.props ?? {}), icon: i } }) })),
            'sep' as const,
            { label: 'Своя…', icon: '✏️', run: () => { const i = prompt('Иконка (любой значок)', icon)?.trim(); if (i) onPatch({ props: { ...(card?.props ?? {}), icon: i } }); } },
            { label: 'Без своей иконки', icon: '✕', run: () => { const { icon: _i, ...rest } = card?.props ?? {}; void _i; onPatch({ props: rest }); }, disabled: !icon },
          ])
        }
      >
        {icon || '🙂'}
      </button>
      {tags.map((t) => (
        <span key={t} className="kb-tag">
          #{t}
          <button className="tag-x" title="Убрать тег" onClick={() => onPatch({ tags: tags.filter((x) => x !== t) })}>
            ×
          </button>
        </span>
      ))}
      <input className="dk-tag-input" list="dk-tag-names" placeholder="+ тег" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} onBlur={() => tag.trim() && add()} />
      {card && <PropsView note={card} />}
      <span className="dk-spacer" />
      <button className="dk-tool wide" title="Карточка файла: свойства, заметки о нём (обычная заметка рядом с ним)" onClick={onOpenCard}>
        📝 {card ? 'Карточка' : 'Завести карточку'}
      </button>
      <span className="muted small">{file.vault?.path}</span>
    </div>
  );
}

export type SortBy = 'title' | 'updated' | 'files';
/** Порядок заметок: по названию, по свежести, по числу файлов (поровну — по названию). */
export function sorter(by: SortBy, filesOf: Map<string, number>) {
  const t = (a: Note, b: Note) => (a.title || '').localeCompare(b.title || '', 'ru');
  if (by === 'updated') return (a: Note, b: Note) => b.updatedAt - a.updatedAt || t(a, b);
  if (by === 'files') return (a: Note, b: Note) => (filesOf.get(b.id) ?? 0) - (filesOf.get(a.id) ?? 0) || t(a, b);
  return t;
}
