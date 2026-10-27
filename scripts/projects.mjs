// Пульт проектов: логика команд `secretary project …`.
//
// Проект — документ users/{uid}/projects/{id} (подколлекция, как finance),
// вкладка «Проекты» в приложении читает его же (src/lib/projects.ts повторяет
// поля и подписи). Пишут сюда хозяин из приложения, сессия «Пульт» и любая
// сессия проекта после заметного шага (порядок — ~/projects/work/pult/CLAUDE.md).
//
// Чистые функции экспортируются для тестов; запись — через `saveProject`.

import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const SPHERES = {
  uchet: 'Учёт и деньги',
  masail: 'Масаиль и книги',
  apps: 'Ислам-приложения',
  tools: 'Проги и инструменты',
  family: 'Семья и дом',
};
export const STAGES = {
  active: 'в работе',
  polish: 'доводка',
  idea: 'замысел',
  live: 'живой',
  paused: 'пауза',
  closed: 'закрыт',
};
export const STAGE_ORDER = ['active', 'polish', 'idea', 'live', 'paused', 'closed'];
export const WHO = { me: 'ты', claude: 'Claude', other: 'другие' };

const STAGE_ALIASES = Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [v, k]));
const WHO_ALIASES = { я: 'me', ты: 'me', хозяин: 'me', клод: 'claude', другие: 'other' };

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function parseStage(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  const v = STAGES[s] ? s : STAGE_ALIASES[s];
  if (!v) throw new Error(`этап — одно из: ${STAGE_ORDER.join(', ')} (или ${Object.values(STAGES).join(', ')})`);
  return v;
}

export function parseSphere(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!SPHERES[s]) throw new Error(`сфера — одно из: ${Object.keys(SPHERES).join(', ')}`);
  return s;
}

export const PRIORITIES = { 1: 'главное', 2: 'важное', 3: 'фоновое' };

/** 1 главное · 2 важное · 3 фоновое · 0 не задан (none). */
export function parsePriority(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (/^(0|none|нет|-)$/.test(s)) return 0;
  const n = Number(s) || Number(Object.entries(PRIORITIES).find(([, v]) => v === s)?.[0]);
  if (![1, 2, 3].includes(n)) throw new Error('приоритет: 1 (главное), 2 (важное), 3 (фоновое) или none');
  return n;
}

export function parseWho(raw) {
  if (raw === undefined || raw === true) return 'me';
  const s = String(raw).trim().toLowerCase();
  const v = WHO[s] ? s : WHO_ALIASES[s];
  if (!v) throw new Error('кто делает шаг: me (хозяин), claude, other');
  return v;
}

/** Документ проекта в полном виде: без undefined, со всеми полями (Firestore не берёт undefined). */
export function normalizeProject(p, id = p.id) {
  const now = Date.now();
  const ts = (v) => (typeof v === 'number' ? v : v ? Date.parse(v) || now : now);
  return {
    id,
    title: p.title ?? id,
    sphere: p.sphere ?? 'tools',
    stage: p.stage ?? 'active',
    focus: !!p.focus,
    priority: [1, 2, 3].includes(p.priority) ? p.priority : 0,
    what: p.what ?? '',
    goal: p.goal ?? '',
    now: p.now ?? '',
    next: (p.next ?? []).map((s) => ({
      t: s.t,
      who: s.who ?? 'me',
      done: !!s.done,
      ...(s.doneAt ? { doneAt: s.doneAt } : {}),
      ...(s.addedAt ? { addedAt: s.addedAt } : {}),
      ...(s.comment ? { comment: s.comment, commentAt: s.commentAt ?? '', commentState: s.commentState ?? 'new' } : {}),
      ...(s.comment && s.commentTo ? { commentTo: s.commentTo } : {}),
      ...(s.comment && s.commentReply ? { commentReply: s.commentReply } : {}),
    })),
    done: (p.done ?? []).map((d) => ({ t: d.t, d: d.d ?? '' })),
    waiting: p.waiting ?? '',
    path: p.path ?? '',
    sessions: (p.sessions ?? []).map((s) => ({ id: s.id, t: s.t ?? '' })),
    links: (p.links ?? []).map((l) => ({ t: l.t ?? l.u, u: l.u })),
    lastActivity: p.lastActivity ?? todayKey(),
    note: p.note ?? '',
    noteAt: p.noteAt ? ts(p.noteAt) : null,
    ...(p.note && p.noteState ? { noteState: p.noteState } : p.note ? { noteState: 'new' } : {}),
    ...(p.note && p.noteTo ? { noteTo: p.noteTo } : {}),
    ...(p.note && p.noteReply ? { noteReply: p.noteReply } : {}),
    updatedBy: p.updatedBy ?? '',
    createdAt: p.createdAt ? ts(p.createdAt) : now,
    updatedAt: p.updatedAt ? ts(p.updatedAt) : now,
    deleted: !!p.deleted,
  };
}

