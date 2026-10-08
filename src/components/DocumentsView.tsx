import { useMemo, useState } from 'react';
import type { Note, Relation } from '../types';
import { useListActions } from '../lib/storage';
import { fromKey, todayKey } from '../lib/dates';
import { fileIcon, formatSize } from '../lib/attachments';
import {
  allDocuments,
  docCounts,
  docLabel,
  docSubtitle,
  expiryWords,
  matchesDoc,
  type DocEntry,
  type DocFilter,
} from '../lib/documents';
import { NoteModal } from './NotesView';

const СРЕЗЫ: { id: DocFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'expired', label: 'Истекли' },
  { id: 'soon', label: 'Скоро' },
  { id: 'dated', label: 'Со сроком' },
  { id: 'undated', label: 'Бессрочные' },
];

/**
 * Реестр документов: все документы всех людей в одном месте.
 *
 * Вопрос, на который отвечает вкладка, — «где лежит документ и что скоро
 * истекает», а не «что есть у этого человека» (на это отвечает карточка).
 * Поэтому сверху горящее, рядом с названием — номер с кнопкой «копировать»,
 * а файл открывается прямо отсюда, без захода в карточку.
 */
export function DocumentsView({
  notes,
  setNotes,
  relations,
  setRelations,
}: {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
}) {
  const noteActions = useListActions(setNotes);
  const today = todayKey();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DocFilter>('all');
  const [owner, setOwner] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  const все = useMemo(() => allDocuments(notes, relations, today), [notes, relations, today]);
  const counts = useMemo(() => docCounts(все), [все]);
  const люди = useMemo(() => {
    const имена = new Set<string>();
    for (const e of все) for (const o of e.owners) имена.add(o.title);
    return [...имена].sort((a, b) => a.localeCompare(b));
  }, [все]);

  const видимые = useMemo(
    () =>
      все.filter(
        (e) => matchesDoc(e, filter, query) && (!owner || e.owners.some((o) => o.title === owner)),
      ),
    [все, filter, query, owner],
  );

  /**
   * Копирование с запасным путём. `navigator.clipboard` есть не везде: в iOS
   * внутри приложения, в не-https и при запрете разрешения он молча отказывает,
   * и кнопка выглядела бы сломанной. Поэтому при отказе — старый execCommand,
   * а отметку показываем в любом случае, чтобы нажатие не пропадало впустую.
   */
  function copy(текст: string, id: string) {
    const отметить = () => {
      setCopied(id);
      setTimeout(() => setCopied(''), 1500);
    };
    const запасной = () => {
      const ta = document.createElement('textarea');
      ta.value = текст;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
      отметить();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(текст).then(отметить, запасной);
    } else {
      запасной();
    }
  }

  const editNote = editId ? notes.find((n) => n.id === editId) ?? null : null;

  return (
    <section className="docs-view">
      <div className="docs-head">
        <input
          className="input docs-search"
          placeholder="Поиск: имя, документ, номер, файл"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(query || filter !== 'all' || owner) && (
          <button
            className="btn btn-small"
            onClick={() => {
              setQuery('');
              setFilter('all');
              setOwner('');
            }}
          >
            Сбросить
          </button>
        )}
      </div>

      <div className="docs-chips">
        {СРЕЗЫ.map((с) => (
          <button
            key={с.id}
            className={`chip ${filter === с.id ? 'chip-on' : ''} ${
              с.id === 'expired' && counts.expired > 0 ? 'chip-alarm' : ''
            }`}
            onClick={() => setFilter(с.id)}
          >
            {с.label}
            <span className="chip-count">{counts[с.id]}</span>
          </button>
        ))}
      </div>

      {люди.length > 1 && (
        <div className="docs-chips">
          <button className={`chip ${owner ? '' : 'chip-on'}`} onClick={() => setOwner('')}>
            Все люди
          </button>
          {люди.map((имя) => (
            <button
              key={имя}
              className={`chip ${owner === имя ? 'chip-on' : ''}`}
              onClick={() => setOwner(owner === имя ? '' : имя)}
            >
              {имя}
            </button>
          ))}
        </div>
      )}

      {видимые.length === 0 ? (
        <p className="muted">
          {все.length === 0
            ? 'Документов нет. Они заводятся на карточке человека в «Справочнике».'
            : 'Ничего не нашлось.'}
        </p>
      ) : (
        <ul className="docs-list">
          {видимые.map((e) => (
            <DocRow
              key={e.doc.id}
              entry={e}
              today={today}
              copied={copied}
              onCopy={copy}
              onOpen={() => setEditId(e.doc.id)}
            />
          ))}
        </ul>
      )}

      {editNote && (
        <NoteModal
          note={editNote}
          allNotes={notes}
          relations={relations}
          setRelations={setRelations}
          onSave={(patch) => noteActions.update(editNote.id, { ...patch, updatedAt: Date.now() })}
          onDelete={() => {
            noteActions.remove(editNote.id);
            setEditId(null);
          }}
          onClose={() => setEditId(null)}
        />
      )}
    </section>
  );
}

function DocRow({
  entry,
  today,
  copied,
  onCopy,
  onOpen,
}: {
  entry: DocEntry;
  today: string;
  copied: string;
  onCopy: (текст: string, id: string) => void;
  onOpen: () => void;
}) {
  const { doc, owners, status } = entry;
  const подпись = docSubtitle(doc);
  const номер = doc.docNumber?.trim();
  const файлы = doc.attachments ?? [];

  return (
    <li className={`doc-card doc-card-${status}`}>
      <div className="doc-main">
        <button className="doc-open" onClick={onOpen} title="Открыть документ">
          <span className="doc-owner">{owners.map((o) => o.title).join(' · ')}</span>
          <span className="doc-name">{docLabel(doc)}</span>
          {подпись && <span className="doc-sub muted small">{подпись}</span>}
        </button>
        {doc.expires && (
          <span className={`doc-exp doc-exp-${status}`}>
            до {fromKey(doc.expires).toLocaleDateString('ru-RU')}
            <span className="doc-exp-words">{expiryWords(doc.expires, today)}</span>
          </span>
        )}
      </div>

      <div className="doc-actions">
        {номер && (
          <button className="btn btn-small" onClick={() => onCopy(номер, `n:${doc.id}`)}>
            {copied === `n:${doc.id}` ? 'Скопирован' : `№ ${номер}`}
          </button>
        )}
        {файлы.map((a) => (
          <span key={a.id} className="doc-file">
            <a className="btn btn-small" href={a.url} target="_blank" rel="noreferrer" title={a.name}>
              {fileIcon(a.type)} {a.name.length > 28 ? a.name.slice(0, 27) + '…' : a.name}
              <span className="muted small"> {formatSize(a.size)}</span>
            </a>
            <button
              className="icon-btn"
              title="Скопировать ссылку на файл"
              onClick={() => onCopy(a.url, `f:${a.id}`)}
            >
              {copied === `f:${a.id}` ? '✓' : '⧉'}
            </button>
          </span>
        ))}
        {файлы.length === 0 && <span className="muted small">файла нет</span>}
      </div>
    </li>
  );
}
