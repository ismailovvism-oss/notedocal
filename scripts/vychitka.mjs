#!/usr/bin/env node
// Вычитка статьи в «Базе» — сторона Claude (вместо артефакта «Редактура»). Замечания автора
// лежат в самом файле статьи (`{>>…<<}` после абзаца, блок `%%замечания`), ответы пишутся туда же
// (src/lib/kb/remarks.ts). Запуск: `zametki вычитка …` (~/projects/apps/zametki/zametki).
//
//   zametki вычитка <файл.md>                 замечания, которые ждут Claude (открытые), с местом и перепиской
//   zametki вычитка все <файл.md>             все замечания с состоянием
//   zametki вычитка начать <файл.md>          взять статью в работу: снимок «до», полоска «Claude работает»
//                                             в окне, открытые замечания и что автор изменил сам с прошлого круга
//   zametki вычитка ответ <файл.md> <ключ> сделано|вопрос|не-принято "текст"
//   zametki вычитка готово <файл.md>          закончить круг: снимок «после», полоску убрать
//   zametki вычитка бросить <файл.md>         снять полоску без снимка (передумал править)
//
// Ключ замечания — как в списке (например k3f2a) или его номер. Снимки и замок —
// ~/.local/share/zametki/вычитка/<хеш пути>/ (до.md, после.md, lock, путь.txt): по ним окно красит
// абзацы, исправленные Claude, и показывает «как было».

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { apply, parseRemarks, replyRemark, STATUS_LABEL } from '../src/lib/kb/remarks.ts';
import { diffBlocks } from '../src/lib/kb/blocks.ts';

const HOME = process.env.ZAMETKI_REVIEW || join(homedir(), '.local/share/zametki/вычитка');

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const fileOf = (p) => {
  if (!p) fail('нужен путь к файлу .md');
  const full = resolve(p);
  if (!existsSync(full)) fail(`нет файла: ${full}`);
  return realpathSync(full);
};
/** Папка снимков статьи — по её полному пути (то же считает окно: baza.py). */
const dirOf = (file) => join(HOME, createHash('sha1').update(file).digest('hex').slice(0, 16));
const read = (f) => readFileSync(f, 'utf8');
/** Заголовок файла (frontmatter) — отдельно: места замечаний считаются по тексту без него, как в окне. */
function split(text) {
  const m = text.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return m ? [m[0], text.slice(m[0].length)] : ['', text];
}
/** Короткий ключ замечания: не зависит от номера (номера сдвигаются, когда автор добавляет свои). */
const keyOf = (r) => 'k' + createHash('sha1').update(`${r.kind}|${r.phrase ?? ''}|${r.text}`).digest('hex').slice(0, 4);
const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;
const short = (s, n = 160) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

function show(file, onlyOpen) {
  const [front, body] = split(read(file));
  const off = front.split('\n').length - 1;
  const all = parseRemarks(body);
  const list = onlyOpen ? all.filter((r) => r.status === 'open') : all;
  if (!list.length) {
    console.log(onlyOpen ? 'Открытых замечаний нет.' : 'Замечаний нет.');
  }
  for (const r of list) {
    const where =
      r.kind === 'gen'
        ? r.gone
          ? `к удалённому абзацу «${r.gone}»`
          : 'общее, ко всему тексту'
        : `строка ${lineOf(body, r.anchorAt ?? r.from) + off}: «${short(r.anchor ?? '', 120)}»`;
    console.log(`── ${keyOf(r)} · №${r.n} · ${STATUS_LABEL[r.status]} · ${where}`);
    if (r.phrase) console.log(`К словам: «${r.phrase}»`);
    console.log(`Замечание: ${r.text}`);
    for (const m of r.thread) console.log(`  ${m.mark} ${m.by === 'claude' ? 'Claude' : 'автор'}: ${m.text}`);
  }
  if (onlyOpen) {
    const ask = all.filter((r) => r.status === 'ask').length;
    const done = all.filter((r) => r.status === 'done' || r.status === 'no').length;
    if (ask || done) console.log(`\nЖдут автора: вопросов — ${ask}, учтённых и «не принято» (ещё не приняты) — ${done}.`);
  }
  return list.length;
}

