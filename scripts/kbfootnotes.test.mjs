// Тесты сносок: разбор, новая у курсора, правка, удаление. npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addFootnote, applyAll, editFootnote, parseFootnotes, removeFootnote } from '../src/lib/kb/footnotes.ts';

const DOC = `Утверждение со сноской[^1] и ещё одно[^имя].

Второй абзац, снова первая[^1].

[^1]: Первая сноска.
[^имя]: Вторая сноска,
    с продолжением قَالَ.
[^лишняя]: На неё не ссылаются.
`;

test('разбор: номера по порядку ссылок, продолжение, сноска без ссылок — в конце', () => {
  const f = parseFootnotes(DOC);
  assert.deepEqual(f.map((x) => [x.id, x.n, x.refs.length]), [['1', 1, 2], ['имя', 2, 1], ['лишняя', 0, 0]]);
  assert.equal(f[1].text, 'Вторая сноска,\nс продолжением قَالَ.');
  assert.equal(DOC.slice(f[0].defFrom, f[0].defTo), '[^1]: Первая сноска.');
});

test('ссылка без определения видна, код не считается', () => {
  const f = parseFootnotes('Текст[^9].\n\n```\n[^1]: не сноска\nи тут[^2]\n```');
  assert.deepEqual(f.map((x) => [x.id, x.defFrom]), [['9', undefined]]);
});

test('новая сноска: ссылка у курсора, определение — после прежних', () => {
  const pos = DOC.indexOf(' и ещё');
  const { changes, id } = addFootnote(DOC, pos);
  assert.equal(id, '2');
  const out = applyAll(DOC, changes);
  assert.ok(out.includes('со сноской[^1][^2] и ещё'));
  assert.ok(out.includes('[^лишняя]: На неё не ссылаются.\n[^2]: \n'));
});

test('первая сноска в тексте — определение через пустую строку; блок замечаний остаётся последним', () => {
  const doc = 'Абзац قال.\n\n%%замечания\n1. Общее\n%%\n';
  const { changes } = addFootnote(doc, 5);
  const out = applyAll(doc, changes);
  assert.equal(out, 'Абзац[^1] قال.\n\n[^1]: \n\n%%замечания\n1. Общее\n%%\n');
});

test('правка определения и определение для ссылки без него', () => {
  const f = parseFootnotes(DOC);
  const c = editFootnote(DOC, f[0], 'Новый текст\nвторая строка');
  const out = applyAll(DOC, [c]);
  assert.ok(out.includes('[^1]: Новый текст\n    вторая строка\n[^имя]'));
  const lone = 'Текст[^9].';
  const out2 = applyAll(lone, [editFootnote(lone, parseFootnotes(lone)[0], 'Нашлась')]);
  assert.equal(out2, 'Текст[^9].\n\n[^9]: Нашлась\n');
});

test('удаление: уходят определение и все ссылки, остальное цело', () => {
  const f = parseFootnotes(DOC);
  const out = applyAll(DOC, removeFootnote(DOC, f[0]));
  assert.ok(!out.includes('[^1]'));
  assert.ok(out.includes('со сноской и ещё одно[^имя].'));
  assert.ok(out.includes('снова первая.\n\n[^имя]: Вторая сноска,'));
  assert.deepEqual(parseFootnotes(out).map((x) => x.id), ['имя', 'лишняя']);
});
