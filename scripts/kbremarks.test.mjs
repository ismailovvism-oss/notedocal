// Тесты замечаний в файле ({>>…<<} к абзацу, блок %%замечания), как в md-редакторе. npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, applyAll, buildInner, dropEmptyRemarks, editRemark, moveRemark, parseInner, replyRemark, toGeneral, generalItems, parseRemarks, remarkAt, remarksText, removeRemark, writeGeneral } from '../src/lib/kb/remarks.ts';

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

test('якорь — чистым текстом: без значков списка, тегов и ссылок', () => {
  const doc = '- [ ] первый <u>пункт</u>\n- второй [сайт](https://x.y) и [[Заметка|так]]\n\n{>>к списку<<}';
  assert.equal(parseRemarks(doc)[0].anchor, 'первый пункт второй сайт и так');
});

test('пустое замечание в файл не идёт, непустые и текст — целы', () => {

  assert.equal(dropEmptyRemarks('Абзац.\n\n{>><<}\n\nДальше.'), 'Абзац.\n\nДальше.');
  assert.equal(dropEmptyRemarks('Абзац.\n\n{>> <<}'), 'Абзац.');
  assert.equal(dropEmptyRemarks('Абзац.\n\n{>>есть<<}\n\nقال'), 'Абзац.\n\n{>>есть<<}\n\nقال');
});


// --- вычитка: ответы, состояния, фраза ---

test('нутро: фраза, слова автора, переписка; состояние — по последнему значку', () => {
  const x = parseInner('[к словам: довод слабый] Найди другой довод\nи покороче\n✓ Заменил на хадис Ибн Умара\n↩ не то: нужен аят\n❓ Какой аят — 2:255?');
  assert.equal(x.phrase, 'довод слабый');
  assert.equal(x.text, 'Найди другой довод\nи покороче');
  assert.deepEqual(x.thread.map((m) => [m.by, m.mark]), [['claude', '✓'], ['author', '↩'], ['claude', '❓']]);
  assert.equal(x.status, 'ask');
  assert.equal(parseInner('просто замечание').status, 'open');
  assert.equal(parseInner('✓ начинается со значка — всё равно слова автора').thread.length, 0);
  // туда и обратно без потерь
  assert.deepEqual(parseInner(buildInner(x)), x);
});

test('ответ Claude и приписка автора ложатся в то же замечание; арабский цел', () => {
  const doc = 'Абзац قَالَ رَسُولُ اللَّهِ.\n\n{>>Довод слабый<<}\n\nДальше.';
  let r = parseRemarks(doc)[0];
  let out = apply(doc, replyRemark(doc, r, '✓', 'Заменил на хадис'));
  assert.equal(out, 'Абзац قَالَ رَسُولُ اللَّهِ.\n\n{>>Довод слабый\n✓ Заменил на хадис<<}\n\nДальше.');
  r = parseRemarks(out)[0];
  assert.deepEqual([r.status, r.text, r.anchor], ['done', 'Довод слабый', 'Абзац قَالَ رَسُولُ اللَّهِ.']);
  out = apply(out, replyRemark(out, r, '↩', 'не то'));
  assert.equal(parseRemarks(out)[0].status, 'open');
  // правка слов автора не трогает переписку
  out = apply(out, editRemark(out, parseRemarks(out)[0], 'Довод совсем слабый'));
  assert.match(out, /\{>>Довод совсем слабый\n✓ Заменил на хадис\n↩ не то<<\}/);
});

test('общие: переписка — строками с отступом, старый вид (всё с номерами) читается', () => {
  let doc = 'Текст.\n\n%%замечания\n1. Порядок не тот\n2. Нет словарика\n%%\n';
  doc = apply(doc, replyRemark(doc, parseRemarks(doc)[0], '✗', 'Порядок оставил: так в источнике'));
  assert.ok(doc.includes('1. Порядок не тот\n   ✗ Порядок оставил: так в источнике\n2. Нет словарика\n%%'));
  const r = parseRemarks(doc);
  assert.deepEqual(r.map((x) => [x.kind, x.status, x.text]), [['gen', 'no', 'Порядок не тот'], ['gen', 'open', 'Нет словарика']]);
  // убрать первое — второе перенумеруется, его текст цел
  assert.ok(apply(doc, removeRemark(doc, r[0])).includes('%%замечания\n1. Нет словарика\n%%'));
});

test('абзац удалили — замечание уходит в общие с началом его текста', () => {
  const doc = 'Оставшийся.\n\n{>>К удалённому было\n✓ ответ<<}\n\nДальше.';
  const out = toGeneral(doc, parseRemarks(doc)[0], 'Тут был абзац про довод');
  assert.equal(out, 'Оставшийся.\n\nДальше.\n\n%%замечания\n1. [к удалённому: Тут был абзац про довод] К удалённому было\n   ✓ ответ\n%%\n');
  const r = parseRemarks(out)[0];
  assert.deepEqual([r.kind, r.gone, r.text, r.status], ['gen', 'Тут был абзац про довод', 'К удалённому было', 'done']);
});

test('перенести замечание к другому абзацу — и из общих тоже', () => {
  const doc = 'Первый.\n\n{>>[к словам: слово] замечание<<}\n\nВторой.\n\nТретий.';
  const at = doc.indexOf('Третий.');
  const out = applyAll(doc, moveRemark(doc, parseRemarks(doc)[0], at, at + 7));
  assert.equal(out, 'Первый.\n\nВторой.\n\nТретий.\n\n{>>[к словам: слово] замечание<<}');
  const g = 'Абзац.\n\n%%замечания\n1. [к удалённому: старое] вернуть сюда\n%%\n';
  const out2 = applyAll(g, moveRemark(g, parseRemarks(g)[0], 0, 6));
  assert.equal(out2.trim(), 'Абзац.\n\n{>>вернуть сюда<<}');
});

test('замечание посреди строки: ответ — той же строкой, удаление не трогает предложение', () => {
  const doc = 'Фраза с {>>замечанием<<} посреди.';
  const out = apply(doc, replyRemark(doc, parseRemarks(doc)[0], '✓', 'убрал'));
  assert.equal(out, 'Фраза с {>>замечанием ⏎ ✓ убрал<<} посреди.');
  const r = parseRemarks(out)[0];
  assert.deepEqual([r.status, r.text], ['done', 'замечанием']);
  assert.equal(apply(out, removeRemark(out, r)), 'Фраза с посреди.');
});