function authorChanges(file) {
  const dir = dirOf(file);
  const after = join(dir, 'после.md');
  if (!existsSync(after)) return;
  const d = diffBlocks(split(read(after))[1], split(read(file))[1]);
  const lines = [];
  d.now.forEach((b) => {
    if (b.kind === 'changed') lines.push(`  ✎ переписал: «${short(b.was, 90)}» → «${short(b.raw, 90)}»`);
    else if (b.kind === 'added') lines.push(`  ＋ добавил: «${short(b.raw, 120)}»`);
    else if (b.kind === 'moved') lines.push(`  ⇅ переставил: «${short(b.raw, 100)}»`);
  });
  for (const r of d.removed) lines.push(`  − убрал: «${short(r.raw, 120)}»`);
  console.log(`\nЧто автор изменил сам с прошлого круга (${lines.length}) — не возвращать назад:`);
  console.log(lines.length ? lines.join('\n') : '  ничего');
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd) fail('так: zametki вычитка [все|начать|ответ|готово|бросить] <файл.md> …');

if (cmd === 'все') {
  show(fileOf(rest[0]), false);
} else if (cmd === 'начать') {
  const file = fileOf(rest[0]);
  const dir = dirOf(file);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'путь.txt'), file);
  writeFileSync(join(dir, 'до.md'), read(file));
  writeFileSync(join(dir, 'lock'), String(Date.now()));
  console.log(`В работе: ${file}\nВ окне «База» у статьи полоска «Claude работает» — автор не правит, пока не будет «готово».\n`);
  show(file, true);
  authorChanges(file);
} else if (cmd === 'готово' || cmd === 'бросить') {
  const file = fileOf(rest[0]);
  const dir = dirOf(file);
  mkdirSync(dir, { recursive: true });
  if (cmd === 'готово') {
    writeFileSync(join(dir, 'путь.txt'), file);
    writeFileSync(join(dir, 'после.md'), read(file));
  } else rmSync(join(dir, 'до.md'), { force: true });
  rmSync(join(dir, 'lock'), { force: true });
  if (cmd === 'готово') {
    const all = parseRemarks(split(read(file))[1]);
    const n = (st) => all.filter((r) => r.status === st).length;
    console.log(`Круг закончен. Замечаний: учтено ${n('done')}, вопросов ${n('ask')}, не принято ${n('no')}, осталось открытых ${n('open')}.`);
    console.log('Исправленные абзацы в окне подсвечены; автор принимает или возвращает.');
  } else console.log('Полоска снята, снимок «до» убран.');
} else if (cmd === 'ответ') {
  const [p, key, kind, ...words] = rest;
  const file = fileOf(p);
  const mark = { сделано: '✓', done: '✓', вопрос: '❓', ask: '❓', уточнить: '❓', 'не-принято': '✗', no: '✗', 'не-буду': '✗' }[kind];
  const text = words.join(' ').trim();
  if (!key || !mark || !text) fail('так: zametki вычитка ответ <файл.md> <ключ> сделано|вопрос|не-принято "что сделано / что уточнить / почему нет"');
  const raw = read(file);
  const [front, body] = split(raw);
  const all = parseRemarks(body);
  const hit = all.filter((r) => keyOf(r) === key || String(r.n) === key.replace(/^[№#]/, ''));
  if (hit.length !== 1) fail(hit.length ? `ключ ${key} подходит к нескольким замечаниям — возьми ключ вида kxxxx из списка` : `замечания ${key} нет (список: zametki вычитка ${p})`);
  const out = front + apply(body, replyRemark(body, hit[0], mark, text));
  // файл мог поменяться, пока считали (автор сохранил правку) — не затирать
  if (read(file) !== raw) fail('файл изменился, пока готовился ответ, — повтори команду');
  writeFileSync(file, out);
  console.log(`${keyOf(hit[0])}: ${{ '✓': 'учтено', '❓': 'вопрос автору', '✗': 'не принято' }[mark]}`);
} else {
  show(fileOf(cmd), true);
}
