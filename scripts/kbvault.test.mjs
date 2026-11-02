// Тесты хранилища-папки: файл ↔ заметка (src/lib/kb/vault.ts). npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newNotePath, noteFromVault, vaultMarkdown, vaultNotes, vaultKey } from '../src/lib/kb/vault.ts';
import { searchNotes } from '../src/lib/kb/search.ts';

const md = (path, text, mtime = 5) => ({ e: { path, kind: 'md', mtime }, text });

test('файл .md → заметка: название из имени, свойства из заголовка, арабский цел', () => {
  const { e, text } = md('Ислам/Маджлис.md', '---\ntags: тема/фикх\nисточник: "[[Ибн Касир]]"\n---\nТекст الصَّلَاةُ');
  const n = noteFromVault(e, text);
  assert.equal(n.id, 'v:Ислам/Маджлис.md');
  assert.equal(n.title, 'Маджлис');
  assert.deepEqual(n.tags, ['тема/фикх']);
  assert.equal(n.props.источник, '[[Ибн Касир]]');
  assert.equal(n.body, 'Текст الصَّلَاةُ');
});

test('правка текста не трогает чужой заголовок; правка свойства — переписывает', () => {
  const raw = '---\ntags: тема/фикх   # как написал Obsidian\nисточник: x\n---\nТекст';
  const n = noteFromVault({ path: 'a.md', kind: 'md' }, raw);
  assert.equal(vaultMarkdown({ ...n, body: 'Новый текст' }), raw.replace('Текст', 'Новый текст'));
  const changed = vaultMarkdown({ ...n, props: { ...n.props, источник: 'y' } });
  assert.match(changed, /источник: y/);
  assert.match(changed, /tags:\n {2}- тема\/фикх/);
  // без заголовка и без свойств — просто текст
  assert.equal(vaultMarkdown(noteFromVault({ path: 'b.md', kind: 'md' }, 'просто')), 'просто');
});

test('роль и версии — в notedocal:, обратно читаются', () => {
  const n = { ...noteFromVault({ path: 'c.md', kind: 'md' }, 'x'), type: 'comment', currentVersion: 'очищено', versions: { оригинал: 'x', очищено: 'y' } };
  const text = vaultMarkdown(n);
  const back = noteFromVault({ path: 'c.md', kind: 'md' }, text);
  assert.equal(back.type, 'comment');
  assert.equal(back.currentVersion, 'очищено');
  // после записи ключ свежий: следующая правка текста заголовок не трогает
  const k = vaultKey(back);
  assert.equal(k.key, back.vault.key);
});

test('папки и файлы: дерево по путям, PDF — свой пункт, поиск «.pdf» находит его и заметку с ним', () => {
  const entries = [
    { path: 'Книги', kind: 'dir' },
    { path: 'Книги/Ибн Касир, т.1.pdf', kind: 'file', size: 10 },
    { path: 'Книги/Тафсир.md', kind: 'md' },
    { path: 'Корень.md', kind: 'md' },
  ];
  const texts = new Map([['Книги/Тафсир.md', 'см. ![[Ибн Касир, т.1.pdf]]'], ['Корень.md', 'ничего']]);
  const { notes, relations } = vaultNotes(entries, texts);
  const pdf = notes.find((n) => n.id === 'f:Книги/Ибн Касир, т.1.pdf');
  assert.equal(pdf.title, 'Ибн Касир, т.1.pdf');
  assert.equal(pdf.vault.mime, 'application/pdf');
  assert.deepEqual(relations.map((r) => `${r.from}>${r.to}`).sort(), ['d:Книги>f:Книги/Ибн Касир, т.1.pdf', 'd:Книги>v:Книги/Тафсир.md']);
  const found = searchNotes(notes, '.pdf').hits.map((h) => h.note.id).sort();
  assert.deepEqual(found, ['f:Книги/Ибн Касир, т.1.pdf', 'v:Книги/Тафсир.md']);
});

test('путь новой заметки: имя из названия, занятое — с номером', () => {
  const taken = new Set(['Идеи/Мысль.md']);
  assert.equal(newNotePath('Идеи', 'Мысль', (p) => taken.has(p)), 'Идеи/Мысль 2.md');
  assert.equal(newNotePath('', 'a/b: c?', () => false), 'a b c.md');
});
