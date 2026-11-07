import { useMemo } from 'react';
import type { DayPlan, DayPlanSlot, PomodoroSession, Project } from '../types';
import { SPHERES, openSteps, sortProjects } from '../lib/projects';
import { todayKey } from '../lib/dates';
import { PHASE_META, formatLeft, type PomodoroApi } from '../lib/pomodoro';
import {
  GOAL_DEFAULT,
  GOAL_MAX,
  SLOTS_MAX,
  SLOTS_MIN,
  doneCounts,
  nextSlot,
  pickable,
  planSlots,
  withSlots,
} from '../lib/dayplan';

interface Props {
  projects: Project[];
  plans: DayPlan[];
  setPlans: React.Dispatch<React.SetStateAction<DayPlan[]>>;
  sessions: PomodoroSession[];
  setSessions: React.Dispatch<React.SetStateAction<PomodoroSession[]>>;
  pomodoro: PomodoroApi;
  workMin: number;
  logPomodoro: (
    startedAt: number,
    durationMin: number,
    itemId: string | null,
    itemText: string,
    projectId: string | null,
  ) => void;
}

/**
 * Проекты дня: три проекта по три помидора, короткому хватит одного, чтобы не
 * метаться между делами (просьба хозяина 07.11.26). Карточка на очереди выделена,
 * у неё главная кнопка и таймер; помидоры считаются из журнала (см. lib/dayplan.ts).
 */
