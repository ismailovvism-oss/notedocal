// Окно «База» — база знаний на компьютере (docs/ЗАМЕТКИ.md, раздел 10). Живёт внутри настольной
// программы ~/projects/apps/zametki (baza.py), данные — через мост секретаря (./bridge.ts).
//
// Раскладка как в Obsidian, без всплывающих окон: слева поиск и дерево папок (./Tree.tsx); в середине
// вкладки с открытыми заметками (у каждой — история «назад/вперёд»), заметка сразу правится;
// справа две вкладки — «Заметка» (оглавление, комментарии, кто ссылается сюда) и «Теги» (отбор). Ядро (src/lib/kb) и редактор — те же,
// что у приложения на телефоне.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, Relation } from '../types';
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
import { NotePane, type PaneFocus } from './NotePane';
import { useBridgeSync, type BridgeStatus } from './bridge';
import { Guard } from './Guard';
import { native } from './native';
import { MenuHost, useMenu, type MenuItem } from './Menu';
import { FileView, fileIcon } from './FileView';

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
  const live = useMemo(() => visible(notes), [notes]);
  const index = useMemo(() => buildIndex(live), [live]);
  useEffect(() => {
    const t = setTimeout(() => void persistParse(), 2000);
    return () => clearTimeout(t);
  }, [index]);
  const actions = useListActions(setNotes);

  // Рабочее и служебное (src/lib/kb/scope.ts): хозяйство — здоровье, документы, контакты —
  // в списке, поиске и тегах не видно, пока не включено «показать служебное»
  const [hiddenFolders, setHiddenFolders] = useLocalStorage<string[]>('dk.hiddenFolders', SERVICE_FOLDERS);
  const [showAll, setShowAll] = useLocalStorage<boolean>('dk.showAll', false);
  const folders = useMemo(() => folderTitles(relations, index.byId), [relations, index]);
  const scope = useMemo(() => {
    const why = new Map<string, ScopeWhy>();
    for (const n of live) why.set(n.id, scopeOf(n, folders.get(n.id), hiddenFolders));
    return why;
  }, [live, folders, hiddenFolders]);
  const shown = useMemo(() => new Set([...scope].filter(([, w]) => w.shown).map(([id]) => id)), [scope]);
  // папки верхнего уровня — их можно прятать и показывать
  const topFolders = useMemo(() => {
    const hasParent = new Set(relations.filter((r) => !r.deleted && r.type === 'child').map((r) => r.to));
    return live.filter((n) => n.type === 'folder' && !hasParent.has(n.id)).map((n) => n.title).filter(Boolean).sort();
  }, [live, relations]);

  const isService = useCallback(
    (fid: string) => {
      const hidden = new Set(hiddenFolders.map((x) => x.trim().toLowerCase()));
      return [index.byId.get(fid)?.title ?? '', ...(folders.get(fid) ?? [])].some((t) => hidden.has(t.trim().toLowerCase()));
    },
    [index, folders, hiddenFolders],
  );
  const relActions = useListActions(setRelations);
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
        const byId = new Map(patches.map((p) => [p.id, p]));
        const now = Date.now();
        setNotes((list) =>
          list.map((n) => {
            const p = byId.get(n.id);
            if (!p) return n;
            return { ...n, ...(p.body !== undefined ? { body: p.body } : {}), ...(p.props ? { props: p.props } : {}), updatedAt: now };
          }),
        );
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
        const byId = new Map(patches.map((p) => [p.id, p]));
        const now = Date.now();
        setNotes((list) =>
          list.map((n) => {
            const p = byId.get(n.id);
            if (!p) return n;
            const { id: _id, ...rest } = p;
            void _id;
            return { ...n, ...rest, updatedAt: now };
          }),
        );
        return patches.length;
      },
      openTag: (tag) => {
        setSel(toggleTag(new Map(), normTag(tag)));
        setRightTab('tags');
      },
      updateNote: (id, patch) => actions.update(id, patch),
      removeNote: (id) => actions.remove(id),
    }),
    [index, actions, setNotes, picking, live, go, setTabs, setActive, setRightTab],
  );

  function freeTitle(base: string) {
    let t = base;
    for (let i = 2; index.byName.has(t.toLowerCase()); i++) t = `${base} (${i})`;
    return t;
  }
  function saveComment(frag: KbFragment, text: string) {
    const now = Date.now();
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
      setNotes((list) =>
        list.map((n) => (n.id === setId ? { ...n, body: (n.body.trimEnd() ? n.body.trimEnd() + '\n\n' : '') + embed, updatedAt: now } : n)),
      );
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
    const now = Date.now();
    const id = uid();
    actions.add({ id, title: name, body: '', type: 'folder', date: null, createdAt: now, updatedAt: now });
    linkTo(parent, id, now);
  }
  /** Перенести заметку или папку из папки from в to (null — корень). */
  function move(id: string, from: string | null, to: string | null) {
    if (from === to) return;
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

  // --- быстрые заметки: ★ и кнопка на микрофоне (команды окна, ./native.ts) ---
  const [recordNew, setRecordNew] = useState<string | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  /** Новая заметка в папке «Быстрые заметки» (нет такой — завести). */
  function quickNote(record: boolean) {
    const folder = live.find((n) => n.type === 'folder' && n.title.trim().toLowerCase() === 'быстрые заметки');
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
        setNotes((list) =>
          list.map((n) => {
            if (n.id !== nid || !n.body?.includes(mark)) return n;
            const body =
              e.event === 'text'
                ? n.body.replace(mark, `${e.text ? e.text + ' ' : ''}${mark}`)
                : n.body.replace(` ${mark}`, '').replace(mark, '');
            return { ...n, body, updatedAt: Date.now() };
          }),
        );
        if (e.event === 'done') leftVoice.current.delete(e.id);
      }),
    [setNotes],
  );

  // пустая новая заметка, с которой ушли, не нужна: ★ без единого слова не оставляет мусора
  const madeHere = useRef(new Set<string>());
  const prevNote = useRef<string | undefined>(undefined);

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
    actions.update(id, { title: t });
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
    if (node.folder) {
      return menu(e, [
        { label: 'Новая заметка здесь', icon: '✎', run: () => createNote(false, n.id) },
        { label: 'Новая подпапка', icon: '📁', run: () => createFolder(n.id) },
        'sep',
        ...common,
        { label: 'Открыть папку как заметку', icon: '📄', run: () => go({ id: n.id }) },
        'sep',
        {
          label: 'Удалить папку',
          icon: '🗑',
          danger: true,
          run: () => {
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
      {
        label: hidden ? 'Показывать в Базе' : 'Спрятать из Базы',
        icon: hidden ? '👁' : '🙈',
        run: () => actions.update(n.id, { inBase: hidden }),
      },
      'sep',
      {
        label: 'Удалить',
        icon: '🗑',
        danger: true,
        run: () => confirm(`Удалить «${n.title || 'Без названия'}»?`) && actions.remove(n.id),
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
  const indexRef = useRef(index);
  indexRef.current = index;
  const note = target ? byId.get(target.id) : undefined;
  noteRef.current = note?.id;
  useEffect(() => {
    const prev = prevNote.current;
    prevNote.current = note?.id;
    if (!prev || prev === note?.id || !madeHere.current.has(prev)) return;
    // ушли — и в ней ни названия, ни текста, ни тегов: убрать (диктовка ещё идёт — оставить).
    // Смотрим свежий указатель: последнее несохранённое уходит в базу как раз при уходе.
    const t = setTimeout(() => {
      const m = indexRef.current.byId.get(prev);
      if (m && !m.title.trim() && !(m.body ?? '').trim() && !(m.tags ?? []).length) {
        madeHere.current.delete(prev);
        actions.remove(prev);
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
          relations={relations}
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
                    <span className="dk-tab-title">{f ? `${fileIcon(f)} ${f.name}` : n?.title || 'Без названия'}</span>
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
            {note && target?.file && note.attachments?.some((a) => a.id === target.file) ? (
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
                picking={!!picking && picking.tab === cur?.key}
                onDelete={() => {
                  actions.remove(note.id);
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
}: {
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
  const filtering = chosen.length > 0;
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [query, sel]);

  const pool = useMemo(
    () =>
      filtering
        ? facets.matching.map((id) => kb.index.byId.get(id)).filter((n): n is Note => !!n)
        : scope
          ? notes.filter((n) => scope.has(n.id))
          : notes,
    [filtering, facets, notes, kb.index, scope],
  );
  const found = useMemo(() => (query ? searchNotes(pool, query, shown) : null), [query, pool, shown]);
  // поиск или отбор по тегам — плоский список; иначе дерево папок
  const flat = found || filtering;
  const list = useMemo(
    () => (found ? found.hits.map((h) => h.note) : [...pool].filter((n) => n.type !== 'folder').sort((a, b) => b.updatedAt - a.updatedAt)),
    [found, pool],
  );
  const hit = useMemo(() => new Map((found?.hits ?? []).map((h) => [h.note.id, h])), [found]);
  const total = found ? found.total : list.length;

  return (
    <aside className="dk-left">
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
      {flat ? (
        <>
          <div className="dk-count muted small">{found ? `найдено: ${total}` : `по тегам: ${total}`}</div>
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
          visible={scope}
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
      <div className="dk-status small muted">{STATUS[status]}</div>
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
