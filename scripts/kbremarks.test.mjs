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

// --- список, выноска, таблица, код: замечание — к своему месту, а не в конец всего блока ---
import { remarkInItem } from '../src/lib/kb/remarks.ts';

/** Нажать ✎ в месте `mark` и написать `text`. */
function penAt(doc, mark, text = 'замечание') {
  const r = remarkAt(doc, doc.indexOf(mark));
  assert.ok('change' in r, 'ожидалась вставка нового замечания');
  const out = apply(doc, r.change);
  return out.slice(0, r.cursor) + text + out.slice(r.cursor);
}

test('список: замечание — строкой под своим пунктом, с его отступом', () => {
  const doc = '- [x] пункт один\n- [ ] пункт два\n- [ ] пункт три\n\nАбзац после.';
  const out = penAt(doc, 'пункт два');
  assert.equal(out, '- [x] пункт один\n- [ ] пункт два\n  {>>замечание<<}\n- [ ] пункт три\n\nАбзац после.');
  const [r] = parseRemarks(out);
  assert.equal(r.anchor, 'пункт два');
  assert.equal(out.slice(r.anchorAt, r.anchorTo), '- [ ] пункт два');
  // у пункта уже есть замечание — править его; у соседнего — завести своё
  assert.equal(remarkAt(out, out.indexOf('пункт два')).existing.text, 'замечание');
  assert.ok('change' in remarkAt(out, out.indexOf('пункт три')));
  // нумерованный список: отступ — по ширине номера
  assert.equal(penAt('1. раз\n2. два\n10. десять', 'десять'), '1. раз\n2. два\n10. десять\n    {>>замечание<<}');
  assert.equal(penAt('1. раз\n2. два', 'раз'), '1. раз\n   {>>замечание<<}\n2. два');
});

test('список: вложенные пункты, продолжение пункта, пустые строки между пунктами', () => {
  const nested = '- внешний\n  - вложенный а\n  - вложенный б\n- второй';
  // к вложенному — под ним, глубже; к внешнему — под его словами, до вложенных
  const a = penAt(nested, 'вложенный а', 'к а');
  assert.equal(a, '- внешний\n  - вложенный а\n    {>>к а<<}\n  - вложенный б\n- второй');
  const both = penAt(a, 'внешний', 'к внешнему');
  assert.equal(both, '- внешний\n  {>>к внешнему<<}\n  - вложенный а\n    {>>к а<<}\n  - вложенный б\n- второй');
  assert.deepEqual(parseRemarks(both).map((r) => [r.text, r.anchor]), [['к внешнему', 'внешний'], ['к а', 'вложенный а']]);
  // отступ замечания решает, чьё оно: с отступом внешнего пункта — его, хоть и стоит под вложенным
  assert.equal(parseRemarks('- внешний\n  - вложенный\n  {>>чьё<<}')[0].anchor, 'внешний');
  // пункт в две строки: замечание — после обеих, якорь — весь пункт
  const wrapped = penAt('- начало пункта\n  и его продолжение\n- другой', 'начало');
  assert.equal(wrapped, '- начало пункта\n  и его продолжение\n  {>>замечание<<}\n- другой');
  assert.equal(parseRemarks(wrapped)[0].anchor, 'начало пункта и его продолжение');
  // список с пустыми строками: остаётся таким же, замечание прижато к пункту
  const loose = penAt('- раз\n\n- два\n\n- три', 'два');
  assert.equal(loose, '- раз\n\n- два\n  {>>замечание<<}\n\n- три');
  assert.equal(parseRemarks(loose)[0].anchor, 'два');
});

test('список: замечание ко всему списку (за ним, через пустую строку) — отдельно от замечаний пунктов', () => {
  const doc = '- раз\n  {>>к первому<<}\n- два\n\n{>>ко всему списку<<}\n\nАбзац.';
  const [one, all] = parseRemarks(doc);
  assert.equal(one.anchor, 'раз');
  assert.equal(all.anchor, 'раз два');
  assert.equal(doc.slice(all.anchorAt, all.anchorAt + 5), '- раз');
  // ✎ на последнем пункте — своё замечание пункту, а не правка замечания ко всему списку
  assert.equal(penAt(doc, 'два'), '- раз\n  {>>к первому<<}\n- два\n  {>>замечание<<}\n\n{>>ко всему списку<<}\n\nАбзац.');
  // два замечания у одного пункта: оба — его
  const two = '- раз\n  {>>первое<<}\n  {>>второе<<}\n- два';
  assert.deepEqual(parseRemarks(two).map((r) => r.anchor), ['раз', 'раз']);
});

