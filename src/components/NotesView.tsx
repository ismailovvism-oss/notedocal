import { useMemo, useRef, useState } from 'react';
import type { Attachment, ContactMethod, ContactType, Note, NoteType, Relation } from '../types';
import { uid, useListActions } from '../lib/storage';
import { fromKey } from '../lib/dates';
import { renderMarkdown } from '../lib/markdown';
import { deleteAttachment } from '../lib/attachments';
import { CONTACT_META, CONTACT_TYPES, effectiveContacts } from '../lib/persons';
import { listLocations, mapLink } from '../lib/locations';
import { DOC_KINDS } from '../lib/docs';
import { AttachmentAdder, AttachmentList } from './Attachments';
import { ContactLinks } from './ContactLinks';
import {
  getBacklinks,
  getChildren,
  getLinks,
  getParents,
  getTags,
  wouldCreateCycle,
} from '../lib/relations';
import { TYPE_BADGE, TYPE_LABELS } from '../lib/noteTypes';

interface Props {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  fixedDate?: string;
  /** Связи между заметками (включает блок «Связи» в модалке). */
  relations?: Relation[];
  setRelations?: React.Dispatch<React.SetStateAction<Relation[]>>;
}

export function NotesView({ notes, setNotes, fixedDate, relations, setRelations }: Props) {
  const { add, update, remove } = useListActions(setNotes);
  const [editing, setEditing] = useState<Note | 'new' | null>(null);

  const list = useMemo(() => {
    // Записи дневника здоровья показываются в своей секции, не здесь.
    const base = fixedDate
      ? notes.filter((n) => n.date === fixedDate && !n.health)
      : notes.filter((n) => !n.health);
    return [...base].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, fixedDate]);

  function save(
    patch: Pick<
      Note,
      | 'title'
      | 'body'
      | 'date'
      | 'type'
      | 'attachments'
      | 'phone'
      | 'contacts'
      | 'address'
      | 'locationId'
      | 'category'
      | 'docNumber'
      | 'expires'
    >,
  ) {
    const now = Date.now();
    if (editing && editing !== 'new') {
      // Существующую обновляем и оставляем окно открытым (модалка сама уйдёт в отображение).
      update(editing.id, { ...patch, updatedAt: now });
    } else {
      // Новую создаём; окно закроет сама модалка (onClose).
      add({
        id: uid(),
        title: patch.title || 'Без названия',
        body: patch.body,
        type: patch.type ?? 'note',
        date: fixedDate ?? patch.date ?? null,
        attachments: patch.attachments ?? [],
        contacts: patch.contacts,
        phone: patch.phone,
        address: patch.address,
        locationId: patch.locationId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return (
    <section className="view">
      {!fixedDate && (
        <div className="view-head">
          <h2>Заметки</h2>
          <button className="btn btn-small btn-primary" onClick={() => setEditing('new')}>
            ＋ Заметка
          </button>
        </div>
      )}
      {fixedDate && (
        <button className="btn btn-small ev-add" onClick={() => setEditing('new')}>
          ＋ Заметка
        </button>
      )}

      <ul className="list notes-grid">
        {list.length === 0 && <li className="empty">Заметок пока нет</li>}
        {list.map((n) => {
          const type = n.type ?? 'note';
          return (
            <li key={n.id} className="note-card" onClick={() => setEditing(n)}>
              <div className="note-head">
                <h3>
                  {type !== 'note' && <span className={`type-badge type-${type}`}>{TYPE_BADGE[type]}</span>}
                  {n.title}
                </h3>
                <button
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(n.id);
                  }}
                  aria-label="Удалить"
                >
                  ✕
                </button>
              </div>
              {n.body && (
                <div className="md note-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(n.body) }} />
              )}
              <div className="note-foot">
                {n.date && <span className="chip">{fromKey(n.date).toLocaleDateString('ru-RU')}</span>}
                <span className="muted small">{relTime(n.updatedAt)}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {editing && (
        <NoteModal
          note={editing === 'new' ? null : editing}
          fixedDate={fixedDate}
          allNotes={notes}
          relations={relations}
          setRelations={setRelations}
          onSave={save}
          onDelete={
            editing !== 'new'
              ? () => {
                  remove(editing.id);
                  setEditing(null);
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

export function NoteModal({
  note,
  fixedDate,
  allNotes,
  relations,
  setRelations,
  initialMode,
  onSave,
  onDelete,
  onClose,
}: {
  note: Note | null;
  fixedDate?: string;
  allNotes: Note[];
  relations?: Relation[];
  setRelations?: React.Dispatch<React.SetStateAction<Relation[]>>;
  /** С какого режима открыть (по умолчанию: существующая — чтение, новая — правка). */
  initialMode?: 'view' | 'edit';
  onSave: (
    patch: Pick<
      Note,
      | 'title'
      | 'body'
      | 'date'
      | 'type'
      | 'attachments'
      | 'phone'
      | 'contacts'
      | 'address'
      | 'locationId'
      | 'category'
      | 'docNumber'
      | 'expires'
    >,
  ) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [date, setDate] = useState(note?.date ?? '');
  const [type, setType] = useState<NoteType>(note?.type ?? 'note');
  const [attachments, setAttachments] = useState<Attachment[]>(note?.attachments ?? []);
  const [contacts, setContacts] = useState<ContactMethod[]>(note ? effectiveContacts(note) : []);
  const [address, setAddress] = useState(note?.address ?? '');
  const [locationId, setLocationId] = useState(note?.locationId ?? '');
  const [category, setCategory] = useState(note?.category ?? '');
  const [docNumber, setDocNumber] = useState(note?.docNumber ?? '');
  const [expires, setExpires] = useState(note?.expires ?? '');
  // Существующая заметка открывается отрендеренной; новая — сразу в правке.
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode ?? (note ? 'view' : 'edit'));
  const taRef = useRef<HTMLTextAreaElement>(null);

  const isPerson = type === 'person';
  const isLocation = type === 'location';
  const isDocument = type === 'document';
  const isContact = isPerson || isLocation;
  const locationOptions = useMemo(() => listLocations(allNotes), [allNotes]);
  const linkedLocation = locationId ? allNotes.find((n) => n.id === locationId) : undefined;

  function setContactAt(i: number, patch: Partial<ContactMethod>) {
    setContacts((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  function patchOf(over?: Partial<Pick<Note, 'attachments'>>) {
    const cleanContacts = contacts.filter((c) => c.value.trim());
    return {
      title: title.trim() || 'Без названия',
      body,
      date: date || null,
      type,
      attachments,
      contacts: cleanContacts,
      phone: cleanContacts.find((c) => c.type === 'phone')?.value ?? '',
      address: address.trim(),
      locationId: locationId || null,
      category: category.trim(),
      docNumber: docNumber.trim(),
      expires: expires || '',
      ...over,
    };
  }
  function handleSave() {
    onSave(patchOf());
    // Существующую оставляем открытой в режиме отображения; новую закрываем.
    if (note) setMode('view');
    else onClose();
  }
  // Файлы сохраняем сразу (у существующей заметки), не дожидаясь «Сохранить».
  function onAttach(added: Attachment[]) {
    const next = [...attachments, ...added];
    setAttachments(next);
    if (note) onSave(patchOf({ attachments: next }));
  }
  function onDetach(a: Attachment) {
    const next = attachments.filter((x) => x.id !== a.id);
    setAttachments(next);
    deleteAttachment(a);
    if (note) onSave(patchOf({ attachments: next }));
  }
  // «Назад» из правки: откатываем несохранённые текстовые правки и возвращаемся
  // к отображению. Вложения не откатываем — они сохраняются сразу при загрузке.
  function cancelEdit() {
    setTitle(note?.title ?? '');
    setBody(note?.body ?? '');
    setDate(note?.date ?? '');
    setType(note?.type ?? 'note');
    setContacts(note ? effectiveContacts(note) : []);
    setAddress(note?.address ?? '');
    setLocationId(note?.locationId ?? '');
    setCategory(note?.category ?? '');
    setDocNumber(note?.docNumber ?? '');
    setExpires(note?.expires ?? '');
    setMode('view');
  }

  function surround(before: string, after = before) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = body.slice(s, e);
    const next = body.slice(0, s) + before + sel + after + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  }
  function linePrefix(prefix: string) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = body.lastIndexOf('\n', s - 1) + 1;
    const next = body.slice(0, lineStart) + prefix + body.slice(lineStart);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + prefix.length, s + prefix.length);
    });
  }
  function insertCallout() {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = body.slice(s, e) || 'текст';
    const block = `> [!note] Заметка\n> ${sel}\n`;
    setBody(body.slice(0, s) + block + body.slice(e));
    requestAnimationFrame(() => ta.focus());
  }

  // В режиме отображения клик по фону закрывает; в правке — нет (чтобы не терять текст).
  const overlayClose = mode === 'view' ? onClose : undefined;

  // --- Отображение: отрендеренная заметка, клик по тексту → правка ---
  if (mode === 'view' && note) {
    return (
      <div className="modal-overlay" onClick={overlayClose}>
        <div className="modal modal-note" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div className="note-read-meta">
              {type !== 'note' && (
                <span className={`type-badge type-${type}`}>{TYPE_BADGE[type]}</span>
              )}
              {date && <span className="chip">{fromKey(date).toLocaleDateString('ru-RU')}</span>}
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </div>

          <h2 className="note-read-title">{title || 'Без названия'}</h2>

          {isContact && (
            <>
              <ContactLinks contacts={contacts} />
              {(linkedLocation || address) && (
                <div className="note-contact">
                  {linkedLocation ? (
                    <a
                      className="note-contact-row"
                      href={mapLink(linkedLocation.address || linkedLocation.title)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span aria-hidden>📍</span> {linkedLocation.title}
                      {linkedLocation.address ? (
                        <span className="muted small"> · {linkedLocation.address}</span>
                      ) : null}
                    </a>
                  ) : (
                    <a
                      className="note-contact-row"
                      href={mapLink(address)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span aria-hidden>📍</span> {address}
                    </a>
                  )}
                </div>
              )}
            </>
          )}

          {isDocument && (
            <div className="doc-facts">
              {category && (
                <span className="doc-fact">
                  <span className="muted small">Вид</span> {category}
                </span>
              )}
              {docNumber && (
                <span className="doc-fact">
                  <span className="muted small">Номер</span> {docNumber}
                </span>
              )}
              {date && (
                <span className="doc-fact">
                  <span className="muted small">Выдан</span> {fromKey(date).toLocaleDateString('ru-RU')}
                </span>
              )}
              {expires && (
                <span className="doc-fact">
                  <span className="muted small">До</span> {fromKey(expires).toLocaleDateString('ru-RU')}
                </span>
              )}
            </div>
          )}

          <div
            className="md note-read-body note-read-tap"
            onClick={() => setMode('edit')}
            title="Нажмите, чтобы редактировать"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(body.trim() || '_Пусто. Нажмите, чтобы добавить текст…_'),
            }}
          />

          <AttachmentList items={attachments} />
        </div>
      </div>
    );
  }

  // --- Правка ---
  return (
    <div className="modal-overlay" onClick={overlayClose}>
      <div className="modal modal-note modal-note-edit" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head note-edit-head">
          {note ? (
            <button className="ne-backbtn" onClick={cancelEdit} title="Назад без сохранения">
              ‹ Назад
            </button>
          ) : (
            <span className="field-label">Новая заметка</span>
          )}
          <div className="ne-head-actions">
            {onDelete && (
              <button className="ne-trash" onClick={onDelete} title="Удалить" aria-label="Удалить">
                🗑
              </button>
            )}
            <button className="ne-save" onClick={handleSave}>
              Сохранить
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </div>
        </div>

        <div className="note-edit-body">
          <input
            className="input modal-title"
            placeholder="Заголовок"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <label className="field">
            <span className="field-label">Тип</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as NoteType)}>
              {(Object.keys(TYPE_LABELS) as NoteType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          {isDocument && (
            <>
              <label className="field">
                <span className="field-label">Вид документа</span>
                <input
                  className="input"
                  list="doc-kinds"
                  placeholder="Паспорт, ВНЖ, ИНН…"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
                <datalist id="doc-kinds">
                  {DOC_KINDS.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span className="field-label">Номер</span>
                <input
                  className="input"
                  placeholder="Номер / серия"
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                />
              </label>
              <div className="task-form-row">
                <label className="field">
                  <span className="field-label">Выдан</span>
                  <input
                    className="input"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Действует до</span>
                  <input
                    className="input"
                    type="date"
                    value={expires}
                    onChange={(e) => setExpires(e.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          {isPerson && (
            <div className="field">
              <span className="field-label">Контакты</span>
              {contacts.map((c, i) => (
                <div key={i} className="ct-row">
                  <select
                    className="input ct-type"
                    value={c.type}
                    onChange={(e) => setContactAt(i, { type: e.target.value as ContactType })}
                  >
                    {CONTACT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {CONTACT_META[t].icon} {CONTACT_META[t].label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input ct-value"
                    placeholder={c.type === 'telegram' ? '@ник или номер' : 'номер / адрес'}
                    value={c.value}
                    onChange={(e) => setContactAt(i, { value: e.target.value })}
                  />
                  <input
                    className="input ct-label"
                    placeholder="подпись"
                    value={c.label ?? ''}
                    onChange={(e) => setContactAt(i, { label: e.target.value })}
                  />
                  <button
                    className="icon-btn"
                    onClick={() => setContacts((cs) => cs.filter((_, j) => j !== i))}
                    aria-label="Убрать"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn btn-small"
                onClick={() => setContacts((cs) => [...cs, { type: 'phone', value: '' }])}
              >
                ＋ Контакт
              </button>
            </div>
          )}

          {isContact && (
            <label className="field">
              <span className="field-label">{isLocation ? 'Адрес' : 'Адрес / место'}</span>
              {isPerson && locationOptions.length > 0 && (
                <select
                  className="input"
                  value={locationId ?? ''}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">— свой адрес —</option>
                  {locationOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      📍 {l.title || 'Без названия'}
                    </option>
                  ))}
                </select>
              )}
              {!(isPerson && locationId) && (
                <input
                  className="input"
                  placeholder="Город, улица…"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              )}
            </label>
          )}

          <div className="md-toolbar">
          <button className="md-btn" title="Жирный" onClick={() => surround('**')}>
            <b>Ж</b>
          </button>
          <button className="md-btn" title="Курсив" onClick={() => surround('*')}>
            <i>К</i>
          </button>
          <button className="md-btn" title="Подчёркнутый" onClick={() => surround('<u>', '</u>')}>
            <u>Ч</u>
          </button>
          <button className="md-btn" title="Зачёркнутый" onClick={() => surround('~~')}>
            <s>З</s>
          </button>
          <span className="md-sep" />
          <button className="md-btn" title="Заголовок" onClick={() => linePrefix('## ')}>
            H
          </button>
          <button className="md-btn" title="Список" onClick={() => linePrefix('- ')}>
            •
          </button>
          <button className="md-btn" title="Цитата" onClick={() => linePrefix('> ')}>
            ❝
          </button>
          <button className="md-btn" title="Коллаут" onClick={insertCallout}>
            💡
          </button>
          <button className="md-btn" title="Код" onClick={() => surround('`')}>
            {'</>'}
          </button>
        </div>
        <textarea
          ref={taRef}
          className="input md-editor"
          placeholder="Текст заметки (Markdown)…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />

        {!fixedDate && !isDocument && (
          <label className="field">
            <span className="field-label">Дата</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}

        <div className="field">
          <span className="field-label">Файлы</span>
          <AttachmentList items={attachments} onRemove={onDetach} />
          <AttachmentAdder onAdd={onAttach} />
        </div>

          {note && relations && setRelations && (
            <RelationsSection
              note={note}
              allNotes={allNotes}
              relations={relations}
              setRelations={setRelations}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RelationsSection({
  note,
  allNotes,
  relations,
  setRelations,
}: {
  note: Note;
  allNotes: Note[];
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
}) {
  const { add, remove } = useListActions(setRelations);
  const [error, setError] = useState('');

  const byId = useMemo(() => new Map(allNotes.map((n) => [n.id, n])), [allNotes]);
  const exists = (id: string) => byId.has(id);
  const titleOf = (id: string) => byId.get(id)?.title || '(без названия)';

  const parents = getParents(note.id, relations).filter(exists);
  const children = getChildren(note.id, relations).filter(exists);
  const tags = getTags(note.id, relations).filter(exists);
  const links = getLinks(note.id, relations).filter(exists);
  const backlinks = getBacklinks(note.id, relations).filter((b) => exists(b.from));

  const findRel = (from: string, to: string, type: Relation['type']) =>
    relations.find((r) => !r.deleted && r.from === from && r.to === to && r.type === type);

  function addRel(to: string, type: Relation['type']) {
    setError('');
    if (!to || to === note.id) return;
    if (findRel(note.id, to, type)) return;
    if (type === 'child' && wouldCreateCycle(note.id, to, relations)) {
      setError('Нельзя: получится цикл в иерархии.');
      return;
    }
    const now = Date.now();
    add({
      id: uid(),
      from: note.id,
      to,
      type,
      position: type === 'child' ? children.length : 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  function removeRel(from: string, to: string, type: Relation['type']) {
    const r = findRel(from, to, type);
    if (r) remove(r.id);
  }

  // Назначить родителя: создаётся связь parent --child--> эта заметка.
  function addParent(parentId: string) {
    setError('');
    if (!parentId || parentId === note.id) return;
    if (findRel(parentId, note.id, 'child')) return;
    if (wouldCreateCycle(parentId, note.id, relations)) {
      setError('Нельзя: получится цикл в иерархии.');
      return;
    }
    const now = Date.now();
    add({ id: uid(), from: parentId, to: note.id, type: 'child', position: 0, createdAt: now, updatedAt: now });
  }

  const candidates = allNotes.filter((n) => n.id !== note.id);

  return (
    <div className="rel-section">
      <div className="field-label rel-title">Связи</div>
      {error && <p className="rel-error small">{error}</p>}

      <RelGroup
        label="Родители"
        ids={parents}
        titleOf={titleOf}
        candidates={candidates}
        onAdd={addParent}
        onRemove={(pid) => removeRel(pid, note.id, 'child')}
      />
      <RelGroup
        label="Подзаметки"
        ids={children}
        titleOf={titleOf}
        candidates={candidates}
        onAdd={(to) => addRel(to, 'child')}
        onRemove={(to) => removeRel(note.id, to, 'child')}
      />
      <RelGroup
        label="Теги"
        ids={tags}
        titleOf={titleOf}
        candidates={candidates}
        onAdd={(to) => addRel(to, 'tag')}
        onRemove={(to) => removeRel(note.id, to, 'tag')}
      />
      <RelGroup
        label="Ссылки"
        ids={links}
        titleOf={titleOf}
        candidates={candidates}
        onAdd={(to) => addRel(to, 'link')}
        onRemove={(to) => removeRel(note.id, to, 'link')}
      />

      <div className="rel-group">
        <div className="rel-group-head">Беклинки</div>
        {backlinks.length === 0 ? (
          <span className="muted small">—</span>
        ) : (
          <ul className="rel-list">
            {backlinks.map((b) => (
              <li key={`${b.from}-${b.type}`} className="rel-item">
                <span className="rel-name">{titleOf(b.from)}</span>
                <span className="muted small">({b.type})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RelGroup({
  label,
  ids,
  titleOf,
  candidates,
  onAdd,
  onRemove,
}: {
  label: string;
  ids: string[];
  titleOf: (id: string) => string;
  candidates: Note[];
  onAdd: (to: string) => void;
  onRemove: (to: string) => void;
}) {
  return (
    <div className="rel-group">
      <div className="rel-group-head">{label}</div>
      {ids.length > 0 && (
        <ul className="rel-list">
          {ids.map((id) => (
            <li key={id} className="rel-item">
              <span className="rel-name">{titleOf(id)}</span>
              <button className="icon-btn rel-del" onClick={() => onRemove(id)} aria-label="Убрать">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <select
        className="input rel-add"
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
          e.target.value = '';
        }}
      >
        <option value="">+ добавить…</option>
        {candidates.map((n) => (
          <option key={n.id} value={n.id}>
            {n.title || 'Без названия'}
          </option>
        ))}
      </select>
    </div>
  );
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  return new Date(ts).toLocaleDateString('ru-RU');
}
