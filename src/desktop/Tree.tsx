// Дерево папок окна «База»: папки (роль «папка», связи child) с подпапками и заметками, как
// проводник Obsidian. Заметку и папку можно перетащить мышью в другую папку или в корень.
// Служебное (src/lib/kb/scope.ts) не видно: папка хозяйства показывается, только если в ней
// есть видимая заметка.

import { useMemo, useState } from 'react';
import type { Note, Relation } from '../types';
import { TYPE_BADGE } from '../lib/noteTypes';

const ru = (a: Note, b: Note) => (a.title || '').localeCompare(b.title || '', 'ru');
/** Порядок заметок в папке (папки — всегда по названию). */
const order = (by: TreeProps['sortBy'], files?: Map<string, number>) =>
  by === 'updated'
    ? (a: Note, b: Note) => b.updatedAt - a.updatedAt || ru(a, b)
    : by === 'files'
      ? (a: Note, b: Note) => (files?.get(b.id) ?? 0) - (files?.get(a.id) ?? 0) || ru(a, b)
      : ru;
const PER_FOLDER = 300;

export interface TreeProps {
  notes: Note[];
  relations: Relation[];
  /** Видимые заметки; null — показывать всё. */
  visible: Set<string> | null;
  /** Служебная ли папка (по названию её и папок над ней). */
  isService: (folderId: string) => boolean;
  activeId?: string;
  onOpen: (id: string, inNew: boolean) => void;
  /** Новая заметка или папка в папке (null — в корне). */
  onCreate: (parent: string | null, kind: 'note' | 'folder') => void;
  /** Перенести из папки from в папку to (null — корень). */
  onMove: (id: string, from: string | null, to: string | null) => void;
  /** Раскрытые папки (хранит окно: туда же раскрывает папку, куда создали заметку). */
  open: string[];
  setOpen: React.Dispatch<React.SetStateAction<string[]>>;
  /** Сколько файлов у заметки (📎 в строке) и порядок пунктов в папке. */
  filesOf?: Map<string, number>;
  sortBy?: 'title' | 'updated' | 'files';
  /** Иконка пункта (своя у заметки, у PDF — по виду файла); пусто — без иконки. */
  iconOf?: (n: Note) => string;
  /** Правая кнопка: по заметке или папке (parent — в какой папке она здесь показана), по пустому месту — null. */
  onMenu: (e: React.MouseEvent, node: { id: string; folder: boolean; parent: string | null } | null) => void;
}

export function FolderTree({ notes, relations, visible, isService, activeId, onOpen, onCreate, onMove, open, setOpen, onMenu, iconOf, filesOf, sortBy = 'title' }: TreeProps) {
  const openSet = useMemo(() => new Set(open), [open]);
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const [over, setOver] = useState<string | null>(null);

  const t = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]));
    const kids = new Map<string, string[]>();
    const hasParent = new Set<string>();
    for (const r of relations) {
      if (r.deleted || r.type !== 'child' || !byId.has(r.from) || !byId.has(r.to)) continue;
      const list = kids.get(r.from);
      if (list) {
        if (!list.includes(r.to)) list.push(r.to);
      } else kids.set(r.from, [r.to]);
      hasParent.add(r.to);
    }
    const seen = (n: Note) => n.type !== 'folder' && (!visible || visible.has(n.id));
    // папка видна: всё показываем, или она не служебная, или в ней (на любой глубине) есть видимое
    const memo = new Map<string, boolean>();
    const folderShown = (id: string, path: Set<string> = new Set()): boolean => {
      const hit = memo.get(id);
      if (hit !== undefined) return hit;
      if (path.has(id)) return false;
      let res = !visible || !isService(id);
      if (!res) {
        for (const k of kids.get(id) ?? []) {
          const n = byId.get(k)!;
          if (n.type === 'folder' ? folderShown(k, new Set([...path, id])) : seen(n)) {
            res = true;
            break;
          }
        }
      }
      memo.set(id, res);
      return res;
    };
    const split = (ids: string[]) => {
      const list = ids.map((id) => byId.get(id)!).filter(Boolean);
      return {
        folders: list.filter((n) => n.type === 'folder' && folderShown(n.id)).sort(ru),
        items: list.filter(seen).sort(order(sortBy, filesOf)),
      };
    };
    const roots = split(notes.filter((n) => !hasParent.has(n.id)).map((n) => n.id));
    return { kids, split, roots };
  }, [notes, relations, visible, isService, sortBy, filesOf]);

  const drop = (to: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    try {
      const { id, from } = JSON.parse(e.dataTransfer.getData('text/x-note')) as { id: string; from: string | null };
      onMove(id, from, to);
    } catch {
      /* перетащили не заметку */
    }
  };
  const dragOver = (key: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('text/x-note')) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(key);
  };
  const drag = (id: string, from: string | null) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/x-note', JSON.stringify({ id, from }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const ctx: Ctx = { t, openSet, toggle, over, setOver, drag, dragOver, drop, activeId, onOpen, onCreate, onMenu, iconOf, filesOf };
  return (
    <div
      className={`dk-tree ${over === '' ? 'drop' : ''}`}
      onDragOver={dragOver('')}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(null)}
      onDrop={drop(null)}
      onContextMenu={(e) => onMenu(e, null)}
    >
      <Items parent={null} depth={0} path={[]} ctx={ctx} />
      <div className="dk-tree-foot">
        <button className="link-btn small" onClick={() => onCreate(null, 'folder')}>
          ＋ папка
        </button>
        <span className="muted small">перетащите заметку на папку — переложить</span>
      </div>
    </div>
  );
}

