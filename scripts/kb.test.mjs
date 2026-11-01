// Ядро базы знаний (src/lib/kb): разбор ссылок, меток, тегов; указатель; переименование;
// заметка ↔ .md. Node 26 запускает .ts сам — импортируем исходники приложения напрямую.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLinks, maskInert, newAnchorName, parseBody, plainText } from '../src/lib/kb/syntax.ts';
import {
  anchorCounts,
  backlinks,
  buildIndex,
  fragmentOf,
  notesWithTag,
  planRename,
  renameLinksInText,
  tagTree,
} from '../src/lib/kb/index.ts';
import { noteFromMarkdown, noteToMarkdown } from '../src/lib/kb/markdownFile.ts';

const note = (id, title, body = '', extra = {}) => ({ id, title, body, date: null, createdAt: 1, updatedAt: 1, ...extra });

test('ссылки: заметка, подпись, заголовок, метка, встраивание, своя заметка', () => {
  const links = findLinks('см. [[Тезис]] и [[Довод — X#^k3f9|по линии размера]], ![[Насс#Текст хадиса]], [[#^ab12]]');
  assert.deepEqual(
    links.map(({ embed, target, heading, anchor, alias }) => ({ embed, target, heading, anchor, alias })),
    [
      { embed: false, target: 'Тезис', heading: undefined, anchor: undefined, alias: undefined },
      { embed: false, target: 'Довод — X', heading: undefined, anchor: 'k3f9', alias: 'по линии размера' },
      { embed: true, target: 'Насс', heading: 'Текст хадиса', anchor: undefined, alias: undefined },
      { embed: false, target: '', heading: undefined, anchor: 'ab12', alias: undefined },
    ],
  );
});

test('ссылки в коде и скрытом тексте не считаются; \\| в таблице — подпись', () => {
  const text = '`[[Нет1]]`\n```\n[[Нет2]]\n```\n%%[[Нет3]]%%\n| [[Да\\|подпись]] |';
  const links = findLinks(text);
  assert.equal(links.length, 1);
  assert.equal(links[0].target, 'Да');
  assert.equal(links[0].alias, 'подпись');
  assert.equal(maskInert(text).length, text.length);
});

test('метки: абзац, пункт списка, слова, разбросанные куски, вложенность', () => {
  const body = [
    'Первая строка абзаца',
    'и вторая строка. ^par1',
    '',
    '- пункт один',
    '- пункт два ^li22',
    '',
    'Метод <span data-a="k3f9">по линии размера</span> даёт <span class="x">200 к <span data-a="k3f9">1</span></span>.',
    'Здесь <span data-a="out1">внешнее <span data-a="in22">внутреннее</span> слово</span>.',
  ].join('\n');
  const { anchors } = parseBody(body);
  assert.equal(anchors.get('par1')[0].text, 'Первая строка абзаца и вторая строка.');
  assert.equal(anchors.get('par1')[0].kind, 'block');
  assert.equal(anchors.get('li22')[0].text, 'пункт два');
  assert.deepEqual(anchors.get('k3f9').map((p) => p.text), ['по линии размера', '1']);
  assert.equal(anchors.get('out1')[0].text, 'внешнее внутреннее слово');
  assert.equal(anchors.get('in22')[0].text, 'внутреннее');
});

test('теги: из текста, с иерархией, не в заголовке, не в ссылке, не числа, не в коде', () => {
  const body = '# Заголовок\nтекст #тема/фикх/намаз и #статус/сырое.\n[[Заметка#Раздел]] #2026 `#код` (#идея)';
  assert.deepEqual(parseBody(body).tags, ['тема/фикх/намаз', 'статус/сырое', 'идея']);
});

test('новая метка не повторяет занятые и не путается на вид', () => {
  const name = newAnchorName(['abcd']);
  assert.match(name, /^[a-z2-9]{4}$/);
  assert.ok(!/[lo01]/.test(name));
});

test('чистый текст: без меток, ссылок и разметки', () => {
  assert.equal(
    plainText('**Жирный** <span data-a="x1">слово</span> [[Цель|подпись]] и [[Другая]] ^blk1'),
    'Жирный слово подпись и Другая',
  );
});

