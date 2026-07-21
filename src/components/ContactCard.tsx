import { useMemo, useState } from 'react';
import type { CalEvent, Checklist, FinanceEntry, Note, Relation } from '../types';
import { useListActions } from '../lib/storage';
import { fromKey } from '../lib/dates';
import { renderMarkdown } from '../lib/markdown';
import { getBacklinks, getLinks } from '../lib/relations';
import { debtSign, formatMoney, personBalances, personLedger } from '../lib/finance';
import type { LinkedTask } from '../lib/checklistLinks';
import { tasksLinkedToNote, toggleItemInList } from '../lib/checklistLinks';
import { mapLink } from '../lib/locations';
import { AttachmentList } from './Attachments';
import { NoteModal } from './NotesView';

interface Props {
  note: Note;
  finance: FinanceEntry[];
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
  events?: CalEvent[];
  currency: string;
  onClose: () => void;
}

export function ContactCard({
  note,
  finance,
  checklists,
  setChecklists,
  notes,
  setNotes,
  relations,
  setRelations,
  events,
  currency,
  onClose,
}: Props) {
  const noteActions = useListActions(setNotes);
  const [edit, setEdit] = useState(false);

  const locEvents = useMemo(
    () =>
      (events ?? [])
        .filter((e) => !e.deleted && e.locationId === note.id)
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    [events, note.id],
  );

  const ledger = useMemo(() => personLedger(finance, note.title), [finance, note.title]);
  const net = useMemo(
    () => personBalances(finance).find((b) => b.person === note.title)?.net ?? 0,
    [finance, note.title],
  );
  const tasks = useMemo(() => tasksLinkedToNote(checklists, note.id), [checklists, note.id]);
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const linked = useMemo(() => {
    const ids = new Set<string>([...getLinks(note.id, relations)]);
    for (const b of getBacklinks(note.id, relations)) ids.add(b.from);
    return [...ids]
      .map((id) => byId.get(id))
      .filter(
        (n): n is Note =>
          !!n && !n.deleted && n.id !== note.id && n.type !== 'folder' && n.type !== 'tag',
      );
  }, [note.id, relations, byId]);

  function toggleTask(t: LinkedTask) {
    setChecklists((cs) =>
      cs.map((c) =>
        c.id === t.listId
          ? { ...c, items: toggleItemInList(c.items, t.item.id), updatedAt: Date.now() }
          : c,
      ),
    );
  }

  if (edit) {
    return (
      <NoteModal
        note={note}
        allNotes={notes}
        relations={relations}
        setRelations={setRelations}
        onSave={(patch) => noteActions.update(note.id, { ...patch, updatedAt: Date.now() })}
        onDelete={() => {
          noteActions.remove(note.id);
          onClose();
        }}
        onClose={() => setEdit(false)}
      />
    );
  }

  const isLocation = note.type === 'location';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-note" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="note-read-meta">
            <span className={`type-badge type-${note.type}`}>{isLocation ? 'локация' : 'персона'}</span>
            {note.category && <span className="chip">{note.category}</span>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <h2 className="note-read-title">{note.title || 'Без названия'}</h2>

        <div className="note-contact">
          {note.phone && (
            <a className="note-contact-row" href={`tel:${note.phone}`}>
              <span aria-hidden>📞</span> {note.phone}
            </a>
          )}
          {note.address && (
            <a className="note-contact-row" href={mapLink(note.address)} target="_blank" rel="noreferrer">
              <span aria-hidden>📍</span> {note.address}
            </a>
          )}
        </div>

        {note.body.trim() && (
          <div className="md note-read-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body) }} />
        )}

        <AttachmentList items={note.attachments} />

        {!isLocation && ledger.length > 0 && (
          <div className="cc-section">
            <div className="cc-sec-head">
              <span className="field-label">Долги</span>
              <span className={`fin-net ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}`}>
                {net > 0
                  ? `должен мне ${formatMoney(net, currency)}`
                  : net < 0
                    ? `я должен ${formatMoney(-net, currency)}`
                    : 'рассчитались'}
              </span>
            </div>
            <ul className="fin-ledger">
              {ledger.map(({ entry, running }) => (
                <li key={entry.id} className="fin-led-item">
                  <span className="fin-led-date">{fromKey(entry.date).toLocaleDateString('ru-RU')}</span>
                  <span className={`fin-led-amt ${debtSign(entry.kind) > 0 ? 'pos' : 'neg'}`}>
                    {debtSign(entry.kind) > 0 ? '+' : '−'}
                    {formatMoney(entry.amount, currency)}
                  </span>
                  <span className="fin-led-run muted small">итог {formatMoney(running, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isLocation && locEvents.length > 0 && (
          <div className="cc-section">
            <span className="field-label">События здесь</span>
            <ul className="fin-ledger">
              {locEvents.map((e) => (
                <li key={e.id} className="fin-led-item">
                  <span className="fin-led-date">{fromKey(e.date).toLocaleDateString('ru-RU')}</span>
                  <span className="fin-led-kind">
                    {e.start ? `${e.start} ` : ''}
                    {e.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tasks.length > 0 && (
          <div className="cc-section">
            <span className="field-label">Задачи</span>
            <ul className="cl-items">
              {tasks.map((t) => (
                <li key={t.item.id} className={`cl-item ${t.item.done ? 'done' : ''}`}>
                  <div className="cl-item-row">
                    <button className="cl-check" onClick={() => toggleTask(t)} aria-label="Отметить">
                      {t.item.done ? '✓' : ''}
                    </button>
                    <span className="cl-item-text">{t.item.text}</span>
                    <span className="muted small">{t.listTitle}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {linked.length > 0 && (
          <div className="cc-section">
            <span className="field-label">Связанные заметки</span>
            <div className="cc-links">
              {linked.map((n) => (
                <span key={n.id} className="nrr-chip">
                  {n.title || 'Без названия'}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="modal-foot modal-foot-split">
          <span />
          <button className="btn btn-primary" onClick={() => setEdit(true)}>
            ✎ Изменить данные
          </button>
        </div>
      </div>
    </div>
  );
}
