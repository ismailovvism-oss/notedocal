// Тесты «что видно в базе знаний» (docs/ЗАМЕТКИ.md, раздел 10). npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_FOLDERS, folderTitles, scopeOf, shownIds } from '../src/lib/kb/scope.ts';
import { buildIndex } from '../src/lib/kb/index.ts';
import { computeFacets, tagCards } from '../src/lib/kb/tags.ts';

const note = (id, extra) => ({ id, title: id, body: '', date: null, createdAt: 1, updatedAt: 1, ...extra });
const child = (from, to) => ({ id: `${from}>${to}`, from, to, type: 'child', createdAt: 1, updatedAt: 1 });

const notes = [
  note('Здоровье', { type: 'folder' }),
  note('Глюкоза', { health: { kind: 'glucose' } }),
  note('Памятка', {}),
  note('Семья', { type: 'folder' }),
  note('Дети', { type: 'folder' }),
  note('Расписание', {}),
  note('Паспорт', { type: 'document' }),
  note('Ислам', { type: 'folder' }),
  note('Маджлис', { tags: ['тема/фикх'] }),
  note('Идея', { tags: ['тема/фикх'] }),
  note('Свободная', {}),
];
const relations = [child('Здоровье', 'Глюкоза'), child('Здоровье', 'Памятка'), child('Семья', 'Дети'), child('Дети', 'Расписание'), child('Ислам', 'Маджлис')];

test('по умолчанию прячутся роли хозяйства, замеры здоровья и папки хозяйства (на любой глубине)', () => {
  const shown = [...shownIds(notes, relations, SERVICE_FOLDERS)].sort();
  assert.deepEqual(shown, ['Идея', 'Маджлис', 'Свободная']);
});

test('почему спрятана — видно', () => {
  const folders = folderTitles(relations, new Map(notes.map((n) => [n.id, n])));
  const why = (id) => scopeOf(notes.find((n) => n.id === id), folders.get(id), SERVICE_FOLDERS).why;
  assert.equal(why('Паспорт'), 'роль');
  assert.equal(why('Глюкоза'), 'здоровье');
  assert.equal(why('Памятка'), 'папка «Здоровье»');
  assert.equal(why('Расписание'), 'папка «Семья»');
  assert.equal(why('Маджлис'), '');
});

test('отметка на заметке сильнее правил — в обе стороны', () => {
  const marked = notes.map((n) =>
    n.id === 'Памятка' ? { ...n, inBase: true } : n.id === 'Свободная' ? { ...n, inBase: false } : n,
  );
  const shown = shownIds(marked, relations, SERVICE_FOLDERS);
  assert.ok(shown.has('Памятка'));
  assert.ok(!shown.has('Свободная'));
});

test('список папок хозяйства меняется; регистр не важен', () => {
  const shown = shownIds(notes, relations, ['здоровье']);
  assert.ok(shown.has('Расписание'));
  assert.ok(!shown.has('Памятка'));
});

test('фасеты считают только видимое', () => {
  const marked = notes.map((n) => (n.id === 'Паспорт' ? { ...n, tags: ['тема/документы'] } : n));
  const index = buildIndex(marked);
  const only = shownIds(marked, relations, SERVICE_FOLDERS);
  const f = computeFacets(index, tagCards(marked), new Map(), only);
  const tags = f.facets.flatMap((x) => x.values.map((v) => v.tag));
  assert.ok(!tags.includes('тема/документы'));
  assert.equal(f.facets.find((x) => x.facet === 'тема').values.find((v) => v.tag === 'тема/фикх').count, 2);
});
