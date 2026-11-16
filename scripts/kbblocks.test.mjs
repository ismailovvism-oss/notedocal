// Тесты блоков: разрез текста, замечания при блоке, перестановка блока вместе с замечаниями. npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksOf, moveUnit, shiftUnit, unitRange } from '../src/lib/kb/blocks.ts';
import { applyAll, parseRemarks } from '../src/lib/kb/remarks.ts';

const DOC = `# Заголовок

Первый абзац.

{>>замечание к первому
✓ исправил<<}

قَالَ رَسُولُ اللَّهِ ﷺ

- пункт один
- пункт два

{>>к списку<<}

Последний абзац.

[^1]: сноска

%%замечания
1. Общее
%%
`;

test('разрез: замечания при своём блоке; сноски и общие — не блоки', () => {
  const b = blocksOf(DOC);
  assert.deepEqual(b.map((x) => [x.raw.trim().split('\n')[0], x.notes.length]), [
    ['# Заголовок', 0],
    ['Первый абзац.', 1],
    ['قَالَ رَسُولُ اللَّهِ ﷺ', 0],
    ['- пункт один', 1],
    ['Последний абзац.', 0],
  ]);
  const u = unitRange(b[1]);
  assert.equal(DOC.slice(u.from, u.to), 'Первый абзац.\n\n{>>замечание к первому\n✓ исправил<<}');
});

test('абзац вниз — его замечание едет с ним, арабский цел', () => {
  const b = blocksOf(DOC);
  const m = moveUnit(DOC, b, 1, 3); // «Первый абзац» — за арабскую строку
  const out = applyAll(DOC, m.changes);
  assert.ok(out.includes('# Заголовок\n\nقَالَ رَسُولُ اللَّهِ ﷺ\n\nПервый абзац.\n\n{>>замечание к первому\n✓ исправил<<}\n\n- пункт один'));
  assert.equal(out.slice(m.start, m.start + 13), 'Первый абзац.');
  // замечание по-прежнему к своему абзацу
  const r = parseRemarks(out).find((x) => x.text === 'замечание к первому');
  assert.equal(r.anchor, 'Первый абзац.');
  assert.equal(out.length, DOC.length);
});

test('в самый конец и в самое начало; хвост (сноски, общие) остаётся хвостом', () => {
  const b = blocksOf(DOC);
  const end = applyAll(DOC, moveUnit(DOC, b, 1, b.length).changes);
  assert.ok(end.includes('Последний абзац.\n\nПервый абзац.\n\n{>>замечание к первому\n✓ исправил<<}\n\n[^1]: сноска'));
  const top = applyAll(DOC, moveUnit(DOC, b, 4, 0).changes);
  assert.ok(top.startsWith('Последний абзац.\n\n# Заголовок\n\nПервый абзац.'));
  assert.ok(top.includes('{>>к списку<<}\n\n[^1]: сноска\n\n%%замечания'));
  assert.equal(moveUnit(DOC, b, 1, 1), null); // на своё же место — ничего
  assert.equal(moveUnit(DOC, b, 1, 2), null);
});

test('Alt+↑ / Alt+↓: блок под курсором, курсор остаётся в нём', () => {
  const pos = DOC.indexOf('пункт два');
  const down = shiftUnit(DOC, pos, 1);
  const out = applyAll(DOC, down.changes);
  assert.ok(out.includes('Последний абзац.\n\n- пункт один\n- пункт два\n\n{>>к списку<<}\n\n[^1]'));
  assert.equal(out.slice(down.cursor, down.cursor + 9), 'пункт два');
  const up = shiftUnit(DOC, pos, -1);
  assert.ok(applyAll(DOC, up.changes).includes('Первый абзац.\n\n{>>замечание к первому\n✓ исправил<<}\n\n- пункт один\n- пункт два\n\n{>>к списку<<}\n\nقَالَ'));
  assert.equal(shiftUnit(DOC, 2, -1), null); // первому некуда вверх
});

test('последний блок в тексте без хвоста — вверх, без лишних пустых строк', () => {
  const doc = 'Раз.\n\nДва.\n\nТри.';
  const out = applyAll(doc, shiftUnit(doc, doc.indexOf('Три'), -1).changes);
  assert.equal(out, 'Раз.\n\nТри.\n\nДва.');
  const doc2 = 'Раз.\n\nДва.\n';
  assert.equal(applyAll(doc2, shiftUnit(doc2, 8, -1).changes), 'Два.\n\nРаз.\n');
});

// --- кто что изменил ---
import { claudeChanges, diffBlocks } from '../src/lib/kb/blocks.ts';

test('сравнение версий: переписан, добавлен, убран, переставлен; ответы в замечаниях — не правка', () => {
  const was = 'Первый абзац про довод и его силу.\n\n{>>слабый довод<<}\n\nВторой остаётся.\n\nТретий уйдёт совсем.\n\nЧетвёртый переедет.\n\nПятый на месте.';
  const now = 'Четвёртый переедет.\n\nПервый абзац про довод и его настоящую силу.\n\n{>>слабый довод\n✓ усилил<<}\n\nВторой остаётся.\n\nСовсем новый абзац о другом.\n\nПятый на месте.';
  const d = diffBlocks(was, now);
  assert.deepEqual(d.now.map((x) => x.kind), ['moved', 'changed', 'same', 'added', 'same']);
  assert.equal(d.now[1].was, 'Первый абзац про довод и его силу.');
  assert.deepEqual(d.removed.map((x) => x.raw), ['Третий уйдёт совсем.']);
  // ничего не меняли — всё «same»
  assert.ok(diffBlocks(was, was).now.every((x) => x.kind === 'same'));
});

