import { useMemo, useState } from 'react';
import type { CalEvent, Checklist, FinanceEntry, Note, Relation } from '../types';
import { uid, useListActions } from '../lib/storage';
import { fromKey, todayKey } from '../lib/dates';
import { renderMarkdown } from '../lib/markdown';
import { getBacklinks, getLinks } from '../lib/relations';
import { debtSign, formatMoney, personBalances, personLedger } from '../lib/finance';
import type { LinkedTask } from '../lib/checklistLinks';
import { tasksLinkedToNote, toggleItemInList } from '../lib/checklistLinks';
import { effectiveContacts } from '../lib/persons';
import { mapLink } from '../lib/locations';
import { personCredentials, personDocuments, expiryStatus } from '../lib/docs';
import { decryptStr, type Vault } from '../lib/vault';
import { AttachmentList } from './Attachments';
import { ContactLinks } from './ContactLinks';
import { CredentialEditor } from './CredentialEditor';
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
  vault: Vault;
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
  vault,
  currency,
  onClose,
}: Props) {
  const noteActions = useListActions(setNotes);
  const relActions = useListActions(setRelations);
  const [edit, setEdit] = useState(false);
  const [docEditId, setDocEditId] = useState<string | null>(null);
  const [credEditId, setCredEditId] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const isPerson = note.type === 'person';
  const docs = useMemo(() => personDocuments(note, notes, relations), [note, notes, relations]);
  const creds = useMemo(() => personCredentials(note, notes, relations), [note, notes, relations]);
  const today = todayKey();

  function addChildNote(child: Note) {
    const now = Date.now();
    noteActions.add(child);
    relActions.add({
      id: uid(),
      from: note.id,
      to: child.id,
      type: 'child',
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  function addDocument() {
    const now = Date.now();
    const id = uid();
    addChildNote({ id, title: '', body: '', type: 'document', date: null, createdAt: now, updatedAt: now });
    setDocEditId(id);
  }
  function addCredential() {
    const now = Date.now();
    const id = uid();
    addChildNote({ id, title: '', body: '', type: 'credential', date: null, createdAt: now, updatedAt: now });
    setCredEditId(id);
  }
  async function reveal(c: Note) {
    if (!vault.key || !c.secret) return;
    try {
      const s = await decryptStr(vault.key, c.secret);
      setRevealed((r) => ({ ...r, [c.id]: s }));
    } catch {
      setPwErr('Ошибка расшифровки');
    }
  }
  function hide(id: string) {
    setRevealed((r) => {
      const n = { ...r };
      delete n[id];
      return n;
    });
  }
  async function submitPw() {
    setPwErr('');
    const ok = vault.status === 'unset' ? (await vault.setup(pw), true) : await vault.unlock(pw);
    if (!ok) setPwErr('Неверный мастер-пароль');
    else setPw('');
  }

  const docEditNote = docEditId ? notes.find((n) => n.id === docEditId) ?? null : null;
  const credEditNote = credEditId ? notes.find((n) => n.id === credEditId) ?? null : null;

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
        initialMode="edit"
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

        <ContactLinks contacts={effectiveContacts(note)} />
        {(() => {
          const loc = note.locationId ? byId.get(note.locationId) : undefined;
          const addr = loc?.address || loc?.title || note.address;
          if (!addr) return null;
          return (
            <div className="note-contact">
              <a className="note-contact-row" href={mapLink(addr)} target="_blank" rel="noreferrer">
                <span aria-hidden>📍</span> {loc ? loc.title : note.address}
                {loc?.address ? <span className="muted small"> · {loc.address}</span> : null}
              </a>
            </div>
          );
        })()}

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

        {isPerson && (
          <div className="cc-section">
            <div className="cc-sec-head">
              <span className="field-label">Документы</span>
              <button className="btn btn-small" onClick={addDocument}>
                ＋ Документ
              </button>
            </div>
            {docs.length === 0 ? (
              <span className="muted small">нет</span>
            ) : (
              <ul className="fin-people">
                {docs.map((d) => {
                  const st = expiryStatus(d.expires, today);
                  return (
                    <li key={d.id}>
                      <button className="fin-person" onClick={() => setDocEditId(d.id)}>
                        <span className="fin-person-name">
                          {d.category || 'Документ'}
                          {d.docNumber ? <span className="muted small"> · {d.docNumber}</span> : null}
                        </span>
                        {d.attachments && d.attachments.length > 0 && (
                          <span className="muted small">📎 {d.attachments.length}</span>
                        )}
                        {d.expires && (
                          <span className={`doc-exp doc-exp-${st}`}>
                            до {fromKey(d.expires).toLocaleDateString('ru-RU')}
                          </span>
                        )}
                        <span className="fin-chev">›</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {isPerson && (
          <div className="cc-section">
            <div className="cc-sec-head">
              <span className="field-label">🔒 Пароли</span>
              {vault.status === 'unlocked' && (
                <button className="btn btn-small" onClick={addCredential}>
                  ＋ Пароль
                </button>
              )}
            </div>

            {vault.status !== 'unlocked' ? (
              <div className="cc-vault">
                <p className="muted small">
                  {vault.status === 'unset'
                    ? 'Задайте мастер-пароль — им шифруются пароли (в облаке только шифртекст). Забудете — восстановить нельзя.'
                    : 'Введите мастер-пароль, чтобы показать пароли.'}
                </p>
                <div className="cred-secret">
                  <input
                    className="input"
                    type="password"
                    placeholder="Мастер-пароль"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitPw()}
                  />
                  <button className="btn btn-small btn-primary" onClick={submitPw}>
                    {vault.status === 'unset' ? 'Задать' : 'Открыть'}
                  </button>
                </div>
                {pwErr && <p className="rel-error small">{pwErr}</p>}
              </div>
            ) : creds.length === 0 ? (
              <span className="muted small">нет</span>
            ) : (
              <ul className="fin-people">
                {creds.map((c) => (
                  <li key={c.id} className="cred-item">
                    <button className="fin-person cred-main" onClick={() => setCredEditId(c.id)}>
                      <span className="fin-person-name">{c.title || 'Без названия'}</span>
                      {c.login && <span className="muted small">{c.login}</span>}
                    </button>
                    <span className="cred-pw muted small">{revealed[c.id] ?? '••••••'}</span>
                    {revealed[c.id] ? (
                      <>
                        <button
                          className="icon-btn"
                          title="Скопировать"
                          onClick={() => navigator.clipboard?.writeText(revealed[c.id])}
                        >
                          ⧉
                        </button>
                        <button className="icon-btn" title="Скрыть" onClick={() => hide(c.id)}>
                          🙈
                        </button>
                      </>
                    ) : (
                      <button className="icon-btn" title="Показать" onClick={() => reveal(c)}>
                        👁
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {vault.status === 'unlocked' && (
              <button className="btn btn-small cc-lock" onClick={vault.lock}>
                Заблокировать
              </button>
            )}
          </div>
        )}

        <div className="modal-foot modal-foot-split">
          <span />
          <button className="btn btn-primary" onClick={() => setEdit(true)}>
            ✎ Изменить данные
          </button>
        </div>
      </div>

      {docEditNote && (
        <NoteModal
          note={docEditNote}
          allNotes={notes}
          relations={relations}
          setRelations={setRelations}
          initialMode="edit"
          onSave={(patch) => noteActions.update(docEditNote.id, { ...patch, updatedAt: Date.now() })}
          onDelete={() => {
            noteActions.remove(docEditNote.id);
            setDocEditId(null);
          }}
          onClose={() => setDocEditId(null)}
        />
      )}
      {credEditNote && (
        <CredentialEditor
          note={credEditNote}
          vault={vault}
          setNotes={setNotes}
          onClose={() => setCredEditId(null)}
        />
      )}
    </div>
  );
}
