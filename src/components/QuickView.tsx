// Вкладка «Быстрые» — окно «Быстрые заметки» (~/projects/apps/zametki) в вебе: запись текстом
// и голосом, версии, Claude (очистить, связно, перевести), склеить, копировать, удалить, отменить.
// В браузере нет ни Claude, ни движков распознавания: такие действия уходят заказом (`request`)
// окну на компьютере, оно выполняет их и кладёт новую версию (docs/ЗАМЕТКИ.md, разделы 6 и 8).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, QuickRequest, Relation } from '../types';
import { uid, useListActions, useLocalStorage } from '../lib/storage';
import { renderMarkdown } from '../lib/markdown';
import { attachmentsReady, uploadAttachment } from '../lib/attachments';
import { useKb } from '../lib/kb/ui';
import { dropEmptyAnchors } from '../lib/kb/edit';
import { LiveEditor } from './LazyLiveEditor';
import { fmtSeconds as fmt, useRecorder } from '../lib/recorder';
import {
  LANGS,
  LANG_NAME,
  QUICK_FOLDER,
  REQUEST_LABEL,
  TRANSLATIONS,
  VOICE_FOLDER,
  bare,
  mergeQuick,
  quickTitle,
  textLang,
  versionName,
  versionsOf,
  when,
  withText,
} from '../lib/quick';

// Буквы — как в окне: Ч и X — одна клавиша в двух раскладках.
const LETTERS: Record<string, string> = {
  ч: 'clean', x: 'clean', н: 'connect', y: 'connect', с: 'merge', c: 'merge',
  п: 'translate', g: 'translate', к: 'copy', r: 'copy', р: 'edit', h: 'edit',
};

interface Props {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
}

