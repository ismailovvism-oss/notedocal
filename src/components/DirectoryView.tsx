import { useMemo, useState } from 'react';
import type { CalEvent, Checklist, FinanceEntry, Note, Relation } from '../types';
import { uid, useListActions } from '../lib/storage';
import { formatMoney, personBalances } from '../lib/finance';
import { CONTACTS_FOLDER_ID, listPersons } from '../lib/persons';
import {
  LOCATION_CATEGORIES,
  LOCATIONS_FOLDER_ID,
  coverPhoto,
  iconOf,
  knownCities,
  locationsByCity,
} from '../lib/locations';
import type { Vault } from '../lib/vault';
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
  vault: Vault;
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
  vault,
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
  const [locCity, setLocCity] = useState('');
  // Массовый импорт локаций списком.
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  // Форма добавления персоны.
  const [personName, setPersonName] = useState('');

  const persons = useMemo(() => listPersons(notes), [notes]);
  const balances = useMemo(() => personBalances(finance), [finance]);
  const cities = useMemo(() => locationsByCity(notes), [notes]);
  const cityHints = useMemo(() => knownCities(notes), [notes]);
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
      city: locCity.trim(),
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

  // Импорт списком: строка = «Название | Категория | Адрес | Город» (| или таб;
  // всё, кроме названия, необязательно).
  function importLocations() {
    const lines = importText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    ensureFolder(LOCATIONS_FOLDER_ID, 'Места');
    const now = Date.now();
    lines.forEach((line, i) => {
      const parts = line.split(/[|\t]/).map((s) => s.trim());
      const title = parts[0];
      if (!title) return;
      const id = uid();
      noteActions.add({
        id,
        title,
        body: '',
        type: 'location',
        category: parts[1] || 'Другое',
        address: parts[2] || '',
        city: parts[3] || '',
        date: null,
        createdAt: now + i,
        updatedAt: now + i,
      });
      relActions.add({
        id: uid(),
        from: LOCATIONS_FOLDER_ID,
        to: id,
        type: 'child',
        position: i,
        createdAt: now,
        updatedAt: now,
      });
    });
    setImportText('');
    setImportOpen(false);
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
      vault={vault}
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
          {cities.length === 0 ? (
            <p className="empty">Мест пока нет</p>
          ) : (
            cities.map((city) => (
              <div key={city.city} className="dir-city">
                <h3 className="dir-city-title">
                  {city.city}
                  <span className="muted small dir-city-count">{city.count}</span>
                </h3>
                {city.groups.map((group) => (
                  <div key={group.category} className="dir-cat">
                    <h4 className="dir-cat-title">
                      <span aria-hidden>{iconOf(group.category)}</span> {group.category}
                    </h4>
                    <div className="dir-grid">
                      {group.items.map((l) => {
                        const cover = coverPhoto(l);
                        return (
                          <button key={l.id} className="dir-card" onClick={() => setCardId(l.id)}>
                            <span className="dir-card-photo">
                              {cover ? (
                                <img src={cover.url} alt="" loading="lazy" />
                              ) : (
                                <span className="dir-card-ic" aria-hidden>
                                  {iconOf(l.category)}
                                </span>
                              )}
                            </span>
                            <span className="dir-card-name">{l.title || 'Без названия'}</span>
                            {l.address && <span className="muted small dir-addr">{l.address}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
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
                placeholder="Адрес, координаты или ссылка Google Maps"
                value={locAddr}
                onChange={(e) => setLocAddr(e.target.value)}
              />
              <input
                className="input"
                placeholder="Город (по нему группируются места)"
                list="dir-city-hints"
                value={locCity}
                onChange={(e) => setLocCity(e.target.value)}
              />
              <datalist id="dir-city-hints">
                {cityHints.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
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
            <div className="dir-loc-actions">
              <button className="btn btn-small" onClick={() => setAddLoc(true)}>
                ＋ Место
              </button>
              <button className="btn btn-small" onClick={() => setImportOpen((v) => !v)}>
                Импорт списком
              </button>
            </div>
          )}

          {importOpen && (
            <div className="fin-form">
              <p className="muted small">
                По одной локации в строке. Формат: <b>Название | Категория | Адрес | Город</b> (всё,
                кроме названия, необязательно; разделитель — « | » или табуляция).
              </p>
              <textarea
                className="input"
                rows={6}
                placeholder={
                  'Аптека №5 | Аптека | Амира Темура 5 | Ташкент\nКафе «Плов» | Кафе | | Ташкент\nДом'
                }
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <div className="ev-form-actions">
                <button className="btn btn-primary" onClick={importLocations}>
                  Добавить все
                </button>
                <button className="btn" onClick={() => setImportOpen(false)}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {card}
    </section>
  );
}
