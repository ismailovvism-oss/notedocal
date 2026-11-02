import { useEffect, useMemo, useState } from 'react';
import type { Note, NoteType, Relation } from '../types';
import { uid, useListActions } from '../lib/storage';
import { getChildren, getParents } from '../lib/relations';
import { TYPE_BADGE } from '../lib/noteTypes';
import { NoteModal } from './NotesView';
import { useKb } from '../lib/kb/ui';
import { OTHER, computeFacets, searchTags, tagCards, toggleTag, type Selection } from '../lib/kb/tags';
import { normTag } from '../lib/kb/syntax';
import { FacetBar, TagTree } from './Facets';

interface Props {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
  /** Перейти к тегу (нажали тег в тексте заметки): отбор по нему. `n` меняется на каждый переход. */
  focusTag?: { tag: string; n: number } | null;
}

// Текущий вид центра: корень структуры или узел-папка (по трейлу). Отбор по тегам — поверх.
type View = { kind: 'root' } | { kind: 'node'; trail: string[] };

const isNarrow = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 759px)').matches;

export function NotesExplorer({ notes, setNotes, relations, setRelations, focusTag }: Props) {
  const notesActions = useListActions(setNotes);
  const relActions = useListActions(setRelations);

  const [view, setView] = useState<View>({ kind: 'root' });
  const [editing, setEditing] = useState<Note | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [leftClosed, setLeftClosed] = useState(isNarrow);
  const [rightClosed, setRightClosed] = useState(true);
  // Прятать теги / папки из центрального списка, чтобы он не загромождался.
  const [hideTags, setHideTags] = useState(false);
  const [hideFolders, setHideFolders] = useState(false);

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  // Теги и фасеты (src/lib/kb/tags.ts): отбор по тегам поверх папок
  const kb = useKb();
  const cards = useMemo(() => tagCards(notes), [notes]);
  const [sel, setSel] = useState<Selection>(new Map());
  const facets = useMemo(() => (kb ? computeFacets(kb.index, cards, sel) : { facets: [], matching: [] }), [kb, cards, sel]);
  const filtering = [...sel.values()].some((s) => s.size);
  useEffect(() => {
    if (!focusTag) return;
    setEditing(null);
    setSel(toggleTag(new Map(), normTag(focusTag.tag)));
  }, [focusTag]);

  /** Карточка тега: есть — открыть, нет — завести. */
  function openCard(tag: string) {
    const c = cards.get(tag.toLowerCase());
    if (c) return setEditing(c.note);
    const now = Date.now();
    const note: Note = { id: uid(), type: 'tag', title: tag, body: '', date: null, createdAt: now, updatedAt: now };
    notesActions.add(note);
    setEditing(note);
  }
  /** Переименовать или слить тег во всех заметках. */
  function renameTag(tag: string) {
    const next = prompt(`Новое имя тега «${tag}».\nЕсли такой тег уже есть — теги сольются.`, tag);
    if (!kb || !next || normTag(next).toLowerCase() === tag.toLowerCase()) return;
    if (kb.renameTag(tag, normTag(next)) === 0 && !notes.some((n) => n.type === 'tag' && n.title.toLowerCase() === tag.toLowerCase())) {
      alert('Этим тегом ничего не помечено.');
    }
    setSel(new Map());
  }
  const typeOf = (n?: Note): NoteType => (n?.type ?? 'note');

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cmp = (a: Note, b: Note) => {
    const af = typeOf(a) === 'folder' ? 0 : 1;
    const bf = typeOf(b) === 'folder' ? 0 : 1;
    if (af !== bf) return af - bf;
    return (a.title || '').localeCompare(b.title || '');
  };

  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((n): n is Note => !!n);

  const folderChildrenOf = (id: string) =>
    getChildren(id, relations).filter((cid) => typeOf(byId.get(cid)) !== 'tag');

  const folderRoots = useMemo(
    () =>
      notes
        .filter((n) => typeOf(n) !== 'tag' && getParents(n.id, relations).length === 0)
        .sort(cmp),
    [notes, relations],
  );
  // --- Что показывает центр ---
  const trail = view.kind === 'node' ? view.trail : [];
  const curId = view.kind === 'node' ? trail[trail.length - 1] : null;
  const curNote = curId ? byId.get(curId) : undefined;

  let items: Note[];
  if (filtering) {
    items = resolve(facets.matching).sort((a, b) => b.updatedAt - a.updatedAt);
  } else if (curId) {
    items = resolve(getChildren(curId, relations)).sort(cmp);
  } else {
    items = folderRoots;
  }
  const visibleItems = items.filter(
    (n) =>
      !(hideTags && typeOf(n) === 'tag') && !(hideFolders && typeOf(n) === 'folder'),
  );

  function createChild(type: NoteType) {
    const now = Date.now();
    const id = uid();
    const note: Note = { id, title: '', body: '', type, date: null, createdAt: now, updatedAt: now };
    notesActions.add(note);
    if (curId) {
      relActions.add({
        id: uid(),
        from: curId,
        to: id,
        type: 'child',
        position: items.length,
        createdAt: now,
        updatedAt: now,
      });
    }
    setEditing(note);
  }

  function saveNote(
    patch: Pick<
      Note,
      | 'title'
      | 'body'
      | 'date'
      | 'type'
      | 'attachments'
      | 'phone'
      | 'contacts'
      | 'address'
      | 'locationId'
      | 'category'
      | 'docNumber'
      | 'expires'
      | 'usedIn'
    >,
  ) {
    if (!editing) return;
    // Сохраняем, но окно не закрываем — модалка сама переходит в отображение.
    notesActions.update(editing.id, { ...patch, updatedAt: Date.now() });
  }

  const activeFolder = view.kind === 'node' ? curId : null;

  return (
    <section className="view ne">
      <div className="view-head">
        <h2>Заметки</h2>
      </div>

      {/* Панель управления: боковые деревья + фильтры центра + задел под фасеты/MOC */}
      <div className="ne-facets">
        <span className="ne-facets-group" title="Боковые деревья">
          <span className="ne-facets-ic" aria-hidden>🌳</span>
          <button
            className={`ne-chip ne-ic ${!leftClosed ? 'on' : ''}`}
            onClick={() => setLeftClosed((v) => !v)}
            title="Дерево папок"
            aria-label="Дерево папок"
          >
            🗂
          </button>
          <button
            className={`ne-chip ne-ic ${!rightClosed ? 'on' : ''}`}
            onClick={() => setRightClosed((v) => !v)}
            title="Дерево тегов"
            aria-label="Дерево тегов"
          >
            🏷
          </button>
        </span>
        <span className="ne-facets-group" title="Скрыть из центрального списка">
          <span className="ne-facets-ic" aria-hidden>📋</span>
          <button
            className={`ne-chip ne-ic ne-hide ${hideFolders ? 'off' : ''}`}
            onClick={() => setHideFolders((v) => !v)}
            title="Скрыть папки из списка"
            aria-label="Скрыть папки из списка"
          >
            🗂
          </button>
          <button
            className={`ne-chip ne-ic ne-hide ${hideTags ? 'off' : ''}`}
            onClick={() => setHideTags((v) => !v)}
            title="Скрыть теги из списка"
            aria-label="Скрыть теги из списка"
          >
            🏷
          </button>
        </span>
        <span className="ne-facets-spacer" />
      </div>

      {kb && (
        <FacetBar
          facets={facets.facets}
          sel={sel}
          setSel={setSel}
          search={(q) => searchTags(kb.index, cards, q)}
        />
      )}

      <div className="ne-3">
        <TreePanel
          title="Папки"
          roots={folderRoots}
          childrenOf={folderChildrenOf}
          byId={byId}
          relations={relations}
          activeId={activeFolder}
          collapsed={leftClosed}
          onToggleCollapse={() => setLeftClosed((v) => !v)}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          onSelect={(t) => setView({ kind: 'node', trail: t })}
        />

        <div className="ne-main">
          <div className="ne-crumbs">
            <button className="ne-crumb" onClick={() => setView({ kind: 'root' })}>
              Все
            </button>
            {filtering && (
              <>
                <span className="ne-sep">/</span>
                <span className="ne-crumb ne-crumb-cur">отбор по тегам · {items.length}</span>
              </>
            )}
            {!filtering && view.kind === 'node' &&
              trail.map((id, i) => (
                <span key={id}>
                  <span className="ne-sep">/</span>
                  <button
                    className="ne-crumb"
                    onClick={() => setView({ kind: 'node', trail: trail.slice(0, i + 1) })}
                  >
                    {byId.get(id)?.title || '…'}
                  </button>
                </span>
              ))}
          </div>

          {curNote && !filtering && (
            <div className="ne-cur">
              {typeOf(curNote) !== 'note' && (
                <span className={`type-badge type-${typeOf(curNote)}`}>{TYPE_BADGE[typeOf(curNote)]}</span>
              )}
              <span className="ne-cur-title">{curNote.title || 'Без названия'}</span>
              <button className="icon-btn" onClick={() => setEditing(curNote)} aria-label="Открыть">
                ✎
              </button>
            </div>
          )}

          <div className="ne-list">
            {visibleItems.length === 0 ? (
              <p className="muted small ne-empty">
                {filtering
                  ? 'Под такой отбор ничего не подходит.'
                  : items.length > 0
                    ? 'Всё скрыто фильтрами.'
                    : 'Пусто.'}
              </p>
            ) : (
              visibleItems.map((n) => (
                <Row
                  key={n.id}
                  note={n}
                  typeOf={typeOf}
                  relations={relations}
                  onOpen={() => setEditing(n)}
                  onEnter={filtering ? undefined : () => setView({ kind: 'node', trail: [...trail, n.id] })}
                />
              ))
            )}
          </div>

          {!filtering && (
            <div className="ne-add">
              <button className="btn btn-small" onClick={() => createChild('note')}>
                ＋ Заметка
              </button>
              <button className="btn btn-small" onClick={() => createChild('folder')}>
                ＋ Папка
              </button>
            </div>
          )}
        </div>

        {!rightClosed && (
          <aside className="ne-panel ne-tags">
            <button className="ne-panel-head" onClick={() => setRightClosed(true)} title="Свернуть">
              <span className="ne-panel-title">Теги</span>
              <span className="ne-panel-chev">✕</span>
            </button>
            <div className="ne-panel-body">
              {facets.facets.length === 0 && <span className="muted small">тегов пока нет</span>}
              {facets.facets.map(({ facet, values }) => (
                <div key={facet || '—'} className="tag-facet">
                  <div className="tag-facet-head">{facet === OTHER ? 'прочее' : facet}</div>
                  <TagTree
                    nodes={values}
                    sel={sel}
                    onToggle={(t) => setSel(toggleTag(sel, t))}
                    onCard={openCard}
                    onRename={renameTag}
                  />
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      {editing && (
        <NoteModal
          note={editing}
          allNotes={notes}
          relations={relations}
          setRelations={setRelations}
          onSave={saveNote}
          onDelete={() => {
            notesActions.remove(editing.id);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function Row({
  note,
  typeOf,
  relations,
  onOpen,
  onEnter,
}: {
  note: Note;
  typeOf: (n?: Note) => NoteType;
  relations: Relation[];
  onOpen: () => void;
  onEnter?: () => void;
}) {
  const kids = getChildren(note.id, relations).length;
  const parents = getParents(note.id, relations).length;
  const container = !!onEnter && (typeOf(note) === 'folder' || kids > 0);
  const t = typeOf(note);
  return (
    <div className="ne-row">
      <button className="ne-row-main" onClick={container ? onEnter : onOpen}>
        {t !== 'note' && <span className={`type-badge type-${t}`}>{TYPE_BADGE[t]}</span>}
        <span className="ne-title">{note.title || 'Без названия'}</span>
        {parents > 1 && (
          <span className="ne-multi" title="Несколько родителей">
            ⧉{parents}
          </span>
        )}
        {kids > 0 && <span className="ne-count">{kids}</span>}
        {container && <span className="ne-chev">›</span>}
      </button>
      <button className="icon-btn" onClick={onOpen} aria-label="Открыть">
        ✎
      </button>
    </div>
  );
}

function TreePanel({
  title,
  roots,
  childrenOf,
  byId,
  relations,
  activeId,
  collapsed,
  onToggleCollapse,
  expanded,
  onToggleExpand,
  onSelect,
}: {
  title: string;
  roots: Note[];
  childrenOf: (id: string) => string[];
  byId: Map<string, Note>;
  relations: Relation[];
  activeId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (trail: string[]) => void;
}) {
  if (collapsed) return null;
  return (
    <aside className="ne-panel">
      <button className="ne-panel-head" onClick={onToggleCollapse} title="Свернуть">
        <span className="ne-panel-title">{title}</span>
        <span className="ne-panel-chev">✕</span>
      </button>
      <div className="ne-panel-body">
        {roots.length === 0 ? (
          <span className="muted small">пусто</span>
        ) : (
          roots.map((r) => (
              <TreeNode
                key={r.id}
                id={r.id}
                trail={[]}
                childrenOf={childrenOf}
                byId={byId}
                relations={relations}
                activeId={activeId}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                onSelect={onSelect}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function TreeNode({
  id,
  trail,
  childrenOf,
  byId,
  relations,
  activeId,
  expanded,
  onToggleExpand,
  onSelect,
}: {
  id: string;
  trail: string[];
  childrenOf: (id: string) => string[];
  byId: Map<string, Note>;
  relations: Relation[];
  activeId: string | null;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (trail: string[]) => void;
}) {
  const note = byId.get(id);
  if (!note) return null;
  const cyclic = trail.includes(id);
  const kids = cyclic ? [] : childrenOf(id);
  const isOpen = expanded.has(id);
  const parents = getParents(id, relations).length;

  return (
    <div className="tree-node">
      <div className="tree-row">
        {kids.length > 0 ? (
          <button className="tree-toggle" onClick={() => onToggleExpand(id)}>
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-spacer" />
        )}
        <button
          className={`tree-label ${activeId === id ? 'active' : ''}`}
          onClick={() => onSelect([...trail, id])}
        >
          {note.title || 'Без названия'}
          {parents > 1 && <span className="ne-multi"> ⧉</span>}
          {cyclic && <span className="muted"> ↻</span>}
        </button>
      </div>
      {isOpen &&
        kids.map((cid) => (
          <TreeNode
            key={cid}
            id={cid}
            trail={[...trail, id]}
            childrenOf={childrenOf}
            byId={byId}
            relations={relations}
            activeId={activeId}
            expanded={expanded}
            onToggleExpand={onToggleExpand}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}
