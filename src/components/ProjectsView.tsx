import { useMemo, useState } from 'react';
import type { Project, ProjectStage, StepWho } from '../types';
import { useListActions } from '../lib/storage';
import { todayKey } from '../lib/dates';
import {
  PRIORITIES,
  SPHERES,
  STAGES,
  STAGE_ORDER,
  WHO,
  ago,
  isQuiet,
  isStale,
  mineByProject,
  openSteps,
  sessionLink,
  sortProjects,
  toggleStep,
} from '../lib/projects';

/**
 * Пульт проектов: где что стоит, что дальше и что ждёт хозяина.
 *
 * Отвечает на вопрос «что у меня по проектам», а не «чем заняться сегодня»
 * (это вкладка «Сегодня»). Заполняют его сессии Claude и секретарь; здесь
 * хозяин отмечает шаги, добавляет свои, меняет этап и приоритет и оставляет
 * заметку для Claude — её забирает сессия «Пульт».
 */
export function ProjectsView({
  projects,
  setProjects,
}: {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
}) {
  const actions = useListActions(setProjects);
  const today = todayKey();
  const [sphere, setSphere] = useState<string>('all');
  const [focusOnly, setFocusOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [quietOpen, setQuietOpen] = useState<Set<string>>(new Set());
  const [mineAll, setMineAll] = useState(false);

  const mine = useMemo(() => mineByProject(projects), [projects]);
  const mineCount = mine.reduce((n, g) => n + g.steps.length, 0);
  const working = projects.filter((p) => p.stage === 'active' || p.stage === 'polish').length;
  const stale = projects.filter((p) => isStale(p, today) !== null).length;

  const edit = (id: string, patch: Partial<Project>) =>
    actions.update(id, { ...patch, updatedBy: 'приложение' });
  const toggle = (p: Project, i: number) => edit(p.id, { next: toggleStep(p, i, today) });
  const flip = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };
  const jump = (id: string) => {
    setSphere('all');
    setFocusOnly(false);
    setOpen((s) => new Set(s).add(id));
    requestAnimationFrame(() => document.getElementById(`pj-${id}`)?.scrollIntoView({ block: 'start' }));
  };

  if (!projects.length) {
    return (
      <section className="view view-narrow">
        <div className="view-head">
          <h2>Проекты</h2>
        </div>
        <p className="empty">
          Проектов пока нет. Они появятся после входа через Google, если на пульте что-то есть; завести
          новый — сказать Claude в сессии «Пульт».
        </p>
      </section>
    );
  }

  const MINE_LIMIT = 8;
  let shown = 0;

  return (
    <section className="view view-narrow pj">
      <div className="view-head">
        <h2>Проекты</h2>
        <span className="muted">пульт</span>
      </div>

      <div className="pj-tiles">
        <div className="pj-tile pj-tile-me">
          <b>{mineCount}</b>
          <span>ждёт тебя</span>
        </div>
        <div className="pj-tile pj-tile-work">
          <b>{working}</b>
          <span>в работе</span>
        </div>
        <div className="pj-tile pj-tile-stale">
          <b>{stale}</b>
          <span>застыли</span>
        </div>
      </div>

      {mine.length > 0 && (
        <div className="pj-mine">
          <h3>Ждёт тебя</h3>
          {mine.map((g) => {
            if (!mineAll && shown >= MINE_LIMIT) return null;
            const steps = mineAll ? g.steps : g.steps.slice(0, MINE_LIMIT - shown);
            shown += steps.length;
            return (
              <div key={g.project.id} className="pj-mine-group">
                <button className="pj-link" onClick={() => jump(g.project.id)}>
                  {g.project.title}
                </button>
                <ul className="pj-steps">
                  {steps.map(({ step, i }) => (
                    <StepRow key={i} text={step.t} who={step.who} done={false} onToggle={() => toggle(g.project, i)} />
                  ))}
                </ul>
              </div>
            );
          })}
          {mineCount > MINE_LIMIT && (
            <button className="pj-more" onClick={() => setMineAll((v) => !v)}>
              {mineAll ? 'Свернуть' : `Показать все ${mineCount}`}
            </button>
          )}
        </div>
      )}

      <div className="docs-chips pj-chips">
        <button className={`chip ${sphere === 'all' ? 'chip-on' : ''}`} onClick={() => setSphere('all')}>
          Все<span className="chip-count">{projects.length}</span>
        </button>
        {SPHERES.map(([k, label]) => (
          <button key={k} className={`chip ${sphere === k ? 'chip-on' : ''}`} onClick={() => setSphere(k)}>
            {label}
            <span className="chip-count">{projects.filter((p) => p.sphere === k).length}</span>
          </button>
        ))}
        <button className={`chip ${focusOnly ? 'chip-on' : ''}`} onClick={() => setFocusOnly((v) => !v)}>
          В фокусе
        </button>
      </div>

      {SPHERES.filter(([k]) => sphere === 'all' || sphere === k).map(([k, label]) => {
        let ps = sortProjects(projects.filter((p) => p.sphere === k));
        if (focusOnly) ps = ps.filter((p) => p.focus);
        if (!ps.length) return null;
        const main = ps.filter((p) => !isQuiet(p) || open.has(p.id));
        const quiet = ps.filter((p) => isQuiet(p) && !open.has(p.id));
        return (
          <div key={k} className="pj-sphere">
            <h3 className="pj-sphere-head">
              {label} <span className="muted">{ps.length}</span>
            </h3>
            {main.map((p) => (
              <ProjectCard
                key={p.id}
                p={p}
                today={today}
                isOpen={open.has(p.id)}
                onOpen={() => setOpen((s) => flip(s, p.id))}
                onToggle={(i) => toggle(p, i)}
                onEdit={(patch) => edit(p.id, patch)}
              />
            ))}
            {quiet.length > 0 && (
              <div className="pj-quiet">
                <button className="pj-more" onClick={() => setQuietOpen((s) => flip(s, k))}>
                  {quietOpen.has(k) ? 'Скрыть' : 'Показать'} тихие: {quiet.length} — живут без открытых шагов
                </button>
                {quietOpen.has(k) &&
                  quiet.map((p) => (
                    <button key={p.id} className="pj-qline" onClick={() => setOpen((s) => flip(s, p.id))}>
                      <span>{p.title}</span>
                      <span className={`pj-stage pj-st-${p.stage}`}>{STAGES[p.stage]}</span>
                      <span className="pj-when">{ago(p.lastActivity, today)}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        );
      })}

      <p className="muted small pj-foot">
        Отметки, шаги и заметки сохраняются сразу. Заполняют пульт сессии Claude; заметку для Claude
        забирает сессия «Пульт». Ссылки на сессии открываются в приложении Claude на компьютере.
      </p>
    </section>
  );
}

function StepRow({ text, who, done, onToggle }: { text: string; who: StepWho; done: boolean; onToggle: () => void }) {
  return (
    <li className={done ? 'pj-step-done' : ''}>
      <label>
        <input type="checkbox" checked={done} onChange={onToggle} />
        <span className="pj-step-text">{text}</span>
        <span className={`pj-who pj-who-${who}`}>{WHO[who] ?? who}</span>
      </label>
    </li>
  );
}

function ProjectCard({
  p,
  today,
  isOpen,
  onOpen,
  onToggle,
  onEdit,
}: {
  p: Project;
  today: string;
  isOpen: boolean;
  onOpen: () => void;
  onToggle: (i: number) => void;
  onEdit: (patch: Partial<Project>) => void;
}) {
  const stale = isStale(p, today);
  return (
    <article id={`pj-${p.id}`} className={`pj-card ${p.focus ? 'pj-card-focus' : ''}`}>
      <div className="pj-head">
        <button className="pj-title" aria-expanded={isOpen} onClick={onOpen}>
          <span className="pj-arrow">{isOpen ? '▾' : '▸'}</span>
          {p.title}
        </button>
        <span className={`pj-stage pj-st-${p.stage}`}>{STAGES[p.stage] ?? p.stage}</span>
        {p.priority > 0 && <span className={`pj-prio pj-prio-${p.priority}`}>{PRIORITIES[p.priority as 1 | 2 | 3]}</span>}
        {p.focus && <span className="pj-focus">в фокусе</span>}
        {p.note && <span title="Есть заметка для Claude">✉</span>}
        <span className={`pj-when ${stale !== null ? 'pj-when-stale' : ''}`}>
          {stale !== null ? `тихо ${stale} дн.` : ago(p.lastActivity, today)}
        </span>
      </div>
      {p.goal && <p className="pj-goal">🎯 {p.goal}</p>}
      {p.now && <p className="pj-now">{p.now}</p>}
      {p.waiting && <p className="pj-wait">Ждём: {p.waiting}</p>}
      {p.next.length > 0 && (
        <ul className="pj-steps">
          {p.next.map((s, i) => (
            <StepRow key={i} text={s.t} who={s.who} done={s.done} onToggle={() => onToggle(i)} />
          ))}
        </ul>
      )}
      {isOpen && <ProjectDetails p={p} today={today} onEdit={onEdit} />}
    </article>
  );
}

function ProjectDetails({ p, today, onEdit }: { p: Project; today: string; onEdit: (patch: Partial<Project>) => void }) {
  const [step, setStep] = useState('');
  const [who, setWho] = useState<StepWho>('me');
  const [note, setNote] = useState(p.note);
  const [goal, setGoal] = useState(p.goal);
  const done = [...p.done].sort((a, b) => (b.d || '').localeCompare(a.d || ''));

  const addStep = () => {
    const t = step.trim();
    if (!t) return;
    onEdit({ next: [...p.next, { t, who, done: false, addedAt: today }] });
    setStep('');
  };

  return (
    <div className="pj-details">
      <dl>
        {p.what && (
          <>
            <dt>Что это</dt>
            <dd>{p.what}</dd>
          </>
        )}
        {done.length > 0 && (
          <>
            <dt>Сделано</dt>
            <dd>
              <ul>
                {done.map((d, i) => (
                  <li key={i}>
                    <span className="pj-date">{ago(d.d, today)}</span> {d.t}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {p.sessions.length > 0 && (
          <>
            <dt>Сессии</dt>
            <dd>
              <ul>
                {p.sessions.map((s) => (
                  <li key={s.id}>
                    <a href={sessionLink(s.id)}>{s.t || 'сессия'}</a>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {p.links.length > 0 && (
          <>
            <dt>Ссылки</dt>
            <dd>
              <ul>
                {p.links.map((l) => (
                  <li key={l.u}>
                    <a href={l.u} target="_blank" rel="noreferrer">
                      {l.t || l.u}
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {p.path && (
          <>
            <dt>Где лежит</dt>
            <dd className="pj-mono">{p.path}</dd>
          </>
        )}
        <dt>Правил</dt>
        <dd className="pj-mono">
          {p.updatedBy || '—'} · {new Date(p.updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </dd>
      </dl>

      <div className="pj-row">
        <input
          className="input"
          placeholder="Новый шаг"
          value={step}
          onChange={(e) => setStep(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addStep()}
        />
        <select className="input input-select" value={who} onChange={(e) => setWho(e.target.value as StepWho)} aria-label="Кто делает">
          {Object.entries(WHO).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={addStep}>
          Добавить
        </button>
      </div>

      <div className="pj-row">
        <label className="pj-lbl">
          Этап
          <select className="input input-select" value={p.stage} onChange={(e) => onEdit({ stage: e.target.value as ProjectStage })}>
            {STAGE_ORDER.map((k) => (
              <option key={k} value={k}>
                {STAGES[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="pj-lbl">
          Приоритет
          <select
            className="input input-select"
            value={p.priority}
            onChange={(e) => onEdit({ priority: Number(e.target.value) as Project['priority'] })}
          >
            <option value={0}>не задан</option>
            {([1, 2, 3] as const).map((k) => (
              <option key={k} value={k}>
                {PRIORITIES[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="pj-lbl pj-lbl-check">
          <input type="checkbox" checked={p.focus} onChange={(e) => onEdit({ focus: e.target.checked })} />в фокусе
        </label>
      </div>

      <label className="pj-lbl pj-lbl-col">
        Цель
        <textarea className="input textarea" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Чего хотим добиться" />
      </label>
      {goal !== p.goal && (
        <button className="btn" onClick={() => onEdit({ goal: goal.trim() })}>
          Сохранить цель
        </button>
      )}

      <label className="pj-lbl pj-lbl-col">
        Заметка для Claude{p.noteAt ? ` · ${new Date(p.noteAt).toLocaleDateString('ru-RU')}` : ''}
        <textarea
          className="input textarea"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="«это закрыто», «сначала сделай…», «поменяй этап»"
        />
      </label>
      {note !== p.note && (
        <button className="btn" onClick={() => onEdit({ note: note.trim(), noteAt: note.trim() ? Date.now() : null })}>
          Сохранить заметку
        </button>
      )}
      {openSteps(p).length === 0 && p.next.length > 0 && <p className="muted small">Все шаги отмечены — «Пульт» перенесёт их в «Сделано».</p>}
    </div>
  );
}
