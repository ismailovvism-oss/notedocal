// Тесты логики пульта проектов (scripts/projects.mjs) — без Firebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySet,
  addStep,
  findByPlace,
  findProject,
  markDone,
  normalizeProject,
  parsePriority,
  sortProjects,
  tidy,
} from './projects.mjs';

const proj = (over = {}) =>
  normalizeProject({
    id: 'voennaya',
    title: 'Военная обязанность (книга)',
    sphere: 'masail',
    stage: 'active',
    path: '~/projects/texts/масаиль/Военная обязанность',
    next: [
      { t: 'Прочитать и поправить гл. 2', who: 'me', done: false },
      { t: 'Внести три вставки', who: 'claude', done: false },
    ],
    done: [],
    lastActivity: '2026-10-18',
    ...over,
  });

test('normalizeProject заполняет все поля и переводит ISO-время в мс', () => {
  const p = normalizeProject({ title: 'X', updatedAt: '2026-10-26T03:00:00+00:00' }, 'x');
  assert.equal(p.id, 'x');
  assert.equal(p.updatedAt, Date.parse('2026-10-26T03:00:00+00:00'));
  assert.deepEqual([p.goal, p.priority, p.note, p.noteAt], ['', 0, '', null]);
});

test('markDone закрывает шаг по номеру или подстроке, иначе записывает новое', () => {
  const p = proj();
  const a = markDone(p, '2', '2026-10-26');
  assert.equal(a.next.length, 1);
  assert.deepEqual(a.done[0], { t: 'Внести три вставки', d: '2026-10-26' });
  assert.equal(a.lastActivity, '2026-10-26');
  const b = markDone(p, 'гл. 2', '2026-10-26');
  assert.equal(b.next[0].t, 'Внести три вставки');
  const c = markDone(p, 'Написана гл. 3', '2026-10-26');
  assert.equal(c.next.length, 2, 'новое сделанное шаги не трогает');
  assert.equal(c.done[0].t, 'Написана гл. 3');
  assert.throws(() => markDone(p, '7'), /нет шага №7/);
});

test('tidy переносит отмеченные хозяином шаги в done', () => {
  const p = proj({ next: [{ t: 'a', who: 'me', done: true, doneAt: '2026-10-25' }, { t: 'b', who: 'me', done: false }] });
  const t = tidy(p);
  assert.deepEqual(t.next.map((s) => s.t), ['b']);
  assert.deepEqual(t.done[0], { t: 'a', d: '2026-10-25' });
  assert.equal(tidy(proj()), null, 'нечего переносить — null');
});

test('applySet: --now ставит дату активности, приоритет и цель, пустая правка — ошибка', () => {
  const p = applySet(proj(), { now: 'гл. 3 начата', priority: 'главное', goal: 'книга к весне' });
  assert.equal(p.now, 'гл. 3 начата');
  assert.equal(p.priority, 1);
  assert.equal(p.goal, 'книга к весне');
  assert.notEqual(p.lastActivity, '2026-10-18');
  assert.equal(applySet(proj(), { note: 'none' }).note, '');
  assert.throws(() => applySet(proj(), {}), /нечего менять/);
  assert.equal(parsePriority('none'), 0);
  assert.throws(() => parsePriority('5'), /приоритет/);
});

test('findByPlace: по сессии надёжнее, по папке — самая длинная', () => {
  const a = proj({ sessions: [{ id: 'local_1', t: 's' }] });
  const b = normalizeProject({ id: 'masail', title: 'Масаиль', path: '~/projects/texts/масаиль' });
  const hits = findByPlace([b, a], '~/projects/texts/масаиль/Военная обязанность/книга', 'local_1');
  assert.equal(hits[0].p.id, 'voennaya');
  assert.equal(hits[0].why, 'по сессии');
  assert.deepEqual(findByPlace([b, a], '~/projects/texts/масаиль/мясо').map((h) => h.p.id), ['masail']);
});

test('findProject и порядок: фокус, приоритет, этап', () => {
  const list = [
    normalizeProject({ id: 'a', title: 'Альфа', stage: 'live' }),
    normalizeProject({ id: 'b', title: 'Бета', stage: 'active', priority: 2 }),
    normalizeProject({ id: 'c', title: 'Гамма', stage: 'paused', focus: true }),
  ];
  assert.deepEqual(sortProjects(list).map((p) => p.id), ['c', 'b', 'a']);
  assert.equal(findProject(list, 'бет').id, 'b');
  assert.throws(() => findProject(list, 'а'), /несколько/);
  assert.equal(addStep(list[0], 'шаг', 'claude').next[0].who, 'claude');
});