/** Проект по id или подстроке названия; несколько подходящих — ошибка со списком. */
export function findProject(projects, query) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('нужен id проекта (список: project list)');
  const exact = projects.filter((p) => p.id === q);
  if (exact.length) return exact[0];
  const low = q.toLowerCase();
  const found = projects.filter((p) => p.title.toLowerCase().includes(low));
  if (found.length === 1) return found[0];
  if (!found.length) throw new Error(`не нашёл проект «${q}» (список: project list)`);
  throw new Error(`под «${q}» подходит несколько:\n${found.map((p) => `  · ${p.id} — ${p.title}`).join('\n')}`);
}

/** Номер шага (с 1) или подстрока его текста → индекс в next. */
export function stepIndex(p, query) {
  const q = String(query ?? '').trim();
  if (/^\d+$/.test(q)) {
    const i = Number(q) - 1;
    if (!p.next[i]) throw new Error(`у «${p.title}» нет шага №${q}`);
    return i;
  }
  const low = q.toLowerCase();
  const found = p.next.map((s, i) => [s, i]).filter(([s]) => s.t.toLowerCase().includes(low));
  if (found.length === 1) return found[0][1];
  if (!found.length) throw new Error(`у «${p.title}» нет шага «${q}»`);
  throw new Error(`под «${q}» подходит несколько шагов:\n${found.map(([s, i]) => `  ${i + 1}. ${s.t}`).join('\n')}`);
}

const ДОНЕ_ДЕРЖАТЬ = 8;

/** Правка полей из флагов `project set`. Возвращает новый документ. */
export function applySet(p, flags) {
  const next = { ...p };
  let touched = false;
  for (const key of ['title', 'what', 'goal', 'now', 'waiting', 'path']) {
    if (typeof flags[key] === 'string') {
      next[key] = flags[key];
      touched = true;
    }
  }
  if ('stage' in flags) {
    next.stage = parseStage(flags.stage);
    touched = true;
  }
  if ('sphere' in flags) {
    next.sphere = parseSphere(flags.sphere);
    touched = true;
  }
  if ('focus' in flags) {
    next.focus = !/^(нет|no|false|0|off)$/i.test(String(flags.focus));
    touched = true;
  }
  if ('priority' in flags) {
    next.priority = parsePriority(flags.priority);
    touched = true;
  }
  if ('note' in flags) {
    const s = flags.note === true ? '' : String(flags.note);
    next.note = /^(none|нет|-)$/i.test(s) ? '' : s;
    next.noteAt = next.note ? Date.now() : null;
    touched = true;
  }
  if (!touched && !('last' in flags)) {
    throw new Error('нечего менять: --now / --stage / --focus / --what / --waiting / --path / --title / --sphere / --note / --last');
  }
  if (typeof flags.last === 'string') next.lastActivity = flags.last;
  else if (typeof flags.now === 'string') next.lastActivity = todayKey();
  return next;
}

export function addStep(p, text, who = 'me') {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('нужен текст шага');
  return { ...p, next: [...p.next, { t, who, done: false, addedAt: todayKey() }] };
}

/** Записать сделанное: сверху в done; если такой шаг стоит в next — убрать его. */
export function markDone(p, text, date = todayKey()) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('нужен текст сделанного');
  // Номер или подстрока ровно одного шага — закрываем этот шаг; иначе это новое сделанное.
  const hits = p.next.filter((s) => s.t.toLowerCase().includes(t.toLowerCase()));
  const i = /^\d+$/.test(t) || hits.length > 1 ? stepIndex(p, t) : hits.length ? p.next.indexOf(hits[0]) : -1;
  const label = i >= 0 ? p.next[i].t : t;
  return {
    ...p,
    next: p.next.filter((_, j) => j !== i),
    done: [{ t: label, d: date }, ...p.done].slice(0, ДОНЕ_ДЕРЖАТЬ),
    lastActivity: date > p.lastActivity ? date : p.lastActivity,
  };
}

