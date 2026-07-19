import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  Checklist,
  ChecklistItem,
  PomodoroSession,
  PomodoroSettings,
} from '../types';
import { PHASE_META, formatLeft, type PomodoroApi } from '../lib/pomodoro';
import { todayKey } from '../lib/dates';

interface Props {
  pomodoro: PomodoroApi;
  sessions: PomodoroSession[];
  settings: PomodoroSettings;
  setSettings: React.Dispatch<React.SetStateAction<PomodoroSettings>>;
  checklists: Checklist[];
}

interface TaskOption {
  id: string;
  text: string;
  listTitle: string;
}

function collectOpen(items: ChecklistItem[], listTitle: string, acc: TaskOption[]): void {
  for (const it of items) {
    if (!it.done && it.text.trim()) acc.push({ id: it.id, text: it.text, listTitle });
    if (it.subitems) collectOpen(it.subitems, listTitle, acc);
  }
}

/** Мини-таймер в топбаре + раскрывающаяся панель управления помидоро. */
export function PomodoroWidget({ pomodoro, sessions, settings, setSettings, checklists }: Props) {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { run, leftMs, paused } = pomodoro;

  const tasks = useMemo(() => {
    const acc: TaskOption[] = [];
    for (const c of checklists) collectOpen(c.items ?? [], c.title || 'Без названия', acc);
    return acc;
  }, [checklists]);

  const today = todayKey();
  const todaySessions = useMemo(
    () => sessions.filter((s) => s.date === today),
    [sessions, today],
  );
  const todayMin = todaySessions.reduce((sum, s) => sum + s.durationMin, 0);

  const phase = run ? PHASE_META[run.phase] : null;

  function pickTask(id: string) {
    const t = tasks.find((x) => x.id === id) ?? null;
    const item = t ? { id: t.id, text: t.text } : null;
    // Если таймер идёт — просто меняем задачу; иначе выбор задачи запускает работу.
    if (run) pomodoro.setTask(item);
    else pomodoro.start(item);
  }

  function num(v: string, fallback: number): number {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 180) : fallback;
  }

  return (
    <>
      <button
        className={`icon-btn pomo-widget ${run ? 'active' : ''} ${paused ? 'paused' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Помидоро"
        title="Помидоро"
      >
        {run ? (
          <>
            <span>{phase!.icon}</span>
            <span className="pomo-widget-time">{formatLeft(leftMs)}</span>
          </>
        ) : (
          '🍅'
        )}
      </button>

      {/* Портал: топбар с backdrop-filter стал бы контейнером для fixed,
          и модалка ушла бы под контент — рендерим её в body. */}
      {open &&
        createPortal(
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal pomo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">🍅 Помидоро</span>
              <div className="pomo-head-btns">
                <button
                  className="icon-btn"
                  onClick={() => setShowSettings((v) => !v)}
                  aria-label="Настройки"
                  title="Настройки"
                >
                  ⚙︎
                </button>
                <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Закрыть">
                  ✕
                </button>
              </div>
            </div>

            {showSettings && (
              <div className="pomo-settings">
                <label className="field">
                  <span>Работа, мин</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={settings.workMin}
                    onChange={(e) => setSettings((s) => ({ ...s, workMin: num(e.target.value, s.workMin) }))}
                  />
                </label>
                <label className="field">
                  <span>Перерыв, мин</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={settings.shortMin}
                    onChange={(e) => setSettings((s) => ({ ...s, shortMin: num(e.target.value, s.shortMin) }))}
                  />
                </label>
                <label className="field">
                  <span>Длинный, мин</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={settings.longMin}
                    onChange={(e) => setSettings((s) => ({ ...s, longMin: num(e.target.value, s.longMin) }))}
                  />
                </label>
                <label className="field">
                  <span>Циклов до длинного</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={settings.cyclesToLong}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, cyclesToLong: num(e.target.value, s.cyclesToLong) }))
                    }
                  />
                </label>
              </div>
            )}

            <div className={`pomo-timer ${run ? `phase-${run.phase}` : ''}`}>
              <span className="pomo-time">{run ? formatLeft(leftMs) : `${settings.workMin}:00`}</span>
              <span className="pomo-phase muted">
                {run ? `${phase!.icon} ${phase!.label} · цикл ${run.cycle}` : 'Таймер не запущен'}
              </span>
              {run?.itemText && <span className="pomo-task">→ {run.itemText}</span>}
            </div>

            <div className="pomo-controls">
              {!run && (
                <button className="btn btn-primary" onClick={() => pomodoro.start()}>
                  ▶ Начать
                </button>
              )}
              {run && !paused && (
                <button className="btn" onClick={pomodoro.pause}>
                  ⏸ Пауза
                </button>
              )}
              {run && paused && (
                <button className="btn btn-primary" onClick={pomodoro.resume}>
                  ▶ Продолжить
                </button>
              )}
              {run && (
                <button className="btn" onClick={pomodoro.finishPhase}>
                  ⏭ Завершить фазу
                </button>
              )}
              {run && (
                <button className="btn cl-danger" onClick={pomodoro.stop}>
                  ■ Стоп
                </button>
              )}
            </div>

            {tasks.length > 0 && (
              <label className="field">
                <span>Над чем работаю</span>
                <select
                  className="input"
                  value={run?.itemId ?? ''}
                  onChange={(e) => pickTask(e.target.value)}
                >
                  <option value="">— без задачи —</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.text} · {t.listTitle}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="pomo-today">
              <span className="muted small">Сегодня:</span>
              <span className="pomo-today-count">
                {'🍅'.repeat(Math.min(todaySessions.length, 12))}
                {todaySessions.length > 12 ? ` ×${todaySessions.length}` : ''}
                {todaySessions.length === 0 && <span className="muted small"> пока ничего</span>}
              </span>
              {todayMin > 0 && <span className="muted small">{todayMin} мин</span>}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
