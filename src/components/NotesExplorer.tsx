import { useMemo, useState } from 'react';
import type { Note, NoteType, Relation } from '../types';
import { uid, useListActions } from '../lib/storage';
import { getChildren, getParents, getTaggedNotes } from '../lib/relations';
import { TYPE_BADGE } from '../lib/noteTypes';
import { NoteModal } from './NotesView';

interface Props {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
}

// Текущий вид центра: корень структуры, узел-папка (по трейлу) или тег.
type View = { kind: 'root' } | { kind: 'node'; trail: string[] } | { kind: 'tag'; id: string };

const isNarrow = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 759px)').matches;

export function NotesExplorer({ notes, setNotes, relations, setRelations }: Props) {
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
  const tagChildrenOf = (id: string) =>
    getChildren(id, relations).filter((cid) => typeOf(byId.get(cid)) === 'tag');

  const folderRoots = useMemo(
    () =>
      notes
        .filter((n) => typeOf(n) !== 'tag' && getParents(n.id, relations).length === 0)
        .sort(cmp),
    [notes, relations],
  );
  const tagRoots = useMemo(
    () =>
      notes
        .filter(
          (n) =>
            typeOf(n) === 'tag' &&
            getParents(n.id, relations).filter((p) => typeOf(byId.get(p)) === 'tag').length === 0,
        )
        .sort(cmp),
    [notes, relations, byId],
  );

  // --- Что показывает центр ---
  const trail = view.kind === 'node' ? view.trail : [];
  const curId = view.kind === 'node' ? trail[trail.length - 1] : null;
  const curNote = curId ? byId.get(curId) : undefined;

  let items: Note[];
  if (view.kind === 'tag') {
    items = resolve(getTaggedNotes(view.id, relations)).sort(cmp);
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

  function saveNote(patch: Pick<Note, 'title' | 'body' | 'date' | 'type'>) {
    if (!editing) return;
    notesActions.update(editing.id, { ...patch, updatedAt: Date.now() });
    setEditing(null);
  }

  const activeFolder = view.kind === 'node' ? curId : null;
  const activeTag = view.kind === 'tag' ? view.id : null;

  return (
    <section className="view ne">
      <div className="view-head">
        <h2>Заметки</h2>
      </div>

      {/* Фильтры центрального списка + задел под фасеты/MOC */}
      <div className="ne-facets">
        <button
          className={`ne-chip ${hideFolders ? 'on' : ''}`}
          onClick={() => setHideFolders((v) => !v)}
          title="Не показывать папки в центральном списке"
        >
          {hideFolders ? 'Папки скрыты' : 'Скрыть папки'}
        </button>
        <button
          className={`ne-chip ${hideTags ? 'on' : ''}`}
          onClick={() => setHideTags((v) => !v)}
          title="Не показывать теги в центральном списке"
        >
          {hideTags ? 'Теги скрыты' : 'Скрыть теги'}
        </button>
        <span className="ne-facets-spacer" />
        <span className="muted small">Фасеты · MOC — скоро</span>
      </div>

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
            {view.kind === 'tag' && (
              <>
                <span className="ne-sep">/</span>
                <span className="ne-crumb ne-crumb-cur"># {byId.get(view.id)?.title || '…'}</span>
              </>
            )}
            {view.kind === 'node' &&
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

          {curNote && (
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
                {view.kind === 'tag'
                  ? 'Ничего не помечено этим тегом.'
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
                  onEnter={
                    view.kind === 'tag'
                      ? undefined
                      : () => setView({ kind: 'node', trail: [...trail, n.id] })
                  }
                />
              ))
            )}
          </div>

          {view.kind !== 'tag' && (
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

        <TreePanel
          title="Теги"
          roots={tagRoots}
          childrenOf={tagChildrenOf}
          byId={byId}
          relations={relations}
          activeId={activeTag}
          collapsed={rightClosed}
          onToggleCollapse={() => setRightClosed((v) => !v)}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          onSelect={(t) => setView({ kind: 'tag', id: t[t.length - 1] })}
        />
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
  return (
    <aside className={`ne-panel ${collapsed ? 'collapsed' : ''}`}>
      <button className="ne-panel-head" onClick={onToggleCollapse}>
        <span className="ne-panel-chev">{collapsed ? '▸' : '▾'}</span> {title}
      </button>
      {!collapsed && (
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
      )}
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
