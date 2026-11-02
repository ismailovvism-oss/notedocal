// Открытая заметка в окне «База»: сразу правится, без режима чтения и всплывающих окон —
// как в Obsidian. Текст сохраняется сам (через 0,7 с после правки, Ctrl+S — сразу).
// Сверху — название, роль, теги и свойства; ниже — текст в редакторе «как видишь».
// В окне на компьютере ещё голос (🎤, Ctrl+Пробел — с места курсора) и кнопки Claude с версиями
// текста, как в быстрых заметках: оригинал, очищено, связно, перевод (./native.ts).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note, NoteType } from '../types';
import LiveEditor from '../components/LiveEditor';
import type { LiveEditorHandle } from '../components/liveEditorTypes';
import { useLocalStorage } from '../lib/storage';
import { native, type Mics, type VoiceEvent } from './native';
import { PropsView, SchemaView, ViewResult } from '../components/Props';
import { PropsEditor, SchemaEditor, ViewEditor } from '../components/PropsEdit';
import { TYPE_LABELS } from '../lib/noteTypes';
import { useKb } from '../lib/kb/ui';
import { dropEmptyAnchors } from '../lib/kb/edit';
import { checkNewTag, tagCards } from '../lib/kb/tags';
import { OWN_KEYS, fieldsOf, schemas } from '../lib/kb/schema';
import type { ScopeWhy } from '../lib/kb/scope';

// не лениво: окно держит страницу открытой часами, а пересборка стирает старые куски —
// догружаемый потом файл мог бы уже исчезнуть (так 02.11.2026 «Свойства» роняли страницу)

export interface PaneFocus {
  anchor?: string;
  heading?: string;
}

