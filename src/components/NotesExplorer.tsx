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

/** Навигатор заметок как DAG: заметка может входить в несколько мест. */
export function NotesExplorer({ notes, setNotes, relations, setRelations }: Props) {
  const notesActions = useListActions(setNotes);
  const relActions = useListActions(setRelations);

  const [path, setPath] = useState<string[]>([]); // трейл захода (id)
  const [editing, setEditing] = useState<Note | null>(null);
  const [tab, setTab] = useState<'notes' | 'tags'>('notes');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const typeOf = (n: Note): NoteType => n.type ?? 'note';

  const currentId = path.length ? path[path.length - 1] : null;
  const currentNote = currentId ? byId.get(currentId) : undefined;

  const cmp = (a: Note, b: Note) => {
    const af = typeOf(a) === 'folder' ? 0 : 1;
    const bf = typeOf(b) === 'folder' ? 0 : 1;
    if (af !== bf) return af - bf;
    return (a.title || '').localeCompare(b.title || '');
  };

  const roots = useMemo(
    () =>
      notes
        .filter((n) => typeOf(n) !== 'tag' && getParents(n.id, relations).length === 0)
        .sort(cmp),
    [notes, relations],
  );

  const childNotes = (id: string): Note[] =>
    getChildren(id, relations)
      .map((cid) => byId.get(cid))
      .filter((n): n is Note => !!n);

  const currentChildren = currentId ? childNotes(currentId) : roots;

  function createChild(type: NoteType) {
    const now = Date.now();
    const id = uid();
    const note: Note = { id, title: '', body: '', type, date: null, createdAt: now, updatedAt: now };
    notesActions.add(note);
    if (currentId) {
      relActions.add({
        id: uid(),
        from: currentId,
        to: id,
        type: 'child',
        position: currentChildren.length,
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

  const tags = useMemo(() => notes.filter((n) => typeOf(n) === 'tag').sort(cmp), [notes]);

  return (
    <section className="view ne">
      <div className="view-head">
        <h2>Заметки</h2>
        <div className="ne-tabs">
          <button className={`md-tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
            Структура
          </button>
          <button className={`md-tab ${tab === 'tags' ? 'active' : ''}`} onClick={() => setTab('tags')}>
            Теги
          </button>
        </div>
      </div>

      {tab === 'notes' ? (
        <div className="ne-body">
          <aside className="ne-tree">
            {roots.length === 0 && <span className="muted small">пусто</span>}
            {roots.map((r) => (
              <TreeNode
                key={r.id}
                id={r.id}
                trail={[]}
                byId={byId}
                relations={relations}
                currentId={currentId}
                expanded={expanded}
                onToggle={(id) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onNavigate={setPath}
              />
            ))}
          </aside>

          <div className="ne-main">
            <div className="ne-crumbs">
              <button className="ne-crumb" onClick={() => setPath([])}>
                Все
              </button>
              {path.map((id, i) => (
                <span key={id}>
                  <span className="ne-sep">/</span>
                  <button className="ne-crumb" onClick={() => setPath(path.slice(0, i + 1))}>
                    {byId.get(id)?.title || '…'}
                  </button>
                </span>
              ))}
            </div>

            {currentNote && (
              <div className="ne-cur">
                {typeOf(currentNote) !== 'note' && (
                  <span className={`type-badge type-${typeOf(currentNote)}`}>
                    {TYPE_BADGE[typeOf(currentNote)]}
                  </span>
                )}
                <span className="ne-cur-title">{currentNote.title || 'Без названия'}</span>
                <button className="icon-btn" onClick={() => setEditing(currentNote)} aria-label="Открыть">
                  ✎
                </button>
              </div>
            )}

            <div className="ne-list">
              {currentChildren.length === 0 ? (
                <p className="muted small ne-empty">Пусто. Добавьте заметку или папку.</p>
              ) : (
                currentChildren.map((n) => (
                  <Row
                    key={n.id}
                    note={n}
                    typeOf={typeOf}
                    relations={relations}
                    onOpen={() => setEditing(n)}
                    onEnter={() => setPath([...path, n.id])}
                  />
                ))
              )}
            </div>

            <div className="ne-add">
              <button className="btn btn-small" onClick={() => createChild('note')}>
                ＋ Заметка
              </button>
              <button className="btn btn-small" onClick={() => createChild('folder')}>
                ＋ Папка
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="ne-tags">
          {tags.length === 0 && <p className="muted small">Тегов пока нет. Создайте заметку с типом «Тег».</p>}
          {tags.map((tag) => {
            const tagged = getTaggedNotes(tag.id, relations)
              .map((id) => byId.get(id))
              .filter((n): n is Note => !!n);
            return (
              <div key={tag.id} className="ne-tag">
                <button className="ne-tag-head" onClick={() => setEditing(tag)}>
                  # {tag.title || 'Без названия'}
                  <span className="ne-count">{tagged.length}</span>
                </button>
                {tagged.length > 0 && (
                  <ul className="rel-list">
                    {tagged.map((n) => (
                      <li key={n.id} className="rel-item">
                        <button className="rel-name ne-link" onClick={() => setEditing(n)}>
                          {n.title || 'Без названия'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

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
  typeOf: (n: Note) => NoteType;
  relations: Relation[];
  onOpen: () => void;
  onEnter: () => void;
}) {
  const kids = getChildren(note.id, relations).length;
  const parents = getParents(note.id, relations).length;
  const container = typeOf(note) === 'folder' || kids > 0;
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

function TreeNode({
  id,
  trail,
  byId,
  relations,
  currentId,
  expanded,
  onToggle,
  onNavigate,
}: {
  id: string;
  trail: string[];
  byId: Map<string, Note>;
  relations: Relation[];
  currentId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (path: string[]) => void;
}) {
  const note = byId.get(id);
  if (!note) return null;
  const cyclic = trail.includes(id); // защита: узел уже выше по этой ветке
  const kids = getChildren(id, relations);
  const isOpen = expanded.has(id);
  const parents = getParents(id, relations).length;

  return (
    <div className="tree-node">
      <div className="tree-row">
        {kids.length > 0 && !cyclic ? (
          <button className="tree-toggle" onClick={() => onToggle(id)}>
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-spacer" />
        )}
        <button
          className={`tree-label ${currentId === id ? 'active' : ''}`}
          onClick={() => onNavigate([...trail, id])}
        >
          {note.title || 'Без названия'}
          {parents > 1 && <span className="ne-multi"> ⧉</span>}
          {cyclic && <span className="muted"> ↻</span>}
        </button>
      </div>
      {isOpen && !cyclic &&
        kids.map((cid) => (
          <TreeNode
            key={cid}
            id={cid}
            trail={[...trail, id]}
            byId={byId}
            relations={relations}
            currentId={currentId}
            expanded={expanded}
            onToggle={onToggle}
            onNavigate={onNavigate}
          />
        ))}
    </div>
  );
}