test('сравнение: арабский абзац с правкой огласовки — «переписан», а не «новый»', () => {
  const d = diffBlocks('قَالَ رَسُولُ اللَّهِ صلى الله عليه وسلم', 'قَالَ رَسُولُ اللهِ صلى الله عليه وسلم');
  assert.deepEqual(d.now.map((x) => x.kind), ['changed']);
});

test('правки Claude: что он переписал, добавил, убрал; поправленное автором после — уже не его', () => {
  const before = 'Абзац про довод и его силу.\n\nВторой.\n\nЛишний абзац.\n\nЧетвёртый.';
  const after = 'Абзац про хадис и его силу.\n\nВторой.\n\nЧетвёртый.\n\nДобавленный Claude вывод.';
  let c = claudeChanges(before, after, after);
  assert.deepEqual(c.now.map((x) => x.kind), ['changed', 'same', 'same', 'added']);
  assert.equal(c.now[0].was, 'Абзац про довод и его силу.');
  assert.deepEqual(c.removed.map((x) => x.raw), ['Лишний абзац.']);
  // автор потом сам переписал первый абзац и вернул лишний — это уже не правки Claude
  const mine = 'Абзац про хадис и его силу, дополненный мной.\n\nВторой.\n\nЛишний абзац.\n\nЧетвёртый.\n\nДобавленный Claude вывод.';
  c = claudeChanges(before, after, mine);
  assert.deepEqual(c.now.map((x) => x.kind), ['same', 'same', 'same', 'same', 'added']);
  assert.equal(c.removed.length, 0);
});

test('«как было» отдаётся с разметкой и строками, как в файле', () => {
  const d = diffBlocks('- пункт один\n- пункт два про довод', '- пункт один\n- пункт два про хадис');
  assert.equal(d.now[0].was, '- пункт один\n- пункт два про довод');
});

// --- замечания внутри блока: под пунктом списка, под абзацем выноски ---
import { bare } from '../src/lib/kb/blocks.ts';

const LIST = `Вступление.

- [x] пункт один
  {>>к первому
  ✓ исправил<<}
- [ ] пункт два
- [ ] пункт три
  - вложенный
    {>>к вложенному<<}

{>>ко всему списку<<}

> [!quote] Выноска
> Первый абзац.
> {>>к абзацу выноски<<}
>
> Второй абзац.

Конец.
`;

test('список: пункты со своими замечаниями; замечание ко всему списку — у блока', () => {
  const b = blocksOf(LIST);
  const list = b[1];
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.items.map((i) => i.notes.map((r) => r.text)), [['к первому'], [], ['к вложенному']]);
  assert.deepEqual(list.notes.map((r) => r.text), ['ко всему списку']);
  assert.deepEqual(list.inner.map((r) => r.text), ['к первому', 'к вложенному']);
  // пункт без строк замечаний — как его показывать
  assert.equal(bare(list.items[0], list.items[0].notes), '- [x] пункт один\n');
  assert.equal(bare(list.items[2], list.items[2].notes), '- [ ] пункт три\n  - вложенный');
  assert.equal(LIST.slice(list.items[1].from, list.items[1].to), '- [ ] пункт два\n');
  // выноска: замечание внутри — при блоке, из текста для показа убрано
  const quote = b[2];
  assert.deepEqual(quote.inner.map((r) => [r.text, r.anchor]), [['к абзацу выноски', 'Выноска Первый абзац.']]);
  assert.equal(bare(quote, quote.inner), '> [!quote] Выноска\n> Первый абзац.\n>\n> Второй абзац.');
  assert.equal(quote.items, undefined);
});

test('список переезжает вместе с замечаниями пунктов и своим', () => {
  const b = blocksOf(LIST);
  const out = applyAll(LIST, moveUnit(LIST, b, 1, 0).changes);
  assert.ok(out.startsWith('- [x] пункт один\n  {>>к первому\n  ✓ исправил<<}\n- [ ] пункт два'));
  assert.ok(out.includes('    {>>к вложенному<<}\n\n{>>ко всему списку<<}\n\nВступление.\n\n> [!quote]'));
  assert.equal(out.length, LIST.length);
  assert.deepEqual(parseRemarks(out).map((r) => r.anchor), ['пункт один', 'вложенный', 'пункт один пункт два пункт три вложенный', 'Выноска Первый абзац.']);
});

test('сравнение версий: ответ Claude в замечании под пунктом — не правка списка', () => {
  const was = '- пункт один про довод\n  {>>слабо<<}\n- пункт два\n\nАбзац.';
  const replied = '- пункт один про довод\n  {>>слабо\n  ✓ усилил<<}\n- пункт два\n\nАбзац.';
  assert.ok(diffBlocks(was, replied).now.every((x) => x.kind === 'same'));
  const fixed = '- пункт один про хадис\n  {>>слабо\n  ✓ усилил<<}\n- пункт два\n\nАбзац.';
  const d = diffBlocks(was, fixed);
  assert.deepEqual(d.now.map((x) => x.kind), ['changed', 'same']);
  // «как было» — без строк замечаний
  assert.equal(d.now[0].was, '- пункт один про довод\n- пункт два');
});
