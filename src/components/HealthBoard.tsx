import { useEffect, useMemo, useState } from 'react';
import type { HealthKind, Note, Relation } from '../types';
import { uid, useListActions } from '../lib/storage';
import { dayKey } from '../lib/dates';
import {
  HEALTH_FOLDER_ID,
  HEALTH_KINDS,
  HEALTH_META,
  MEAL_GOAL,
  healthOnDay,
  mealPlan,
  mealScore,
} from '../lib/health';
import { NoteModal } from './NotesView';

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
    setOpen(true);
  }
  function startEdit(n: Note) {
    setEditId(n.id);
    setKind(n.health ?? 'other');
    setTime(n.time ?? '');
    setTitle(n.title);
    setDesc(n.body);
    setOpen(true);
  }
  function save() {
    const now = Date.now();
    const patch = {
      health: kind,
      time,
      title: title.trim() || HEALTH_META[kind].label,
      body: desc,
    };
    if (editId) {
      notesActions.update(editId, { ...patch, updatedAt: now });
    } else {
      ensureFolder();
      const id = uid();
      notesActions.add({ id, type: 'note', date, createdAt: now, updatedAt: now, ...patch });
      relActions.add({
        id: uid(),
        from: HEALTH_FOLDER_ID,
        to: id,
        type: 'child',
        position: list.length,
        createdAt: now,
        updatedAt: now,
      });
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

  const descPlaceholder = kind === 'med' ? 'Доза, заметка…' : kind === 'meal' ? 'Что съел…' : 'Заметка…';
  const titlePlaceholder =
    kind === 'med' ? 'Название препарата' : kind === 'meal' ? 'Завтрак / обед / перекус…' : 'Название';

  return (
    <div className="hl-board">
      {banner && <div className={`hl-banner hl-banner-${banner.cls}`}>{banner.text}</div>}

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
                onClick={() => setKind(k)}
              >
                {HEALTH_META[k].icon} {HEALTH_META[k].label}
              </button>
            ))}
          </div>
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
