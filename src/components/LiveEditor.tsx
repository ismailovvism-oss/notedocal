// Поле правки «как видишь» (docs/ЗАМЕТКИ.md, этап 2). Внутри — CodeMirror с живым просмотром
// (src/lib/kb/livePreview.ts): текст хранится markdown, а виден оформленным. Выделил слова —
// над ними панель: метка, ссылка, комментарий, набор. `[[` подсказывает названия заметок,
// `#` — существующие теги. Вставка с оформлением (из браузера, Word) становится markdown.

import { useEffect, useRef, useState } from 'react';
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import TurndownService from 'turndown';
import { renderMarkdown } from '../lib/markdown';
import { addPiece, clearPieces, deleteSkippingTags, livePreview, pendingPieces, setLiveCtx } from '../lib/kb/livePreview';
import { runFragmentAction, type FragmentAction } from '../lib/kb/fragmentActions';
import { FragmentButtons } from './FragmentButtons';
import type { LiveEditorProps } from './liveEditorTypes';
import { useKb, type KbApi } from '../lib/kb/ui';
import { addAnchor, anchorsAt, dropEmptyAnchors, excerpt } from '../lib/kb/edit';
import { fmtSeconds, useRecorder } from '../lib/recorder';
import { attachmentsReady, uploadAttachment } from '../lib/attachments';
import { useLocalStorage } from '../lib/storage';
import { LANGS } from '../lib/quick';

/** Минимальная правка вместо замены всего текста: курсор и история не прыгают. */
function diff(a: string, b: string) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { from: s, to: a.length - e, insert: b.slice(s, b.length - e) };
}

/** Заменить текст редактора, не трогая спрятанные теги меток (filter: false — свои правки). */
function setEditorText(view: EditorView, text: string) {
  const cur = view.state.doc.toString();
  if (cur === text) return;
  view.dispatch({ changes: diff(cur, text), filter: false });
}

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });
turndown.remove(['script', 'style']);

function wikiCompletion(kbRef: { current: KbApi | null }) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^[\]\n]*/);
    if (!m) return null;
    const kb = kbRef.current;
    if (!kb) return null;
    const inner = m.text.slice(2);
    const hash = inner.indexOf('#');
    const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2);
    const close = after === ']]' ? '' : ']]';
    if (hash >= 0) {
      // после # — заголовки и метки этой заметки
      const name = inner.slice(0, hash).trim().toLowerCase();
      const note = name ? kb.index.byName.get(name)?.[0] : undefined;
      const parsed = note ? kb.index.parsed.get(note.id) : undefined;
      if (!parsed) return null;
      const options = [
        ...parsed.headings.map((h) => ({ label: h.text, type: 'heading', detail: 'заголовок', apply: h.text + close })),
        ...[...parsed.anchors].map(([a, pieces]) => ({
          label: '^' + a,
          type: 'anchor',
          detail: pieces.map((p) => p.text).join(' … ').slice(0, 60),
          apply: '^' + a + close,
        })),
      ];
      return { from: m.from + 2 + hash + 1, options, validFor: /^[^[\]\n|]*$/ };
    }
    const seen = new Set<string>();
    const options = [];
    for (const n of kb.index.byId.values()) {
      if (seen.has(n.id) || !n.title) continue;
      seen.add(n.id);
      options.push({ label: n.title, type: n.type ?? 'note', apply: n.title + close });
      for (const a of n.aliases ?? []) options.push({ label: a, detail: `→ ${n.title}`, type: 'alias', apply: a + close });
    }
    return { from: m.from + 2, options, validFor: /^[^[\]\n#|]*$/ };
  };
}

function tagCompletion(kbRef: { current: KbApi | null }) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/(?:^|[\s(])#[\p{L}\p{N}_/-]*/u);
    if (!m) return null;
    const kb = kbRef.current;
    if (!kb) return null;
    const hashAt = m.from + m.text.indexOf('#');
    const line = ctx.state.doc.lineAt(hashAt);
    if (hashAt === line.from && /^#{1,6}\s/.test(line.text)) return null;
    return {
      from: hashAt + 1,
      options: [...kb.index.tagNames.values()].map((t) => ({ label: t, type: "tag" })),
      validFor: /^[\p{L}\p{N}_/-]*$/u,
    };
  };
}

