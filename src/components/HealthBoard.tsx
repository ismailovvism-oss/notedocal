import { useEffect, useMemo, useState } from 'react';
import type { HealthKind, Note, Relation } from '../types';
import { uid, useListActions } from '../lib/storage';
import { dayKey } from '../lib/dates';
import {
  HEALTH_FOLDER_ID,
  HEALTH_KINDS,
  HEALTH_META,
  MEAL_GOAL,
  eatingWindow,
  healthOnDay,
  mealPlan,
  mealScore,
  mealStreaks,
  minToHHMM,
} from '../lib/health';
import { METRICS, METRIC_BY_CODE, fmtValue, rangeLabel, statusOfNote } from '../lib/metrics';
import { courseNotes } from '../lib/meds';
import { NoteModal } from './NotesView';
import { MetricPanel } from './MetricPanel';
import { CoursePanel } from './CoursePanel';

interface Props {
  date: string;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  relations: Relation[];
  setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
  gapHours: number;
  setGapHours: React.Dispatch<React.SetStateAction<number>>;
}

function nowTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** «3ч 20м» из миллисекунд. */
function fmtDur(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseMin(t: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

export function HealthBoard({
  date,
  notes,
  setNotes,
  relations,
  setRelations,
  gapHours,
  setGapHours,
}: Props) {
  const notesActions = useListActions(setNotes);
  const relActions = useListActions(setRelations);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [kind, setKind] = useState<HealthKind>('meal');
  const [time, setTime] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  // Поля замера/анализа/симптома: показатель, число (+второе у давления), сила.
  const [code, setCode] = useState('weight');
  const [value, setValue] = useState('');
  const [value2, setValue2] = useState('');
  const [severity, setSeverity] = useState(3);
  // Открытая заметка-запись в полном окне (фото, подробное описание).
  const [modalId, setModalId] = useState<string | null>(null);

  // Тик раз в минуту — чтобы обратный отсчёт до следующего приёма обновлялся.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const list = useMemo(() => healthOnDay(notes, date), [notes, date]);
  const modalNote = modalId ? notes.find((n) => n.id === modalId) ?? null : null;

  // Мотивация: оценка дня + подсказка о следующем приёме.
  const isToday = date === dayKey(new Date());
  const mealsCount = list.filter((e) => e.health === 'meal').length;
  const score = mealScore(list, gapHours);
  const plan = mealPlan(list, date, gapHours);

  let banner: { cls: string; text: string } | null = null;
  if (score === 'good') {
    banner = { cls: 'good', text: `🟢 Отличный день: ${MEAL_GOAL} приёма с хорошим промежутком` };
  } else if (score === 'over') {
    banner = { cls: 'over', text: `🔴 Перебор: ${mealsCount} приёмов пищи (цель — ${MEAL_GOAL})` };
  } else if (mealsCount === 3) {
    banner = { cls: 'ok', text: '🟡 3 приёма — приемлемо, но цель — 2' };
  } else if (mealsCount === MEAL_GOAL) {
    banner = { cls: 'ok', text: '🟡 2 приёма, но промежуток маловат' };
  } else if (mealsCount === 1) {
    if (isToday && plan.nextMs) {
      const left = plan.nextMs - Date.now();
      banner =
        left > 0
          ? { cls: 'ok', text: `⏳ До второго приёма ~${fmtDur(left)} — в ${hhmm(plan.nextMs)}` }
          : { cls: 'good', text: `🍽 Пора на второй приём (уже ${fmtDur(-left)} назад)` };
    } else {
      banner = { cls: 'ok', text: '🟡 Пока 1 приём — цель 2' };
    }
  }

  // Серия «зелёных» дней (глобально) и окно питания выбранного дня.
  const streak = useMemo(() => mealStreaks(notes, dayKey(new Date()), gapHours), [notes, gapHours]);
  const courses = useMemo(() => courseNotes(notes), [notes]);
  const todayKey = dayKey(new Date());
  // Симптомы за 30 дней — то, о чём первым делом спросит врач: как часто и как сильно.
  const symptoms30 = useMemo(() => {
    const from = new Date(Date.parse(todayKey) - 30 * 86400000).toISOString().slice(0, 10);
    const list30 = notes.filter(
      (n) => !n.deleted && n.health === 'symptom' && n.date && n.date >= from && n.date <= todayKey,
    );
    const withSev = list30.filter((n) => n.severity != null);
    const avg = withSev.length
      ? withSev.reduce((a, n) => a + (n.severity as number), 0) / withSev.length
      : null;
    return { count: list30.length, avg };
  }, [notes, todayKey]);
  const win = eatingWindow(list);

  // Мягкое предупреждение: приём пищи слишком рано после предыдущего.
  let soonWarn = '';
  if (open && kind === 'meal') {
    const formMin = parseMin(time);
    const priorMins = list
      .filter((e) => e.health === 'meal' && e.id !== editId)
      .map((e) => parseMin(e.time ?? ''))
      .filter((x): x is number => x != null);
    if (formMin != null && priorMins.length) {
      const nearest = Math.max(...priorMins.filter((m) => m <= formMin));
      if (Number.isFinite(nearest)) {
        const gapMin = formMin - nearest;
        if (gapMin >= 0 && gapMin < gapHours * 60) {
          const h = Math.floor(gapMin / 60);
          const m = gapMin % 60;
          soonWarn = `С прошлого приёма всего ${h > 0 ? `${h}ч ` : ''}${m}м — рекомендуется ≥ ${gapHours} ч`;
        }
      }
    }
  }

  // Гарантируем существование папки «Здоровье».
  function ensureFolder() {
    if (notes.some((n) => n.id === HEALTH_FOLDER_ID)) return;
    const now = Date.now();
    notesActions.add({
      id: HEALTH_FOLDER_ID,
      title: 'Здоровье',
      body: '',
      type: 'folder',
      date: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  function startAdd(k: HealthKind) {
    setEditId(null);
    setKind(k);
    setTime(nowTime());
    setTitle('');
    setDesc('');
    setValue('');
    setValue2('');
    setSeverity(3);
    setCode(k === 'lab' ? 'ldl' : 'weight');
    setOpen(true);
  }
  function startEdit(n: Note) {
    setEditId(n.id);
    setKind(n.health ?? 'other');
    setTime(n.time ?? '');
    setTitle(n.title);
    setDesc(n.body);
    setCode(n.code ?? 'weight');
    setValue(n.value != null ? String(n.value) : '');
    setValue2(n.value2 != null ? String(n.value2) : '');
    setSeverity(n.severity ?? 3);
    setOpen(true);
  }
  /** Кладёт запись в дневник: создаёт заметку и вешает её в папку «Здоровье».
   *  Общая точка для формы и для кнопки «вколол» в карточке курса. */
  function addEntry(patch: Partial<Note>, day = date) {
    const now = Date.now();
    ensureFolder();
    const id = uid();
    notesActions.add({
      id,
      type: 'note',
      title: '',
      body: '',
      date: day,
      createdAt: now,
      updatedAt: now,
      ...patch,
    } as Note);
    relActions.add({
      id: uid(),
      from: HEALTH_FOLDER_ID,
      to: id,
      type: 'child',
      position: list.length,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  function save() {
    const now = Date.now();
    const isMeasure = kind === 'metric' || kind === 'lab';
    const def = isMeasure ? METRIC_BY_CODE[code] : null;
    const num = Number(value.replace(',', '.'));
    const patch: Partial<Note> = {
      health: kind,
      time,
      title: title.trim() || def?.label || HEALTH_META[kind].label,
      body: desc,
      code: isMeasure ? code : undefined,
      value: isMeasure && Number.isFinite(num) ? num : undefined,
      value2:
        isMeasure && def?.pair && value2 ? Number(value2.replace(',', '.')) || undefined : undefined,
      severity: kind === 'symptom' ? severity : undefined,
    };
    if (editId) {
      notesActions.update(editId, { ...patch, updatedAt: now });
    } else {
      addEntry(patch);
      // При первом приёме пищи спросим разрешение на уведомление о втором.
      if (
        kind === 'meal' &&
        mealsCount === 0 &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'default'
      ) {
        Notification.requestPermission().catch(() => {});
      }
    }
    setOpen(false);
  }

  const descPlaceholder =
    kind === 'med'
      ? 'Доза, заметка…'
      : kind === 'meal'
        ? 'Что съел…'
        : kind === 'symptom'
          ? 'Где болит, после чего, как долго…'
          : 'Заметка…';
  const titlePlaceholder =
    kind === 'med'
      ? 'Название препарата'
      : kind === 'meal'
        ? 'Завтрак / обед / перекус…'
        : kind === 'symptom'
          ? 'Что болит (левый бок, пах…)'
          : kind === 'metric' || kind === 'lab'
            ? 'Подпись (необязательно)'
            : 'Название';

  return (
    <div className="hl-board">
      {banner && <div className={`hl-banner hl-banner-${banner.cls}`}>{banner.text}</div>}

      {(streak.current > 0 || (win && win.windowMin > 0) || symptoms30.count > 0) && (
        <div className="hl-stats">
          {streak.current > 0 && (
            <span className="hl-stat" title="Дней подряд с правильным питанием">
              🔥 Серия {streak.current}
              {streak.best > streak.current ? ` · рекорд ${streak.best}` : ''}
            </span>
          )}
          {symptoms30.count > 0 && (
            <span className="hl-stat" title="Эпизоды симптомов за последние 30 дней">
              🤕 {symptoms30.count} за 30д
              {symptoms30.avg != null ? ` · в среднем ${symptoms30.avg.toFixed(1)}/10` : ''}
            </span>
          )}
          {win && win.windowMin > 0 && (
            <span className="hl-stat" title="Окно питания и голодание">
              🕰 Окно {minToHHMM(win.first)}–{minToHHMM(win.last)} ({(win.windowMin / 60).toFixed(1)}ч) ·
              голодание ~{Math.round(win.fastingMin / 60)}ч
            </span>
          )}
        </div>
      )}

      <CoursePanel
        date={date}
        notes={notes}
        courses={courses}
        onShot={(c) =>
          addEntry({
            health: 'med',
            code: c.code,
            title: c.title + (c.dose ? ` ${c.dose}` : ''),
            time: nowTime(),
          })
        }
        onPatch={(id, patch) => notesActions.update(id, { ...patch, updatedAt: Date.now() })}
        onCreate={(patch) => {
          const now = Date.now();
          ensureFolder();
          notesActions.add({
            id: uid(),
            type: 'note',
            title: '',
            body: '',
            date: null,
            health: 'course',
            createdAt: now,
            updatedAt: now,
            ...patch,
          } as Note);
        }}
        onRemove={(id) => notesActions.remove(id)}
      />

      <MetricPanel notes={notes} todayKey={todayKey} />

      <div className="hl-goal muted small">
        Цель: {MEAL_GOAL} приёма в день · промежуток
        <input
          className="hl-gap-input"
          type="number"
          min={1}
          max={12}
          value={gapHours}
          onChange={(e) => setGapHours(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
        />
        ч
      </div>

      {list.length > 0 && (
        <ul className="hl-list">
          {list.map((n) => {
            const meta = HEALTH_META[n.health ?? 'other'];
            return (
              <li key={n.id} className={`hl-item hl-${n.health}`}>
                <span className="hl-ic" title={meta.label}>
                  {meta.icon}
                </span>
                <div className="hl-body">
                  <span className="hl-title">
                    {n.time && <b className="hl-time">{n.time}</b>} {n.title}
                    {n.value != null && n.code && METRIC_BY_CODE[n.code] && (
                      <b className={`hl-val st-${statusOfNote(METRIC_BY_CODE[n.code], n.value, n.value2)}`}>
                        {' '}
                        {fmtValue(METRIC_BY_CODE[n.code], n)} {METRIC_BY_CODE[n.code].unit}
                      </b>
                    )}
                    {n.severity != null && <b className="hl-sev"> {n.severity}/10</b>}
                  </span>
                  {n.body && <span className="muted small hl-desc">{n.body}</span>}
                  {n.attachments && n.attachments.length > 0 && (
                    <span className="muted small hl-clip">📎 {n.attachments.length}</span>
                  )}
                </div>
                <button className="icon-btn" onClick={() => startEdit(n)} aria-label="Изменить">
                  ✎
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setModalId(n.id)}
                  title="Фото и подробности"
                  aria-label="Открыть заметку"
                >
                  📷
                </button>
                <button className="icon-btn" onClick={() => notesActions.remove(n.id)} aria-label="Удалить">
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <div className="hl-form">
          <div className="hl-kinds" role="group" aria-label="Вид записи">
            {HEALTH_KINDS.map((k) => (
              <button
                key={k}
                className={`hl-kind ${kind === k ? 'active' : ''}`}
                onClick={() => {
                  setKind(k);
                  // Показатель должен быть из той же группы, иначе список пуст.
                  if (k === 'metric' || k === 'lab') {
                    const def = METRIC_BY_CODE[code];
                    if (!def || def.group !== k) setCode(k === 'lab' ? 'ldl' : 'weight');
                  }
                }}
              >
                {HEALTH_META[k].icon} {HEALTH_META[k].label}
              </button>
            ))}
          </div>
          {soonWarn && <p className="hl-warn small">⚠ {soonWarn}</p>}
          {(kind === 'metric' || kind === 'lab') && (
            <div className="ev-form-row">
              <label className="field">
                <span className="field-label">Показатель</span>
                <select className="input" value={code} onChange={(e) => setCode(e.target.value)}>
                  {METRICS.filter((m) => m.group === kind).map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label} ({m.unit})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field hl-val-field">
                <span className="field-label">Значение</span>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              {METRIC_BY_CODE[code]?.pair && (
                <label className="field hl-val-field">
                  <span className="field-label">Нижнее</span>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={value2}
                    onChange={(e) => setValue2(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
          {METRIC_BY_CODE[code] && (kind === 'metric' || kind === 'lab') && (
            <p className="muted small hl-hint">
              {[rangeLabel(METRIC_BY_CODE[code]), METRIC_BY_CODE[code].hint].filter(Boolean).join(' · ')}
            </p>
          )}
          {kind === 'symptom' && (
            <details className="hl-sites small">
              <summary>Как назвать локацию</summary>
              <p className="muted">
                Сторона · линия · уровень — например <b>лево СП Д+3</b>.
              </p>
              <p className="muted">
                <b>Линии:</b> Ц — по центру живота · СК — вниз от середины ключицы · ПП — передний
                край подмышки · СП — ровно сбоку, «в профиль» · ЗП — задний край подмышки · Лп —
                сзади под лопаткой.
              </p>
              <p className="muted">
                <b>Уровень:</b> Д+3 — на 3 см выше рёберной дуги · Д−4 — ниже дуги, по животу ·
                П+2 / П−2 — от пупка · Р9, Р10 — по ребру.
              </p>
              <p className="muted">
                <b>Сила:</b> 1–2 лёгкая · 3–4 отвлекает · 5–6 мешает делать дела · 7–8 сильная ·
                9–10 нестерпимая.
              </p>
            </details>
          )}
          {kind === 'symptom' && (
            <label className="field">
              <span className="field-label">Сила: {severity}/10</span>
              <input
                type="range"
                min={0}
                max={10}
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value))}
              />
            </label>
          )}
          <div className="ev-form-row">
            <input
              className="input"
              placeholder={titlePlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <label className="field hl-time-field">
              <span className="field-label">Время</span>
              <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <textarea
            className="input"
            rows={2}
            placeholder={descPlaceholder}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <div className="ev-form-actions">
            <button className="btn btn-primary" onClick={save}>
              {editId ? 'Сохранить' : 'Добавить'}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="hl-add">
          {HEALTH_KINDS.map((k) => (
            <button key={k} className="btn btn-small" onClick={() => startAdd(k)}>
              {HEALTH_META[k].icon} {HEALTH_META[k].label}
            </button>
          ))}
        </div>
      )}

      {modalNote && (
        <NoteModal
          note={modalNote}
          fixedDate={date}
          allNotes={notes}
          relations={relations}
          setRelations={setRelations}
          onSave={(patch) => notesActions.update(modalNote.id, { ...patch, updatedAt: Date.now() })}
          onDelete={() => {
            notesActions.remove(modalNote.id);
            setModalId(null);
          }}
          onClose={() => setModalId(null)}
        />
      )}
    </div>
  );
}
