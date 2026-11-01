// «Ссылаются сюда» под заметкой: кто ссылается на неё и на её фрагменты (docs/ЗАМЕТКИ.md, 3.1).

import { useMemo, useState } from 'react';
import type { LinkRef } from '../lib/kb/index';
import { KIND_LABELS, backlinks } from '../lib/kb/index';
import { useKb } from '../lib/kb/ui';

const kindLabel = (k: string) => KIND_LABELS[k] ?? k;

/** «Обратные ссылки»: кто ссылается на заметку и на её фрагменты, с текстом вокруг ссылки. */
export function Backlinks({ noteId, anchor, setAnchor }: { noteId: string; anchor: string; setAnchor: (a: string) => void }) {
  const kb = useKb();
  const [open, setOpen] = useState(true);
  const all = useMemo(() => (kb ? backlinks(kb.index, noteId) : []), [kb, noteId]);
  if (!kb || all.length === 0) return null;
  const anchors = kb.index.parsed.get(noteId)?.anchors;
  const shown = anchor ? all.filter((r) => r.anchor?.toLowerCase() === anchor.toLowerCase()) : all;
  const fragText = (r: LinkRef) => anchors?.get(r.anchor ?? '')?.map((p) => p.text).join(' … ');
  const comments = shown.filter((r) => r.kind === 'comment');
  const links = shown.filter((r) => r.kind !== 'comment');

  const row = (r: LinkRef, i: number) => {
    const src = kb.index.byId.get(r.from);
    const frag = r.anchor ? fragText(r) : r.heading;
    return (
      <li key={`${r.from}-${i}`} className="kb-bl-item">
        <button className="kb-bl-src" onClick={() => kb.open({ id: r.from })}>
          {src?.title || 'Без названия'}
        </button>
        <span className="muted small"> · {kindLabel(r.kind)}</span>
        {frag && <span className="kb-bl-frag small"> → «{frag}»</span>}
        <div className="kb-bl-ctx small">{r.context}</div>
      </li>
    );
  };

  return (
    <div className="kb-backlinks">
      <button className="kb-bl-head field-label" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} Ссылаются сюда · {all.length}
      </button>
      {open && (
        <>
          {anchor && (
            <div className="kb-bl-filter small">
              только на фрагмент «{anchors?.get(anchor)?.map((p) => p.text).join(' … ') ?? anchor}»{' '}
              <button className="btn btn-small" onClick={() => setAnchor('')}>
                все
              </button>
            </div>
          )}
          {comments.length > 0 && (
            <>
              <div className="kb-bl-group small">💬 Комментарии</div>
              <ul className="kb-bl-list">{comments.map(row)}</ul>
            </>
          )}
          {links.length > 0 && <ul className="kb-bl-list">{links.map(row)}</ul>}
          {shown.length === 0 && <div className="muted small">На этот фрагмент ссылок нет.</div>}
        </>
      )}
    </div>
  );
}
