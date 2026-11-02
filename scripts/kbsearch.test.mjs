// Тесты полнотекстового поиска с арабской нормализацией (docs/ЗАМЕТКИ.md, раздел 5). npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileQuery, matchRanges, normalize, parseQuery, searchNotes } from '../src/lib/kb/search.ts';

const note = (id, body, extra) => ({ id, title: id, body, date: null, createdAt: 1, updatedAt: 1, ...extra });
const ids = (r) => r.hits.map((h) => h.note.id);

test('простой вид: без огласовок, хамзы к одной, та марбута = ха, алиф максура = йа', () => {
  assert.equal(normalize('الصَّلَاةُ'), 'الصلاه');
  assert.equal(normalize('مسألة'), normalize('مسئلة'));
  assert.equal(normalize('على'), 'علي');
  assert.equal(normalize('ٱلْكِتَٰبُ'), 'الكتب');
  assert.equal(normalize('Ёлка'), 'елка');
  assert.equal(normalize('Ма́рьям'), 'марьям'); // ударение
});

test('запрос без огласовок находит огласованный текст, подсветка — по исходнику', () => {
  const text = 'قال: وَالصَّلَاةُ عِمَادُ الدِّين';
  const [r] = matchRanges(text, compileQuery('الصلاة'));
  assert.equal(text.slice(r[0], r[1]).replace(/[ً-ٟ]/g, ''), 'والصلاة'.slice(1));
  // и наоборот: огласованный запрос находит голый текст
  assert.equal(matchRanges('هذه الصلاة', compileQuery('الصَّلَاة')).length, 1);
});

test('хамза: любая подставка и голый алиф; голые буквы не путаются между собой', () => {
  const notes = [note('a', 'هذه مسألة'), note('b', 'هذه مسئلة'), note('c', 'هذه مسالة'), note('d', 'هذه مسولة')];
  // хамза находит любую хамзу и голый алиф, но не голый вав
  assert.deepEqual(ids(searchNotes(notes, 'مسئلة')).sort(), ['a', 'b', 'c']);
  // голый алиф находит алиф с хамзой, но не вав
  assert.deepEqual(ids(searchNotes(notes, 'مسالة')).sort(), ['a', 'c']);
  assert.deepEqual(ids(searchNotes([note('x', 'أسماء الله الحسنى')], 'اسماء الحسني')), ['x']);
});

test('все слова запроса должны найтись; фраза в кавычках — подряд', () => {
  const notes = [note('a', 'Ибн Таймийя писал о намазе'), note('b', 'писал Ибн Касир'), note('c', 'Таймийя — это ибн')];
  assert.deepEqual(ids(searchNotes(notes, 'ибн таймийя')).sort(), ['a', 'c']);
  assert.deepEqual(ids(searchNotes(notes, '"ибн таймийя"')), ['a']);
  assert.deepEqual(parseQuery('«Ибн  Касир» намаз'), ['ибн касир', 'намаз']);
});

test('название выше текста; пароли и удалённые не ищутся; короткий запрос — пусто', () => {
  const notes = [
    note('в тексте', 'про намаз и ещё раз намаз'),
    note('Намаз', 'коротко'),
    note('секрет', 'намаз', { type: 'credential' }),
    note('удалена', 'намаз', { deleted: true }),
  ];
  const r = searchNotes(notes, 'намаз');
  assert.deepEqual(ids(r), ['Намаз', 'в тексте']);
  assert.equal(r.total, 2);
  assert.equal(searchNotes(notes, 'н').total, 0);
});

test('псевдонимы ищутся как название; кусок текста без разметки и с подсветкой', () => {
  const r = searchNotes([note('k', 'Начало. ' + 'слово '.repeat(40) + 'про [[Закят|закят]] **важно**', { aliases: ['زكاة'] })], 'закят');
  assert.equal(r.hits[0].snippet.includes('[['), false);
  const [m] = r.hits[0].marks;
  assert.equal(r.hits[0].snippet.slice(m[0], m[1]).toLowerCase(), 'закят');
  assert.equal(searchNotes([note('k', '', { aliases: ['زكاة'] })], 'زكاه').total, 1);
});