test('список: ответ Claude, правка и снятие — отступ у каждой строки, соседний текст цел', () => {
  const doc = '- раз\n- два\n  {>>слабо<<}\n\nАбзац после списка.';
  const [r] = parseRemarks(doc);
  const replied = apply(doc, replyRemark(doc, r, '✓', 'Усилил'));
  assert.equal(replied, '- раз\n- два\n  {>>слабо\n  ✓ Усилил<<}\n\nАбзац после списка.');
  const [r2] = parseRemarks(replied);
  assert.deepEqual([r2.text, r2.status, r2.thread[0].text, r2.anchor], ['слабо', 'done', 'Усилил', 'два']);
  const again = apply(replied, replyRemark(replied, r2, '↩', 'не то'));
  assert.equal(again, '- раз\n- два\n  {>>слабо\n  ✓ Усилил\n  ↩ не то<<}\n\nАбзац после списка.');
  // сняли — список и абзац за ним не слились
  assert.equal(apply(again, removeRemark(again, parseRemarks(again)[0])), '- раз\n- два\n\nАбзац после списка.');
  assert.equal(apply(doc, editRemark(doc, r, 'сильнее')), '- раз\n- два\n  {>>сильнее<<}\n\nАбзац после списка.');
  // нажали ✎ и ничего не написали — в файл не идёт
  const empty = apply(doc, remarkAt(doc, 0).change);
  assert.equal(empty, '- раз\n  {>><<}\n- два\n  {>>слабо<<}\n\nАбзац после списка.');
  assert.equal(dropEmptyRemarks(empty), doc);
});

test('список: арабский пункт цел, замечание — отдельной строкой', () => {
  const ar = '- قَالَ رَسُولُ اللَّهِ ﷺ\n- إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ';
  const out = penAt(ar, 'قَالَ', 'проверить огласовку');
  assert.equal(out, '- قَالَ رَسُولُ اللَّهِ ﷺ\n  {>>проверить огласовку<<}\n- إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ');
  const back = apply(out, removeRemark(out, parseRemarks(out)[0]));
  assert.equal(back, ar);
});

test('просмотр: замечание к пункту (со словами) и перенос замечания к другому пункту', () => {
  const doc = '- раз\n- два довод\n\nАбзац.';
  const out = apply(doc, remarkInItem(doc, doc.indexOf('- два'), 'слабый', 'довод'));
  assert.equal(out, '- раз\n- два довод\n  {>>[к словам: довод] слабый<<}\n\nАбзац.');
  const [r] = parseRemarks(out);
  assert.deepEqual([r.phrase, r.text, r.anchor], ['довод', 'слабый', 'два довод']);
  // к другому пункту
  const moved = applyAll(out, moveRemark(out, r, 0, 5, true));
  assert.equal(moved, '- раз\n  {>>[к словам: довод] слабый<<}\n- два довод\n\nАбзац.');
  // от пункта — к абзацу, и обратно к пункту
  const [m] = parseRemarks(moved);
  const toPar = applyAll(moved, moveRemark(moved, m, moved.indexOf('Абзац.'), moved.length));
  assert.equal(toPar, '- раз\n- два довод\n\nАбзац.\n\n{>>[к словам: довод] слабый<<}');
  const [p] = parseRemarks(toPar);
  assert.equal(applyAll(toPar, moveRemark(toPar, p, toPar.indexOf('- два'), toPar.indexOf('\n\nАбзац'), true)), out);
  // к своему же пункту — ничего не меняется
  assert.deepEqual(moveRemark(out, r, out.indexOf('- два'), out.indexOf('\n\nАбзац'), true), []);
  // от последнего пункта — ко всему списку
  const toList = applyAll(out, moveRemark(out, r, 0, out.indexOf('\n\nАбзац')));
  assert.equal(toList, '- раз\n- два довод\n\n{>>[к словам: довод] слабый<<}\n\nАбзац.');
});

test('выноска: замечание — под своим абзацем внутри неё, со знаком цитаты', () => {
  const doc = '> [!quote] Ибн Таймия\n> Первый абзац цитаты.\n>\n> Второй абзац цитаты.\n\nТекст после.';
  const out = penAt(doc, 'Первый');
  assert.equal(out, '> [!quote] Ибн Таймия\n> Первый абзац цитаты.\n> {>>замечание<<}\n>\n> Второй абзац цитаты.\n\nТекст после.');
  const [r] = parseRemarks(out);
  assert.equal(r.anchor, 'Ибн Таймия Первый абзац цитаты.');
  assert.equal(remarkAt(out, out.indexOf('Первый')).existing.text, 'замечание');
  const second = penAt(out, 'Второй', 'ко второму');
  assert.equal(second, '> [!quote] Ибн Таймия\n> Первый абзац цитаты.\n> {>>замечание<<}\n>\n> Второй абзац цитаты.\n> {>>ко второму<<}\n\nТекст после.');
  assert.deepEqual(parseRemarks(second).map((x) => x.anchor), ['Ибн Таймия Первый абзац цитаты.', 'Второй абзац цитаты.']);
  // ответ — со знаком цитаты у каждой строки; снятие возвращает выноску как была
  const replied = apply(out, replyRemark(out, r, '❓', 'Какой перевод?'));
  assert.equal(replied, '> [!quote] Ибн Таймия\n> Первый абзац цитаты.\n> {>>замечание\n> ❓ Какой перевод?<<}\n>\n> Второй абзац цитаты.\n\nТекст после.');
  const [q] = parseRemarks(replied);
  assert.deepEqual([q.text, q.status, q.thread[0].text], ['замечание', 'ask', 'Какой перевод?']);
  assert.equal(apply(replied, removeRemark(replied, q)), doc);
  assert.equal(dropEmptyRemarks(apply(doc, remarkAt(doc, doc.indexOf('Второй')).change)), doc);
  // список внутри выноски — под пунктом, с отступом и знаком цитаты
  assert.equal(penAt('> - раз\n> - два', 'раз'), '> - раз\n>   {>>замечание<<}\n> - два');
});

