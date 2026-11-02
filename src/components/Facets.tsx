// Фасетный отбор и дерево тегов на вкладке «Заметки» (docs/ЗАМЕТКИ.md, 3.3, этап 3).
// Логика — src/lib/kb/tags.ts; здесь только вид.

import { useState } from 'react';
import { OTHER, facetOf, selectedTags, toggleTag, type FacetNode, type Facets, type Selection } from '../lib/kb/tags';

const k = (t: string) => t.toLowerCase();
const facetLabel = (f: string) => (f === OTHER ? 'прочее' : f);

/** Ряд фасетов над списком: «тип ▾», «тема ▾»… — каждый раскрывает дерево значений со счётчиками. */
export function FacetBar({
  facets,
  sel,
  setSel,
  search,
}: {
  facets: Facets['facets'];
  sel: Selection;
  setSel: (s: Selection) => void;
  /** Поиск тега по имени и синонимам. */
  search: (q: string) => string[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const found = q.trim() ? search(q) : [];
  const chosen = selectedTags(sel);
  return (
    <div className="facet-bar">
      <div className="facet-row">
        {facets.map(({ facet }) => {
          const n = sel.get(facet)?.size ?? 0;
          return (
            <button
              key={facet || '—'}
              className={`ne-chip facet-chip ${n ? 'on' : ''} ${open === facet ? 'open' : ''}`}
              onClick={() => setOpen(open === facet ? null : facet)}
            >
              {facetLabel(facet)}
              {n ? ` · ${n}` : ''} ▾
            </button>
          );
        })}
        <input
          className="input facet-search"
          placeholder="🔍 тег или синоним…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {found.length > 0 && (
        <div className="facet-found">
          {found.map((t) => (
            <button
              key={t}
              className="kb-tag facet-found-tag"
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
      {open !== null && (
        <div className="facet-pop">
          <TagTree
            nodes={facets.find((f) => f.facet === open)?.values ?? []}
            sel={sel}
            onToggle={(t) => setSel(toggleTag(sel, t))}
          />
        </div>
      )}
      {chosen.length > 0 && (
        <div className="facet-chosen">
          {chosen.map((t) => (
            <button key={t} className="kb-tag facet-chosen-tag" onClick={() => setSel(toggleTag(sel, t))} title="Убрать из отбора">
              #{t} ×
            </button>
          ))}
          <button className="link-btn small" onClick={() => setSel(new Map())}>
            сбросить
          </button>
        </div>
      )}
    </div>
  );
}

/** Дерево значений: галочка — в отбор, ▸ — раскрыть, число — сколько заметок даст выбор. */
export function TagTree({
  nodes,
  sel,
  onToggle,
  onCard,
  onRename,
  depth = 0,
}: {
  nodes: FacetNode[];
  sel: Selection;
  onToggle: (tag: string) => void;
  /** Открыть карточку тега (описание, синонимы). */
  onCard?: (tag: string) => void;
  /** Переименовать или слить тег. */
  onRename?: (tag: string) => void;
  depth?: number;
}) {
  const [openSet, setOpenSet] = useState<Set<string>>(new Set());
  const isOn = (t: string) => sel.get(facetOf(t))?.has(k(t)) ?? false;
  return (
    <ul className="tag-tree" style={{ paddingLeft: depth ? 14 : 0 }}>
      {nodes.map((n) => (
        <li key={n.tag}>
          <div className={`tag-tree-row ${n.count ? '' : 'tag-zero'}`}>
            {n.children.length ? (
              <button
                className="tree-toggle"
                onClick={() =>
                  setOpenSet((s) => {
                    const x = new Set(s);
                    if (x.has(n.tag)) x.delete(n.tag);
                    else x.add(n.tag);
                    return x;
                  })
                }
              >
                {openSet.has(n.tag) ? '▾' : '▸'}
              </button>
            ) : (
              <span className="tree-spacer" />
            )}
            <label className="tag-tree-label">
              <input type="checkbox" checked={isOn(n.tag)} onChange={() => onToggle(n.tag)} />
              <span>{n.name}</span>
              <span className="tag-tree-count">{n.count}</span>
            </label>
            {onCard && (
              <button className="tag-tree-act" title="Карточка тега: описание, синонимы" onClick={() => onCard(n.tag)}>
                ✎
              </button>
            )}
            {onRename && (
              <button className="tag-tree-act" title="Переименовать или слить с другим" onClick={() => onRename(n.tag)}>
                ⇄
              </button>
            )}
          </div>
          {openSet.has(n.tag) && n.children.length > 0 && (
            <TagTree nodes={n.children} sel={sel} onToggle={onToggle} onCard={onCard} onRename={onRename} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}