test('указатель: цели по названию и псевдониму, обратные ссылки, свойства-связи, комментарии', () => {
  const notes = [
    note('t1', 'Тезис — время', 'Тезис. <span data-a="w1">ключевые слова</span>', { aliases: ['к-0001'] }),
    note('d1', 'Довод — один', 'Доказывает [[тезис — время#^w1|это]] и [[Нет такой]].', {
      props: { доказывает: ['[[Тезис — время]]'], 'приложить-к': 'к-0001' },
    }),
    note('c1', 'Комментарий', 'Спорно.', { type: 'comment', props: { к: ['[[Тезис — время#^w1]]'] } }),
    note('p1', 'Пароль', '[[Тезис — время]]', { type: 'credential' }),
  ];
  const idx = buildIndex(notes);
  const out = idx.outgoing.get('d1');
  assert.equal(out[0].to, 't1');
  assert.equal(out[0].anchor, 'w1');
  assert.equal(out[1].to, null);
  assert.deepEqual(
    backlinks(idx, 't1').map((r) => `${r.from}:${r.kind}`).sort(),
    ['c1:comment', 'd1:mention', 'd1:доказывает', 'd1:приложить-к'],
  );
  assert.deepEqual(backlinks(idx, 't1', 'W1').map((r) => r.from).sort(), ['c1', 'd1']);
  assert.deepEqual(anchorCounts(idx, 't1').get('w1'), { links: 1, comments: 1 });
  assert.ok(!idx.outgoing.has('p1'), 'пароли в указатель не идут');
  assert.match(out[0].context, /Доказывает это и Нет такой/);
});

test('указатель: теги из свойства и текста, поиск с потомками, дерево', () => {
  const idx = buildIndex([
    note('a', 'А', 'про #тема/таухид/сыфаты/время', { tags: ['тип/довод'] }),
    note('b', 'Б', '', { tags: ['тема/таухид'] }),
  ]);
  assert.deepEqual(idx.noteTags.get('a'), ['тип/довод', 'тема/таухид/сыфаты/время']);
  assert.deepEqual([...notesWithTag(idx, 'тема/таухид')].sort(), ['a', 'b']);
  assert.deepEqual([...notesWithTag(idx, 'тема/таухид', false)], ['b']);
  assert.equal(tagTree(idx).get('тема/таухид/сыфаты').count, 1);
  assert.equal(tagTree(idx).get('тема').count, 2);
});

test('кусок для встраивания: по метке (все куски) и по заголовку (до следующего такого же)', () => {
  const body = '# Один\nтекст <span data-a="a1">раз</span>\n## Под\nещё <span data-a="a1">два</span>\n# Два\nдругое';
  const idx = buildIndex([note('n', 'Н', body)]);
  assert.equal(fragmentOf(idx, 'n', { anchor: 'a1' }), 'раз\n\n…\n\nдва');
  assert.equal(fragmentOf(idx, 'n', { heading: 'один' }), '# Один\nтекст <span data-a="a1">раз</span>\n## Под\nещё <span data-a="a1">два</span>');
});

test('переименование: ссылки переписаны с меткой и подписью, код не тронут, свойства тоже', () => {
  assert.equal(
    renameLinksInText('[[Старое#^k3f9|слова]] `[[Старое]]` ![[старое#Раздел]]', new Set(['старое']), 'Новое'),
    '[[Новое#^k3f9|слова]] `[[Старое]]` ![[Новое#Раздел]]',
  );
  const notes = [
    note('x', 'Старое', 'текст'),
    note('y', 'Источник', 'см. [[Старое]]', { props: { доказывает: ['[[Старое]]'], 'приложить-к': 'Старое' } }),
  ];
  const plan = planRename(buildIndex(notes), 'x', 'Старое', 'Новое');
  assert.deepEqual(plan, [
    { id: 'y', body: 'см. [[Новое]]', props: { доказывает: ['[[Новое]]'], 'приложить-к': 'Новое' } },
  ]);
});

test('переименование: если старое название было у двух заметок — не трогаем', () => {
  const notes = [note('x', 'Дубль'), note('z', 'Дубль'), note('y', 'И', '[[Дубль]]')];
  assert.deepEqual(planRename(buildIndex(notes), 'x', 'Дубль', 'Новое'), []);
});

