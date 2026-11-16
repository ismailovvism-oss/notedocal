// Просмотр заметки рядом с правкой и режим чтения (из md-редактора, ~/projects/apps/md-redaktor).
// Текст режется на блоки — абзац, список, таблица, выноска — и у каждого справа кружок ✎:
// замечание к этому месту. Оно ложится в сам файл строкой `{>>…<<}` сразу за блоком
// (src/lib/kb/remarks.ts) и показывается карточкой под ним; блок с замечанием отмечен полосой.
// Двойной щелчок по блоку ставит курсор правки на его место.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { renderMarkdown } from '../lib/markdown';
import type { KbIndex } from '../lib/kb/index';
import { editRemark, generalRange, remarkAfter, removeRemark, type Change, type Remark } from '../lib/kb/remarks';

interface Block {
  from: number;
  to: number;
  raw: string;
  /** Замечания, стоящие сразу за блоком. */
  notes: Remark[];
}

const REMARK_ONLY = /^\s*(\{>>[\s\S]*<<\}|%%(?!🎤:)[\s\S]*%%)\s*$/;

/** Блоки верхнего уровня с местом в тексте; замечания-строки — при своём блоке. */
function blocksOf(src: string, remarks: Remark[]): Block[] | null {
  const tokens = marked.lexer(src);
  // места считаются по исходным кускам: разбор обязан вернуть текст как есть
  if (tokens.map((t) => t.raw).join('') !== src) return null;
  const gen = generalRange(src);
  const standalone = new Map(remarks.filter((r) => r.kind === 'par').map((r) => [r.from, r]));
  const out: Block[] = [];
  let at = 0;
  for (const t of tokens) {
    const from = at;
    at += t.raw.length;
    if (t.type === 'space') continue;
    if (gen && from < gen.to && at > gen.from) continue; // блок общих замечаний — в панели, не в тексте
    if (REMARK_ONLY.test(t.raw)) {
      const lead = t.raw.length - t.raw.trimStart().length;
      const r = standalone.get(from + lead);
      if (r && out.length) {
        out[out.length - 1].notes.push(r);
        continue;
      }
      if (r) {
        // замечание в самом начале текста — блоком без содержимого
        out.push({ from, to: from, raw: '', notes: [r] });
        continue;
      }
    }
    out.push({ from, to: at, raw: t.raw, notes: [] });
  }
  return out;
}

const AR = '؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿';
const AR_RUN = new RegExp(`[${AR}](?:[${AR} \\t.,:;!?«»()\\-]*[${AR}])?`, 'g');
/** Арабские куски — в `<span class="ar">`: свой шрифт и кегль (как в правке). */
const arabicRuns = (html: string) => html.replace(/>([^<]+)</g, (_, t: string) => '>' + t.replace(AR_RUN, '<span class="ar">$&</span>') + '<');

const Html = memo(function Html({ html }: { html: string }) {
  return <div className="pv-html" dangerouslySetInnerHTML={{ __html: html }} />;
});

