// Пульт проектов: подписи и чистая логика вкладки «Проекты».
// Те же поля и подписи — в scripts/projects.mjs (команды секретаря).

import type { Project, ProjectSphere, ProjectStage, ProjectStep, StepWho } from '../types';
import { todayKey } from './dates';

export const SPHERES: [ProjectSphere, string][] = [
  ['uchet', 'Учёт и деньги'],
  ['masail', 'Масаиль и книги'],
  ['apps', 'Ислам-приложения'],
  ['tools', 'Проги и инструменты'],
  ['family', 'Семья и дом'],
];

export const STAGES: Record<ProjectStage, string> = {
  active: 'в работе',
  polish: 'доводка',
  idea: 'замысел',
  live: 'живой',
  paused: 'пауза',
  closed: 'закрыт',
};
export const STAGE_ORDER: ProjectStage[] = ['active', 'polish', 'idea', 'live', 'paused', 'closed'];

export const PRIORITIES: Record<1 | 2 | 3, string> = { 1: 'главное', 2: 'важное', 3: 'фоновое' };

export const WHO: Record<StepWho, string> = { me: 'ты', claude: 'Claude', other: 'другие' };

/** Активный проект молчит столько дней — помечаем «тихо». */
export const STALE_DAYS = 10;

export function daysSince(key: string, today = todayKey()): number | null {
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000);
}

export function ago(key: string, today = todayKey()): string {
  const n = daysSince(key, today);
  if (n === null) return '';
  if (n <= 0) return 'сегодня';
  if (n === 1) return 'вчера';
  if (n < 7) return `${n} дн. назад`;
  const [, m, d] = key.split('-');
  return `${d}.${m}`;
}

export function isStale(p: Project, today = todayKey()): number | null {
  const n = daysSince(p.lastActivity, today);
  return (p.stage === 'active' || p.stage === 'polish') && n !== null && n >= STALE_DAYS ? n : null;
}

export const openSteps = (p: Project) => p.next.filter((s) => !s.done);

/** Тихий — живёт сам: без открытых шагов, не в работе и не в фокусе. */
export function isQuiet(p: Project): boolean {
  return !p.focus && openSteps(p).length === 0 && ['live', 'paused', 'closed'].includes(p.stage);
}

export function sortProjects(list: Project[]): Project[] {
  return [...list].sort((a, b) => {
    if (a.focus !== b.focus) return a.focus ? -1 : 1;
    const pa = a.priority || 9;
    const pb = b.priority || 9;
    if (pa !== pb) return pa - pb;
    const sa = STAGE_ORDER.indexOf(a.stage);
    const sb = STAGE_ORDER.indexOf(b.stage);
    if (sa !== sb) return sa - sb;
    return (b.lastActivity || '').localeCompare(a.lastActivity || '');
  });
}

/** Шаги, которые ждут хозяина, сгруппированные по проектам (порядок — как на пульте). */
export function mineByProject(list: Project[]): { project: Project; steps: { step: ProjectStep; i: number }[] }[] {
  return sortProjects(list)
    .map((project) => ({
      project,
      steps: project.next.map((step, i) => ({ step, i })).filter((x) => x.step.who === 'me' && !x.step.done),
    }))
    .filter((g) => g.steps.length);
}

export function toggleStep(p: Project, i: number, today = todayKey()): ProjectStep[] {
  return p.next.map((s, j) => {
    if (j !== i) return s;
    if (s.done) {
      const rest = { ...s, done: false };
      delete rest.doneAt;
      return rest;
    }
    return { ...s, done: true, doneAt: today };
  });
}

export function sessionLink(id: string): string {
  return `claude://claude.ai/epitaxy/${id}`;
}
