// Тесты тегов и фасетов (docs/ЗАМЕТКИ.md, 3.3). npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../src/lib/kb/index.ts';
import { canonicalTag, checkNewTag, computeFacets, planTagRename, renameTagInText, searchTags, tagCards } from '../src/lib/kb/tags.ts';

const now = 1;
const note = (id, extra) => ({ id, title: id, body: '', date: null, createdAt: now, updatedAt: now, ...extra });
const notes = [
  note('a', { tags: ['тип/довод', 'тема/фикх/намаз'] }),
  note('b', { tags: ['тип/довод'], body: 'про #тема/фикх/закят' }),
  note('c', { tags: ['тип/насс', 'тема/таухид'] }),
  note('d', { body: '#идея и #семья/дети' }),
  note('тема/фикх/закят', { type: 'tag', props: { 'родители': ['тема/имущество'] }, aliases: ['زكاة'] }),
  note('тема/старое', { type: 'tag', props: { 'слит-в': 'тема/таухид' } }),
  note('e', { tags: ['тема/старое/x'] }),
];

const facetsOf = (sel) => {
  const index = buildIndex(notes);
  return computeFacets(index, tagCards(notes), sel);
};
const find = (vals, tag) => {
  for (const v of vals) {
    if (v.tag === tag) return v;
    const f = find(v.children, tag);
    if (f) return f;
  }
};

test('фасеты: корни волта первыми, свои — потом, без «/» — в «прочем»', () => {
  const { facets } = facetsOf(new Map());
  assert.deepEqual(facets.map((f) => f.facet), ['тип', 'тема', 'семья', '']);
  const тема = facets[1].values;
  assert.equal(find(тема, 'тема/фикх').count, 2);
  assert.equal(find(тема, 'тема/таухид').count, 2); // c и e (слито из «старое»)
  // второй родитель: закят стоит и под «имуществом»
  assert.equal(find(тема, 'тема/имущество').children[0].tag, 'тема/фикх/закят');
});

test('отбор: внутри фасета «или», между фасетами «и»', () => {
  const sel = new Map([['тип', new Set(['тип/довод'])]]);
  const r = facetsOf(sel);
  assert.deepEqual(r.matching.sort(), ['a', 'b']);
  // счётчики «темы» — с учётом выбранного типа
  assert.equal(find(r.facets[1].values, 'тема/таухид').count, 0);
  assert.equal(find(r.facets[1].values, 'тема/фикх').count, 2);
  // счётчики «типа» не сужаются своим же выбором
  assert.equal(find(r.facets[0].values, 'тип/насс').count, 1);
  const two = facetsOf(new Map([['тип', new Set(['тип/довод', 'тип/насс'])], ['тема', new Set(['тема/таухид'])]]));
  assert.deepEqual(two.matching, ['c']);
  const parent = facetsOf(new Map([['тема', new Set(['тема/имущество'])]]));
  assert.deepEqual(parent.matching, ['b']);
});

test('слит-в, поиск по синониму, опечатки', () => {
  const index = buildIndex(notes);
  const cards = tagCards(notes);
  assert.equal(canonicalTag(cards, 'тема/старое/x'), 'тема/таухид/x');
  assert.deepEqual(searchTags(index, cards, 'زكا'), ['тема/фикх/закят']);
  assert.deepEqual(checkNewTag(index, cards, 'тип/довод'), { exists: true, similar: [] });
  assert.ok(checkNewTag(index, cards, 'тип/довд').similar.includes('тип/довод'));
  assert.ok(checkNewTag(index, cards, 'закят').similar.includes('тема/фикх/закят'));
});

test('переименование тега в тексте: граница слова, код не трогается', () => {
  const t = 'Про #тема/фикх и #тема/фикх/намаз, но не #тема/фикхи. `#тема/фикх` и # Заголовок';
  assert.equal(renameTagInText(t, 'тема/фикх', 'тема/фиқх'), 'Про #тема/фиқх и #тема/фиқх/намаз, но не #тема/фикхи. `#тема/фикх` и # Заголовок');
});

test('переименовать и слить тег во всех заметках и карточках', () => {
  const p = planTagRename(notes, 'тема/фикх', 'тема/фикх-ибадат');
  const by = Object.fromEntries(p.map((x) => [x.id, x]));
  assert.deepEqual(by.a.tags, ['тип/довод', 'тема/фикх-ибадат/намаз']);
  assert.equal(by.b.body, 'про #тема/фикх-ибадат/закят');
  assert.equal(by['тема/фикх/закят'].title, 'тема/фикх-ибадат/закят');
  // слияние в тег, у которого есть карточка: старая карточка — «слит-в»
  const m = planTagRename(notes, 'тема/старое', 'тема/фикх/закят');
  const old = m.find((x) => x.id === 'тема/старое');
  assert.equal(old.props['слит-в'], 'тема/фикх/закят');
  assert.deepEqual(m.find((x) => x.id === 'e').tags, ['тема/фикх/закят/x']);
});
