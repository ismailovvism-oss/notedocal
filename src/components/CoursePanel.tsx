import { useState } from 'react';
import type { Note } from '../types';
import { courseState } from '../lib/meds';
import { dayKey } from '../lib/dates';

interface Props {
  date: string;
  notes: Note[];
  courses: Note[];
  onShot: (course: Note) => void;
  onPatch: (id: string, patch: Partial<Note>) => void;
  onCreate: (patch: Partial<Note>) => void;
  onRemove: (id: string) => void;
}

function fmtDay(key: string | null): string {
  if (!key) return '—';
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Карточка курса препарата: доза, расписание, остаток в ручке, кнопка «вколол».
 *  Счётчик доз считается из журнала уколов, отдельного состояния нет. */
export function CoursePanel({ date, notes, courses, onShot, onPatch, onCreate, onRemove }: Props) {
  const today = dayKey(new Date());
  const [editId, setEditId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    title: '',
    code: '',
    dose: '',
    everyDays: '7',
    dosesPerPen: '4',
    penStart: today,
  });

  function startEdit(c: Note) {
    setForm({
      title: c.title,
      code: c.code ?? '',
      dose: c.dose ?? '',
      everyDays: String(c.everyDays ?? 7),
      dosesPerPen: String(c.dosesPerPen ?? 4),
      penStart: c.penStart ?? today,
    });
    setEditId(c.id);
    setAdding(false);
  }

  function save() {
    const patch: Partial<Note> = {
      title: form.title.trim() || 'Препарат',
      code: form.code.trim() || form.title.trim().toLowerCase().replace(/\s+/g, '-'),
      dose: form.dose.trim(),
      everyDays: Number(form.everyDays) || 7,
      dosesPerPen: Number(form.dosesPerPen) || 0,
      penStart: form.penStart,
    };
    if (editId) onPatch(editId, patch);
    else onCreate(patch);
    setEditId(null);
    setAdding(false);
  }

  const editing = adding || editId != null;

  return (
    <div className="hl-courses">
      {courses.map((c) => {
        const st = courseState(notes, c, today);
        const cls = st.overdue ? 'bad' : st.left === 0 ? 'warn' : '';
        return (
          <div key={c.id} className={`hl-course ${cls}`}>
            <div className="hl-course-head">
              <span className="hl-course-name">
                💉 {c.title}
                {c.dose ? ` · ${c.dose}` : ''}
              </span>
              <button className="icon-btn" onClick={() => startEdit(c)} aria-label="Изменить курс">
                ✎
              </button>
            </div>
            <div className="hl-course-body small">
              {c.dosesPerPen ? (
                <span>
                  Сделано {st.taken} из {c.dosesPerPen} · осталось {st.left}
                </span>
              ) : null}
              <span>
                {st.doneToday
                  ? '✅ сегодня вколото'
                  : st.overdue
                    ? `⚠ просрочено с ${fmtDay(st.nextDate)}`
                    : `следующий — ${fmtDay(st.nextDate)}`}
              </span>
              {st.buyBy && st.left <= 2 && <span>🛒 новая упаковка к {fmtDay(st.buyBy)}</span>}
            </div>
            <div className="hl-course-actions">
              <button
                className="btn btn-small"
                onClick={() => onShot(c)}
                title={`Записать укол на ${date}`}
              >
                Вколол
              </button>
              {st.left === 0 && (
                <button
                  className="btn btn-small"
                  onClick={() => onPatch(c.id, { penStart: date })}
                  title="Начать отсчёт доз заново с этого дня"
                >
                  Новая упаковка
                </button>
              )}
            </div>
          </div>
        );
      })}

      {editing ? (
        <div className="hl-form">
          <div className="ev-form-row">
            <input
              className="input"
              placeholder="Название препарата"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <input
              className="input"
              placeholder="Доза (7.5 мг)"
              value={form.dose}
              onChange={(e) => setForm({ ...form, dose: e.target.value })}
            />
          </div>
          <div className="ev-form-row">
            <label className="field">
              <span className="field-label">Раз в дней</span>
              <input
                className="input"
                type="number"
                min={1}
                value={form.everyDays}
                onChange={(e) => setForm({ ...form, everyDays: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">Доз в упаковке</span>
              <input
                className="input"
                type="number"
                min={0}
                value={form.dosesPerPen}
                onChange={(e) => setForm({ ...form, dosesPerPen: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">Упаковка с</span>
              <input
                className="input"
                type="date"
                value={form.penStart}
                onChange={(e) => setForm({ ...form, penStart: e.target.value })}
              />
            </label>
          </div>
          <div className="ev-form-actions">
            <button className="btn btn-primary" onClick={save}>
              Сохранить
            </button>
            <button
              className="btn"
              onClick={() => {
                setEditId(null);
                setAdding(false);
              }}
            >
              Отмена
            </button>
            {editId && (
              <button
                className="btn btn-danger"
                onClick={() => {
                  onRemove(editId);
                  setEditId(null);
                }}
              >
                Удалить курс
              </button>
            )}
          </div>
        </div>
      ) : (
        courses.length === 0 && (
          <button
            className="btn btn-small"
            onClick={() => {
              setForm({ ...form, title: '', code: '', dose: '', penStart: today });
              setAdding(true);
            }}
          >
            💉 Завести курс препарата
          </button>
        )
      )}
    </div>
  );
}
