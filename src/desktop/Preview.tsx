// Просмотр заметки рядом с правкой и режим чтения (из md-редактора, ~/projects/apps/md-redaktor).
// Текст режется на блоки — абзац, список, таблица, выноска (src/lib/kb/blocks.ts) — и у каждого:
// - справа кружок ✎: замечание к этому месту (выделили слова — к этим словам). Оно ложится в
//   сам файл строкой `{>>…<<}` сразу за блоком и показывается карточкой под ним
//   (./RemarkCard.tsx — с перепиской и состоянием). У списка кружок свой у каждого пункта:
//   замечание ложится строкой под этим пунктом и показывается под ним же;
// - слева ручка ⋮⋮ и стрелки: блок переставляется вместе со своими замечаниями.
// Двойной щелчок по блоку ставит курсор правки на его место.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import type { KbIndex } from '../lib/kb/index';
import { AR_SIGN } from '../lib/kb/livePreview';
import { moveRemark, remarkAfter, remarkInItem, type Change, type Remark } from '../lib/kb/remarks';
import { parseFootnotes } from '../lib/kb/footnotes';
import { bare, blocksOf, moveUnit, unitRange, type BlocksDiff } from '../lib/kb/blocks';
import { RemarkCard } from './RemarkCard';

const AR = '؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿';
const AR_RUN = new RegExp(`[${AR}](?:[${AR} \\t.,:;!?«»()\\-]*[${AR}])?`, 'g');
/** Арабские куски — в `<span class="ar">`: свой шрифт и кегль (как в правке). */
const arabicRuns = (html: string) =>
  html.replace(/>([^<]+)</g, (_, t: string) => '>' + t.replace(AR_RUN, (s) => `<span class="ar${AR_SIGN.test(s) ? ' ar-sign' : ''}">${s}</span>`) + '<');

/** Текст сноски — одной строкой разметки (без обёртки абзаца). */
const inline = (text: string) => arabicRuns(renderMarkdown(text)).replace(/^<p>|<\/p>\s*$/g, '');

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Видимый текст отрисованного блока — проверить, на месте ли фраза замечания. */
const textOfHtml = (html: string) =>
  squash(html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));

