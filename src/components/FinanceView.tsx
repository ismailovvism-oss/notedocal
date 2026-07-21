import { useMemo, useState } from 'react';
import type { CalEvent, Checklist, FinanceEntry, FinanceKind, Note, Relation } from '../types';
import { uid, useListActions } from '../lib/storage';
import { dayKey, fromKey, todayKey } from '../lib/dates';
import {
  DEBT_KINDS,
  EXPENSE_CATEGORIES,
  FIN_LABEL,
  debtSign,
  debtTotals,
  formatMoney,
  moneyInRange,
  moneyTotals,
  personBalances,
  personLedger,
  persons,
} from '../lib/finance';
import { CONTACTS_FOLDER_ID, findPerson } from '../lib/persons';
import type { Vault } from '../lib/vault';
import { ContactCard } from './ContactCard';

interface Props {
  finance: FinanceEntry[];
  setFinance: React.Dispatch<React.SetStateAction<FinanceEntry[]>>;
  currency: string;
  setCurrency: React.Dispatch<React.SetStateAction<string>>;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  events: CalEvent[];
  vault: Vault;
}

function monthStart(): string {
  const d = new Date();
  return dayKey(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function FinanceView({
  finance,
  setFinance,
  currency,
  setCurrency,
  notes,
  setNotes,
  relations,
  setRelations,
  checklists,
  setChecklists,
  events,
  vault,
}: Props) {
  const [mode, setMode] = useState<'debts' | 'expenses'>('debts');

  return (
    <section className="view view-narrow fin">
      <div className="view-head">
        <h2>Финансы</h2>
        <input
          className="input fin-cur"
          placeholder="валюта"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.slice(0, 6))}
          title="Символ валюты (₽, сум, $…)"
        />
      </div>

      <div className="fin-tabs">
        <button className={`fin-tab ${mode === 'debts' ? 'active' : ''}`} onClick={() => setMode('debts')}>
          Долги
        </button>
        <button
          className={`fin-tab ${mode === 'expenses' ? 'active' : ''}`}
          onClick={() => setMode('expenses')}
        >
          Расходы
        </button>
      </div>

      {mode === 'debts' ? (
        <DebtsPanel
          finance={finance}
          setFinance={setFinance}
          currency={currency}
          notes={notes}
          setNotes={setNotes}
          relations={relations}
          setRelations={setRelations}
          checklists={checklists}
          setChecklists={setChecklists}
          events={events}
          vault={vault}
        />
      ) : (
        <ExpensesPanel finance={finance} setFinance={setFinance} currency={currency} />
      )}
    </section>
  );
}