export default function LiveEditor({
  value,
  onChange,
  noteId,
  noteTitle,
  placeholder,
  autoFocus,
  cursorAt,
  keys,
  onCommit,
  actions = true,
  voice = true,
  className,
  handle,
}: LiveEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const kb = useKb();
  const kbRef = useRef(kb);
  kbRef.current = kb;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const [bar, setBar] = useState<{ top: number; left: number; below: boolean; pieces: number; inAnchor: boolean } | null>(null);
  const [error, setError] = useState('');
  // Диктовка с места курсора: метка %%🎤:id%% в тексте, запись — окну на компьютере
  const recorder = useRecorder();
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceMsg, setVoiceMsg] = useState('');
  const [lang, setLang] = useLocalStorage<string>('ndc.quickLang', 'ru');

  useEffect(() => {
    const extra: Extension = keymap.of(
      (keysRef.current ?? []).map((k) => ({
        ...k,
        run: (v: EditorView) => (keysRef.current?.find((x) => x.key === k.key)?.run?.(v) ?? false),
      })),
    );
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          extra,
          keymap.of([
            { key: 'Backspace', run: (v) => deleteSkippingTags(v, false) },
            { key: 'Delete', run: (v) => deleteSkippingTags(v, true) },
            { key: 'Mod-b', run: (v) => wrap(v, '**') },
            { key: 'Mod-i', run: (v) => wrap(v, '*') },
            { key: 'Mod-u', run: (v) => wrap(v, '<u>', '</u>') },
          ]),
          history(),
          EditorState.allowMultipleSelections.of(true),
          markdown({ base: markdownLanguage }),
          keymap.of([...completionKeymap, ...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
          autocompletion({ override: [wikiCompletion(kbRef), tagCompletion(kbRef)], icons: false }),
          EditorView.lineWrapping,
          EditorView.perLineTextDirection.of(true),
          cmPlaceholder(placeholder ?? ''),
          livePreview(),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            if (u.selectionSet || u.docChanged || u.focusChanged || u.geometryChanged) updateBar(u.view);
          }),
          EditorView.domEventHandlers({
            paste(e, v) {
              const html = e.clipboardData?.getData('text/html');
              if (!html) return false;
              const md = turndown.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
              if (!md) return false;
              e.preventDefault();
              v.dispatch(v.state.replaceSelection(md));
              return true;
            },
            mousedown(e, v) {
              // щелчок по ссылке — переход, как в чтении; править ссылку — стрелками
              const link = (e.target as HTMLElement).closest<HTMLElement>('.kb-link');
              if (!link || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
              const k = kbRef.current;
              if (!k) return false;
              e.preventDefault();
              const { target, anchor, heading } = link.dataset;
              k.open(target ? { name: target, anchor, heading } : { id: noteId, anchor, heading });
              void v;
              return true;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (handle) {
      handle.current = {
        wrap: (open, close) => wrap(view, open, close ?? open),
        prefixLine: (prefix) => {
          const line = view.state.doc.lineAt(view.state.selection.main.head);
          view.dispatch({ changes: { from: line.from, insert: prefix } });
          view.focus();
        },
        replaceSelection: (fn) => {
          const r = view.state.selection.main;
          view.dispatch({ changes: { from: r.from, to: r.to, insert: fn(view.state.sliceDoc(r.from, r.to)) } });
          view.focus();
        },
        insertAtCursor: (text) => {
          const at = view.state.selection.main.to;
          view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, filter: false });
        },
        replaceText: (find, replace) => {
          const at = view.state.doc.toString().indexOf(find);
          if (at < 0) return false;
          view.dispatch({ changes: { from: at, to: at + find.length, insert: replace }, filter: false });
          return true;
        },
        around: (find) => {
          const doc = view.state.doc.toString();
          const at = doc.indexOf(find);
          if (at < 0) return null;
          return { before: doc.slice(Math.max(0, at - 1), at), after: doc.slice(at + find.length, at + find.length + 1) };
        },
      };
    }
    if (autoFocus) {
      view.focus();
      const at = cursorAt !== undefined && cursorAt <= view.state.doc.length ? cursorAt : view.state.doc.length;
      view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
    }
    return () => {
      view.destroy();
      viewRef.current = null;
      if (handle) handle.current = null;
    };
    // редактор создаётся один раз; новые value приходят через setEditorText ниже
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // текст поменяли снаружи (синхронизация, «Отменить») — привести редактор к нему
  useEffect(() => {
    const v = viewRef.current;
    if (v && v.state.doc.toString() !== value) setEditorText(v, value);
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setLiveCtx.of({
        index: kb?.index,
        noteId,
        render: (md, id) => renderMarkdown(md, kb ? { index: kb.index, noteId: id, depth: 1 } : undefined),
      }),
    });
  }, [kb, noteId]);

  // окно распознало диктовку, а здесь ещё старый текст с меткой — подставить распознанное
  useEffect(() => {
    const v = viewRef.current;
    const results = noteId ? kb?.index.byId.get(noteId)?.voiceResults : undefined;
    if (!v || !results) return;
    let doc = v.state.doc.toString();
    for (const [id, text] of Object.entries(results)) doc = doc.replace(`%%🎤:${id}%%`, text);
    setEditorText(v, doc);
  }, [kb, noteId]);

  const marker = (id: string) => `%%🎤:${id}%%`;
  function dropMarker(id: string) {
    const v = viewRef.current;
    if (!v) return;
    const doc = v.state.doc.toString();
    const at = doc.indexOf(marker(id));
    if (at < 0) return;
    const to = at + marker(id).length + (doc[at + marker(id).length] === ' ' ? 1 : 0);
    v.dispatch({ changes: { from: at, to }, filter: false });
  }
  async function startVoice() {
    const v = viewRef.current;
    if (!v || !noteId) return;
    setVoiceMsg('');
    if (!attachmentsReady()) {
      setVoiceMsg('Войдите через Google: запись уходит в хранилище, а распознаёт её окно на компьютере');
      return;
    }
    const id = Math.random().toString(36).slice(2, 8);
    const pos = v.state.selection.main.to;
    const left = v.state.sliceDoc(pos - 1, pos);
    const right = v.state.sliceDoc(pos, pos + 1);
    const insert = (left && !/\s/.test(left) ? ' ' : '') + marker(id) + (right && !/[\s.,!?:;)»]/.test(right) ? ' ' : '');
    try {
      await recorder.start();
    } catch (e) {
      setVoiceMsg(`Микрофон: ${(e as Error).message}`);
      return;
    }
    v.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, filter: false });
    setVoiceId(id);
  }
  async function finishVoice() {
    const id = voiceId;
    const k = kbRef.current;
    setVoiceId(null);
    const file = await recorder.stop();
    if (!id || !file || !noteId || !k) return;
    setVoiceMsg('Загружаю запись…');
    try {
      const att = await uploadAttachment(file);
      const v = viewRef.current;
      // текст с меткой — в базу сразу: окно ставит распознанное на место метки
      if (v && onCommit) onCommit(dropEmptyAnchors(v.state.doc.toString()));
      const job = { id, path: att.path ?? '', type: att.type, lang, at: Date.now() };
      k.updateNote(noteId, { dictations: [...(k.index.byId.get(noteId)?.dictations ?? []), job] });
      setVoiceMsg('Запись ушла окну на компьютере — текст встанет на место 🎤');
    } catch (e) {
      dropMarker(id);
      setVoiceMsg(`Не загрузилась запись: ${(e as Error).message}`);
    }
  }
  function cancelVoice() {
    recorder.cancel();
    if (voiceId) dropMarker(voiceId);
    setVoiceId(null);
  }

  function updateBar(view: EditorView) {
    if (!actions) return;
    const sel = view.state.selection;
    const pieces = pendingPieces(view.state).length;
    const hasSel = sel.ranges.some((r) => !r.empty);
    if ((!hasSel && !pieces) || !view.hasFocus) {
      if (!view.hasFocus && document.activeElement?.closest('.fragment-bar')) return;
      setBar(null);
      return;
    }
    const r = sel.main;
    const a = view.coordsAtPos(r.from);
    const b = view.coordsAtPos(r.to);
    const box = host.current!.getBoundingClientRect();
    if (!a || !b) return;
    const touch = matchMedia('(pointer: coarse)').matches;
    const doc = view.state.doc.toString();
    const inAnchor = anchorsAt(doc, r.from).length > 0;
    setBar({
      top: (touch ? Math.max(a.bottom, b.bottom) + 8 : Math.min(a.top, b.top) - 6) - box.top,
      left: Math.max(0, Math.min(a.left - box.left, box.width - 280)),
      below: touch,
      pieces,
      inAnchor,
    });
  }

  async function act(action: FragmentAction | 'piece') {
    const view = viewRef.current;
    if (!view) return;
    setError('');
    const st = view.state;
    if (action === 'piece') {
      const effects = st.selection.ranges.filter((r) => !r.empty).map((r) => addPiece.of({ from: r.from, to: r.to }));
      view.dispatch({ effects, selection: EditorSelection.cursor(st.selection.main.to) });
      view.focus();
      return;
    }
    const spans = [...pendingPieces(st), ...st.selection.ranges.filter((r) => !r.empty).map((r) => ({ from: r.from, to: r.to }))];
    const body = st.doc.toString();
    try {
      const next = await runFragmentAction(action, body, spans, { id: noteId, title: noteTitle ?? '' }, kbRef.current);
      const v = viewRef.current;
      if (!v) return;
      if (next !== null && v.state.doc.toString() === body) {
        v.dispatch({ changes: diff(body, next), filter: false, effects: clearPieces.of(null) });
      } else v.dispatch({ effects: clearPieces.of(null) });
      if ((action === 'comment' || action === 'set') && onCommit) onCommit(dropEmptyAnchors(v.state.doc.toString()));
      v.dispatch({ selection: EditorSelection.cursor(v.state.selection.main.to) });
      v.focus();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Выбирали слова для ссылки из другой заметки: метка на них — и ссылка готова. */
  function pickHere() {
    const v = viewRef.current;
    const k = kbRef.current;
    if (!v || !k || !noteId) return;
    const st = v.state;
    const spans = [...pendingPieces(st), ...st.selection.ranges.filter((r) => !r.empty).map((r) => ({ from: r.from, to: r.to }))];
    if (!spans.length) return;
    try {
      const body = st.doc.toString();
      const r = addAnchor(body, spans);
      if (!r.existed) v.dispatch({ changes: diff(body, r.text), filter: false, effects: clearPieces.of(null) });
      onCommit?.(dropEmptyAnchors(v.state.doc.toString()));
      k.pickHere({ noteId, title: noteTitle ?? '', anchor: r.name, excerpt: excerpt(body, spans) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className={`live-editor ${className ?? ''}`}>
      <div ref={host} className="live-host md" />
      {bar && (
        <div
          className={`fragment-bar ${bar.below ? 'below' : ''}`}
          style={{ top: bar.top, left: bar.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <FragmentButtons
            onAction={act}
            pieces={bar.pieces}
            canNoteActions={!!noteId}
            inAnchor={bar.inAnchor}
            picking={!!kb?.picking && !!noteId}
            onPickHere={pickHere}
            format={(f) => viewRef.current && wrap(viewRef.current, ...f)}
          />
          {error && <div className="fragment-err">{error}</div>}
        </div>
      )}
      {noteId && voice && (
        <div className="voice-row" onMouseDown={(e) => e.preventDefault()}>
          {voiceMsg && <span className="small muted voice-msg">{voiceMsg}</span>}
          {recorder.state === 'idle' ? (
            <button className="voice-btn" title="Диктовать сюда — с места курсора" onClick={startVoice}>
              🎤 Диктовать
            </button>
          ) : (
            <>
              <span className={`voice-rec ${recorder.state}`}>
                {recorder.state === 'recording' ? '● запись' : '⏸ пауза'} {fmtSeconds(recorder.seconds)}
              </span>
              <button className="voice-btn" onClick={recorder.state === 'recording' ? recorder.pause : recorder.resume}>
                {recorder.state === 'recording' ? '⏸' : '▶'}
              </button>
              <button className="voice-btn voice-ok" onClick={finishVoice} title="Готово — распознать">
                ✓ Готово
              </button>
              <button className="voice-btn" onClick={cancelVoice} title="Выбросить запись">
                ✕
              </button>
            </>
          )}
          <select className="voice-lang" value={lang} onChange={(e) => setLang(e.target.value)} title="Язык диктовки">
            {LANGS.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/** Обернуть выделение значками (жирный, курсив); уже обёрнуто — снять. */
function wrap(view: EditorView, open: string, close = open): boolean {
  const changes = view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    const before = view.state.sliceDoc(r.from - open.length, r.from);
    const after = view.state.sliceDoc(r.to, r.to + close.length);
    if (before === open && after === close) {
      return {
        changes: [
          { from: r.from - open.length, to: r.from },
          { from: r.to, to: r.to + close.length },
        ],
        range: EditorSelection.range(r.from - open.length, r.to - open.length),
      };
    }
    return {
      changes: { from: r.from, to: r.to, insert: open + text + close },
      range: EditorSelection.range(r.from + open.length, r.to + open.length),
    };
  });
  view.dispatch(changes);
  view.focus();
  return true;
}