test('заметка ↔ .md: кирпич волта туда и обратно без потерь', () => {
  const file = [
    '---',
    'id: к-30169',
    'aliases: [к-30169]',
    'чьё: автор',
    'позиция-на: 2026-05-13',
    'места:',
    '  - "[каадий #Ат-Тамими, 13.05.2026]"',
    'сверено:',
    '  дословность: да',
    'tags:',
    '  - тип/довод',
    '  - тема/таухид/сыфаты/телесность',
    '---',
    '',
    '# Довод — доведение метода до конца',
    '',
    'Текст ^p1',
  ].join('\n');
  const n = noteFromMarkdown(file, 'Довод — доведение метода до конца');
  assert.deepEqual(n.tags, ['тип/довод', 'тема/таухид/сыфаты/телесность']);
  assert.deepEqual(n.aliases, ['к-30169']);
  assert.equal(n.props['позиция-на'], '2026-05-13', 'дата остаётся строкой');
  assert.deepEqual(n.props.сверено, { дословность: 'да' });
  const full = { ...note('id1', n.title, n.body, { type: 'document', expires: '2027-01-01' }), ...n };
  const back = noteFromMarkdown(noteToMarkdown(full), n.title);
  delete full.date; // date: null — пустое, в файл не пишется; приложение читает его как null
  assert.deepEqual(back, full);
});

test('код и скрытое: непарная кавычка не глушит текст, ~~~ и многострочное %%', () => {
  const text = 'одна ` кавычка [[Да1]]\n\n~~~js\n[[Нет1]]\n~~~\n%%\n[[Нет2]]\n%%\n``x`y`` [[Да2]] <!-- [[Нет3]] -->\n```\n[[Нет4]] без конца';
  assert.deepEqual(findLinks(text).map((l) => l.target), ['Да1', 'Да2']);
  assert.equal(maskInert(text).length, text.length);
  assert.equal(maskInert(text).split('\n').length, text.split('\n').length);
});

test('показ: ссылки, пустые ссылки, теги, метки со счётчиками, скрытое, выделение, код не тронут', async () => {
  const { prepareMarkdown } = await import('../src/lib/kb/render.ts');
  const notes = [
    note('t', 'Тезис', 'Текст <span data-a="w1">слова</span> и <span data-a="w1">ещё</span>.\nАбзац ^p1'),
    note('d', 'Довод', '[[Тезис#^w1|это]] [[Тезис#^p1]]'),
    note('c', 'К', '', { type: 'comment', props: { к: '[[Тезис#^w1]]' } }),
  ];
  const index = buildIndex(notes);
  const md = prepareMarkdown(notes[0].body + '\n\n%%скрыто%% ==важно== #тема/а `[[Код]]` [[Нет]]', { index, noteId: 't' }, () => '').markdown;
  assert.match(md, /<span class="kb-a kb-commented" data-a="w1" id="kb-a-w1" data-n="1" data-c="1">слова<\/span>/);
  assert.match(md, /<span class="kb-a kb-commented" data-a="w1">ещё<\/span>/, 'счётчик только у первого куска, подсветка у всех');
  assert.match(md, /<span class="kb-blk" data-blk="p1" id="kb-a-p1" data-n="1"><\/span>/);
  assert.ok(!md.includes('скрыто'));
  assert.match(md, /<mark>важно<\/mark>/);
  assert.match(md, /<span class="kb-tag" data-tag="тема\/а">#тема\/а<\/span>/);
  assert.match(md, /`\[\[Код\]\]`/);
  assert.match(md, /<a class="kb-link kb-missing" href="#" data-target="Нет">Нет<\/a>/);
});

test('показ: встраивание куска по метке — заглушка и HTML с текстом куска', async () => {
  const { prepareMarkdown } = await import('../src/lib/kb/render.ts');
  const index = buildIndex([note('t', 'Тезис', 'А <span data-a="w1">кусок</span> Б'), note('s', 'Набор', '![[Тезис#^w1]]')]);
  const { markdown, embeds } = prepareMarkdown('![[Тезис#^w1]]', { index, noteId: 's' }, (inner) => `<p>${inner}</p>`);
  assert.equal(markdown, 'KBEMBED0X');
  assert.match(embeds.get('KBEMBED0X'), /↳ Тезис.*<p>кусок<\/p>/s);
});