export function QuickView({ notes, setNotes, relations, setRelations }: Props) {
  const noteActions = useListActions(setNotes);
  const relActions = useListActions(setRelations);
  const kb = useKb();
  const [draft, setDraft] = useLocalStorage<string>('ndc.quickDraft', '');
  const [lang, setLang] = useLocalStorage<string>('ndc.quickLang', 'ru');
  const [openId, setOpenId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [message, setMessage] = useState('');
  const [translateMenu, setTranslateMenu] = useState(false);
  const undo = useRef<Note[][]>([]);
  const fine = typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;

  // папки окна: «Быстрые заметки» и вложенная в неё «Голосом»
  const quickFolder = notes.find((n) => n.type === 'folder' && n.title.trim() === QUICK_FOLDER);
  const voiceFolder = notes.find((n) => n.type === 'folder' && n.title.trim() === VOICE_FOLDER);
  const list = useMemo(() => {
    const where = new Map<string, 'quick' | 'voice'>();
    for (const r of relations) {
      if (r.deleted || r.type !== 'child') continue;
      if (voiceFolder && r.from === voiceFolder.id) where.set(r.to, 'voice');
      else if (quickFolder && r.from === quickFolder.id && r.to !== voiceFolder?.id && !where.has(r.to)) where.set(r.to, 'quick');
    }
    return notes
      .filter((n) => where.has(n.id))
      .map((n) => ({ note: n, folder: where.get(n.id)! }))
      .sort((a, b) => b.note.createdAt - a.note.createdAt);
  }, [notes, relations, quickFolder, voiceFolder]);
  const open = list.find((x) => x.note.id === openId)?.note ?? null;
  const selected = useCallback(() => {
    const marked = list.filter((x) => checked.has(x.note.id)).map((x) => x.note);
    return marked.length ? marked : open ? [open] : [];
  }, [list, checked, open]);

  const say = (t: string) => setMessage(t);

  /** Папка окна; нет — завести (как ensureFolder у секретаря: по названию). */
  function folderId(kind: 'quick' | 'voice'): string {
    const now = Date.now();
    let quick = quickFolder?.id;
    if (!quick) {
      quick = uid();
      noteActions.add({ id: quick, type: 'folder', title: QUICK_FOLDER, body: '', date: null, createdAt: now, updatedAt: now });
    }
    if (kind === 'quick') return quick;
    let voice = voiceFolder?.id;
    if (!voice) {
      voice = uid();
      noteActions.add({ id: voice, type: 'folder', title: VOICE_FOLDER, body: '', date: null, createdAt: now, updatedAt: now });
      relActions.add({ id: uid(), from: quick, to: voice, type: 'child', position: 0, createdAt: now, updatedAt: now });
    }
    return voice;
  }

  function create(kind: 'quick' | 'voice', fields: Partial<Note>): string {
    const now = Date.now();
    const id = uid();
    const parent = folderId(kind);
    const text = fields.body ?? '';
    noteActions.add({
      id,
      type: 'note',
      title: quickTitle(text),
      body: text,
      versions: { оригинал: text },
      currentVersion: 'оригинал',
      lang: textLang(text),
      date: null,
      createdAt: now,
      updatedAt: now,
      ...fields,
    } as Note);
    relActions.add({ id: uid(), from: parent, to: id, type: 'child', position: 0, createdAt: now, updatedAt: now });
    return id;
  }

  function remember(affected: Note[]) {
    undo.current.push(affected.map((n) => ({ ...n })));
    undo.current = undo.current.slice(-30);
  }
  function rollback() {
    const snap = undo.current.pop();
    if (!snap) return say('Отменять нечего');
    const byId = new Map(snap.map((n) => [n.id, n]));
    const now = Date.now();
    setNotes((l) => l.map((n) => (byId.has(n.id) ? { ...byId.get(n.id)!, updatedAt: now } : n)));
    say('Отменено');
  }

  function saveDraft() {
    const text = draft.trim();
    if (!text) return;
    const id = create('quick', { body: text, versions: { оригинал: text }, lang: textLang(text) });
    setDraft('');
    setOpenId(id);
    say('Сохранено — заметка уже в базе, видна и на компьютере');
  }

  function order(kind: QuickRequest['kind'], to?: string) {
    const targets = selected().filter((n) => kind === 'transcribe' || (n.body ?? '').trim());
    if (!targets.length) return say('Откройте заметку щелчком в списке');
    const at = Date.now();
    for (const n of targets) noteActions.update(n.id, { request: { kind, ...(to ? { to } : {}), at }, requestError: '' });
    say(`Заказ отправлен окну на компьютере: ${REQUEST_LABEL[kind]}. Окно должно быть запущено.`);
  }

  function merge() {
    // как `годные` в окне: только с текстом и не ждущие распознавания
    const marked = list.filter((x) => checked.has(x.note.id) && (x.note.body ?? '').trim() && !x.note.request).map((x) => x.note);
    if (marked.length < 2) return say('Чтобы склеить, отметьте галочками две заметки с текстом или больше');
    remember(marked);
    const { keep, patch, drop } = mergeQuick(marked);
    noteActions.update(keep.id, patch);
    for (const n of drop) noteActions.remove(n.id);
    setChecked(new Set());
    setOpenId(keep.id);
    say(`Склеено заметок: ${marked.length} · Ctrl+Z — отменить`);
  }

  async function copy() {
    const texts = selected().map((n) => n.body).filter(Boolean);
    if (!texts.length) return;
    try {
      await navigator.clipboard.writeText(texts.join('\n\n'));
      say(`Скопировано: ${texts.length}`);
    } catch {
      say('Браузер не дал скопировать — выделите текст вручную');
    }
  }

  function remove() {
    const sel = selected();
    if (!sel.length) return;
    remember(sel);
    for (const n of sel) noteActions.remove(n.id);
    setChecked(new Set());
    if (open && sel.some((n) => n.id === open.id)) setOpenId(null);
    say(`Удалено: ${sel.length} · Ctrl+Z — вернуть`);
  }

  function startEdit() {
    if (!open) return;
    setEditing(open.id);
    setEditText(open.body ?? '');
  }
  function saveEdit() {
    const n = list.find((x) => x.note.id === editing)?.note;
    setEditing(null);
    if (!n) return;
    const text = dropEmptyAnchors(editText);
    if (text === (n.body ?? '')) return;
    remember([n]);
    noteActions.update(n.id, withText(n, text));
    say('Сохранено · Ctrl+Z — вернуть как было');
  }

  function pickVersion(v: string) {
    if (!open) return;
    const { versions } = versionsOf(open);
    noteActions.update(open.id, { currentVersion: v, body: versions[v], title: quickTitle(versions[v]) || open.title });
  }

  function step(dir: number, mark: boolean) {
    if (!list.length) return;
    const i = list.findIndex((x) => x.note.id === openId);
    const j = Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + dir));
    if (mark) {
      setChecked((s) => new Set([...s, ...(i >= 0 ? [list[i].note.id] : []), list[j].note.id]));
    }
    setOpenId(list[j].note.id);
  }

  // клавиши — как в окне, когда фокус не в поле ввода и не открыта карточка
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target instanceof HTMLElement ? e.target : document.body;
    if (t.closest('input, textarea, select, [contenteditable="true"], .cm-editor') || document.querySelector('.modal-overlay')) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'я') rollback();
      else if (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'ф') setChecked(new Set(list.map((x) => x.note.id)));
      else return;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') step(e.key === 'ArrowUp' ? -1 : 1, e.shiftKey);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!open) return;
      const keys = Object.keys(versionsOf(open).versions);
      const i = keys.indexOf(versionsOf(open).current);
      if (keys.length > 1) pickVersion(keys[(i + (e.key === 'ArrowLeft' ? -1 : 1) + keys.length) % keys.length]);
    } else if (e.key === 'Enter' || e.key === 'F2') startEdit();
    else if (e.key === 'Delete') remove();
    else if (e.key === 'Escape') setChecked(new Set());
    else if ('1234'.includes(e.key) && e.key.length === 1) setLang(LANGS[Number(e.key) - 1][0]);
    else {
      const act = LETTERS[e.key.toLowerCase()];
      if (!act) return;
      const run: Record<string, () => void> = {
        clean: () => order('clean'),
        connect: () => order('connect'),
        merge,
        translate: () => setTranslateMenu(true),
        copy: () => void copy(),
        edit: startEdit,
      };
      run[act]();
    }
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const rec = useRecorder();
  async function finishVoice() {
    const file = await rec.stop();
    if (!file) return;
    if (!attachmentsReady()) return say('Войдите через Google — запись уходит в хранилище, а распознаёт её окно на компьютере');
    say('Загружаю запись…');
    try {
      const att = await uploadAttachment(file);
      const id = create('voice', { body: '', versions: { оригинал: '' }, lang, attachments: [att], request: { kind: 'transcribe', at: Date.now() } });
      setOpenId(id);
      say('Запись отправлена — окно на компьютере распознает её и положит текст сюда');
    } catch (e) {
      say(`Не загрузилась запись: ${(e as Error).message}`);
    }
  }

  const v = open ? versionsOf(open) : null;
  const status = (n: Note) =>
    n.request ? `⏳ окно ${REQUEST_LABEL[n.request.kind] ?? n.request.kind}…` : n.requestError ? `⚠ ${n.requestError}` : '';

  return (
    <section className="view quick">
      <div className="view-head">
        <h2>Быстрые</h2>
        <span className="muted small">как окно на компьютере · буквы на кнопках — клавиши</span>
      </div>

      <div className="quick-input">
        <LiveEditor
          value={draft}
          onChange={setDraft}
          placeholder={fine ? 'Пишите — Enter сохранит, Shift+Enter — новая строка' : 'Пишите заметку…'}
          actions={false}
          className="quick-draft"
          keys={fine ? [{ key: 'Enter', run: () => (saveDraft(), true) }] : []}
        />
        <div className="quick-input-row">
          <button className="btn btn-primary btn-small" onClick={saveDraft} disabled={!draft.trim()}>
            Сохранить
          </button>
          <span className="quick-voice">
            {rec.state === 'idle' ? (
              <button className="btn btn-small" onClick={() => rec.start().catch((e) => say(`Микрофон: ${(e as Error).message}`))}>
                🎤 Голосом
              </button>
            ) : (
              <>
                <span className={`quick-rec ${rec.state}`}>{rec.state === 'recording' ? '● запись' : '⏸ пауза'} {fmt(rec.seconds)}</span>
                <button className="btn btn-small" onClick={rec.state === 'recording' ? rec.pause : rec.resume}>
                  {rec.state === 'recording' ? '⏸ Пауза' : '▶ Дальше'}
                </button>
                <button className="btn btn-small btn-primary" onClick={finishVoice}>
                  ✓ Готово
                </button>
                <button className="btn btn-small" onClick={() => rec.cancel()}>
                  ✕
                </button>
              </>
            )}
            <select className="input quick-lang" value={lang} onChange={(e) => setLang(e.target.value)} title="Язык записи (клавиши 1–4)">
              {LANGS.map(([code, name], i) => (
                <option key={code} value={code}>
                  {i + 1} {name}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>

      {message && <div className="quick-msg small">{message}</div>}

      <div className={`quick-body ${open ? 'has-open' : ''}`}>
        <div className="quick-list-col">
          <ul className="quick-list">
            {list.length === 0 && <li className="empty">Быстрых заметок пока нет</li>}
            {list.map(({ note: n, folder }) => {
              const nv = versionsOf(n);
              return (
                <li key={n.id} className={`quick-row ${n.id === openId ? 'open' : ''}`} onClick={() => setOpenId(n.id)}>
                  <input
                    type="checkbox"
                    checked={checked.has(n.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setChecked((s) => {
                        const x = new Set(s);
                        if (e.target.checked) x.add(n.id);
                        else x.delete(n.id);
                        return x;
                      })
                    }
                  />
                  <div className="quick-row-text">
                    <div className="quick-row-head small muted">
                      {when(n.createdAt)} · {folder === 'voice' ? `🎤 ${LANG_NAME[n.lang ?? ''] ?? n.lang ?? ''}` : '✎'}
                      {nv.current !== 'оригинал' && ` · ${versionName(nv.current).toLowerCase()}`}
                      {status(n) && <span className={n.requestError && !n.request ? 'quick-err' : 'quick-wait'}> · {status(n)}</span>}
                    </div>
                    <div className="quick-row-start">{bare(n.body ?? '').split(/\s+/).join(' ').slice(0, 150) || '…'}</div>
                  </div>
                </li>
              );
            })}
          </ul>
          {checked.size >= 2 && (
            <button className="btn btn-small quick-merge" onClick={merge}>
              <span className="qk">С</span> Склеить отмеченные ({checked.size})
            </button>
          )}
        </div>

        {open && v && (
          <div className="quick-pane">
            <button className="quick-back" onClick={() => setOpenId(null)}>
              ‹ К списку
            </button>
            {Object.keys(v.versions).length > 1 && (
              <div className="quick-tabs">
                {Object.keys(v.versions).map((k) => (
                  <button key={k} className={`quick-tab ${k === v.current ? 'on' : ''}`} onClick={() => pickVersion(k)}>
                    {versionName(k)}
                  </button>
                ))}
              </div>
            )}
            <div className="quick-actions">
              {editing === open.id ? (
                <>
                  <button className="btn btn-small btn-primary" onClick={saveEdit}>
                    Сохранить правку
                  </button>
                  <button className="btn btn-small" onClick={() => setEditing(null)}>
                    Отменить правку
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-small" onClick={startEdit} title="Поправить текст (Enter)">
                    <span className="qk">Р</span> Править
                  </button>
                  <button className="btn btn-small" onClick={copy} title="Скопировать текст">
                    <span className="qk">К</span> Копировать
                  </button>
                  <span className="quick-sep" />
                  <span className="muted small">Claude:</span>
                  <button className="btn btn-small" onClick={() => order('clean')} title="Исправить ослышки, опечатки и пунктуацию">
                    <span className="qk">Ч</span> Очистить
                  </button>
                  <button className="btn btn-small" onClick={() => order('connect')} title="Собрать надиктованное в складный текст">
                    <span className="qk">Н</span> Связно
                  </button>
                  <span className="quick-tr">
                    <button className="btn btn-small" onClick={() => setTranslateMenu((x) => !x)}>
                      <span className="qk">П</span> Перевести ▾
                    </button>
                    {translateMenu && (
                      <span className="quick-tr-menu">
                        {TRANSLATIONS.map(([code, name], i) => (
                          <button
                            key={code}
                            onClick={() => {
                              setTranslateMenu(false);
                              order('translate', code);
                            }}
                          >
                            {i + 1}&nbsp; {name}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="quick-grow" />
                  <button className="btn btn-small" title="Открыть как обычную заметку: теги, ссылки, комментарии" onClick={() => kb?.open({ id: open.id })}>
                    ↗
                  </button>
                  <button className="btn btn-small quick-del" onClick={remove} title="Удалить (Ctrl+Z — вернуть)">
                    <span className="qk">Del</span> Удалить
                  </button>
                </>
              )}
            </div>
            {open.request && (
              <div className="quick-wait-box small">
                ⏳ Ждёт окна на компьютере: {REQUEST_LABEL[open.request.kind]}.{' '}
                <button className="link-btn" onClick={() => noteActions.update(open.id, { request: null })}>
                  Отменить заказ
                </button>
              </div>
            )}
            {!open.request && open.requestError && <div className="quick-err-box small">⚠ {open.requestError}</div>}
            {editing === open.id ? (
              <LiveEditor
                key={`edit-${open.id}`}
                value={editText}
                onChange={setEditText}
                noteId={open.id}
                noteTitle={open.title}
                autoFocus
                keys={[
                  { key: 'Mod-s', run: () => (saveEdit(), true) },
                  { key: 'Escape', run: () => (saveEdit(), true) },
                ]}
                onCommit={(t) => noteActions.update(open.id, withText(open, t))}
              />
            ) : (
              <div
                className="md quick-text"
                onDoubleClick={startEdit}
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(open.body?.trim() || (open.request ? '_…_' : '_Пусто_'), kb ? { index: kb.index, noteId: open.id } : undefined),
                }}
              />
            )}
            {open.attachments?.some((a) => a.type.startsWith('audio/')) && (
              <div className="small muted">
                🎵 Запись приложена — после распознавания окно её сотрёт.{' '}
                {!open.request && (
                  <button
                    className="link-btn"
                    onClick={() => noteActions.update(open.id, { request: { kind: 'transcribe', at: Date.now() }, requestError: '' })}
                  >
                    Распознать ещё раз
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