export function Preview({
  body,
  noteId,
  index,
  remarks,
  onApply,
  onOpenLink,
  onJumpEdit,
  jump,
}: {
  body: string;
  noteId: string;
  index: KbIndex;
  remarks: Remark[];
  /** Правка текста (замечание добавили, поправили, убрали). */
  onApply: (c: Change) => void;
  onOpenLink: (d: { target?: string; anchor?: string; heading?: string }) => void;
  /** Двойной щелчок по блоку — курсор правки на его место. */
  onJumpEdit?: (pos: number) => void;
  /** Показать место (из панели замечаний): блок с этим местом прокрутить и подсветить. */
  jump: { pos: number; n: number } | null;
}) {
  const blocks = useMemo(() => blocksOf(body, remarks), [body, remarks]);
  // отрисованный блок запоминается по тексту: при наборе перерисовывается только изменённый
  const cache = useRef(new Map<string, string>());
  const cacheFor = useRef<KbIndex | null>(null);
  if (cacheFor.current !== index) {
    cache.current = new Map();
    cacheFor.current = index;
  }
  const htmlOf = (raw: string) => {
    let h = cache.current.get(raw);
    if (h === undefined) {
      h = arabicRuns(renderMarkdown(raw, { index, noteId }));
      if (cache.current.size > 2000) cache.current.clear();
      cache.current.set(raw, h);
    }
    return h;
  };

  /** Открытое поле замечания: к какому блоку (его начало) и что правим (null — новое). */
  const [edit, setEdit] = useState<{ at: number; n: number | null; text: string } | null>(null);
  useEffect(() => setEdit(null), [noteId]);
  const host = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    if (!jump || !blocks) return;
    const b = blocks.find((x) => jump.pos >= x.from && jump.pos <= Math.max(x.to, x.from)) ?? blocks.find((x) => x.notes.some((r) => r.from === jump.pos));
    if (!b) return;
    setFlash(b.from);
    host.current?.querySelector(`[data-from="${b.from}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  if (!blocks) {
    // разбор не сошёлся с текстом (редкая разметка) — показать целиком, без кружков
    return <div className="dk-preview md pv-plain" dangerouslySetInnerHTML={{ __html: arabicRuns(renderMarkdown(body, { index, noteId })) }} />;
  }

  const save = (b: Block) => {
    if (!edit) return;
    const text = edit.text.trim();
    const cur = edit.n === null ? undefined : b.notes.find((r) => r.n === edit.n);
    if (cur) onApply(text ? editRemark(body, cur, text) : removeRemark(body, cur));
    else if (text) onApply(remarkAfter(body, b.from, b.to, text));
    setEdit(null);
  };

  return (
    <div
      className="dk-preview md"
      ref={host}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>('.kb-link');
        if (!a) return;
        e.preventDefault();
        onOpenLink({ target: a.dataset.target, anchor: a.dataset.anchor, heading: a.dataset.heading });
      }}
    >
      {!body.trim() && <div className="pv-empty muted">Пусто — напишите что-нибудь в правке.</div>}
      {blocks.map((b) => {
        const open = edit?.at === b.from;
        const has = b.notes.length > 0;
        return (
          <div key={b.from} className="pv-item">
            {b.raw && (
              <div
                className={`pv-block ${has ? 'marked' : ''} ${flash === b.from ? 'flash' : ''}`}
                data-from={b.from}
                onDoubleClick={() => onJumpEdit?.(b.from)}
              >
                <Html html={htmlOf(b.raw)} />
                <button
                  className={`pv-btn ${has ? 'on' : ''} ${open ? 'open' : ''}`}
                  title={open ? 'Закрыть' : has ? 'Поправить замечание' : 'Замечание к этому месту'}
                  onClick={() => (open ? setEdit(null) : setEdit({ at: b.from, n: has ? b.notes[0].n : null, text: has ? b.notes[0].text : '' }))}
                >
                  {open ? '✕' : '✎'}
                </button>
              </div>
            )}
            {b.notes.map((r) =>
              open && edit?.n === r.n ? null : (
                <aside
                  key={r.n}
                  className={`pv-note ${flash === b.from ? 'flash' : ''}`}
                  data-from={b.raw ? undefined : b.from}
                  title="Щёлкните, чтобы поправить"
                  onClick={() => setEdit({ at: b.from, n: r.n, text: r.text })}
                >
                  <span className="pv-note-l">✎ замечание {r.n}</span>
                  <button
                    className="pv-note-x"
                    title="Убрать замечание"
                    onClick={(e) => {
                      e.stopPropagation();
                      onApply(removeRemark(body, r));
                    }}
                  >
                    ✕
                  </button>
                  <div dir="auto">{r.text || '…'}</div>
                </aside>
              ),
            )}
            {open && (
              <div className="pv-edit">
                <textarea
                  autoFocus
                  dir="auto"
                  placeholder="Замечание к этому месту…"
                  value={edit!.text}
                  onChange={(e) => setEdit({ ...edit!, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      save(b);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setEdit(null);
                    }
                  }}
                />
                <div className="pv-edit-row">
                  <button className="btn-primary" onClick={() => save(b)}>
                    Сохранить
                  </button>
                  <button onClick={() => setEdit(null)}>Отмена</button>
                  {edit!.n !== null && (
                    <button
                      className="danger"
                      onClick={() => {
                        const cur = b.notes.find((r) => r.n === edit!.n);
                        if (cur) onApply(removeRemark(body, cur));
                        setEdit(null);
                      }}
                    >
                      Удалить
                    </button>
                  )}
                  <span className="muted small">Ctrl+Enter — сохранить · Esc — закрыть</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