/** Отрисованный блок; фразы, к которым есть замечания, подсвечены. */
const Html = memo(function Html({ html, phrases }: { html: string; phrases: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    for (const ph of phrases ? phrases.split('\u0001') : []) {
      // фраза внутри одного куска текста — обернуть; через границы разметки — не трогаем
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').indexOf(ph);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + ph.length);
        const mark = document.createElement('mark');
        mark.className = 'pv-phrase';
        range.surroundContents(mark);
        break;
      }
    }
  }, [html, phrases]);
  return <div className="pv-html" ref={ref} />;
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
  moving,
  onMoveStart,
  onMoveEnd,
  fixes,
}: {
  /** Правки Claude, которые ещё стоят в тексте (вычитка): подсветить, «как было», «вернуть». */
  fixes: BlocksDiff | null;
  body: string;
  noteId: string;
  index: KbIndex;
  remarks: Remark[];
  /** Правка текста (замечание добавили, поправили, убрали; блок переставили). */
  onApply: (c: Change | Change[]) => void;
  onOpenLink: (d: { target?: string; anchor?: string; heading?: string }) => void;
  /** Двойной щелчок по блоку — курсор правки на его место. */
  onJumpEdit?: (pos: number) => void;
  /** Показать место (из панели замечаний): блок с этим местом прокрутить и подсветить. */
  jump: { pos: number; n: number } | null;
  /** Замечание переносят к другому абзацу: следующий щелчок по блоку — туда. */
  moving: Remark | null;
  onMoveStart: (r: Remark) => void;
  onMoveEnd: () => void;
}) {
  const blocks = useMemo(() => blocksOf(body, remarks), [body, remarks]);
  // отрисованный блок запоминается по тексту: при наборе перерисовывается только изменённый
  const cache = useRef(new Map<string, string>());
  const cacheFor = useRef<KbIndex | null>(null);
  if (cacheFor.current !== index) {
    cache.current = new Map();
    cacheFor.current = index;
  }
  // сноски: номер вместо `[^id]`, определение — под абзацем по щелчку и списком внизу
  const foots = useMemo(() => parseFootnotes(body), [body]);
  const fnNum = useMemo(() => new Map(foots.filter((f) => f.n).map((f) => [f.id, f.n])), [foots]);
  const fnSig = foots.map((f) => f.id).join('\u0001');
  const sigFor = useRef('');
  if (sigFor.current !== fnSig) {
    cache.current = new Map();
    sigFor.current = fnSig;
  }
  const withRefs = (raw: string) =>
    /^\s*(```|~~~)/.test(raw)
      ? raw
      : raw.replace(/\[\^([^\]\s]+)\](?!:)/g, (_, id: string) => `<sup class="kb-fn" data-fn="${id.replace(/"/g, '')}">${fnNum.get(id) ?? '?'}</sup>`);
  const [openFn, setOpenFn] = useState<{ at: number; id: string } | null>(null);
  const htmlOf = (raw: string) => {
    let h = cache.current.get(raw);
    if (h === undefined) {
      h = arabicRuns(renderMarkdown(withRefs(raw), { index, noteId }));
      if (cache.current.size > 2000) cache.current.clear();
      cache.current.set(raw, h);
    }
    return h;
  };

  /** Новое замечание: к какому месту (`b`+начало блока или `i`+начало пункта списка) и к каким словам. */
  const [draft, setDraft] = useState<{ key: string; phrase?: string; text: string } | null>(null);
  useEffect(() => setDraft(null), [noteId]);
  const host = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!jump || !blocks) return;
    const b = blocks.find((x) => x.notes.some((r) => r.from === jump.pos) || x.inner.some((r) => r.from === jump.pos)) ?? [...blocks].reverse().find((x) => x.from <= jump.pos);
    if (!b) return;
    // замечание к пункту списка — показать сам пункт
    const it = b.items?.find((x) => x.notes.some((r) => r.from === jump.pos)) ?? (b.items && b.notes.every((r) => r.from !== jump.pos) ? [...b.items].reverse().find((x) => x.from <= jump.pos) : undefined);
    setFlash(it ? `i${it.from}` : `b${b.from}`);
    host.current?.querySelector(it ? `[data-item="${it.from}"]` : `[data-from="${b.from}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);
  useEffect(() => {
    if (!moving) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onMoveEnd();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moving, onMoveEnd]);
  // у какого блока раскрыто «как было»
  const [wasOpen, setWasOpen] = useState<number | null>(null);
  // перетаскивание блока: куда встанет (перед каким блоком; blocks.length — в конец)
  const [drag, setDrag] = useState<{ i: number; to: number | null } | null>(null);

  if (!blocks) {
    // разбор не сошёлся с текстом (редкая разметка) — показать целиком, без кружков
    return <div className="dk-preview md pv-plain" dangerouslySetInnerHTML={{ __html: arabicRuns(renderMarkdown(body, { index, noteId })) }} />;
  }

  /** Сохранить новое замечание: к блоку — абзацем за ним, к пункту списка — строкой под пунктом. */
  const save = (from: number, to: number, item = false) => {
    if (!draft) return;
    const text = draft.text.trim();
    if (text) onApply(item ? remarkInItem(body, from, text, draft.phrase) : remarkAfter(body, from, to, text, draft.phrase));
    setDraft(null);
  };
  const worstOf = (list: Remark[]) => (list.some((r) => r.status === 'open') ? 'open' : list.some((r) => r.status === 'ask') ? 'ask' : list.some((r) => r.status === 'done') ? 'done' : 'no');
  /** Кружок ✎: новое замечание к этому месту (выделены слова — к ним). */
  const pen = (key: string, list: Remark[], title: string) => {
    const open = draft?.key === key;
    return (
      <button
        className={`pv-btn ${list.length ? `on ${worstOf(list)}` : ''} ${open ? 'writing' : ''}`}
        title={open ? 'Закрыть' : title}
        onMouseDown={(e) => {
          // слова выделены в этом месте — запомнить до щелчка (он снимет выделение)
          e.preventDefault();
          e.stopPropagation();
          if (open) return setDraft(null);
          setDraft({ key, phrase: pickPhrase(e.currentTarget.parentElement), text: '' });
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {open ? '✕' : '✎'}
      </button>
    );
  };
  /** Карточки замечаний под своим местом. `own` — начало этого места: у замечания к другому
   *  (вложенный пункт, абзац внутри выноски) подписано, к какому. */
  const cards = (list: Remark[], key: string, lost: (r: Remark) => boolean, own?: number) =>
    list.map((r) => (
      <div key={r.n} className={`pv-note-wrap ${flash === key ? 'flash' : ''}`}>
        <RemarkCard r={r} resolve={() => ({ doc: body, r })} onApply={onApply} onMove={r.inline ? undefined : () => onMoveStart(r)} where={own !== undefined && r.anchorAt !== own} missing={lost(r)} />
      </div>
    ));
  /** Поле нового замечания. */
  const box = (key: string, from: number, to: number, item = false) =>
    draft?.key === key && (
      <div className="pv-edit" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {draft.phrase && (
          <div className="rk-quote" dir="auto">
            к словам «{draft.phrase}»
            <button className="pv-unphrase" title="Замечание ко всему месту, а не к этим словам" onClick={() => setDraft({ ...draft, phrase: undefined })}>
              ×
            </button>
          </div>
        )}
        <textarea
          autoFocus
          dir="auto"
          placeholder={draft.phrase ? 'Замечание к этим словам…' : item ? 'Замечание к этому пункту…' : 'Замечание к этому месту…'}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              save(from, to, item);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(null);
            }
          }}
        />
        <div className="pv-edit-row">
          <button className="btn-primary" onClick={() => save(from, to, item)}>
            Сохранить
          </button>
          <button onClick={() => setDraft(null)}>Отмена</button>
          <span className="muted small">Ctrl+Enter — сохранить · Esc — закрыть</span>
        </div>
      </div>
    );
  /** Перенос замечания: щёлкнули место, куда его. */
  const dropHere = (e: React.MouseEvent, from: number, to: number, item = false) => {
    if (!moving) return;
    e.stopPropagation();
    const fresh = remarks.find((x) => x.n === moving.n && x.kind === moving.kind);
    if (fresh) onApply(moveRemark(body, fresh, from, to, item));
    onMoveEnd();
  };
  const shift = (i: number, j: number) => {
    const m = moveUnit(body, blocks, i, j);
    if (m) onApply(m.changes);
  };
  /** Выделенные в этом блоке слова — фраза для замечания. */
  const pickPhrase = (el: HTMLElement | null) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !el || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return undefined;
    const t = squash(sel.toString());
    return t && t.length <= 200 ? t : undefined;
  };

  return (
    <div
      className={`dk-preview md ${moving ? 'pv-moving' : ''}`}
      ref={host}
      onClick={(e) => {
        const sup = (e.target as HTMLElement).closest<HTMLElement>('sup.kb-fn');
        if (sup) {
          const at = Number(sup.closest<HTMLElement>('.pv-block')?.dataset.from);
          const id = sup.dataset.fn ?? '';
          setOpenFn(openFn && openFn.at === at && openFn.id === id ? null : { at, id });
          return;
        }
        const a = (e.target as HTMLElement).closest<HTMLElement>('.kb-link');
        if (!a) return;
        e.preventDefault();
        onOpenLink({ target: a.dataset.target, anchor: a.dataset.anchor, heading: a.dataset.heading });
      }}
    >
      {moving && (
        <div className="pv-move-hint">
          ↪ Щёлкните абзац или пункт списка, к которому перенести замечание {moving.n} · Esc — отмена
          <button onClick={onMoveEnd}>Отмена</button>
        </div>
      )}
      {!body.trim() && <div className="pv-empty muted">Пусто — напишите что-нибудь в правке.</div>}
      {blocks.map((b, i) => {
        // правка Claude на этом блоке: счёт идёт по блокам с текстом, как в сравнении версий
        const k = b.raw.trim() ? blocks.slice(0, i).filter((x) => x.raw.trim()).length : -1;
        const fix = fixes && k >= 0 && fixes.now[k]?.kind !== 'same' ? fixes.now[k] : null;
        const gone = fixes && k >= 0 ? fixes.removed.filter((r) => r.before === k) : [];
        const key = `b${b.from}`;
        // у списка замечания пунктов — под пунктами; у прочих блоков внутренние — под блоком
        const inItems = new Set((b.items ?? []).flatMap((x) => x.notes));
        const mine = [...b.inner.filter((r) => !inItems.has(r)), ...b.notes];
        const has = mine.length > 0;
        const html = b.raw && !b.items ? htmlOf(bare(b, b.inner)) : '';
        const plain = html && mine.some((r) => r.phrase) ? textOfHtml(html) : '';
        const found = (r: Remark) => !!r.phrase && plain.includes(squash(r.phrase));
        const worst = worstOf(mine);
        return (
          <div key={b.from} className={`pv-item ${drag?.to === i ? 'drop-before' : ''} ${drag?.to === blocks.length && i === blocks.length - 1 ? 'drop-after' : ''}`}>
            {gone.map((g, gi) => (
              <div key={gi} className="pv-gone">
                <span dir="auto">Claude убрал абзац: «{squash(g.raw).slice(0, 140)}{squash(g.raw).length > 140 ? '…' : ''}»</span>
                <button title="Вернуть этот абзац на место" onClick={() => onApply({ from: b.from, to: b.from, insert: g.raw + '\n\n' })}>
                  Вернуть
                </button>
              </div>
            ))}
            {b.raw && (
              <div
                className={`pv-block ${b.items ? 'has-items' : ''} ${has ? `marked ${worst}` : ''} ${fix ? 'fixed' : ''} ${flash === key ? 'flash' : ''} ${drag?.i === i ? 'dragging' : ''}`}
                data-from={b.from}
                onDoubleClick={() => !moving && onJumpEdit?.(b.from)}
                onClick={(e) => dropHere(e, b.from, b.to)}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const to = e.clientY < r.top + r.height / 2 ? i : i + 1;
                  if (drag.to !== to) setDrag({ ...drag, to });
                }}
                onDrop={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  if (drag.to !== null) shift(drag.i, drag.to);
                  setDrag(null);
                }}
              >
                <div className="pv-grip">
                  <button title="Абзац выше (в правке — Alt+↑)" disabled={i === 0} onClick={() => shift(i, i - 1)}>
                    ▴
                  </button>
                  <span
                    className="pv-handle"
                    title="Потяните, чтобы переставить абзац — замечания поедут с ним"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/x-block', String(i));
                      setDrag({ i, to: null });
                    }}
                    onDragEnd={() => setDrag(null)}
                  >
                    ⋮⋮
                  </span>
                  <button title="Абзац ниже (в правке — Alt+↓)" disabled={i === blocks.length - 1} onClick={() => shift(i, i + 2)}>
                    ▾
                  </button>
                </div>
                {b.items ? (
                  // список: у каждого пункта свой кружок и свои замечания
                  <div className={`pv-list ${b.loose ? 'loose' : ''}`}>
                    {b.items.map((it) => {
                      const ik = `i${it.from}`;
                      const ih = htmlOf(bare(it, it.notes));
                      const itext = it.notes.some((r) => r.phrase) ? textOfHtml(ih) : '';
                      const ifound = (r: Remark) => !!r.phrase && itext.includes(squash(r.phrase));
                      return (
                        <div
                          key={it.from}
                          className={`pv-li ${it.notes.length ? `marked ${worstOf(it.notes)}` : ''} ${flash === ik ? 'flash' : ''}`}
                          data-item={it.from}
                          onDoubleClick={(e) => {
                            if (moving) return;
                            e.stopPropagation();
                            onJumpEdit?.(it.from);
                          }}
                          onClick={(e) => dropHere(e, it.from, it.to, true)}
                        >
                          <div className="pv-li-text">
                            <Html
                              html={ih}
                              phrases={it.notes
                                .filter(ifound)
                                .map((r) => squash(r.phrase!))
                                .join('\u0001')}
                            />
                            {pen(ik, it.notes, 'Замечание к этому пункту. Выделите слова — замечание будет к ним')}
                          </div>
                          {cards(it.notes, ik, (r) => !!r.phrase && !ifound(r), it.from)}
                          {box(ik, it.from, it.to, true)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <Html
                      html={html}
                      phrases={mine
                        .filter(found)
                        .map((r) => squash(r.phrase!))
                        .join('\u0001')}
                    />
                    {pen(key, mine, 'Замечание к этому месту. Выделите слова — замечание будет к ним')}
                  </>
                )}
              </div>
            )}
            {fix && (
              <div className="pv-fix">
                <span className="pv-fix-l">{fix.kind === 'added' ? '＋ добавлено Claude' : '✓ исправлено Claude'}</span>
                {fix.was !== undefined && <button onClick={() => setWasOpen(wasOpen === b.from ? null : b.from)}>{wasOpen === b.from ? 'Скрыть «как было»' : 'Как было'}</button>}
                {fix.was !== undefined ? (
                  <button title="Вернуть прежний текст абзаца" onClick={() => onApply({ from: b.from, to: b.from + b.raw.trimEnd().length, insert: fix.was! + b.inner.map((r) => `\n\n{>>${r.raw}<<}`).join('') })}>
                    ↩ Вернуть как было
                  </button>
                ) : (
                  <button
                    title="Убрать добавленный абзац"
                    onClick={() => {
                      const u = unitRange(b);
                      const tail = body.slice(u.to).match(/^\s*/)?.[0].length ?? 0;
                      onApply({ from: u.from, to: u.to + tail, insert: '' });
                    }}
                  >
                    ↩ Убрать
                  </button>
                )}
                {wasOpen === b.from && fix.was !== undefined && <div className="pv-was md" dir="auto" dangerouslySetInnerHTML={{ __html: arabicRuns(renderMarkdown(fix.was, { index, noteId })) }} />}
              </div>
            )}
            {openFn?.at === b.from &&
              (() => {
                const f = foots.find((x) => x.id === openFn.id);
                return (
                  <div className="pv-fn" onClick={() => setOpenFn(null)} title="Щёлкните, чтобы свернуть">
                    <span className="pv-fn-n">{f?.n || '?'}</span>
                    {f?.text ? <span dir="auto" dangerouslySetInnerHTML={{ __html: inline(f.text) }} /> : <span className="muted">у этой сноски нет текста</span>}
                  </div>
                );
              })()}
            {!b.raw && <span data-from={b.from} />}
            {cards(mine, key, (r) => !!r.phrase && !!b.raw && !b.items && !found(r), b.inner.length > 0 && !b.items ? b.from : undefined)}
            {box(key, b.from, b.to)}
          </div>
        );
      })}
      {fixes?.removed
        .filter((r) => r.before >= blocks.filter((x) => x.raw.trim()).length)
        .map((g, gi) => (
          <div key={gi} className="pv-gone">
            <span dir="auto">Claude убрал абзац: «{squash(g.raw).slice(0, 140)}{squash(g.raw).length > 140 ? '…' : ''}»</span>
            <button
              title="Вернуть этот абзац на место"
              onClick={() => {
                const last = blocks[blocks.length - 1];
                const at = last ? unitRange(last).to : 0;
                onApply({ from: at, to: at, insert: (at ? '\n\n' : '') + g.raw });
              }}
            >
              Вернуть
            </button>
          </div>
        ))}
      {foots.some((f) => f.n) && (
        <div className="pv-foots">
          <div className="pv-foots-title">Сноски</div>
          {foots
            .filter((f) => f.n)
            .map((f) => (
              <div key={f.id} className="pv-foot">
                <span className="pv-fn-n">{f.n}</span>
                {f.text ? <span dir="auto" dangerouslySetInnerHTML={{ __html: inline(f.text) }} /> : <span className="muted">нет текста</span>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
