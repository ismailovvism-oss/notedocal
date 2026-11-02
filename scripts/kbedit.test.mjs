// Тесты правок редактора: метки на словах и абзацах, ссылки, поиск выделенного на экране.
// npm test (Node 26 запускает .ts напрямую).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addAnchor,
  anchorsAt,
  blockAt,
  dropEmptyAnchors,
  locateSelection,
  plainOf,
  removeAnchor,
  replaceWithLink,
  splitRuns,
} from '../src/lib/kb/edit.ts';
import { findAnchors } from '../src/lib/kb/syntax.ts';

const fixed = () => 0.5;
const at = (src, words) => {
  const i = src.indexOf(words);
  assert.ok(i >= 0, `нет «${words}»`);
  return { from: i, to: i + words.length };
};

test('видимый текст без разметки', () => {
  const src = '## Заголовок\n- **жирные** слова и [[Довод|подпись]] и [[Тезис#Раздел]]\n> цитата ^ab12\n%%скрыто%% ![[Встройка]] `код`';
  const p = plainOf(src);
  assert.equal(p.text, 'Заголовок\nжирные слова и подпись и Тезис\nцитата\n  `код`');
  assert.equal(src[p.map[p.text.indexOf('подпись')]], 'п');
});

test('метка на словах внутри абзаца', () => {
  const src = 'Первый довод сильный, второй слабый.';
  const r = addAnchor(src, [at(src, 'довод сильный')], { random: fixed });
  assert.equal(r.text, `Первый <span data-a="${r.name}">довод сильный</span>, второй слабый.`);
  assert.ok(!r.block);
  // те же слова ещё раз — та же метка, текст не меняется
  const again = addAnchor(r.text, [at(r.text, 'довод сильный')]);
  assert.equal(again.name, r.name);
  assert.ok(again.existed);
  assert.equal(again.text, r.text);
});

test('целый абзац — метка абзаца как в Obsidian', () => {
  const src = 'Один абзац.\n\nВторой абзац\nв две строки.\n\nТретий.';
  const r = addAnchor(src, [at(src, 'Второй абзац\nв две строки.')], { random: fixed });
  assert.ok(r.block);
  assert.equal(r.text, `Один абзац.\n\nВторой абзац\nв две строки. ^${r.name}\n\nТретий.`);
  const again = addAnchor(r.text, [at(r.text, 'Второй абзац\nв две строки.')]);
  assert.equal(again.name, r.name);
});

test('пункт списка — тоже абзац', () => {
  const src = '- один\n- два\n- три';
  const r = addAnchor(src, [at(src, 'два')], { random: fixed });
  assert.equal(r.text, `- один\n- два ^${r.name}\n- три`);
});

test('выделение через жирный и перенос режется на куски одной метки', () => {
  const src = 'Начало **жирного куска** конец\nвторая строка';
  const sel = { from: src.indexOf('куска'), to: src.indexOf('вторая') + 'вторая'.length };
  const r = addAnchor(src, [sel], { random: fixed });
  const n = r.name;
  assert.equal(
    r.text,
    `Начало **жирного <span data-a="${n}">куска</span>** <span data-a="${n}">конец</span>\n<span data-a="${n}">вторая</span> строка`,
  );
  const pieces = findAnchors(r.text).get(n);
  assert.equal(pieces.length, 3);
});

test('пара значков целиком внутри — одна обёртка', () => {
  const src = 'Вот **это** важно здесь';
  const r = addAnchor(src, [at(src, '**это** важно')], { random: fixed });
  assert.equal(r.text, `Вот <span data-a="${r.name}">**это** важно</span> здесь`);
});

test('ссылка на краю выделения забирается целиком', () => {
  const src = 'Смотри [[Довод — размер|по линии]] размера тут';
  const sel = { from: src.indexOf('линии'), to: src.indexOf('размера') + 7 };
  const r = addAnchor(src, [sel], { random: fixed });
  assert.equal(r.text, `Смотри <span data-a="${r.name}">[[Довод — размер|по линии]] размера</span> тут`);
});

