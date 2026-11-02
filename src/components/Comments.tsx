// Комментарии к словам заметки (docs/ЗАМЕТКИ.md, 3.1): на широком экране — на полях справа,
// напротив своих слов; на телефоне — под абзацем, раскрываются нажатием на подсвеченные слова.
// Комментарий — заметка роли «комментарий», её цель — в свойстве `к`.

import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LinkRef } from '../lib/kb/index';
import { useCommentRefs, useKb } from '../lib/kb/ui';
import { renderMarkdown } from '../lib/markdown';

const WIDE = '(min-width: 1100px)';

/** Элемент, напротив которого стоит комментарий: слова с меткой, абзац, заголовок или начало. */
function targetEl(root: HTMLElement, r: LinkRef): HTMLElement | null {
  if (r.anchor) {
    const a = CSS.escape(r.anchor);
    const el = root.querySelector<HTMLElement>(`.kb-a[data-a="${a}" i], .kb-blk[data-blk="${a}" i]`);
    if (el?.classList.contains('kb-blk')) return el.closest<HTMLElement>('p, li, blockquote') ?? el;
    return el;
  }
  if (r.heading) {
    const want = r.heading.trim().toLowerCase();
    return [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].find((h) => h.textContent?.trim().toLowerCase() === want) ?? null;
  }
  return null;
}

export function CommentsMargin({
  noteId,
  root,
  html,
  open,
  setOpen,
}: {
  noteId: string;
  /** Показанный текст заметки (div с отрисованным markdown). */
  root: HTMLElement | null;
  /** Отрисованный текст: поменялся — пересчитать места. */
  html: string;
  /** Раскрытые на телефоне метки. */
  open: Set<string>;
  setOpen: (f: (s: Set<string>) => Set<string>) => void;
}) {
  const refs = useCommentRefs(noteId);
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  const [tops, setTops] = useState<number[]>([]);
  const [slots, setSlots] = useState<Map<string, HTMLElement>>(new Map());

  useLayoutEffect(() => {
    const mq = matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // на полях: каждый напротив своих слов, без наложения друг на друга
  useLayoutEffect(() => {
    if (!root || !wide) return;
    const place = () => {
      const base = root.getBoundingClientRect().top;
      const cards = root.parentElement?.querySelectorAll<HTMLElement>('.kb-margin .kb-cm-card') ?? [];
      let bottom = 0;
      const next = refs.map((r, i) => {
        const el = targetEl(root, r);
        const want = el ? el.getBoundingClientRect().top - base : 0;
        const top = Math.max(want, bottom);
        bottom = top + (cards[i]?.offsetHeight ?? 60) + 8;
        return top;
      });
      setTops((old) => (old.length === next.length && old.every((t, i) => Math.abs(t - next[i]) < 1) ? old : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root);
    return () => ro.disconnect();
  }, [root, html, refs, wide]);

  // на телефоне: место под абзацем, куда раскрывается комментарий
  useLayoutEffect(() => {
    if (!root || wide) return;
    root.querySelectorAll('.kb-cm-slot').forEach((x) => x.remove());
    const map = new Map<string, HTMLElement>();
    for (const r of refs) {
      const key = r.anchor ?? r.heading ?? '';
      if (map.has(key) || !open.has(key)) continue;
      const el = targetEl(root, r);
      const block = el?.closest<HTMLElement>('p, li, blockquote, h1, h2, h3, h4, h5, h6, td') ?? null;
      const slot = document.createElement('div');
      slot.className = 'kb-cm-slot';
      if (block) block.after(slot);
      else root.prepend(slot);
      map.set(key, slot);
    }
    setSlots(map);
  }, [root, html, refs, wide, open]);

  if (!refs.length) return null;

  if (wide) {
    return (
      <div className="kb-margin">
        {refs.map((r, i) => (
          <CommentCard key={`${r.from}-${i}`} r={r} style={{ top: tops[i] ?? 0 }} />
        ))}
      </div>
    );
  }
  const byKey = new Map<string, LinkRef[]>();
  for (const r of refs) {
    const key = r.anchor ?? r.heading ?? '';
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  return (
    <>
      {[...slots].map(([key, slot]) =>
        createPortal(
          <div className="kb-cm-inline">
            {(byKey.get(key) ?? []).map((r, i) => (
              <CommentCard key={`${r.from}-${i}`} r={r} />
            ))}
            <button
              className="kb-cm-hide small"
              onClick={() =>
                setOpen((s) => {
                  const n = new Set(s);
                  n.delete(key);
                  return n;
                })
              }
            >
              Свернуть
            </button>
          </div>,
          slot,
        ),
      )}
    </>
  );
}

function CommentCard({ r, style }: { r: LinkRef; style?: React.CSSProperties }) {
  const kb = useKb();
  const note = kb?.index.byId.get(r.from);
  const [edit, setEdit] = useState<string | null>(null);
  if (!kb || !note) return null;
  const highlight = (on: boolean) => {
    if (!r.anchor) return;
    document
      .querySelectorAll(`.modal-note .kb-a[data-a="${CSS.escape(r.anchor)}" i]`)
      .forEach((x) => x.classList.toggle('kb-lit', on));
  };
  return (
    <div
      className="kb-cm-card"
      style={style}
      onMouseEnter={() => highlight(true)}
      onMouseLeave={() => highlight(false)}
    >
      {edit === null ? (
        <div
          className="md kb-cm-body"
          title="Нажмите, чтобы поправить"
          onClick={() => setEdit(note.body)}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body || '_пусто_', { index: kb.index, noteId: note.id }) }}
        />
      ) : (
        <textarea
          className="input kb-cm-edit"
          autoFocus
          rows={4}
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              kb.updateNote(note.id, { body: edit });
              setEdit(null);
            }
            if (e.key === 'Escape') setEdit(null);
          }}
        />
      )}
      <div className="kb-cm-foot">
        {edit !== null ? (
          <>
            <button className="kb-cm-btn" onClick={() => setEdit(null)}>
              Отмена
            </button>
            <button
              className="kb-cm-btn kb-cm-save"
              onClick={() => {
                kb.updateNote(note.id, { body: edit });
                setEdit(null);
              }}
            >
              Сохранить
            </button>
          </>
        ) : (
          <>
            <button className="kb-cm-btn" title="Открыть как заметку: теги, ответы" onClick={() => kb.open({ id: note.id })}>
              ↗
            </button>
            <button
              className="kb-cm-btn"
              title="Удалить комментарий"
              onClick={() => {
                if (confirm('Удалить комментарий?')) kb.removeNote(note.id);
              }}
            >
              🗑
            </button>
          </>
        )}
      </div>
    </div>
  );
}
