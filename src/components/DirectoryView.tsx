import { useMemo, useState } from 'react';
import type { CalEvent, Checklist, FinanceEntry, Note, Relation } from '../types';
import { uid, useListActions } from '../lib/storage';
import { formatMoney, personBalances } from '../lib/finance';
import { CONTACTS_FOLDER_ID, listPersons } from '../lib/persons';
import { LOCATION_CATEGORIES, LOCATIONS_FOLDER_ID, locationsByCategory } from '../lib/locations';
import { ContactCard } from './ContactCard';

interface Props {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
  finance: FinanceEntry[];
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  events: CalEvent[];
  currency: string;
}

export function DirectoryView({
  notes,
  setNotes,
  relations,
  setRelations,
  finance,
  checklists,
  setChecklists,
  events,
  currency,
}: Props) {
  const noteActions = useListActions(setNotes);
  const relActions = useListActions(setRelations);
  const [mode, setMode] = useState<'people' | 'places'>('people');
  const [cardId, setCardId] = useState<string | null>(null);

  // Форма добавления локации.
  const [addLoc, setAddLoc] = useState(false);
  const [locName, setLocName] = useState('');
  const [locCat, setLocCat] = useState('Магазин');
  const [locAddr, setLocAddr] = useState('');
  // Форма добавления персоны.
  const [personName, setPersonName] = useState('');

  const persons = useMemo(() => listPersons(notes), [notes]);
  const balances = useMemo(() => personBalances(finance), [finance]);
  const places = useMemo(() => locationsByCategory(notes), [notes]);
  const cardNote = cardId ? notes.find((n) => n.id === cardId) ?? null : null;

  function ensureFolder(id: string, title: string) {
    if (notes.some((n) => n.id === id)) return;
    const now = Date.now();
    noteActions.add({ id, title, body: '', type: 'folder', date: null, createdAt: now, updatedAt: now });
  }

  function addPerson() {
    const name = personName.trim();
    if (!name) return;
    ensureFolder(CONTACTS_FOLDER_ID, 'Контакты');
    const id = uid();
    const now = Date.now();
    noteActions.add({ id, title: name, body: '', type: 'person', date: null, createdAt: now, updatedAt: now });
    relActions.add({
      id: uid(),
      from: CONTACTS_FOLDER_ID,
      to: id,
      type: 'child',
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    setPersonName('');
    setCardId(id);
  }

  function addLocation() {
    const name = locName.trim();
    if (!name) return;
    ensureFolder(LOCATIONS_FOLDER_ID, 'Места');
    const id = uid();
    const now = Date.now();
    noteActions.add({
      id,
      title: name,
      body: '',
      type: 'location',
      category: locCat.trim() || 'Другое',
      address: locAddr.trim(),
      date: null,
      createdAt: now,
      updatedAt: now,
    });
    relActions.add({
      id: uid(),
      from: LOCATIONS_FOLDER_ID,
      to: id,
      type: 'child',
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    setLocName('');
    setLocAddr('');
    setAddLoc(false);
    setCardId(id);
  }

  const card = cardNote ? (
    <ContactCard
      note={cardNote}
      finance={finance}
      checklists={checklists}
      setChecklists={setChecklists}
      notes={notes}
      setNotes={setNotes}
      relations={relations}
      setRelations={setRelations}
      events={events}
      currency={currency}
      onClose={() => setCardId(null)}
    />
  ) : null;

  return (
    <section className="view view-narrow">
      <div className="view-head">
        <h2>Справочник</h2>
      </div>

      <div className="fin-tabs">
        <button className={`fin-tab ${mode === 'people' ? 'active' : ''}`} onClick={() => setMode('people')}>
          Контакты
        </button>
        <button className={`fin-tab ${mode === 'places' ? 'active' : ''}`} onClick={() => setMode('places')}>
          Места
        </button>
      </div>

      {mode === 'people' ? (
        <div>
          <form
            className="cl-quick"
            onSubmit={(e) => {
              e.preventDefault();
              addPerson();
            }}
          >
            <input
              className="input cl-quick-input"
              placeholder="＋ Новый контакт (имя)"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
            />
          </form>

          {persons.length === 0 ? (
            <p className="empty">Контактов пока нет</p>
          ) : (
            <ul className="fin-people">
              {persons.map((p) => {
                const net = balances.find((b) => b.person === p.title)?.net ?? 0;
                return (
                  <li key={p.id}>
                    <button className="fin-person" onClick={() => setCardId(p.id)}>
                      <span className="fin-person-name">{p.title || 'Без имени'}</span>
                      {p.phone && <span className="muted small">{p.phone}</span>}
                      {net !== 0 && (
                        <span className={`fin-net ${net > 0 ? 'pos' : 'neg'}`}>
                          {net > 0 ? `+${formatMoney(net, currency)}` : `−${formatMoney(-net, currency)}`}
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
      ) : (
        <div>
          {places.length === 0 ? (
            <p className="empty">Мест пока нет</p>
          ) : (
            places.map((group) => (
              <div key={group.category} className="dir-cat">
                <h3 className="dir-cat-title">{group.category}</h3>
                <ul className="fin-people">
                  {group.items.map((l) => (
                    <li key={l.id}>
                      <button className="fin-person" onClick={() => setCardId(l.id)}>
                        <span className="fin-person-name">{l.title || 'Без названия'}</span>
                        {l.address && <span className="muted small dir-addr">{l.address}</span>}
                        <span className="fin-chev">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}

          {addLoc ? (
            <div className="fin-form">
              <input
                className="input"
                placeholder="Название места"
                value={locName}
                onChange={(e) => setLocName(e.target.value)}
              />
              <div className="fin-cat-pick">
                {LOCATION_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    className={`fin-cat-btn ${locCat === c ? 'active' : ''}`}
                    onClick={() => setLocCat(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <input
                className="input"
                placeholder="Адрес"
                value={locAddr}
                onChange={(e) => setLocAddr(e.target.value)}
              />
              <div className="ev-form-actions">
                <button className="btn btn-primary" onClick={addLocation}>
                  Добавить
                </button>
                <button className="btn" onClick={() => setAddLoc(false)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-small" onClick={() => setAddLoc(true)}>
              ＋ Место
            </button>
          )}
        </div>
      )}

      {card}
    </section>
  );
}