test('пересечение с другой меткой: теги не перекрещиваются', () => {
  const src = 'aa <span data-a="x1">bb cc</span> dd';
  const sel = { from: src.indexOf('cc'), to: src.indexOf('dd') + 2 };
  const r = addAnchor(src, [sel], { name: 'y2' });
  assert.equal(r.text, 'aa <span data-a="x1">bb <span data-a="y2">cc</span></span> <span data-a="y2">dd</span>');
  const a = findAnchors(r.text);
  assert.deepEqual(a.get('y2').map((p) => p.text), ['cc', 'dd']);
  assert.deepEqual(a.get('x1').map((p) => p.text), ['bb cc']);
});

test('разбросанные куски — одна метка', () => {
  const src = 'Первое место. Середина. Второе место.';
  const r = addAnchor(src, [at(src, 'Первое место'), at(src, 'Второе место')], { name: 'k3f9' });
  assert.equal(r.text, '<span data-a="k3f9">Первое место</span>. Середина. <span data-a="k3f9">Второе место</span>.');
});

test('в коде метки не ставятся', () => {
  const src = 'Текст\n```\nкод тут\n```';
  assert.throws(() => addAnchor(src, [at(src, 'код тут')]), /кода/);
});

test('снять метку и пустые обёртки', () => {
  const src = '<span data-a="k3f9">слова</span> и абзац ^k3f9\n\n<span data-a="zz22"><span data-a="k3f9">x</span></span>';
  assert.equal(removeAnchor(src, 'k3f9'), 'слова и абзац\n\n<span data-a="zz22">x</span>');
  assert.equal(dropEmptyAnchors('a <span data-a="k3f9"></span>b <span data-a="q2"> </span>'), 'a b  ');
});

test('метки под позицией', () => {
  const src = 'a <span data-a="x1">bb <span data-a="y2">cc</span></span> d';
  assert.deepEqual(anchorsAt(src, src.indexOf('cc') + 1).sort(), ['x1', 'y2']);
  assert.deepEqual(anchorsAt(src, src.indexOf(' d') + 1), []);
});

test('найти выделенное на экране, с повторами', () => {
  const src = '# Тема\n\nслово **и** слово, и ещё [[Цель|слово]]';
  // на экране: «Тема слово и слово, и ещё слово» — выделили третье «слово»
  const r = locateSelection(src, 'слово', 'Тема\nслово и слово, и ещё ');
  assert.equal(src.slice(r.from, r.to), 'слово');
  assert.ok(r.from > src.indexOf('[[Цель'));
  const r2 = locateSelection(src, 'слово и слово', 'Тема ');
  assert.equal(src.slice(r2.from, r2.to), 'слово **и** слово');
  assert.equal(locateSelection(src, 'нет такого'), null);
});

test('заменить слова ссылкой, метки сохраняются', () => {
  const src = 'Довод <span data-a="k3f9">по линии</span> размера';
  const r = replaceWithLink(src, at(src, '<span data-a="k3f9">по линии</span>'), { title: 'Тезис', anchor: 'p2a7' });
  assert.equal(r.text, 'Довод <span data-a="k3f9">[[Тезис#^p2a7|по линии]]</span> размера');
  const plain = replaceWithLink('Смотри Тезис тут', { from: 7, to: 12 }, { title: 'Тезис' });
  assert.equal(plain.text, 'Смотри [[Тезис]] тут');
  const half = 'aa <span data-a="x1">bb cc</span> dd';
  const r3 = replaceWithLink(half, { from: half.indexOf('cc'), to: half.indexOf('dd') + 2 }, { title: 'T' });
  assert.equal(r3.text, 'aa <span data-a="x1">bb </span>[[T|cc dd]]');
});

test('абзац под позицией', () => {
  const src = 'a\nb\n\n- c\n- d\n\ne';
  assert.deepEqual(blockAt(src, 1), { from: 0, to: 3 });
  assert.equal(src.slice(...Object.values(blockAt(src, src.indexOf('d')))), '- d');
  assert.deepEqual(splitRuns(src, { from: 0, to: 3 }), [{ from: 0, to: 1 }, { from: 2, to: 3 }]);
});

test('арабский: огласовка не отрывается от буквы', () => {
  const src = 'قَالَ رَسُولُ اللَّهِ';
  const i = src.indexOf('رَسُولُ');
  // выделение кончается между «ل» и её даммой
  const r = addAnchor(src, [{ from: i, to: i + 'رَسُولُ'.length - 1 }], { name: 'ar12' });
  assert.equal(r.text, 'قَالَ <span data-a="ar12">رَسُولُ</span> اللَّهِ');
  assert.equal(r.text.replace(/<[^>]+>/g, ''), src);
});