// ---------- Комментарии хозяина: к шагу (номер) или ко всему проекту ('note') ----------
// new — ждёт «Пульт», sent — передано сессии проекта, done — сессия сделала (reply — что именно).

export function comments(projects, { pending = false } = {}) {
  const out = [];
  for (const p of projects) {
    if (p.note) {
      out.push({ id: p.id, title: p.title, n: 'note', step: '(весь проект)', comment: p.note,
        state: p.noteState ?? 'new', at: p.noteAt ? new Date(p.noteAt).toISOString() : '', to: p.noteTo ?? '',
        reply: p.noteReply ?? '', sessions: p.sessions });
    }
    p.next.forEach((s, i) => {
      if (s.comment) {
        out.push({ id: p.id, title: p.title, n: i + 1, step: s.t, comment: s.comment, state: s.commentState ?? 'new',
          at: s.commentAt ?? '', to: s.commentTo ?? '', reply: s.commentReply ?? '', sessions: p.sessions });
      }
    });
  }
  return pending ? out.filter((c) => c.state === 'new') : out;
}

/** Поставить комментарию состояние: sent (+to) или done (+reply); n — номер шага или 'note'. */
export function markComment(p, n, state, { to, reply } = {}) {
  if (!['new', 'sent', 'done'].includes(state)) throw new Error('состояние: new, sent, done');
  if (n === 'note') {
    if (!p.note) throw new Error(`у «${p.title}» нет заметки`);
    return { ...p, noteState: state, ...(to ? { noteTo: to } : {}), ...(reply ? { noteReply: reply } : {}) };
  }
  const i = stepIndex(p, String(n));
  if (!p.next[i].comment) throw new Error(`у шага ${i + 1} нет комментария`);
  return {
    ...p,
    next: p.next.map((s, j) =>
      j === i ? { ...s, commentState: state, ...(to ? { commentTo: to } : {}), ...(reply ? { commentReply: reply } : {}) } : s,
    ),
  };
}

/** Комментарий хозяина из командной строки (тот же, что кнопка 💬 в приложении). */
export function setComment(p, n, text) {
  const comment = String(text ?? '').trim();
  if (n === 'note') return { ...p, note: comment, noteAt: comment ? Date.now() : null, noteState: 'new', noteTo: '', noteReply: '' };
  const i = stepIndex(p, String(n));
  return {
    ...p,
    next: p.next.map((s, j) => {
      if (j !== i) return s;
      const { commentTo: _t, commentReply: _r, ...rest } = s;
      return comment ? { ...rest, comment, commentAt: new Date().toISOString(), commentState: 'new' } : (({ comment: _c, commentAt: _a, commentState: _s, ...r }) => r)(rest);
    }),
  };
}

/** Снять отметку с шага (нажал по ошибке): шаг снова открыт. */
export function reopenStep(p, query) {
  const i = stepIndex(p, query);
  const next = p.next.map((s, j) => {
    if (j !== i) return s;
    const { doneAt: _d, ...rest } = s;
    return { ...rest, done: false };
  });
  return { ...p, next };
}

/** Отмеченные галочкой шаги (хозяин в приложении) → в done, из next убрать. */
export function tidy(p) {
  const ticked = p.next.filter((s) => s.done);
  if (!ticked.length) return null;
  const done = [...ticked.map((s) => ({ t: s.t, d: s.doneAt ?? todayKey() })), ...p.done];
  return { ...p, next: p.next.filter((s) => !s.done), done: done.slice(0, ДОНЕ_ДЕРЖАТЬ) };
}

export function addSession(p, id, title) {
  if (!id) throw new Error('нужен id сессии (local_…)');
  const rest = p.sessions.filter((s) => s.id !== id);
  return { ...p, sessions: [{ id, t: title || '' }, ...rest] };
}

/** Папка из поля path, если это путь: «~/x/y (пояснение)» → абсолютный путь. */
export function projectDir(p) {
  const raw = String(p.path ?? '').split(' (')[0].trim();
  if (!raw.startsWith('~/') && !raw.startsWith('/')) return null;
  return resolve(raw.replace(/^~(?=\/)/, homedir()));
}