function DebtsPanel({
  finance,
  setFinance,
  currency,
  notes,
  setNotes,
  relations,
  setRelations,
  checklists,
  setChecklists,
  events,
  vault,
}: {
  finance: FinanceEntry[];
  setFinance: React.Dispatch<React.SetStateAction<FinanceEntry[]>>;
  currency: string;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
  checklists: Checklist[];
  setChecklists: React.Dispatch<React.SetStateAction<Checklist[]>>;
  events: CalEvent[];
  vault: Vault;
}) {
  const { add, remove } = useListActions(setFinance);
  const noteActions = useListActions(setNotes);
  const relActions = useListActions(setRelations);
  const [selected, setSelected] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState('');
  const [kind, setKind] = useState<FinanceKind>('lent');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayKey());
  const [note, setNote] = useState('');

  const balances = useMemo(() => personBalances(finance), [finance]);
  const totals = debtTotals(balances);
  const allPersons = useMemo(() => persons(finance), [finance]);
  const cardNote = cardId ? notes.find((n) => n.id === cardId) ?? null : null;

  // Найти карточку персоны по имени, создав её при необходимости (в папке «Контакты»).
  function ensurePerson(name: string): string {
    const existing = findPerson(notes, name);
    if (existing) return existing.id;
    const now = Date.now();
    if (!notes.some((n) => n.id === CONTACTS_FOLDER_ID)) {
      noteActions.add({
        id: CONTACTS_FOLDER_ID,
        title: 'Контакты',
        body: '',
        type: 'folder',
        date: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    const id = uid();
    noteActions.add({
      id,
      title: name,
      body: '',
      type: 'person',
      date: null,
      createdAt: now,
      updatedAt: now,
    });
    relActions.add({
      id: uid(),
      from: CONTACTS_FOLDER_ID,
      to: id,
      type: 'child',
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  function openCard(name: string) {
    setCardId(ensurePerson(name));
  }

  function save() {
    const amt = Math.abs(Number(amount));
    const who = (selected ?? person).trim();
    if (!who || !amt) return;
    const now = Date.now();
    add({
      id: uid(),
      kind,
      amount: amt,
      date,
      person: who,
      note: note.trim(),
      createdAt: now,
      updatedAt: now,
    });
    ensurePerson(who); // завести карточку контакта, если ещё нет
    setAmount('');
    setNote('');
    setOpen(false);
  }

  const netLabel = (net: number) =>
    net > 0
      ? `должен мне ${formatMoney(net, currency)}`
      : net < 0
        ? `я должен ${formatMoney(-net, currency)}`
        : 'рассчитались';

  const formBlock = open ? (
    <div className="fin-form">
      {!selected && (
        <>
          <input
            className="input"
            list="fin-persons"
            placeholder="Кто (имя)"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          />
          <datalist id="fin-persons">
            {allPersons.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </>
      )}
      <div className="fin-kinds">
        {DEBT_KINDS.map((k) => (
          <button key={k} className={`hl-kind ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
            {FIN_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="ev-form-row">
        <input
          className="input"
          type="number"
          inputMode="numeric"
          placeholder="Сумма"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <input
        className="input"
        placeholder="Комментарий (за что)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="ev-form-actions">
        <button className="btn btn-primary" onClick={save}>
          Добавить
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </div>
  ) : (
    <button className="btn btn-small" onClick={() => setOpen(true)}>
      ＋ Долг / возврат
    </button>
  );

  const cardModal = cardNote ? (
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

  if (selected) {
    const ledger = personLedger(finance, selected);
    const net = balances.find((b) => b.person === selected)?.net ?? 0;
    const personNote = findPerson(notes, selected);
    return (
      <div>
        <button className="fin-back" onClick={() => setSelected(null)}>
          ‹ Все контрагенты
        </button>
        <div className="fin-person-head">
          <h3>{selected}</h3>
          <span className={`fin-net ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}`}>{netLabel(net)}</span>
        </div>

        <div className="fin-person-contact">
          {personNote?.phone && (
            <a className="fin-contact-chip" href={`tel:${personNote.phone}`}>
              📞 {personNote.phone}
            </a>
          )}
          {personNote?.address && <span className="fin-contact-chip">📍 {personNote.address}</span>}
          <button className="btn btn-small" onClick={() => openCard(selected)}>
            📇 Карточка
          </button>
        </div>

        {ledger.length === 0 ? (
          <p className="empty">Записей нет</p>
        ) : (
          <ul className="fin-ledger">
            {ledger.map(({ entry, running }) => (
              <li key={entry.id} className="fin-led-item">
                <span className="fin-led-date">{fromKey(entry.date).toLocaleDateString('ru-RU')}</span>
                <span className="fin-led-kind">{FIN_LABEL[entry.kind]}</span>
                <span className={`fin-led-amt ${debtSign(entry.kind) > 0 ? 'pos' : 'neg'}`}>
                  {debtSign(entry.kind) > 0 ? '+' : '−'}
                  {formatMoney(entry.amount, currency)}
                </span>
                <span className="fin-led-run muted small">итог {formatMoney(running, currency)}</span>
                {entry.note && <span className="muted small fin-led-note">{entry.note}</span>}
                <button className="icon-btn" onClick={() => remove(entry.id)} aria-label="Удалить">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {formBlock}
        {cardModal}
      </div>
    );
  }

  return (
    <div>
      <div className="fin-summary">
        <div className="fin-sum-card pos">
          <span className="muted small">Мне должны</span>
          <b>{formatMoney(totals.owedToMe, currency)}</b>
        </div>
        <div className="fin-sum-card neg">
          <span className="muted small">Я должен</span>
          <b>{formatMoney(totals.iOwe, currency)}</b>
        </div>
      </div>

      {balances.length === 0 ? (
        <p className="empty">Долгов пока нет</p>
      ) : (
        <ul className="fin-people">
          {balances.map((b) => (
            <li key={b.person}>
              <button className="fin-person" onClick={() => setSelected(b.person)}>
                <span className="fin-person-name">{b.person}</span>
                <span className={`fin-net ${b.net > 0 ? 'pos' : b.net < 0 ? 'neg' : ''}`}>
                  {b.net > 0
                    ? `+${formatMoney(b.net, currency)}`
                    : b.net < 0
                      ? `−${formatMoney(-b.net, currency)}`
                      : '0'}
                </span>
                <span className="fin-chev">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {formBlock}
      {cardModal}
    </div>
  );
}

function ExpensesPanel({
  finance,
  setFinance,
  currency,
}: {
  finance: FinanceEntry[];
  setFinance: React.Dispatch<React.SetStateAction<FinanceEntry[]>>;
  currency: string;
}) {
  const { add, remove } = useListActions(setFinance);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayKey);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FinanceKind>('expense');
  const [category, setCategory] = useState('Коммуналка');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayKey());
  const [note, setNote] = useState('');

  const list = useMemo(() => moneyInRange(finance, from, to), [finance, from, to]);
  const totals = useMemo(() => moneyTotals(list), [list]);

  function save() {
    const amt = Math.abs(Number(amount));
    if (!amt) return;
    const now = Date.now();
    add({
      id: uid(),
      kind,
      amount: amt,
      date,
      category: kind === 'expense' ? category.trim() || 'Другое' : '',
      note: note.trim(),
      createdAt: now,
      updatedAt: now,
    });
    setAmount('');
    setNote('');
    setOpen(false);
  }

  return (
    <div>
      <div className="db-dates fin-dates">
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="muted">—</span>
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      <div className="fin-summary">
        <div className="fin-sum-card neg">
          <span className="muted small">Потрачено</span>
          <b>{formatMoney(totals.spent, currency)}</b>
        </div>
        {totals.income > 0 && (
          <div className="fin-sum-card pos">
            <span className="muted small">Доход</span>
            <b>{formatMoney(totals.income, currency)}</b>
          </div>
        )}
      </div>

      {totals.byCategory.length > 0 && (
        <div className="fin-cats">
          {totals.byCategory.map((c) => (
            <span key={c.category} className="fin-cat-chip">
              {c.category}: {formatMoney(c.sum, currency)}
            </span>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <p className="empty">За этот период трат нет</p>
      ) : (
        <ul className="fin-exp-list">
          {list.map((e) => (
            <li key={e.id} className="fin-exp-item">
              <span className="fin-led-date">{fromKey(e.date).toLocaleDateString('ru-RU')}</span>
              <span className="fin-exp-cat">{e.kind === 'income' ? 'Доход' : e.category || 'Другое'}</span>
              <span className={`fin-led-amt ${e.kind === 'income' ? 'pos' : 'neg'}`}>
                {e.kind === 'income' ? '+' : '−'}
                {formatMoney(e.amount, currency)}
              </span>
              {e.note && <span className="muted small fin-led-note">{e.note}</span>}
              <button className="icon-btn" onClick={() => remove(e.id)} aria-label="Удалить">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="fin-form">
          <div className="fin-kinds">
            <button
              className={`hl-kind ${kind === 'expense' ? 'active' : ''}`}
              onClick={() => setKind('expense')}
            >
              Расход
            </button>
            <button
              className={`hl-kind ${kind === 'income' ? 'active' : ''}`}
              onClick={() => setKind('income')}
            >
              Доход
            </button>
          </div>
          {kind === 'expense' && (
            <>
              <div className="fin-cat-pick">
                {EXPENSE_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    className={`fin-cat-btn ${category === c ? 'active' : ''}`}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <input
                className="input"
                placeholder="Категория"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </>
          )}
          <div className="ev-form-row">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              placeholder="Сумма"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <input
            className="input"
            placeholder="Комментарий"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="ev-form-actions">
            <button className="btn btn-primary" onClick={save}>
              Добавить
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-small" onClick={() => setOpen(true)}>
          ＋ Расход / доход
        </button>
      )}
    </div>
  );
}
