// Тесты свойств, схем и видов (docs/ЗАМЕТКИ.md, 3.4). npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../src/lib/kb/index.ts';
import { checkProps, fieldsOf, fromInput, groupBy, parseCondition, parseView, runView, schemaCoverage, schemas, viewToProps } from '../src/lib/kb/schema.ts';

const note = (id, extra) => ({ id, title: id, body: '', date: null, createdAt: 1, updatedAt: 1, ...extra });
const схема = note('Схема — кирпич', {
  type: 'schema',
  props: {
    для: ['тип/довод', 'тип/насс'],
    поля: [
      { имя: 'чьё', вид: 'выбор', варианты: ['автор', 'учёный', 'оппонент'], обязательно: true },
      { имя: 'надёжность', вид: 'выбор', варианты: ['A', 'B', 'C'] },
      { имя: 'кто', вид: 'ссылка' },
      { имя: 'места', вид: 'список' },
    ],
  },
});
const notes = [
  схема,
  note('Ибн Таймия', { aliases: ['ИТ'] }),
  note('Довод 1', { tags: ['тип/довод'], props: { чьё: 'автор', надёжность: 'A' }, updatedAt: 3 }),
  note('Довод 2', { tags: ['тип/довод', 'тема/фикх'], props: { чьё: 'учёный', кто: '[[Ибн Таймия]]', надёжность: 'C' }, updatedAt: 2 }),
  note('Насс 1', { tags: ['тип/насс'], props: { надёжность: 'D' }, body: 'про закят' }),
];
const index = buildIndex(notes);

test('схема: поля по тегам, обязательные и неверные', () => {
  const all = schemas(notes);
  assert.deepEqual(fieldsOf(all, ['тип/довод/сильный']).map((f) => f.name), ['чьё', 'надёжность', 'кто', 'места']);
  assert.deepEqual(fieldsOf(all, ['тема/фикх']), []);
  const f = fieldsOf(all, ['тип/насс']);
  assert.deepEqual(checkProps({ надёжность: 'D' }, f), { missing: ['чьё'], wrong: ['надёжность'] });
  const cov = schemaCoverage(index, all[0]);
  assert.equal(cov.notes.length, 3);
  assert.deepEqual(cov.incomplete.map((x) => x.note.id), ['Насс 1']);
});

test('ввод в значение: ссылки, списки, числа, да-нет', () => {
  assert.deepEqual(fromInput({ name: 'x', kind: 'ссылки' }, 'Ибн Таймия, [[Довод 1#^ab12|тут, там]]'), ['[[Ибн Таймия]]', '[[Довод 1#^ab12|тут, там]]']);
  assert.deepEqual(fromInput({ name: 'x', kind: 'список' }, 'а\n\nб'), ['а', 'б']);
  assert.equal(fromInput({ name: 'x', kind: 'число' }, '3,5'), 3.5);
  assert.equal(fromInput({ name: 'x', kind: 'ссылка' }, 'Ибн Таймия'), '[[Ибн Таймия]]');
  assert.equal(fromInput({ name: 'x', kind: 'текст' }, '  '), undefined);
  assert.equal(fromInput({ name: 'x', kind: 'да-нет' }, true), true);
});

test('вид: теги, условия, текст, сортировка', () => {
  const v = parseView(note('Вид', { type: 'view', props: { теги: ['тип/довод'], условия: ['надёжность != C'], вид: 'таблица', столбцы: ['чьё'] } }));
  assert.deepEqual(runView(index, v).map((n) => n.id), ['Довод 1']);
  // ссылка сравнивается и по псевдониму цели
  const byAlias = { ...v, conditions: [parseCondition('кто = ИТ')] };
  assert.deepEqual(runView(index, byAlias).map((n) => n.id), ['Довод 2']);
  const all = { ...v, tags: [], conditions: [parseCondition('надёжность есть')], sort: 'надёжность' };
  assert.deepEqual(runView(index, all).map((n) => n.id), ['Довод 1', 'Довод 2', 'Насс 1']);
  const text = { ...all, text: 'закят' };
  assert.deepEqual(runView(index, text).map((n) => n.id), ['Насс 1']);
  assert.deepEqual(parseView(note('В', { type: 'view', props: viewToProps(v) })), v);
});

test('доска: столбцы по значению, пустые — в конце', () => {
  const g = groupBy(index, runView(index, parseView(note('В', { props: { теги: ['тип'] } }))), 'чьё', ['автор', 'учёный', 'оппонент']);
  assert.deepEqual(g.map((x) => [x.value, x.notes.map((n) => n.id)]), [
    ['автор', ['Довод 1']],
    ['учёный', ['Довод 2']],
    ['оппонент', []],
    ['', ['Насс 1']],
  ]);
});
