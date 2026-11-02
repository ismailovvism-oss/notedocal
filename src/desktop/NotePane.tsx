// Открытая заметка в окне «База»: сразу правится, без режима чтения и всплывающих окон —
// как в Obsidian. Текст сохраняется сам (через 0,7 с после правки, Ctrl+S — сразу).
// Сверху — название, роль, теги и свойства; ниже — текст в редакторе «как видишь».
// В окне на компьютере ещё голос (🎤, Ctrl+Пробел — с места курсора) и кнопки Claude с версиями
// текста, как в быстрых заметках: оригинал, очищено, связно, перевод (./native.ts).

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  toolsSlot,
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
  /** Место в правой колонке для панели инструментов этой заметки (./desktop.css, .dk-tools). */
  toolsSlot?: HTMLElement | null;
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
        <span className="dk-spacer" />
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
      {toolsSlot &&
        createPortal(
          <Tools
            editor={editor}
            voice={voice}
            toggleVoice={toggleVoice}
            stopVoice={stopVoice}
            mic={mic}
            mics={mics}
            micTitle={micTitle}
            loadMics={loadMics}
            pickMic={pickMic}
            lang={lang}
            setLang={setLang}
            busy={busy}
            claude={claude}
            versions={versionNames}
            version={note.currentVersion ?? 'оригинал'}
            pickVersion={pickVersion}
            setMsg={setMsg}
          />,
          toolsSlot,
        )}
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

const LANGS: [string, string][] = [
  ['ru', 'рус'],
  ['ar', 'араб'],
  ['ar-dia', 'диалект'],
  ['en', 'англ'],
];

const keep = (e: React.MouseEvent) => e.preventDefault();

/** Кнопка панели: не отнимает фокус у текста — выделение в редакторе остаётся. Отдельным
 *  компонентом, а не внутри Tools: панель перерисовывается 5 раз в секунду во время записи,
 *  и кнопка, объявленная внутри, пересоздавалась бы между нажатием и отпусканием. */
function B({ t, title, on, wide }: { t: React.ReactNode; title: string; on: () => void; wide?: boolean }) {
  return (
    <button className={`dk-tool ${wide ? 'wide' : ''}`} title={title} onMouseDown={keep} onClick={on}>
      {t}
    </button>
  );
}

/** Блок панели инструментов: заголовок сворачивает; что свёрнуто — запоминается. */
function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const [shut, setShut] = useLocalStorage<boolean>(`dk.tools.${id}`, false);
  return (
    <section className={`dk-block ${shut ? 'shut' : ''}`}>
      <button className="dk-block-head" onClick={() => setShut(!shut)}>
        <span>{title}</span>
        <span className="dk-caret">{shut ? '▸' : '▾'}</span>
      </button>
      {!shut && <div className="dk-block-body">{children}</div>}
    </section>
  );
}

/** Панель инструментов справа: голос, оформление, метки и ссылки, Claude. Кнопки не отнимают
 *  фокус у текста (mousedown без действия) — выделение в редакторе остаётся. */