test('таблица: строку в неё не вставить — замечание за таблицей, со словами ячейки под курсором', () => {
  const doc = '| Имя | Хукм |\n| --- | --- |\n| Зейд | **сахих** |\n| Амр | да‘иф |\n\nТекст после.';
  const r = remarkAt(doc, doc.indexOf('да‘иф') + 2);
  const out = apply(doc, r.change);
  assert.equal(out, '| Имя | Хукм |\n| --- | --- |\n| Зейд | **сахих** |\n| Амр | да‘иф |\n\n{>>[к словам: да‘иф] <<}\n\nТекст после.');
  assert.equal(out.slice(r.cursor, r.cursor + 3), '<<}');
  // начало строки (кружок ✎ у строки) — первая ячейка; разметка в ячейке — без значков
  assert.ok(apply(doc, remarkAt(doc, doc.indexOf('| Амр')).change).includes('{>>[к словам: Амр] <<}'));
  assert.ok(apply(doc, remarkAt(doc, doc.indexOf('сахих')).change).includes('{>>[к словам: сахих] <<}'));
  // разделитель — ко всей таблице; только фраза без слов автора в файл не идёт
  assert.ok(apply(doc, remarkAt(doc, doc.indexOf('| ---')).change).includes('|\n\n{>><<}\n\nТекст'));
  assert.equal(dropEmptyRemarks(out), doc);
  // два замечания к разным строкам — оба за таблицей, таблица цела
  const one = out.slice(0, r.cursor) + 'проверить' + out.slice(r.cursor);
  const two = penAt(one, 'Зейд', 'кто это');
  assert.ok(two.startsWith('| Имя | Хукм |\n| --- | --- |\n| Зейд | **сахих** |\n| Амр | да‘иф |\n\n{>>[к словам: Зейд] кто это<<}\n\n{>>[к словам: да‘иф] проверить<<}'));
  assert.deepEqual(parseRemarks(two).map((x) => [x.phrase, x.text]), [['Зейд', 'кто это'], ['да‘иф', 'проверить']]);
});

test('блок кода: замечание — за блоком, а не внутри кода', () => {
  const doc = 'Пример:\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nТекст после.';
  const out = penAt(doc, 'const a');
  assert.equal(out, 'Пример:\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n{>>замечание<<}\n\nТекст после.');
  assert.equal(parseRemarks(out).length, 1);
  assert.equal(remarkAt(out, out.indexOf('const b')).existing.text, 'замечание');
  // строки кода, похожие на список, списком не считаются
  assert.equal(penAt('```yaml\n- name: x\n- name: y\n```', 'name: x'), '```yaml\n- name: x\n- name: y\n```\n\n{>>замечание<<}');
});

test('абзац, за которым сразу другой блок: замечание — между ними, а не в конце следующего', () => {
  // вступление и список без пустой строки
  const out = penAt('Вот доводы:\n- первый\n- второй\n\nДальше.', 'Вот');
  assert.equal(out, 'Вот доводы:\n\n{>>замечание<<}\n\n- первый\n- второй\n\nДальше.');
  assert.equal(parseRemarks(out)[0].anchor, 'Вот доводы:');
  assert.equal(remarkAt(out, 1).existing.text, 'замечание');
  // заголовок, за которым сразу текст: к заголовку — под заголовком
  assert.equal(penAt('## Глава\nТекст главы.', 'Глава'), '## Глава\n\n{>>замечание<<}\n\nТекст главы.');
  // номер посреди абзаца («…в\n1986. году») — не список: замечание в конце абзаца
  assert.equal(penAt('Это было в\n1986. году, давно\nи неправда.', 'было'), 'Это было в\n1986. году, давно\nи неправда.\n\n{>>замечание<<}');
  // а список с номера 1 абзац прерывает
  assert.equal(penAt('Шаги:\n1. раз\n2. два', 'два'), 'Шаги:\n1. раз\n2. два\n   {>>замечание<<}');
  // два замечания подряд у одного абзаца: якорь у обоих — абзац
  assert.deepEqual(parseRemarks('Абзац.\n\n{>>первое<<}\n\n{>>второе<<}').map((r) => r.anchor), ['Абзац.', 'Абзац.']);
});
