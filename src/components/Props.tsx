// Свойства заметки, схема и вид — показ в чтении (docs/ЗАМЕТКИ.md, 3.4, этап 4). Правка —
// src/components/PropsEdit.tsx (грузится лениво, вместе с разбором YAML).

import { useMemo, useState } from 'react';
import type { Note } from '../types';
import { useKb } from '../lib/kb/ui';
import {
  checkProps,
  display,
  fieldsOf,
  groupBy,
  isEmpty,
  parseView,
  runView,
  schemaCoverage,
  schemas,
  valueOf,
  OWN_KEYS,
  type Field,
} from '../lib/kb/schema';
import { plainText } from '../lib/kb/syntax';

/** Поля схемы для заметки — по её тегам. */
function useSchemaFields(noteId: string | undefined, tags: string[]): Field[] {
  const kb = useKb();
  return useMemo(() => {
    if (!kb) return [];
    const all = schemas(kb.index.byId.values());
    return fieldsOf(all, noteId ? (kb.index.noteTags.get(noteId) ?? tags) : tags);
  }, [kb, noteId, tags]);
}

/** Одно значение: ссылки — переходом, остальное — текстом. */
function Value({ v }: { v: unknown }) {
  const kb = useKb();
  const items = Array.isArray(v) ? v : [v];
  return (
    <>
      {items.map((x, i) => {
        const s = String(x);
        const link = s.match(/^\[\[([^\]|#]*)(#[^\]|]*)?(\|([^\]]*))?\]\]$/);
        const sep = i ? ', ' : '';
        if (link && kb) {
          const anchor = link[2]?.startsWith('#^') ? link[2].slice(2) : undefined;
          const heading = link[2] && !anchor ? link[2].slice(1) : undefined;
          return (
            <span key={i}>
              {sep}
              <a
                className="kb-link"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  kb.open({ name: link[1], anchor, heading });
                }}
              >
                {link[4] ?? link[1]}
              </a>
            </span>
          );
        }
        return (
          <span key={i}>
            {sep}
            {typeof x === 'object' && x !== null ? JSON.stringify(x) : display(x)}
          </span>
        );
      })}
    </>
  );
}

/** Свойства в чтении: сначала поля схемы (недостающие обязательные — красным), потом прочие. */
export function PropsView({ note }: { note: Note }) {
  const fields = useSchemaFields(note.id, note.tags ?? []);
  const props = note.props ?? {};
  const hidden = new Set(OWN_KEYS[note.type ?? ''] ?? []);
  const { missing, wrong } = checkProps(props, fields);
  const inSchema = new Set(fields.map((f) => f.name.toLowerCase()));
  const rest = Object.keys(props).filter((k) => !inSchema.has(k.toLowerCase()) && !hidden.has(k) && !isEmpty(props[k]));
  const shown = fields.filter((f) => !isEmpty(props[f.name]) || f.required);
  if (!shown.length && !rest.length) return null;
  return (
    <div className="props-view">
      {shown.map((f) => (
        <div key={f.name} className={`prop-row ${missing.includes(f.name) ? 'prop-missing' : ''} ${wrong.includes(f.name) ? 'prop-wrong' : ''}`}>
          <span className="prop-key">{f.name}</span>
          <span className="prop-val">{missing.includes(f.name) ? 'не заполнено' : <Value v={props[f.name]} />}</span>
        </div>
      ))}
      {rest.map((k) => (
        <div key={k} className="prop-row">
          <span className="prop-key">{k}</span>
          <span className="prop-val">
            <Value v={props[k]} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Схема в чтении: поля и сколько заметок под ней неполные. */
export function SchemaView({ note }: { note: Note }) {
  const kb = useKb();
  const s = useMemo(() => (kb ? schemas([note])[0] : null), [kb, note]);
  if (!kb || !s) return null;
  const cov = schemaCoverage(kb.index, s);
  return (
    <div className="schema-view">
      <div className="small muted">
        Для тегов: {s.for.length ? s.for.map((t) => `#${t}`).join(', ') : '— не указаны'}
      </div>
      <table className="schema-table">
        <thead>
          <tr>
            <th>поле</th>
            <th>вид</th>
            <th>варианты</th>
          </tr>
        </thead>
        <tbody>
          {s.fields.map((f) => (
            <tr key={f.name}>
              <td>
                {f.name}
                {f.required ? ' *' : ''}
              </td>
              <td>{f.kind}</td>
              <td className="muted">{f.options?.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small">
        Заметок под схемой: {cov.notes.length}
        {cov.incomplete.length > 0 && <span className="prop-missing-text"> · неполных: {cov.incomplete.length}</span>}
      </div>
      {cov.incomplete.length > 0 && (
        <ul className="schema-incomplete small">
          {cov.incomplete.slice(0, 50).map(({ note: n, missing }) => (
            <li key={n.id}>
              <a
                className="kb-link"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  kb.open({ id: n.id });
                }}
              >
                {n.title}
              </a>{' '}
              <span className="muted">— нет: {missing.join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Вид в чтении: выборка таблицей, карточками или доской. */
export function ViewResult({ note }: { note: Note }) {
  const kb = useKb();
  const spec = useMemo(() => parseView(note), [note]);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const rows = useMemo(() => {
    if (!kb) return [];
    return runView(kb.index, sortBy ? { ...spec, sort: sortBy } : spec, note.id);
  }, [kb, spec, sortBy, note.id]);
  if (!kb) return null;
  const open = (id: string) => kb.open({ id });
  const cols = spec.columns;
  const cell = (n: Note, c: string) => <Value v={valueOf(kb.index, n, c)} />;

  if (spec.kind === 'доска') {
    if (!spec.group) return <p className="muted small">Для доски укажите поле «группа» в правке вида.</p>;
    // варианты столбцов — из схемы: сначала по тегам вида, иначе из любой схемы с таким полем
    const all = schemas(kb.index.byId.values());
    const same = (f: Field) => f.name.toLowerCase() === spec.group.toLowerCase();
    const field = fieldsOf(all, spec.tags).find(same) ?? all.flatMap((s) => s.fields).find(same);
    const groups = groupBy(kb.index, rows, spec.group, field?.options);
    const values = groups.map((g) => g.value).filter(Boolean);
    return (
      <div className="view-board">
        {groups.map((g) => (
          <div key={g.value || '—'} className="board-col">
            <div className="board-head">
              {g.value || 'без значения'} <span className="muted">{g.notes.length}</span>
            </div>
            {g.notes.map((n) => (
              <div key={n.id} className="board-card">
                <button className="board-title" onClick={() => open(n.id)}>
                  {n.title || 'Без названия'}
                </button>
                {cols.map((c) => (
                  <div key={c} className="small muted">
                    {c}: {cell(n, c)}
                  </div>
                ))}
                <select
                  className="input board-move"
                  value={g.value}
                  title="Перенести в другой столбец"
                  onChange={(e) => {
                    const v = e.target.value;
                    const props = { ...(n.props ?? {}) };
                    const key = Object.keys(props).find((k) => k.toLowerCase() === spec.group.toLowerCase()) ?? spec.group;
                    if (v) props[key] = v;
                    else delete props[key];
                    kb.updateNote(n.id, { props });
                  }}
                >
                  <option value="">—</option>
                  {values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (spec.kind === 'карточки') {
    return (
      <>
        <div className="small muted">Заметок: {rows.length}</div>
        <div className="view-cards">
          {rows.map((n) => (
            <button key={n.id} className="view-card" onClick={() => open(n.id)}>
              <div className="view-card-title">{n.title || 'Без названия'}</div>
              {cols.map((c) => (
                <div key={c} className="small">
                  <span className="muted">{c}:</span> {display(valueOf(kb.index, n, c))}
                </div>
              ))}
              <div className="small muted view-card-text">{plainText(n.body ?? '').slice(0, 160)}</div>
            </button>
          ))}
        </div>
      </>
    );
  }

  const sortKey = sortBy ?? spec.sort;
  const head = (c: string) => (
    <th key={c} onClick={() => setSortBy(sortKey === c ? '-' + c : c)} className="view-th">
      {c}
      {sortKey === c ? ' ▲' : sortKey === '-' + c ? ' ▼' : ''}
    </th>
  );
  return (
    <div className="view-table-wrap">
      <div className="small muted">Заметок: {rows.length} · нажмите на столбец — сортировка</div>
      <table className="view-table">
        <thead>
          <tr>
            {head('название')}
            {cols.map(head)}
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.id}>
              <td>
                <button className="link-btn" onClick={() => open(n.id)}>
                  {n.title || 'Без названия'}
                </button>
              </td>
              {cols.map((c) => (
                <td key={c}>{cell(n, c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
