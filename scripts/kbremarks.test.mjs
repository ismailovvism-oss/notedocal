// Тесты замечаний в файле ({>>…<<} к абзацу, блок %%замечания), как в md-редакторе. npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, editRemark, generalItems, parseRemarks, remarkAt, remarksText, removeRemark, writeGeneral } from '../src/lib/kb/remarks.ts';

const DOC = `# Заголовок

Первый абзац о доводе.
Вторая строка абзаца.

{>>Довод слабый, найди другой<<}

بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ

%%старое обсидиановское%%

Третий абзац.

%%замечания
1. Порядок разделов не тот.
2. Нет словарика.
%%
`;

test('разбор: общие первыми, нумерация сквозная, якорь — абзац выше', () => {
  const r = parseRemarks(DOC);
  assert.deepEqual(r.map((x) => [x.n, x.kind, x.text]), [
    [1, 'gen', 'Порядок разделов не тот.'],
    [2, 'gen', 'Нет словарика.'],
    [3, 'par', 'Довод слабый, найди другой'],
    [4, 'par', 'старое обсидиановское'],
  ]);
  assert.equal(r[2].anchor, 'Первый абзац о доводе. Вторая строка абзаца.');
  assert.equal(r[3].anchor, 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'); // арабский якорь цел, с огласовками
  assert.equal(DOC.slice(r[2].anchorAt, r[2].anchorAt + 6), 'Первый');
});

test('замечание к абзацу — после абзаца отдельной строкой, курсор внутри скобок', () => {
  const doc = 'Абзац один.\nещё строка\n\nАбзац два.';
  const res = remarkAt(doc, 3); // курсор в первой строке
  assert.ok('change' in res);
  const out = apply(doc, res.change);
  assert.equal(out, 'Абзац один.\nещё строка\n\n{>><<}\n\nАбзац два.');
  assert.equal(out.slice(res.cursor - 3, res.cursor + 3), '{>><<}');
});

test('арабская строка: скобки — не внутрь строки, а новой строкой после', () => {
  const doc = 'قال رسول الله ﷺ';
  const res = remarkAt(doc, 4);
  assert.ok('change' in res);
  assert.equal(apply(doc, res.change), 'قال رسول الله ﷺ\n\n{>><<}');
});

test('у абзаца уже есть замечание — править его, а не заводить второе', () => {
  const res = remarkAt(DOC, DOC.indexOf('Вторая'));
  assert.ok('existing' in res);
  assert.equal(res.existing.text, 'Довод слабый, найди другой');
});

test('общие: завести блок, добавить, удалить с перенумерацией, убрать пустой', () => {
  let doc = 'Текст.';
  doc = apply(doc, writeGeneral(doc, ['Первое']));
  assert.equal(doc, 'Текст.\n\n%%замечания\n1. Первое\n%%\n');
  doc = apply(doc, writeGeneral(doc, [...generalItems(doc), 'Второе', 'Третье']));
  assert.match(doc, /1\. Первое\n2\. Второе\n3\. Третье/);
  const two = parseRemarks(doc).find((r) => r.text === 'Второе');
  doc = apply(doc, removeRemark(doc, two));
  assert.match(doc, /1\. Первое\n2\. Третье\n%%/);
  doc = apply(doc, writeGeneral(doc, []));
  assert.equal(doc.trim(), 'Текст.');
});

test('убрать и поправить замечание к абзацу — без лишних пустых строк', () => {
  const r = parseRemarks(DOC).find((x) => x.text.startsWith('Довод'));
  const edited = apply(DOC, editRemark(DOC, r, 'Новый текст'));
  assert.match(edited, /\{>>Новый текст<<\}/);
  const removed = apply(DOC, removeRemark(DOC, r));
  assert.ok(!removed.includes('Довод слабый'));
  assert.ok(removed.includes('Вторая строка абзаца.\n\nبِسْمِ'));
});

test('в коде замечаний нет; список для Claude одним куском', () => {
  const doc = '```\n{>>не замечание<<}\n```\n\nАбзац.\n\n{>>да<<}';
  const r = parseRemarks(doc);
  assert.deepEqual(r.map((x) => x.text), ['да']);
  assert.equal(remarksText(r), '1. К «Абзац.»:\n   да');
});

test('замечание посреди строки — тоже в списке, якорь без разметки', () => {
  const doc = 'Фраза с {==выделением==} и {>>прямо в строке<<} посреди.';
  const r = parseRemarks(doc);
  assert.deepEqual(r.map((x) => [x.text, x.anchor]), [['прямо в строке', 'Фраза с выделением и посреди.']]);
  assert.equal(doc.slice(r[0].from, r[0].to), '{>>прямо в строке<<}');
});