export function DayPlanBoard({
  projects,
  plans,
  setPlans,
  sessions,
  setSessions,
  pomodoro,
  workMin,
  logPomodoro,
}: Props) {
  const today = todayKey();
  const slots = planSlots(plans, today);
  const counts = useMemo(() => doneCounts(sessions, today), [sessions, today]);
  const { run, leftMs, paused } = pomodoro;
  const working = run?.phase === 'work';

  const save = (next: DayPlanSlot[]) => setPlans((l) => withSlots(l, today, next));
  const patchSlot = (projectId: string, goal: number) =>
    save(slots.map((s) => (s.projectId === projectId ? { ...s, goal } : s)));

  const options = useMemo(() => sortProjects(pickable(projects, slots)), [projects, slots]);
  const emptyCount = Math.max(slots.length < SLOTS_MAX ? 1 : 0, SLOTS_MIN - slots.length);

  // Идёт помидор проекта — выделен он; иначе тот, что на очереди.
  const runSlot = slots.find((s) => s.projectId === run?.projectId) ?? null;
  const next = nextSlot(slots, counts);
  const current =
    runSlot && (working || (counts.get(runSlot.projectId) ?? 0) < runSlot.goal) ? runSlot : next;

  const goalTotal = slots.reduce((sum, s) => sum + s.goal, 0);
  const doneTotal = slots.reduce((sum, s) => sum + Math.min(counts.get(s.projectId) ?? 0, s.goal), 0);

  function addMark(p: Project) {
    logPomodoro(Date.now() - workMin * 60_000, workMin, null, p.title, p.id);
  }

  /** Снять последний помидор проекта за сегодня: нажал по ошибке. */
  function removeMark(projectId: string) {
    const last = sessions.find((s) => s.date === today && s.projectId === projectId);
    if (!last) return;
    setSessions((l) =>
      l.map((s) => (s.id === last.id ? { ...s, deleted: true, updatedAt: Date.now() } : s)),
    );
  }

  return (
    <div className="dp">
      <div className="dp-head">
        <h3>Проекты дня</h3>
        {slots.length > 0 ? (
          <span className="muted small">
            {doneTotal} из {goalTotal} 🍅{slots.length > 0 && !next ? ' · план дня закрыт' : ''}
          </span>
        ) : (
          <span className="muted small">Выбери три проекта. Каждому три помидора, короткому хватит одного.</span>
        )}
      </div>

      <div className="dp-grid">
        {slots.map((slot, i) => {
          const p = projects.find((x) => x.id === slot.projectId);
          const done = counts.get(slot.projectId) ?? 0;
          const isCurrent = current?.projectId === slot.projectId;
          const live = !!run && run.projectId === slot.projectId;
          const step = p ? openSteps(p)[0]?.t : '';
          return (
            <article
              key={slot.projectId}
              className={`dp-card ${isCurrent ? 'dp-current' : ''} ${done >= slot.goal ? 'dp-closed' : ''}`}
            >
              <div className="dp-card-head">
                <span className="dp-num">{i + 1}</span>
                <h4>{p?.title ?? slot.projectId}</h4>
                <button
                  className="icon-btn"
                  onClick={() => save(slots.filter((s) => s !== slot))}
                  disabled={working && live}
                  aria-label="Убрать из плана дня"
                  title="Убрать из плана дня (сделанные помидоры останутся в журнале)"
                >
                  ×
                </button>
              </div>

              {step && <p className="dp-step small">Дальше: {step}</p>}

              <Tomatoes
                done={done}
                goal={slot.goal}
                liveShare={live && working ? 1 - leftMs / (workMin * 60_000) : null}
                onAdd={p ? () => addMark(p) : undefined}
                onRemove={() => removeMark(slot.projectId)}
                onGoal={(goal) => patchSlot(slot.projectId, goal)}
              />

              {live && (
                <div className={`dp-timer ${paused ? 'dp-paused' : ''}`}>
                  <span className="dp-time">{formatLeft(leftMs)}</span>
                  <span className="muted small">
                    {paused ? 'Пауза' : `${PHASE_META[run.phase].icon} ${PHASE_META[run.phase].label}`}
                  </span>
                </div>
              )}

              <div className="dp-actions">
                {live && working && !paused && (
                  <button className="btn" onClick={pomodoro.pause}>
                    ⏸ Пауза
                  </button>
                )}
                {live && working && paused && (
                  <button className="btn btn-primary" onClick={pomodoro.resume}>
                    ▶ Продолжить
                  </button>
                )}
                {live && working && (
                  <button className="btn cl-danger" onClick={pomodoro.stop} title="Прервать, помидор не засчитается">
                    ■ Стоп
                  </button>
                )}
                {!(live && working) && (
                  <button
                    className={`btn ${isCurrent ? 'btn-primary' : ''}`}
                    disabled={working || !p}
                    title={working ? 'Сначала закончи идущий помидор' : undefined}
                    onClick={() => p && pomodoro.start({ id: null, text: p.title }, p.id)}
                  >
                    {done >= slot.goal ? '▶ Ещё один' : `▶ Помидор ${done + 1} из ${slot.goal}`}
                  </button>
                )}
              </div>
            </article>
          );
        })}

        {Array.from({ length: emptyCount }, (_, i) => (
          <div key={i} className="dp-card dp-empty">
            <span className="dp-num">{slots.length + i + 1}</span>
            <select
              className="input"
              value=""
              aria-label="Выбрать проект"
              onChange={(e) => e.target.value && save([...slots, { projectId: e.target.value, goal: GOAL_DEFAULT }])}
            >
              <option value="">{i === 0 && slots.length >= SLOTS_MIN ? '+ ещё проект' : 'Выбрать проект…'}</option>
              {SPHERES.map(([sphere, label]) => {
                const list = options.filter((p) => p.sphere === sphere);
                return (
                  list.length > 0 && (
                    <optgroup key={sphere} label={label}>
                      {list.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </optgroup>
                  )
                );
              })}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ряд помидоров: сделанные яркие, идущий заполняется по кругу; ± меняют отведённое. */
function Tomatoes({
  done,
  goal,
  liveShare,
  onAdd,
  onRemove,
  onGoal,
}: {
  done: number;
  goal: number;
  /** Доля идущего помидора 0…1, null — сейчас не идёт. */
  liveShare: number | null;
  onAdd?: () => void;
  onRemove: () => void;
  onGoal: (goal: number) => void;
}) {
  const total = Math.max(done, goal) + (liveShare !== null && done >= goal ? 1 : 0);
  return (
    <div className="dp-tomatoes">
      {Array.from({ length: total }, (_, i) => {
        if (i < done) {
          return (
            <button key={i} className="dp-tomato dp-t-done" onClick={onRemove} title="Снять последний помидор">
              🍅
            </button>
          );
        }
        if (i === done && liveShare !== null) {
          return (
            <span
              key={i}
              className="dp-tomato dp-t-live"
              style={{ '--share': `${Math.round(liveShare * 360)}deg` } as React.CSSProperties}
              title="Идёт этот помидор"
            >
              <span>🍅</span>
            </span>
          );
        }
        return (
          <button key={i} className="dp-tomato" onClick={onAdd} title="Отметить сделанным без таймера">
            🍅
          </button>
        );
      })}
      <span className="dp-goal">
        <button
          className="icon-btn"
          disabled={goal <= 1}
          onClick={() => onGoal(goal - 1)}
          aria-label="Меньше помидоров"
          title="Меньше помидоров"
        >
          −
        </button>
        <button
          className="icon-btn"
          disabled={goal >= GOAL_MAX}
          onClick={() => onGoal(goal + 1)}
          aria-label="Больше помидоров"
          title="Больше помидоров"
        >
          +
        </button>
      </span>
    </div>
  );
}
