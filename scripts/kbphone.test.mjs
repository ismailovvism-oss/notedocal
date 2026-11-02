// Тесты «📱 на телефон»: какие заметки хранилища в облаке и что с ними при сверке. npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedFiles, phoneMode, planPhoneSync } from '../src/lib/kb/phone.ts';

const v = (path, extra = {}, at = 10) => ({ id: 'v:' + path, title: path, body: '', date: null, createdAt: at, updatedAt: at, vault: { path }, ...extra });
const copy = (id, sync, at = 10, extra = {}) => ({ id, title: 'x', body: '', date: null, createdAt: 1, updatedAt: at, vaultSync: { vault: 'Заметки', path: 'a.md', at: 10, cloudAt: 10, mode: 'text', ...sync }, ...extra });
let n = 0;
const mk = () => `id${++n}`;

test('режим: своя отметка, ближайшая папка, «не надо» сильнее папки', () => {
  const folders = { Ислам: 'text', 'Ислам/Книги': 'files', Личное: 'off' };
  assert.equal(phoneMode(v('Ислам/Маджлис.md'), folders), 'text');
  assert.equal(phoneMode(v('Ислам/Книги/Тафсир.md'), folders), 'files');
  assert.equal(phoneMode(v('Ислам/Маджлис.md', { toPhone: 'off' }), folders), null);
  assert.equal(phoneMode(v('Личное/Дневник.md', { toPhone: 'text' }), folders), 'text');
  assert.equal(phoneMode(v('Корень.md'), folders), null);
  assert.equal(phoneMode(v('Корень.md'), { '': 'text' }), 'text'); // всё хранилище
});

test('без постоянного id — выдать; с id и без копии — отправить', () => {
  const p = planPhoneSync('Заметки', [v('a.md', { toPhone: 'text' }), v('b.md', { toPhone: 'files', cloud: 'B' }), v('c.md')], [], {}, mk);
  assert.deepEqual(p.assign.map((x) => x.id), ['v:a.md']);
  assert.deepEqual(p.push.map((x) => [x.cloud, x.mode]), [['B', 'files']]);
});

test('правили файл — в облако; правили на телефоне — в файл; обе — позднее', () => {
  const file = v('a.md', { toPhone: 'text', cloud: 'A' }, 20);
  assert.equal(planPhoneSync('Заметки', [file], [copy('A', {}, 10)], {}, mk).push.length, 1);
  const phone = v('a.md', { toPhone: 'text', cloud: 'A' }, 10);
  assert.equal(planPhoneSync('Заметки', [phone], [copy('A', {}, 30)], {}, mk).pull.length, 1);
  const both = planPhoneSync('Заметки', [v('a.md', { toPhone: 'text', cloud: 'A' }, 20)], [copy('A', {}, 30)], {}, mk);
  assert.equal(both.pull.length, 1);
  assert.equal(both.push.length, 0);
  const same = planPhoneSync('Заметки', [v('a.md', { toPhone: 'text', cloud: 'A' }, 10)], [copy('A', {}, 10)], {}, mk);
  assert.deepEqual([same.push.length, same.pull.length, same.drop.length], [0, 0, 0]);
});

test('сменили режим или переименовали файл — отправить заново; сняли отметку — убрать копию', () => {
  assert.equal(planPhoneSync('Заметки', [v('a.md', { toPhone: 'files', cloud: 'A' }, 10)], [copy('A', {}, 10)], {}, mk).push.length, 1);
  assert.equal(planPhoneSync('Заметки', [v('b.md', { toPhone: 'text', cloud: 'A' }, 10)], [copy('A', {}, 10)], {}, mk).push.length, 1);
  const off = planPhoneSync('Заметки', [v('a.md', { cloud: 'A' }, 10)], [copy('A', {}, 10)], {}, mk);
  assert.deepEqual(off.drop.map((c) => c.id), ['A']);
  // копии другого хранилища не трогаем
  assert.equal(planPhoneSync('Другое', [], [copy('A', {}, 10)], {}, mk).drop.length, 0);
});

test('встроенные файлы — не .md, без повторов, с подписью', () => {
  assert.deepEqual(embeddedFiles('![[Ибн Касир, т.1.pdf]] и ![[Заметка]] ![[x.md]] ![[фото.jpg|200]] ![[Ибн Касир, т.1.pdf]]'), ['Ибн Касир, т.1.pdf', 'фото.jpg']);
});

test('после записи правки с телефона — только запомнить новое время файла, не отправлять назад', () => {
  const p = planPhoneSync('Заметки', [v('a.md', { toPhone: 'text', cloud: 'A' }, 50)], [copy('A', { at: -1, cloudAt: 30 }, 30)], {}, mk);
  assert.deepEqual(p.baseline.map((b) => b.at), [50]);
  assert.deepEqual([p.push.length, p.pull.length], [0, 0]);
});

test('правка с телефона пришла, пока ждали записи прошлой, — тоже в файл, а не «сверено»', () => {
  const p = planPhoneSync('Заметки', [v('a.md', { toPhone: 'text', cloud: 'A' }, 50)], [copy('A', { at: -1, cloudAt: 30 }, 40)], {}, mk);
  assert.equal(p.pull.length, 1);
  assert.equal(p.baseline.length, 0);
});

test('один id у двух файлов — хозяин тот, с чьего пути копия; второму новый id, без метаний', () => {
  const a = v('a.md', { toPhone: 'text', cloud: 'A' }, 10);
  const b = v('Копия a.md', { toPhone: 'text', cloud: 'A' }, 10);
  const p = planPhoneSync('Заметки', [b, a], [copy('A', {}, 10)], {}, mk);
  assert.deepEqual(p.assign.map((x) => x.id), ['v:Копия a.md']);
  assert.deepEqual([p.push.length, p.pull.length, p.drop.length], [0, 0, 0]);
});

test('файл из другого хранилища со своим id — не перехватывает чужую копию', () => {
  const p = planPhoneSync('Второе', [v('a.md', { toPhone: 'text', cloud: 'A' }, 99)], [copy('A', {}, 10)], {}, mk);
  assert.deepEqual(p.assign.map((x) => x.id), ['v:a.md']);
  assert.equal(p.push.length, 0);
});

test('не влезет в облако — пропустить с причиной, копию не трогать', () => {
  const big = v('книга.md', { toPhone: 'text', cloud: 'K', body: 'ب'.repeat(500_000) }, 20);
  const nested = v('n.md', { toPhone: 'text', cloud: 'N', props: { x: [[1, 2]] } }, 20);
  const p = planPhoneSync('Заметки', [big, nested], [copy('K', {}, 10)], {}, mk);
  assert.equal(p.skip.length, 2);
  assert.deepEqual([p.push.length, p.drop.length], [0, 0]);
});
