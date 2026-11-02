// Правка свойств заметки, схемы и вида (docs/ЗАМЕТКИ.md, 3.4, этап 4). Грузится лениво из
// NotesView.tsx: тянет за собой разбор YAML, а нужна только в правке.

import { useEffect, useState } from 'react';
import { parse, stringify } from 'yaml';
import {
  FIELD_KINDS,
  conditionText,
  fieldsToProps,
  fromInput,
  parseFields,
  parseView,
  toInput,
  viewToProps,
  type Field,
  type FieldKind,
  type ViewKind,
} from '../lib/kb/schema';

type Props = Record<string, unknown>;
const split = (s: string) => s.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean);

/** Свойства заметки: поля её схем — по видам, остальное — текстом YAML (как frontmatter). */
export function PropsEditor({
  props,
  setProps,
  fields,
  hidden,
  titles,
}: {
  props: Props;
  setProps: (p: Props) => void;
  /** Поля из схем заметки (по её тегам). */
  fields: Field[];
  /** Ключи, которые правятся в другом месте карточки. */
  hidden: string[];
  /** Названия заметок — подсказка для полей-ссылок. */
  titles: string[];
}) {
  const own = new Set([...fields.map((f) => f.name.toLowerCase()), ...hidden.map((h) => h.toLowerCase())]);
  const restOf = (p: Props) => Object.fromEntries(Object.entries(p).filter(([k]) => !own.has(k.toLowerCase())));
  const dump = (p: Props) => {
    const r = restOf(p);
    return Object.keys(r).length ? stringify(r, { lineWidth: 0 }).trimEnd() : '';
  };
  const [yamlText, setYamlText] = useState(() => dump(props));
  const [error, setError] = useState('');
  // поля схемы поменялись (добавили тег) — пересобрать текст прочих
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setYamlText(dump(props)), [fields.length]);

  function setField(f: Field, raw: string | boolean) {
    const next = { ...props };
    const key = Object.keys(next).find((k) => k.toLowerCase() === f.name.toLowerCase()) ?? f.name;
    const v = fromInput(f, raw);
    if (v === undefined) delete next[key];
    else next[key] = v;
    setProps(next);
  }
  function applyYaml(text: string) {
    let parsed: unknown;
    try {
      parsed = text.trim() ? parse(text) : {};
    } catch (e) {
      setError(`Ошибка в записи: ${(e as Error).message.split('\n')[0]}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError('Нужны строки вида «имя: значение»');
      return;
    }
    setError('');
    const keep = Object.fromEntries(Object.entries(props).filter(([k]) => own.has(k.toLowerCase())));
    setProps({ ...keep, ...(parsed as Props) });
  }

  return (
    <div className="field props-edit">
      <span className="field-label">Свойства</span>
      {fields.map((f) => {
        const key = Object.keys(props).find((k) => k.toLowerCase() === f.name.toLowerCase()) ?? f.name;
        const v = props[key];
        const value = toInput(f, v);
        const missing = f.required && !value;
        const label = (
          <span className={`prop-key ${missing ? 'prop-missing-text' : ''}`}>
            {f.name}
            {f.required ? ' *' : ''}
          </span>
        );
        let input: React.ReactNode;
        if (f.kind === 'выбор') {
          input = (
            <select className="input" value={value} onChange={(e) => setField(f, e.target.value)}>
              <option value="">—</option>
              {[...(f.options ?? []), ...(value && !f.options?.includes(value) ? [value] : [])].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        } else if (f.kind === 'да-нет') {
          input = <input type="checkbox" checked={v === true} onChange={(e) => setField(f, e.target.checked)} />;
        } else if (f.kind === 'список' || f.kind === 'ссылки') {
          input = (
            <textarea
              className="input"
              rows={Math.max(2, value.split('\n').length)}
              value={value}
              placeholder={f.kind === 'ссылки' ? 'название заметки — по одной на строку' : 'по одному на строку'}
              onChange={(e) => setField(f, e.target.value)}
            />
          );
        } else {
          input = (
            <input
              className="input"
              type={f.kind === 'дата' ? 'date' : f.kind === 'число' ? 'number' : 'text'}
              list={f.kind === 'ссылка' ? 'kb-note-titles' : undefined}
              value={f.kind === 'ссылка' ? value.replace(/^\[\[|\]\]$/g, '') : value}
              onChange={(e) => setField(f, e.target.value)}
            />
          );
        }
        return (
          <label key={f.name} className="prop-edit-row">
            {label}
            {input}
          </label>
        );
      })}
      <datalist id="kb-note-titles">
        {titles.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <label className="prop-edit-yaml">
        <span className="muted small">
          {fields.length ? 'Прочие свойства' : 'Свойства'} — строками «имя: значение», как в Obsidian
        </span>
        <textarea
          className="input props-yaml"
          rows={Math.max(2, yamlText.split('\n').length + 1)}
          value={yamlText}
          placeholder={'источник: аль-Мугни 9/322\nнадёжность: A'}
          onChange={(e) => setYamlText(e.target.value)}
          onBlur={(e) => applyYaml(e.target.value)}
        />
        {error && <span className="fragment-err">{error}</span>}
      </label>
    </div>
  );
}

/** Схема: для каких тегов и какие поля у таких заметок. */
export function SchemaEditor({ props, setProps }: { props: Props; setProps: (p: Props) => void }) {
  const forTags = Array.isArray(props['для']) ? (props['для'] as unknown[]).map(String).join(', ') : String(props['для'] ?? '');
  // поля держим у себя: только что добавленное ещё без имени, а в свойства идут лишь названные
  const [fields, setFields] = useState<Field[]>(() => parseFields(props['поля']));
  const [forText, setForText] = useState(forTags);
  const put = (fs: Field[]) => {
    setFields(fs);
    setProps({ ...props, поля: fieldsToProps(fs.filter((f) => f.name.trim())) });
  };
  const change = (i: number, patch: Partial<Field>) => put(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const fs = [...fields];
    [fs[i], fs[j]] = [fs[j], fs[i]];
    put(fs);
  };
  return (
    <div className="field schema-edit">
      <span className="field-label">Схема</span>
      <label className="prop-edit-row">
        <span className="prop-key">для тегов</span>
        <input
          className="input"
          list="kb-tag-names"
          value={forText}
          placeholder="тип/довод, тип/насс"
          onChange={(e) => {
            setForText(e.target.value);
            setProps({ ...props, для: split(e.target.value) });
          }}
        />
      </label>
      <p className="muted small">Схема подсказывает эти поля всем заметкам с такими тегами (и ниже по пути), а недостающие обязательные (*) — подсвечивает.</p>
      {fields.map((f, i) => (
        <div key={i} className="schema-field">
          <input className="input sf-name" value={f.name} placeholder="имя поля" onChange={(e) => change(i, { name: e.target.value })} />
          <select className="input sf-kind" value={f.kind} onChange={(e) => change(i, { kind: e.target.value as FieldKind })}>
            {FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <label className="sf-req small" title="Обязательное поле">
            <input type="checkbox" checked={!!f.required} onChange={(e) => change(i, { required: e.target.checked })} /> обяз.
          </label>
          {f.kind === 'выбор' && (
            <input
              className="input sf-opts"
              value={(f.options ?? []).join(', ')}
              placeholder="варианты через запятую"
              onChange={(e) => change(i, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
            />
          )}
          <span className="sf-acts">
            <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Выше">
              ↑
            </button>
            <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Ниже">
              ↓
            </button>
            <button className="icon-btn" onClick={() => put(fields.filter((_, j) => j !== i))} aria-label="Убрать поле">
              ✕
            </button>
          </span>
        </div>
      ))}
      <button className="btn btn-small" onClick={() => put([...fields, { name: '', kind: 'текст' }])}>
        ＋ Поле
      </button>
    </div>
  );
}

/** Вид: какие заметки отбирать и как показывать. */
export function ViewEditor({ props, setProps }: { props: Props; setProps: (p: Props) => void }) {
  const spec = parseView({ id: '', title: '', body: '', date: null, createdAt: 0, updatedAt: 0, props });
  const [tagsText, setTagsText] = useState(spec.tags.join(', '));
  const [conds, setConds] = useState(spec.conditions.map(conditionText).join('\n'));
  const [cols, setCols] = useState(spec.columns.join(', '));
  const save = (patch: Partial<typeof spec>, extra?: Props) => {
    const rest = Object.fromEntries(Object.entries(props).filter(([k]) => !['вид', 'теги', 'условия', 'текст', 'столбцы', 'группа', 'сортировка'].includes(k)));
    setProps({ ...rest, ...viewToProps({ ...spec, ...patch }), ...extra });
  };
  return (
    <div className="field view-edit">
      <span className="field-label">Вид — сохранённая выборка</span>
      <label className="prop-edit-row">
        <span className="prop-key">показывать</span>
        <select className="input" value={spec.kind} onChange={(e) => save({ kind: e.target.value as ViewKind })}>
          <option value="таблица">таблицей</option>
          <option value="карточки">карточками</option>
          <option value="доска">доской (столбцы по полю)</option>
        </select>
      </label>
      <label className="prop-edit-row">
        <span className="prop-key">теги</span>
        <input
          className="input"
          list="kb-tag-names"
          value={tagsText}
          placeholder="тип/довод, тема/фикх — нужны все"
          onChange={(e) => {
            setTagsText(e.target.value);
            save({ tags: split(e.target.value) });
          }}
        />
      </label>
      <label className="prop-edit-row">
        <span className="prop-key">условия</span>
        <textarea
          className="input"
          rows={3}
          value={conds}
          placeholder={'чьё = автор\nнадёжность != C\nместа есть'}
          onChange={(e) => {
            setConds(e.target.value);
            const rest = Object.fromEntries(Object.entries(props).filter(([k]) => k !== 'условия'));
            const lines = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean);
            setProps({ ...rest, ...(lines.length ? { условия: lines } : {}) });
          }}
        />
      </label>
      <p className="muted small">
        Условие — строка: «поле = значение», «поле != значение», «поле есть», «поле нет», «поле &gt; 5», «поле ~ часть слова».
        Поля — свойства заметок, а ещё «название», «теги», «изменена», «создана».
      </p>
      <label className="prop-edit-row">
        <span className="prop-key">текст содержит</span>
        <input className="input" value={spec.text} onChange={(e) => save({ text: e.target.value })} />
      </label>
      <label className="prop-edit-row">
        <span className="prop-key">столбцы</span>
        <input
          className="input"
          value={cols}
          placeholder="чьё, надёжность, изменена"
          onChange={(e) => {
            setCols(e.target.value);
            save({ columns: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) });
          }}
        />
      </label>
      {spec.kind === 'доска' && (
        <label className="prop-edit-row">
          <span className="prop-key">группа (поле)</span>
          <input className="input" value={spec.group} placeholder="статус" onChange={(e) => save({ group: e.target.value.trim() })} />
        </label>
      )}
      <label className="prop-edit-row">
        <span className="prop-key">сортировка</span>
        <input className="input" value={spec.sort} placeholder="изменена, -надёжность (минус — по убыванию)" onChange={(e) => save({ sort: e.target.value.trim() })} />
      </label>
    </div>
  );
}
