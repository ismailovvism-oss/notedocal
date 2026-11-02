// Окно «База» — база знаний на компьютере (docs/ЗАМЕТКИ.md, раздел 10). Живёт внутри настольной
// программы ~/projects/apps/zametki (baza.py), данные — через мост секретаря (./bridge.ts).
//
// Раскладка как в Obsidian, без всплывающих окон: слева поиск, отбор по тегам и список; в середине
// вкладки с открытыми заметками (у каждой — история «назад/вперёд»), заметка сразу правится;
// справа — оглавление, кто ссылается сюда и комментарии. Ядро (src/lib/kb) и редактор — те же,
// что у приложения на телефоне.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, Relation } from '../types';
import { uid, useListActions, useLocalStorage, visible } from '../lib/storage';
import { persistParse, useNotesStore } from '../lib/notesStore';
import { buildIndex, planRename } from '../lib/kb/index';
import { KbContext, useCommentRefs, useKb, type KbApi, type KbFragment, type KbPicked } from '../lib/kb/ui';
import { planTagRename, computeFacets, searchTags, tagCards, toggleTag, type Selection } from '../lib/kb/tags';
import { normTag } from '../lib/kb/syntax';
import { linkText } from '../lib/kb/edit';
import { searchNotes } from '../lib/kb/search';
import { SERVICE_FOLDERS, folderTitles, scopeOf, type ScopeWhy } from '../lib/kb/scope';
import { TYPE_BADGE } from '../lib/noteTypes';
import { FacetBar } from '../components/Facets';
import { Backlinks } from '../components/Backlinks';
import { CommentComposer, LinkPicker, SetPicker } from '../components/KbDialogs';
import { NotePane, type PaneFocus } from './NotePane';
import { useBridgeSync, type BridgeStatus } from './bridge';
import { Guard } from './Guard';

interface Target extends PaneFocus {
  id: string;
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
  const [focusTag, setFocusTag] = useState<{ tag: string; n: number } | null>(null);

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
      openTag: (tag) => setFocusTag((f) => ({ tag, n: (f?.n ?? 0) + 1 })),
      updateNote: (id, patch) => actions.update(id, patch),
      removeNote: (id) => actions.remove(id),
    }),
    [index, actions, setNotes, picking, live, go, setTabs, setActive],
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
  function createNote(inNew = false) {
    const now = Date.now();
    const id = uid();
    actions.add({ id, title: '', body: '', type: 'note', date: null, createdAt: now, updatedAt: now });
    go({ id }, inNew);
    setTimeout(() => document.querySelector<HTMLInputElement>('.dk-title')?.focus(), 50);
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
          focusTag={focusTag}
          onOpen={(id, inNew) => go({ id }, inNew)}
          onCreate={() => createNote()}
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
                return (
                  <div
                    key={t.key}
                    className={`dk-tab ${t.key === cur?.key ? 'on' : ''}`}
                    onClick={() => setActive(t.key)}
                    onAuxClick={(e) => e.button === 1 && closeTab(t.key)}
                    title={n?.title}
                  >
                    <span className="dk-tab-title">{n?.title || 'Без названия'}</span>
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
            {note ? (
              <Guard key={`${cur!.key}-${note.id}-${target!.n}`}>
              <NotePane
                note={note}
                focus={target}
                allNotes={live}
                scope={scope.get(note.id)}
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

        <aside className="dk-right">{note && <Context note={note} />}</aside>
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
  focusTag,
  onOpen,
  onCreate,
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
  focusTag: { tag: string; n: number } | null;
  onOpen: (id: string, inNew: boolean) => void;
  onCreate: () => void;
}) {
  const kb = useKb()!;
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const cards = useMemo(() => tagCards(notes), [notes]);
  const [sel, setSel] = useState<Selection>(new Map());
  useEffect(() => {
    if (focusTag) setSel(toggleTag(new Map(), normTag(focusTag.tag)));
  }, [focusTag]);
  const facets = useMemo(() => computeFacets(kb.index, cards, sel, scope ?? undefined), [kb.index, cards, sel, scope]);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const isHidden = (f: string) => hiddenFolders.some((x) => x.toLowerCase() === f.toLowerCase());
  const filtering = [...sel.values()].some((s) => s.size);
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
            if (e.key === 'Enter' && list[0]) onOpen(list[0].id, e.ctrlKey);
          }}
        />
        <button className="dk-icon" title="Новая заметка (Ctrl+N)" onClick={onCreate}>
          ✎
        </button>
      </div>
      <FacetBar facets={facets.facets} sel={sel} setSel={setSel} search={(s) => searchTags(kb.index, cards, s)} />
      <div className="dk-count muted small">
        {found ? `найдено: ${total}` : filtering ? `по тегам: ${total}` : `заметок: ${total}`}
      </div>
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