export function NotePane({
  note,
  focus,
  allNotes,
  scope,
  picking,
  autoRecord,
  onVoiceLeft,
  onDelete,
}: {
  note: Note;
  focus?: PaneFocus;
  allNotes: Note[];
  /** Видна ли заметка в Базе и почему (src/lib/kb/scope.ts). */
  scope?: ScopeWhy;
  /** Эта заметка открыта, чтобы выделить в ней слова для ссылки из другой. */
  picking: boolean;
  /** Сразу начать запись голосом (★ с кнопки на микрофоне — новая заметка и запись). */
  autoRecord?: boolean;
  /** Ушли с заметки посреди диктовки: дораспознанное вставит окно в текст заметки. */
  onVoiceLeft: (voiceId: string, noteId: string) => void;
  onDelete: () => void;
}) {
  const kb = useKb()!;
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body ?? '');
  const [tagInput, setTagInput] = useState('');
  const [propsOpen, setPropsOpen] = useState(false);
  // последнее сохранённое: пришло снаружи новое, а у нас нет несохранённого — берём новое
  const saved = useRef(note.body ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if ((note.body ?? '') !== saved.current && body === saved.current) {
      saved.current = note.body ?? '';
      setBody(note.body ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.body]);
  useEffect(() => setTitle(note.title), [note.title]);

  /** Текст в базу; у заметки с версиями (быстрые) — и в текущую версию. */
  const withVersion = (clean: string) =>
    note.versions ? { body: clean, versions: { ...note.versions, [note.currentVersion ?? 'оригинал']: clean } } : { body: clean };
  function save(text: string) {
    if (timer.current) clearTimeout(timer.current);
    const clean = dropEmptyAnchors(text);
    if (clean === saved.current) return;
    saved.current = clean;
    kb.updateNote(note.id, withVersion(clean));
  }
  function change(text: string) {
    setBody(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(text), 700);
  }
  // ушли с заметки — несохранённое сохранить
  const bodyRef = useRef(body);
  bodyRef.current = body;
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        const clean = dropEmptyAnchors(bodyRef.current);
        if (clean !== saved.current) kb.updateNote(note.id, withVersion(clean));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id],
  );

  // --- голос: метка %%🎤:id%% на месте курсора, распознанное встаёт перед ней ---
  const editor = useRef<LiveEditorHandle | null>(null);
  const [voice, setVoice] = useState<{ id: string; state: string; seconds: number; level: number; waiting: number; mic: string } | null>(null);
  // с какого микрофона писать: mic — какой стоит в системе по умолчанию; выбор запоминается
  const [mic, setMic] = useLocalStorage<string>('dk.mic', 'mic');
  const [mics, setMics] = useState<Mics>({ default: '', list: [] });
  const loadMics = () => void native.mics().then(setMics);
  useEffect(loadMics, []);
  const micTitle = (name: string) =>
    name === 'mic'
      ? `по умолчанию — ${mics.list.find((m) => m.name === mics.default)?.title ?? '…'}`
      : (mics.list.find((m) => m.name === name)?.title ?? 'нет такого — по умолчанию');
  const pickMic = (name: string) => {
    setMic(name);
    if (voiceId.current) native.voice({ op: 'mic', mic: name });
  };
  const voiceId = useRef<string | null>(null);
  const [lang, setLang] = useLocalStorage<string>('dk.voiceLang', 'ru');
  const [msg, setMsg] = useState('');
  const mark = (id: string) => `%%🎤:${id}%%`;
  // идёт ли запись прямо сейчас — в ref: кнопка на микрофоне зовёт toggleVoice из подписки,
  // созданной при открытии заметки, и состояние из её замыкания было бы устаревшим
  // (02.11.2026 второе нажатие слало «продолжить» вместо «пауза»)
  const voiceState = useRef('');
  voiceState.current = voice?.state ?? '';
  function toggleVoice() {
    if (!native.available()) return setMsg('Голос — только в окне на компьютере');
    const v = voiceId.current;
    if (v) return native.voice({ op: voiceState.current === 'rec' ? 'pause' : 'resume' });
    const h = editor.current;
    if (!h) return;
    const id = Math.random().toString(36).slice(2, 8);
    h.insertAtCursor(mark(id));
    voiceId.current = id;
    setVoice({ id, state: 'rec', seconds: 0, level: 0, waiting: 0, mic: micTitle(mic) });
    setMsg('');
    native.voice({ op: 'start', id, lang, mic });
  }
  const toggleRef = useRef(toggleVoice);
  toggleRef.current = toggleVoice;
  const stopVoice = () => voiceId.current && native.voice({ op: 'stop' });
  useEffect(
    () =>
      native.onVoice((e: VoiceEvent) => {
        const id = voiceId.current;
        const h = editor.current;
        if (e.event === 'error') return setMsg(e.message);
        if (!id || !('id' in e) || e.id !== id) return;
        if (e.event === 'state') setVoice((v) => v && { ...v, state: e.state, seconds: e.seconds, level: e.level, waiting: e.waiting, mic: e.mic || v.mic });
        else if (e.event === 'text' && e.text && h) {
          const a = h.around(mark(id));
          const sp = a && a.before && !/[\s(«"'\u00a0]/.test(a.before) ? ' ' : '';
          if (!h.replaceText(mark(id), `${sp}${e.text} ${mark(id)}`)) h.insertAtCursor(`${sp}${e.text} `);
        } else if (e.event === 'done') {
          if (h && !h.replaceText(` ${mark(id)}`, '')) h.replaceText(mark(id), '');
          voiceId.current = null;
          setVoice(null);
        }
      }),
    [],
  );
  // ушли с заметки посреди диктовки — закончить; дораспознанное вставит окно (DesktopApp)
  useEffect(
    () => () => {
      const id = voiceId.current;
      if (id) {
        native.voice({ op: 'stop' });
        onVoiceLeft(id, note.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id],
  );
  // ★ с кнопки на микрофоне: новая заметка — и сразу запись; повторное нажатие — пауза
  useEffect(() => {
    if (autoRecord) setTimeout(() => toggleRef.current(), 150);
    const onRecord = () => toggleRef.current();
    window.addEventListener('dk-record', onRecord);
    return () => window.removeEventListener('dk-record', onRecord);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Claude: очистить, связно, перевести — новая версия текста, как в быстрых заметках ---
  const [busy, setBusy] = useState('');
  async function claude(kind: 'clean' | 'connect' | 'translate', label: string, to?: string) {
    const text = dropEmptyAnchors(body);
    if (!text.trim()) return setMsg('Пустая заметка — нечего обрабатывать');
    setBusy(label);
    setMsg('');
    const res = await native.process(kind, text, { lang: note.lang ?? 'ru', to });
    setBusy('');
    if (!res.trim()) return setMsg('Claude не ответил — попробуйте ещё раз');
    const name = kind === 'clean' ? 'очищено' : kind === 'connect' ? 'связно' : `перевод-${to}`;
    const versions = { ...(note.versions ?? {}), [note.currentVersion ?? 'оригинал']: text, [name]: res };
    if (timer.current) clearTimeout(timer.current);
    saved.current = res;
    setBody(res);
    kb.updateNote(note.id, { body: res, versions, currentVersion: name });
  }
  function pickVersion(name: string) {
    if (!note.versions?.[name] && note.versions?.[name] !== '') return;
    const text = dropEmptyAnchors(body);
    const versions = { ...note.versions, [note.currentVersion ?? 'оригинал']: text };
    if (timer.current) clearTimeout(timer.current);
    saved.current = versions[name];
    setBody(versions[name]);
    kb.updateNote(note.id, { body: versions[name], versions, currentVersion: name });
  }
  const versionNames = Object.keys(note.versions ?? {});

  function commitTitle() {
    // пустое так и остаётся пустым: «Без названия» в базе мешало бы ссылкам и поиску
    const t = title.trim();
    if (t === (note.title ?? '').trim()) return setTitle(note.title);
    // ссылки на старое название переписать до сохранения: указатель ещё знает его
    // стёрли название — ссылки на заметку не трогаем: на пустое имя сослаться нельзя
    if (t && note.title) kb.renamed(note.id, note.title, t);
    kb.updateNote(note.id, { title: t });
    if (t && note.type === 'tag') kb.renameTag(note.title, t);
  }

  const tags = useMemo(() => note.tags ?? [], [note.tags]);
  const textTags = (kb.index.noteTags.get(note.id) ?? []).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));
  function addTag(raw: string) {
    const t = raw.trim().replace(/^#/, '').replace(/\s+/g, '-');
    setTagInput('');
    if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    const c = checkNewTag(kb.index, tagCards(allNotes), t);
    if (!c.exists) {
      const hint = c.similar.length ? `\nПохожие: ${c.similar.join(', ')}` : '';
      if (!confirm(`Тега «${t}» ещё нет — завести новый?${hint}`)) return;
    }
    kb.updateNote(note.id, { tags: [...tags, t] });
  }

  const fields = useMemo(
    () => fieldsOf(schemas(kb.index.byId.values()), kb.index.noteTags.get(note.id) ?? tags),
    [kb.index, note.id, tags],
  );
  const setProps = (p: Record<string, unknown>) => kb.updateNote(note.id, { props: p });
  const type = note.type ?? 'note';

  // куда поставить курсор: к метке или заголовку, по которым перешли
  const cursorAt = useMemo(() => {
    const parsed = kb.index.parsed.get(note.id);
    if (focus?.anchor) return parsed?.anchors.get(focus.anchor)?.[0]?.start ?? parsed?.anchors.get(focus.anchor.toLowerCase())?.[0]?.start;
    if (focus?.heading) return parsed?.headings.find((h) => h.text.toLowerCase() === focus.heading!.toLowerCase())?.start;
    return undefined;
    // только при открытии
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, focus]);

  return (
    <div className="dk-note" dir="auto">
      <div className="dk-note-head">
        <select
          className="dk-type"
          value={type}
          title="Роль заметки"
          onChange={(e) => kb.updateNote(note.id, { type: e.target.value as NoteType })}
        >
          {(Object.keys(TYPE_LABELS) as NoteType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        {scope && !scope.shown && (
          <span className="dk-hidden-note small" title="В списке, поиске и тегах Базы её не видно">
            служебная{scope.why !== 'отметка' ? ` · ${scope.why}` : ''}
          </span>
        )}
        {versionNames.length > 1 && (
          <select className="dk-type" title="Версия текста" value={note.currentVersion ?? 'оригинал'} onChange={(e) => pickVersion(e.target.value)}>
            {versionNames.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
        {native.available() && (
          <span className="dk-claude">
            <button disabled={!!busy} title="Claude: исправить ослышки и пунктуацию — новая версия" onClick={() => claude('clean', 'чищу…')}>
              ✨ Очистить
            </button>
            <button disabled={!!busy} title="Claude: свести надиктованное в связный текст" onClick={() => claude('connect', 'собираю…')}>
              ≡ Связно
            </button>
            <select
              disabled={!!busy}
              value=""
              title="Claude: перевести — новая версия"
              onChange={(e) => e.target.value && claude('translate', 'перевожу…', e.target.value)}
            >
              <option value="">🌐 Перевод</option>
              <option value="ru">на русский</option>
              <option value="ar">на арабский</option>
              <option value="en">на английский</option>
            </select>
            {busy && <span className="dk-busy">{busy}</span>}
          </span>
        )}
        <span className="dk-spacer" />
        {native.available() && (
          <span className={`dk-voice ${voice ? 'on ' + voice.state : ''}`}>
            {voice ? (
              <>
                <span className="dk-voice-dot" style={{ opacity: voice.state === 'rec' ? 0.4 + Math.min(1, voice.level * 6) : 1 }} />
                <span className="dk-voice-time">
                  {voice.state === 'rec'
                    ? `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`
                    : voice.state === 'pause'
                      ? 'пауза · жду голос'
                      : `распознаю… ${voice.waiting || ''}`}
                </span>
                {(voice.state === 'rec' || voice.state === 'pause') && (
                  <>
                    <MicSelect value={mic} mics={mics} title={micTitle} onFocus={loadMics} onChange={pickMic} current={voice.mic} />
                    <button title="Пауза / дальше (Ctrl+Пробел)" onClick={toggleVoice}>
                      {voice.state === 'rec' ? '⏸' : '●'}
                    </button>
                    <button title="Готово — дораспознать и закончить" onClick={stopVoice}>
                      ✓
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <button title="Диктовать с места курсора (Ctrl+Пробел)" onClick={toggleVoice}>
                  🎤
                </button>
                <MicSelect value={mic} mics={mics} title={micTitle} onFocus={loadMics} onChange={pickMic} />
                <select value={lang} onChange={(e) => setLang(e.target.value)} title="Язык диктовки">
                  <option value="ru">рус</option>
                  <option value="ar">араб</option>
                  <option value="ar-dia">диалект</option>
                  <option value="en">англ</option>
                </select>
              </>
            )}
          </span>
        )}
        {scope?.why === 'отметка' && (
          <button
            className="dk-icon"
            title="Вернуть как по правилам (по роли и папке)"
            onClick={() => kb.updateNote(note.id, { inBase: undefined })}
          >
            ↺
          </button>
        )}
        <button
          className={`dk-icon ${scope && !scope.shown ? '' : 'on'}`}
          title={scope && !scope.shown ? 'Показывать в Базе' : 'Спрятать из Базы (останется в notedocal, ссылки работают)'}
          onClick={() => kb.updateNote(note.id, { inBase: !(scope?.shown ?? true) })}
        >
          {scope && !scope.shown ? '🙈' : '👁'}
        </button>
        <button className={`dk-icon ${propsOpen ? 'on' : ''}`} title="Свойства" onClick={() => setPropsOpen((v) => !v)}>
          ⚙
        </button>
        <button
          className="dk-icon"
          title="Удалить заметку"
          onClick={() => confirm(`Удалить «${note.title || 'Без названия'}»?`) && onDelete()}
        >
          🗑
        </button>
      </div>

      <input
        className="dk-title"
        value={title}
        placeholder="Название"
        dir="auto"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />

      <div className="dk-tags">
        {tags.map((t) => (
          <span key={t} className="kb-tag">
            <button className="kb-tag-btn dk-tag-name" onClick={() => kb.openTag(t)} title="Заметки с этим тегом">
              #{t}
            </button>
            <button className="tag-x" title="Убрать тег" onClick={() => kb.updateNote(note.id, { tags: tags.filter((x) => x !== t) })}>
              ×
            </button>
          </span>
        ))}
        {textTags.map((t) => (
          <button key={t} className="kb-tag kb-tag-btn" title="Тег из текста" onClick={() => kb.openTag(t)}>
            #{t}
          </button>
        ))}
        <input
          className="dk-tag-input"
          list="dk-tag-names"
          placeholder="+ тег"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag(tagInput);
            }
          }}
          onBlur={() => tagInput.trim() && addTag(tagInput)}
        />
        <datalist id="dk-tag-names">
          {[...kb.index.tagNames.values()].map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      {propsOpen ? (
        <>
          {type === 'schema' && <SchemaEditor props={note.props ?? {}} setProps={setProps} />}
          {type === 'view' && <ViewEditor props={note.props ?? {}} setProps={setProps} />}
          <PropsEditor
            key={`${note.id}-${type}-${fields.length}`}
            props={note.props ?? {}}
            setProps={setProps}
            fields={fields}
            hidden={OWN_KEYS[type] ?? []}
            titles={allNotes.map((n) => n.title).filter(Boolean)}
          />
        </>
      ) : (
        type !== 'schema' && type !== 'view' && <PropsView note={note} />
      )}
      {type === 'schema' && <SchemaView note={note} />}
      {type === 'view' && <ViewResult note={note} />}

      {msg && <div className="dk-msg small">{msg}</div>}
      {picking && <div className="kb-picking">✋ Выделите слова, на которые будет ссылка, и нажмите «🎯 Сюда»</div>}

      <LiveEditor
        key={note.id}
        value={body}
        onChange={change}
        onCommit={save}
        noteId={note.id}
        noteTitle={note.title}
        placeholder="Текст заметки… [[ — ссылка, # — тег"
        autoFocus={cursorAt !== undefined || !body}
        cursorAt={cursorAt}
        voice={false}
        handle={editor}
        className="dk-editor"
        keys={[
          {
            key: 'Ctrl-Space',
            run: () => {
              toggleVoice();
              return true;
            },
          },
          {
            key: 'Mod-s',
            run: (v) => {
              save(v.state.doc.toString());
              return true;
            },
          },
        ]}
      />
    </div>
  );
}

/** Выбор микрофона. Видно, с какого пишем сейчас; список обновляется при каждом открытии. */
function MicSelect({
  value,
  mics,
  title,
  current,
  onFocus,
  onChange,
}: {
  value: string;
  mics: Mics;
  title: (name: string) => string;
  /** Запись идёт: как называется микрофон, с которого пишет окно. */
  current?: string;
  onFocus: () => void;
  onChange: (name: string) => void;
}) {
  return (
    <select
      className="dk-mic"
      value={value}
      title={current ? `Пишу с: ${current}` : `Микрофон: ${title(value)}`}
      onFocus={onFocus}
      onMouseDown={onFocus}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="mic">🎙 {title('mic')}</option>
      {mics.list.map((m) => (
        <option key={m.name} value={m.name}>
          {m.name === 'monitor' ? m.title : `🎙 ${m.title}`}
        </option>
      ))}
      {value !== 'mic' && !mics.list.some((m) => m.name === value) && <option value={value}>🎙 {title(value)}</option>}
    </select>
  );
}
