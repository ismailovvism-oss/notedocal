import { useEffect, useMemo, useState } from 'react';
import type { Project, ProjectSphere, ProjectStage, StepWho } from '../types';
import { useListActions } from '../lib/storage';
import { todayKey } from '../lib/dates';
import {
  PRIORITIES,
  SPHERES,
  SPHERE_LABEL,
  STAGES,
  STAGE_ORDER,
  WHO,
  ago,
  isFocus,
  isQuiet,
  isStale,
  matchesQuery,
  mineByProject,
  openSteps,
  sessionLink,
  sortProjects,
  toggleStep,
} from '../lib/projects';

type Filter = 'all' | 'mine' | 'focus' | 'work' | 'stale';

/** В колонке «Ждёт тебя» — столько шагов на проект, остальное в панели проекта. */
const MINE_PER_PROJECT = 3;

/**
 * Пульт проектов: где что стоит, что дальше и что ждёт хозяина.
 *
 * На широком экране: слева колонка «Внимание» (твои шаги, застывшие, заметки
 * для Claude), справа — «В фокусе» крупно и сферы сеткой карточек; тихие
 * проекты — строкой значков. Подробности и правка — в панели справа, лента
 * при этом не раздувается. Заполняют пульт сессии Claude и секретарь.
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
  const [filter, setFilter] = useState<Filter>('all');
  const [sphere, setSphere] = useState<ProjectSphere | 'all'>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const edit = (id: string, patch: Partial<Project>) => actions.update(id, { ...patch, updatedBy: 'приложение' });
  const toggle = (p: Project, i: number) => edit(p.id, { next: toggleStep(p, i, today) });

  const mine = useMemo(() => mineByProject(projects), [projects]);
  const mineCount = mine.reduce((n, g) => n + g.steps.length, 0);
  const stale = useMemo(
    () => sortProjects(projects.filter((p) => isStale(p, today) !== null)),
    [projects, today],
  );
  const notes = projects.filter((p) => p.note);
  const counts = {
    mine: mineCount,
    focus: projects.filter(isFocus).length,
    work: projects.filter((p) => p.stage === 'active' || p.stage === 'polish').length,
    stale: stale.length,
  };

  const shown = useMemo(() => {
    let list = projects.filter((p) => matchesQuery(p, query));
    if (sphere !== 'all') list = list.filter((p) => p.sphere === sphere);
    if (filter === 'mine') list = list.filter((p) => p.next.some((s) => s.who === 'me' && !s.done));
    if (filter === 'focus') list = list.filter(isFocus);
    if (filter === 'work') list = list.filter((p) => p.stage === 'active' || p.stage === 'polish');
    if (filter === 'stale') list = list.filter((p) => isStale(p, today) !== null);
    return sortProjects(list);
  }, [projects, query, sphere, filter, today]);

  const focus = shown.filter(isFocus);
  const open = projects.find((p) => p.id === openId) ?? null;

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

  const stat = (id: Filter, n: number, label: string) => (
    <button
      className={`pj-stat pj-stat-${id} ${filter === id ? 'pj-stat-on' : ''}`}
      onClick={() => setFilter((f) => (f === id ? 'all' : id))}
      aria-pressed={filter === id}
    >
      <b>{n}</b>
      <span>{label}</span>
    </button>
  );

  return (
    <section className="pj">
      <header className="pj-head">
        <h2>Проекты</h2>
        <input
          className="input pj-search"
          type="search"
          placeholder="Поиск по проектам и шагам"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="pj-stats">
          {stat('mine', counts.mine, 'ждёт тебя')}
          {stat('focus', counts.focus, 'в фокусе')}
          {stat('work', counts.work, 'в работе')}
          {stat('stale', counts.stale, 'застыли')}
        </div>
      </header>

      <div className="pj-spheres">
        <button className={`pj-sph ${sphere === 'all' ? 'pj-sph-on' : ''}`} onClick={() => setSphere('all')}>
          Все сферы
        </button>
        {SPHERES.map(([k, label]) => (
          <button
            key={k}
            className={`pj-sph sp-${k} ${sphere === k ? 'pj-sph-on' : ''}`}
            onClick={() => setSphere((s) => (s === k ? 'all' : k))}
          >
            <i className="pj-dot" />
            {label}
            <span className="pj-sph-n">{projects.filter((p) => p.sphere === k).length}</span>
          </button>
        ))}
        {(filter !== 'all' || sphere !== 'all' || query) && (
          <button
            className="pj-reset"
            onClick={() => {
              setFilter('all');
              setSphere('all');
              setQuery('');
            }}
          >
            Сбросить
          </button>
        )}
      </div>

      <div className="pj-body">
        <aside className="pj-aside" aria-label="Внимание">
          <div className="pj-box">
            <h3>
              Ждёт тебя <span className="pj-n">{mineCount}</span>
            </h3>
            {mine.length === 0 && <p className="muted small">Ничего не ждёт твоего решения.</p>}
            {mine.map((g) => (
              <div key={g.project.id} className="pj-mine">
                <button className={`pj-mine-title sp-${g.project.sphere}`} onClick={() => setOpenId(g.project.id)}>
                  <i className="pj-dot" />
                  {g.project.title}
                </button>
                <ul className="pj-steps">
                  {g.steps.slice(0, MINE_PER_PROJECT).map(({ step, i }) => (
                    <StepRow key={i} text={step.t} who={step.who} done={false} hideWho onToggle={() => toggle(g.project, i)} />
                  ))}
                </ul>
                {g.steps.length > MINE_PER_PROJECT && (
                  <button className="pj-mine-more" onClick={() => setOpenId(g.project.id)}>
                    ещё {g.steps.length - MINE_PER_PROJECT} — открыть проект
                  </button>
                )}
              </div>
            ))}
          </div>

          {stale.length > 0 && (
            <div className="pj-box">
              <h3>
                Застыли <span className="pj-n">{stale.length}</span>
              </h3>
              <ul className="pj-plain">
                {stale.map((p) => (
                  <li key={p.id}>
                    <button className={`pj-line sp-${p.sphere}`} onClick={() => setOpenId(p.id)}>
                      <i className="pj-dot" />
                      <span>{p.title}</span>
                      <span className="pj-stale-n">{isStale(p, today)} дн.</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {notes.length > 0 && (
            <div className="pj-box">
              <h3>
                Заметки для Claude <span className="pj-n">{notes.length}</span>
              </h3>
              <ul className="pj-plain">
                {notes.map((p) => (
                  <li key={p.id}>
                    <button className="pj-note-line" onClick={() => setOpenId(p.id)}>
                      <b>{p.title}</b>
                      <span>{p.note}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted small">Забирает сессия «Пульт» при обновлении.</p>
            </div>
          )}
        </aside>

        <div className="pj-main">
          {shown.length === 0 && <p className="empty">Под этот отбор проектов нет.</p>}

          {focus.length > 0 && (
            <section className="pj-sec">
              <h3 className="pj-sec-head">
                ★ В фокусе <span className="pj-n">{focus.length}</span>
              </h3>
              <div className="pj-grid pj-grid-big">
                {focus.map((p) => (
                  <Card key={p.id} p={p} big today={today} onOpen={() => setOpenId(p.id)} onToggle={(i) => toggle(p, i)} />
                ))}
              </div>
            </section>
          )}

          {SPHERES.map(([k, label]) => {
            const ps = shown.filter((p) => p.sphere === k && !isFocus(p));
            if (!ps.length) return null;
            const cards = ps.filter((p) => !isQuiet(p));
            const quiet = ps.filter(isQuiet);
            return (
              <section key={k} className={`pj-sec sp-${k}`}>
                <h3 className="pj-sec-head">
                  <i className="pj-dot" />
                  {label} <span className="pj-n">{ps.length}</span>
                </h3>
                {cards.length > 0 && (
                  <div className="pj-grid">
                    {cards.map((p) => (
                      <Card key={p.id} p={p} today={today} onOpen={() => setOpenId(p.id)} onToggle={(i) => toggle(p, i)} />
                    ))}
                  </div>
                )}
                {quiet.length > 0 && (
                  <div className="pj-quiet">
                    <span className="muted small">Тихие:</span>
                    {quiet.map((p) => (
                      <button key={p.id} className="pj-quiet-chip" onClick={() => setOpenId(p.id)} title={p.now || p.what}>
                        {p.title}
                        <span className={`pj-stage pj-st-${p.stage}`}>{STAGES[p.stage]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {open && <ProjectPanel key={open.id} p={open} today={today} onClose={() => setOpenId(null)} onEdit={(patch) => edit(open.id, patch)} />}
    </section>
  );
}

function StepRow({
  text,
  who,
  done,
  hideWho,
  onToggle,
}: {
  text: string;
  who: StepWho;
  done: boolean;
  hideWho?: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={done ? 'pj-step-done' : ''} onClick={(e) => e.stopPropagation()}>
      <label>
        <input type="checkbox" checked={done} onChange={onToggle} />
        <span className="pj-step-text">{text}</span>
        {!hideWho && <span className={`pj-who pj-who-${who}`}>{WHO[who] ?? who}</span>}
      </label>
    </li>
  );
}

function Badges({ p, today }: { p: Project; today: string }) {
  const stale = isStale(p, today);
  return (
    <div className="pj-badges">
      <span className={`pj-stage pj-st-${p.stage}`}>{STAGES[p.stage] ?? p.stage}</span>
      {p.priority > 0 && <span className={`pj-prio pj-prio-${p.priority}`}>{PRIORITIES[p.priority as 1 | 2 | 3]}</span>}
      {p.focus && <span className="pj-focus">★ фокус</span>}
      {p.note && <span className="pj-flag" title="Заметка для Claude">✉</span>}
      <span className={`pj-when ${stale !== null ? 'pj-when-stale' : ''}`}>
        {stale !== null ? `тихо ${stale} дн.` : ago(p.lastActivity, today)}
      </span>
    </div>
  );
}

function Card({
  p,
  big,
  today,
  onOpen,
  onToggle,
}: {
  p: Project;
  big?: boolean;
  today: string;
  onOpen: () => void;
  onToggle: (i: number) => void;
}) {
  const steps = p.next.map((s, i) => ({ s, i })).filter((x) => !x.s.done);
  const limit = big ? 4 : 2;
  const ticked = p.next.length - steps.length;
  return (
    <article
      className={`pj-card sp-${p.sphere} ${big ? 'pj-card-big' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' ? onOpen() : undefined)}
      tabIndex={0}
      role="button"
      aria-label={`Открыть: ${p.title}`}
    >
      <div className="pj-card-top">
        <i className="pj-dot" />
        <h4>{p.title}</h4>
      </div>
      <Badges p={p} today={today} />
      {p.goal && <p className="pj-goal">🎯 {p.goal}</p>}
      {p.now && <p className={`pj-now ${big ? 'pj-clamp3' : 'pj-clamp2'}`}>{p.now}</p>}
      {p.waiting && <p className="pj-wait">Ждём: {p.waiting}</p>}
      {steps.length > 0 && (
        <ul className="pj-steps">
          {steps.slice(0, limit).map(({ s, i }) => (
            <StepRow key={i} text={s.t} who={s.who} done={false} onToggle={() => onToggle(i)} />
          ))}
        </ul>
      )}
      {(steps.length > limit || ticked > 0) && (
        <p className="pj-more-line">
          {steps.length > limit && `ещё ${steps.length - limit} ${steps.length - limit === 1 ? 'шаг' : 'шагов'}`}
          {steps.length > limit && ticked > 0 && ' · '}
          {ticked > 0 && `отмечено ${ticked}`}
        </p>
      )}
    </article>
  );
}

function ProjectPanel({
  p,
  today,
  onClose,
  onEdit,
}: {
  p: Project;
  today: string;
  onClose: () => void;
  onEdit: (patch: Partial<Project>) => void;
}) {
  const [step, setStep] = useState('');
  const [who, setWho] = useState<StepWho>('me');
  const [goal, setGoal] = useState(p.goal);
  const [note, setNote] = useState(p.note);
  const done = [...p.done].sort((a, b) => (b.d || '').localeCompare(a.d || ''));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addStep = () => {
    const t = step.trim();
    if (!t) return;
    onEdit({ next: [...p.next, { t, who, done: false, addedAt: today }] });
    setStep('');
  };
  const toggle = (i: number) => onEdit({ next: toggleStep(p, i, today) });

  return (
    <>
      <div className="pj-backdrop" onClick={onClose} />
      <aside className={`pj-panel sp-${p.sphere}`} role="dialog" aria-label={p.title}>
        <header className="pj-panel-head">
          <div>
            <span className="pj-panel-sphere">
              <i className="pj-dot" />
              {SPHERE_LABEL[p.sphere]}
            </span>
            <h3>{p.title}</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        <div className="pj-panel-body">
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

          <div className="pj-field">
            <h4>Цель</h4>
            <textarea className="input textarea" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Чего хотим добиться" />
            {goal !== p.goal && (
              <button className="btn btn-small" onClick={() => onEdit({ goal: goal.trim() })}>
                Сохранить цель
              </button>
            )}
          </div>

          {(p.now || p.waiting || p.what) && (
            <div className="pj-field">
              <h4>Где остановились</h4>
              {p.now && <p>{p.now}</p>}
              {p.waiting && <p className="pj-wait">Ждём: {p.waiting}</p>}
              {p.what && <p className="muted small">{p.what}</p>}
            </div>
          )}

          <div className="pj-field">
            <h4>
              Шаги <span className="pj-n">{openSteps(p).length}</span>
            </h4>
            {p.next.length > 0 && (
              <ul className="pj-steps">
                {p.next.map((s, i) => (
                  <StepRow key={i} text={s.t} who={s.who} done={s.done} onToggle={() => toggle(i)} />
                ))}
              </ul>
            )}
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
              <button className="btn btn-primary btn-small" onClick={addStep}>
                Добавить
              </button>
            </div>
          </div>

          {done.length > 0 && (
            <div className="pj-field">
              <h4>Сделано</h4>
              <ul className="pj-done">
                {done.map((d, i) => (
                  <li key={i}>
                    <span className="pj-date">{ago(d.d, today)}</span>
                    {d.t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pj-field">
            <h4>Заметка для Claude{p.noteAt ? ` · ${new Date(p.noteAt).toLocaleDateString('ru-RU')}` : ''}</h4>
            <textarea
              className="input textarea"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="«это закрыто», «сначала сделай…», «поменяй этап»"
            />
            {note !== p.note && (
              <button className="btn btn-small" onClick={() => onEdit({ note: note.trim(), noteAt: note.trim() ? Date.now() : null })}>
                Сохранить заметку
              </button>
            )}
          </div>

          <dl className="pj-meta">
            {p.sessions.length > 0 && (
              <>
                <dt>Сессии</dt>
                <dd>
                  {p.sessions.map((s) => (
                    <a key={s.id} href={sessionLink(s.id)}>
                      {s.t || 'сессия'}
                    </a>
                  ))}
                </dd>
              </>
            )}
            {p.links.length > 0 && (
              <>
                <dt>Ссылки</dt>
                <dd>
                  {p.links.map((l) => (
                    <a key={l.u} href={l.u} target="_blank" rel="noreferrer">
                      {l.t || l.u}
                    </a>
                  ))}
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
              {p.updatedBy || '—'} ·{' '}
              {new Date(p.updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </dd>
          </dl>
        </div>
      </aside>
    </>
  );
}