interface Ctx {
  t: {
    kids: Map<string, string[]>;
    split: (ids: string[]) => { folders: Note[]; items: Note[] };
    roots: { folders: Note[]; items: Note[] };
  };
  openSet: Set<string>;
  toggle: (id: string) => void;
  over: string | null;
  setOver: React.Dispatch<React.SetStateAction<string | null>>;
  drag: (id: string, from: string | null) => (e: React.DragEvent) => void;
  dragOver: (key: string) => (e: React.DragEvent) => void;
  drop: (to: string | null) => (e: React.DragEvent) => void;
  activeId?: string;
  onOpen: TreeProps['onOpen'];
  onCreate: TreeProps['onCreate'];
  onMenu: TreeProps['onMenu'];
  iconOf?: TreeProps['iconOf'];
  filesOf?: TreeProps['filesOf'];
}

function Items({ parent, depth, path, ctx }: { parent: string | null; depth: number; path: string[]; ctx: Ctx }) {
  const { t, openSet, toggle, over, setOver, drag, dragOver, drop, activeId, onOpen, onCreate, onMenu, iconOf, filesOf } = ctx;
  const { folders, items } = parent ? t.split(t.kids.get(parent) ?? []) : t.roots;
  const [limit, setLimit] = useState(PER_FOLDER);
  const pad = { paddingInlineStart: 6 + depth * 14 };
  return (
    <>
      {folders.map((f) => {
        const isOpen = openSet.has(f.id) && !path.includes(f.id);
        const inner = t.split(t.kids.get(f.id) ?? []);
        return (
          <div key={f.id}>
            <div
              className={`dk-node dk-folder ${over === f.id ? 'drop' : ''} ${f.id === activeId ? 'on' : ''}`}
              style={pad}
              draggable
              onDragStart={drag(f.id, parent)}
              onDragOver={dragOver(f.id)}
              onDragLeave={() => setOver((o) => (o === f.id ? null : o))}
              onDrop={drop(f.id)}
              onClick={() => toggle(f.id)}
              onContextMenu={(e) => onMenu(e, { id: f.id, folder: true, parent })}
              dir="auto"
            >
              <span className="dk-caret">{isOpen ? '▾' : '▸'}</span>
              <span className="dk-node-title">{f.title || 'Без названия'}</span>
              <span className="dk-node-count">{inner.items.length || ''}</span>
              <span className="dk-node-acts" onClick={(e) => e.stopPropagation()}>
                <button title="Новая заметка в этой папке" onClick={() => onCreate(f.id, 'note')}>
                  ＋
                </button>
                <button title="Новая папка внутри" onClick={() => onCreate(f.id, 'folder')}>
                  📁
                </button>
                <button title="Открыть папку: переименовать, описание, удалить" onClick={(e) => onOpen(f.id, e.ctrlKey)}>
                  ✎
                </button>
              </span>
            </div>
            {isOpen && <Items parent={f.id} depth={depth + 1} path={[...path, f.id]} ctx={ctx} />}
          </div>
        );
      })}
      {items.slice(0, limit).map((n) => {
        const type = n.type ?? 'note';
        return (
          <div
            key={n.id}
            className={`dk-node dk-leaf ${n.id === activeId ? 'on' : ''}`}
            style={pad}
            draggable
            onDragStart={drag(n.id, parent)}
            onClick={(e) => onOpen(n.id, e.ctrlKey || e.metaKey)}
            onAuxClick={(e) => e.button === 1 && onOpen(n.id, true)}
            onContextMenu={(e) => onMenu(e, { id: n.id, folder: false, parent })}
            dir="auto"
          >
            <span className="dk-caret" />
            <span className="dk-node-title">
              {iconOf?.(n) ? <span className="dk-node-icon">{iconOf(n)}</span> : type !== 'note' && <span className={`type-badge type-${type}`}>{TYPE_BADGE[type]}</span>}
              {n.title || 'Без названия'}
            </span>
            {filesOf?.get(n.id) ? <span className="dk-files-badge" title="Файлов в заметке">📎{filesOf.get(n.id)}</span> : null}
          </div>
        );
      })}
      {items.length > limit && (
        <button className="link-btn small dk-node-more" style={pad} onClick={() => setLimit((x) => x + PER_FOLDER)}>
          ещё {items.length - limit}
        </button>
      )}
    </>
  );
}