/** Какой проект мой: по id сессии, затем по папке (длинный путь — точнее). */
export function findByPlace(projects, dir, sessionId) {
  const out = [];
  const where = dir ? resolve(String(dir).replace(/^~(?=\/)/, homedir())) : null;
  for (const p of projects) {
    if (sessionId && p.sessions.some((s) => s.id === sessionId)) out.push({ p, score: 1e6, why: 'по сессии' });
    const d = projectDir(p);
    if (where && d && (where === d || where.startsWith(d + '/'))) out.push({ p, score: d.length, why: 'по папке' });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Шаги, которые ждут хозяина, по всем проектам: фокус вперёд. */
export function mine(projects) {
  const out = [];
  for (const p of projects) {
    p.next.forEach((s, i) => {
      if (s.who === 'me' && !s.done) out.push({ project: p, step: s, n: i + 1 });
    });
  }
  return out.sort((a, b) => Number(b.project.focus) - Number(a.project.focus));
}

export function sortProjects(list) {
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

// ---------- Firestore ----------

export async function allProjects(db, uid) {
  const snap = await db.collection(`users/${uid}/projects`).get();
  return snap.docs.map((d) => normalizeProject(d.data(), d.id)).filter((p) => !p.deleted);
}

/** Записать проект целиком; `by` — кто правил («сессия «…»», «Пульт»). */
export async function saveProject(db, uid, p, by) {
  const doc = normalizeProject({ ...p, updatedAt: Date.now(), updatedBy: by ?? p.updatedBy ?? '' });
  await db.doc(`users/${uid}/projects/${doc.id}`).set(doc);
  return doc;
}

// ---------- Вывод ----------

export function fmtProject(p, full = false) {
  const pr = p.priority ? `, ${PRIORITIES[p.priority]}` : '';
  const head = `${p.id} — ${p.title} [${STAGES[p.stage] ?? p.stage}${pr}${p.focus ? ', в фокусе' : ''}] ${p.lastActivity}`;
  if (!full) return head;
  const lines = [head];
  if (p.what) lines.push(`  что: ${p.what}`);
  if (p.goal) lines.push(`  цель: ${p.goal}`);
  if (p.now) lines.push(`  сейчас: ${p.now}`);
  if (p.waiting) lines.push(`  ждём: ${p.waiting}`);
  p.next.forEach((s, i) => lines.push(`  ${i + 1}. ${s.done ? '[x]' : '[ ]'} ${s.t} (${WHO[s.who] ?? s.who})`));
  for (const d of p.done) lines.push(`  ✓ ${d.d} ${d.t}`);
  for (const s of p.sessions) lines.push(`  сессия: ${s.t} ${s.id}`);
  for (const l of p.links) lines.push(`  ссылка: ${l.t} ${l.u}`);
  if (p.path) lines.push(`  где: ${p.path}`);
  if (p.note) lines.push(`  ✉ заметка хозяина: ${p.note}`);
  lines.push(`  правил: ${p.updatedBy || '—'} ${new Date(p.updatedAt).toLocaleString('ru-RU')}`);
  return lines.join('\n');
}

export const PROJECT_HELP = `
  project list [--sphere uchet|masail|apps|tools|family] [--mine] [--notes]
                       --mine — шаги, которые ждут хозяина; --notes — заметки хозяина
  project show <id>
  project find [папка] [--session local_…]   какой проект мой (сессии проектов)
  project add <id> --title "…" --sphere tools [--stage active] [--what …] [--path ~/…]
  project set <id> [--now "где остановились"] [--stage active|polish|idea|live|paused|closed]
                   [--goal "цель"] [--priority 1|2|3|none] (главное / важное / фоновое)
                   [--focus да|нет] [--what …] [--waiting …] [--path …] [--title …]
                   [--sphere …] [--last ГГГГ-ММ-ДД] [--note none]   --now ставит дату активности
  project step <id> "шаг" [--who me|claude|other]
  project done <id> "сделанное или номер шага" [--date ГГГГ-ММ-ДД]
  project step-rm <id> <номер или текст>
  project session <id> <local_…> "название сессии"
  project link <id> "название" <url>
  project comments [--pending]  комментарии хозяина (💬 к шагу или ко всему проекту)
  project comment <id> <n|note> "текст"        записать комментарий (пусто — снять)
  project comment-sent <id> <n|note> --to "сессия «…»"   «Пульт» передал сессии
  project comment-done <id> <n|note> --reply "что сделано"  сессия сделала
  project reopen <id> <n>      снять отметку с шага (нажал по ошибке)
  project tidy [<id>]          отмеченные хозяином шаги → в «сделано»
  project import файл.json     {id: проект, …} — перенос пачкой (заменяет целиком)
  project rm <id>
  Общие флаги: --by "сессия «…»" (кто правил), --json.`;