function Tools({
  editor,
  voice,
  toggleVoice,
  stopVoice,
  mic,
  mics,
  micTitle,
  loadMics,
  pickMic,
  lang,
  setLang,
  busy,
  claude,
  versions,
  version,
  pickVersion,
  setMsg,
}: {
  editor: React.MutableRefObject<LiveEditorHandle | null>;
  voice: { id: string; state: string; seconds: number; level: number; waiting: number; mic: string } | null;
  toggleVoice: () => void;
  stopVoice: () => void;
  mic: string;
  mics: Mics;
  micTitle: (name: string) => string;
  loadMics: () => void;
  pickMic: (name: string) => void;
  lang: string;
  setLang: (l: string) => void;
  busy: string;
  claude: (kind: 'clean' | 'connect' | 'translate', label: string, to?: string) => void;
  versions: string[];
  version: string;
  pickVersion: (name: string) => void;
  setMsg: (m: string) => void;
}) {
  const h = () => editor.current;
  /** Действие над словами — только когда они выделены. */
  const onWords = (a: Parameters<LiveEditorHandle['run']>[0]) => () => {
    if (!h()?.selected()) return setMsg('Сначала выделите слова в тексте');
    setMsg('');
    h()?.run(a);
  };
  const time = voice ? `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}` : '';
  const native_ = native.available();
  return (
    <div className="dk-tools">
      {native_ && (
        <Block id="voice" title="🎤 Голос">
          <div className={`dk-rec ${voice ? voice.state : ''}`}>
            {!voice ? (
              <B wide t={<>● Записать <span className="muted small">Ctrl+Пробел</span></>} title="Диктовать с места курсора" on={toggleVoice} />
            ) : voice.state === 'wait' ? (
              <div className="dk-rec-wait">распознаю… {voice.waiting || ''}</div>
            ) : (
              <>
                <B wide t={voice.state === 'rec' ? `⏸ Пауза · ${time}` : `● Дальше · ${time}`} title="Пауза / дальше (Ctrl+Пробел, кнопка на микрофоне)" on={toggleVoice} />
                <B t="✓" title="Готово — дораспознать и закончить" on={stopVoice} />
              </>
            )}
          </div>
          {voice?.state === 'rec' && (
            <div className="dk-level">
              <span style={{ width: `${Math.min(100, voice.level * 400)}%` }} />
            </div>
          )}
          {voice?.state === 'pause' && <div className="muted small">пауза — заговорите, и запись продолжится сама</div>}
          <MicSelect value={mic} mics={mics} title={micTitle} onFocus={loadMics} onChange={pickMic} current={voice?.mic} />
          <div className="dk-seg">
            {LANGS.map(([k, t]) => (
              <button key={k} className={lang === k ? 'on' : ''} onMouseDown={keep} onClick={() => setLang(k)} title="Язык диктовки">
                {t}
              </button>
            ))}
          </div>
        </Block>
      )}

      <Block id="format" title="Оформление">
        <div className="dk-grid">
          <B t={<b>Ж</b>} title="Жирный (Ctrl+B)" on={() => h()?.wrap('**')} />
          <B t={<i>К</i>} title="Курсив (Ctrl+I)" on={() => h()?.wrap('*')} />
          <B t={<u>Ч</u>} title="Подчёркнутый (Ctrl+U)" on={() => h()?.wrap('<u>', '</u>')} />
          <B t={<s>З</s>} title="Зачёркнутый" on={() => h()?.wrap('~~')} />
          <B t={<mark>М</mark>} title="Маркер" on={() => h()?.wrap('==')} />
          <B t={<code>{'<>'}</code>} title="Код" on={() => h()?.wrap('`')} />
          <B t="H1" title="Заголовок 1" on={() => h()?.prefixLine('# ')} />
          <B t="H2" title="Заголовок 2" on={() => h()?.prefixLine('## ')} />
          <B t="H3" title="Заголовок 3" on={() => h()?.prefixLine('### ')} />
          <B t="•" title="Список" on={() => h()?.prefixLine('- ')} />
          <B t="1." title="Нумерованный список" on={() => h()?.prefixLine('1. ')} />
          <B t="☐" title="Задача" on={() => h()?.prefixLine('- [ ] ')} />
          <B t="❝" title="Цитата" on={() => h()?.prefixLine('> ')} />
          <B t="💡" title="Выноска (callout)" on={() => h()?.replaceSelection((sel) => `> [!note] Заметка\n> ${sel || 'текст'}\n`)} />
          <B t="—" title="Черта-разделитель" on={() => h()?.insertAtCursor('\n\n---\n\n')} />
          <B t="%%" title="Скрытый текст (виден только в правке)" on={() => h()?.wrap('%%')} />
        </div>
      </Block>

      <Block id="links" title="Метки и ссылки">
        <div className="dk-list-tools">
          <B wide t="[[ Ссылка" title="Вставить [[ и выбрать заметку из подсказки" on={() => h()?.startLink()} />
          <B wide t="🔗 Сослаться" title="Выделенные слова — ссылкой на заметку или её фрагмент" on={onWords('link')} />
          <B wide t="⚓ Метка" title="Поставить метку: на выделенные слова можно будет сослаться" on={onWords('anchor')} />
          <B wide t="💬 Коммент." title="Прокомментировать выделенные слова — заметка на полях" on={onWords('comment')} />
          <B wide t="📚 В набор" title="Добавить выделенные слова в набор (сборку кусков разных заметок)" on={onWords('set')} />
          <B wide t="＋ Кусок" title="Отложить этот кусок и выделить следующий: метка ляжет на все куски" on={onWords('piece')} />
          <B wide t="✕ Снять" title="Убрать метку с выделенных слов" on={onWords('unanchor')} />
          <B wide t="# Тег" title="Вставить # и выбрать тег" on={() => h()?.insertAtCursor('#')} />
        </div>
      </Block>

      {native_ && (
        <Block id="claude" title="✨ Claude">
          <div className="dk-list-tools">
            <B wide t="✨ Очистить" title="Исправить ослышки и пунктуацию — новая версия" on={() => !busy && claude('clean', 'чищу…')} />
            <B wide t="≡ Связно" title="Свести надиктованное в связный текст — новая версия" on={() => !busy && claude('connect', 'собираю…')} />
          </div>
          <div className="dk-seg">
            <span className="muted small">перевод:</span>
            <button onMouseDown={keep} onClick={() => !busy && claude('translate', 'перевожу…', 'ru')}>рус</button>
            <button onMouseDown={keep} onClick={() => !busy && claude('translate', 'перевожу…', 'ar')}>араб</button>
            <button onMouseDown={keep} onClick={() => !busy && claude('translate', 'перевожу…', 'en')}>англ</button>
          </div>
          {busy && <div className="dk-busy">{busy}</div>}
          {versions.length > 1 && (
            <>
              <div className="muted small">версии текста:</div>
              <div className="dk-seg dk-versions">
                {versions.map((v) => (
                  <button key={v} className={v === version ? 'on' : ''} onMouseDown={keep} onClick={() => pickVersion(v)}>
                    {v}
                  </button>
                ))}
              </div>
            </>
          )}
        </Block>
      )}
    </div>
  );
}
