// Открытая заметка в окне «База»: сразу правится, без режима чтения и всплывающих окон —
// как в Obsidian. Текст сохраняется сам (через 0,7 с после правки, Ctrl+S — сразу).
// Сверху — название, роль, теги и свойства; ниже — текст в редакторе «как видишь».

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note, NoteType } from '../types';
import LiveEditor from '../components/LiveEditor';
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
  onDelete,
}: {
  note: Note;
  focus?: PaneFocus;
  allNotes: Note[];
  /** Видна ли заметка в Базе и почему (src/lib/kb/scope.ts). */
  scope?: ScopeWhy;
  /** Эта заметка открыта, чтобы выделить в ней слова для ссылки из другой. */
  picking: boolean;
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

  function save(text: string) {
    if (timer.current) clearTimeout(timer.current);
    const clean = dropEmptyAnchors(text);
    if (clean === saved.current) return;
    saved.current = clean;
    kb.updateNote(note.id, { body: clean });
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
        if (clean !== saved.current) kb.updateNote(note.id, { body: clean });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id],
  );

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
        className="dk-editor"
        keys={[
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
