// Тесты смеси фона: переход со старого одного звука, названия наборов, ползунки, свои смеси.
// npm test (Node 26 запускает .ts напрямую).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  PRESETS,
  SOUNDS,
  cleanMix,
  currentMix,
  mixName,
  sameMix,
  saveMix,
  setLevel,
  toggleSound,
} from '../src/lib/ambient.ts';

const base = { workMin: 25, shortMin: 5, longMin: 15, cyclesToLong: 4 };

test('старый один звук становится смесью, своя смесь важнее старого', () => {
  assert.deepEqual(currentMix(base), {});
  assert.deepEqual(currentMix({ ...base, background: 'off' }), {});
  assert.deepEqual(currentMix({ ...base, background: 'rain' }), { rain: 60 });
  assert.deepEqual(currentMix({ ...base, background: 'sea' }), { waves: 60 });
  assert.deepEqual(currentMix({ ...base, background: 'rain', mix: {} }), {});
  assert.deepEqual(currentMix({ ...base, background: 'rain', mix: { birds: 30 } }), { birds: 30 });
});

test('в смеси только известные звуки и громкость в пределах', () => {
  assert.deepEqual(cleanMix({ rain: 0, birds: 140, owl: 2, nope: 50, fire: 33.4 }), {
    birds: 100,
    owl: 5,
    fire: 33,
  });
});

test('название смеси: тишина, набор, своё сохранённое, иначе своя', () => {
  assert.equal(mixName({}), 'Тишина');
  assert.equal(mixName({ ...PRESETS[0].levels }), PRESETS[0].name);
  assert.equal(mixName({ rain: 10 }), 'Своя смесь');
  const saved = saveMix([], 'Мой дождь', { rain: 10 }, 1);
  assert.equal(mixName({ rain: 10 }, saved), 'Мой дождь');
  assert.ok(sameMix({ rain: 10, owl: 0 }, { rain: 10 }));
});

test('звук включается с обычной громкостью и выключается, ползунок меняет одну громкость', () => {
  const on = toggleSound({}, 'birds');
  assert.deepEqual(on, { birds: 50 });
  assert.deepEqual(toggleSound(on, 'birds'), {});
  assert.deepEqual(setLevel({ birds: 50, rain: 20 }, 'birds', 75), { birds: 75, rain: 20 });
});

test('своя смесь: то же название заменяет, пустую не сохранить, не больше 12', () => {
  let saved = saveMix([], 'Утро', { stream: 40 }, 1);
  saved = saveMix(saved, 'утро ', { stream: 60 }, 2);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].levels, { stream: 60 });
  assert.equal(saveMix(saved, 'Пусто', {}, 3), saved);
  for (let i = 0; i < 20; i++) saved = saveMix(saved, `Смесь ${i}`, { rain: 10 + i }, 10 + i);
  assert.equal(saved.length, 12);
  assert.equal(saved[0].name, 'Смесь 19');
});

test('наборы состоят из известных звуков, у записей есть файлы', () => {
  const ids = new Set(SOUNDS.map((s) => s.id));
  for (const p of PRESETS) for (const id of Object.keys(p.levels)) assert.ok(ids.has(id), `${p.name}: ${id}`);
  for (const s of SOUNDS) {
    for (const f of s.files ?? []) {
      assert.ok(existsSync(new URL(`../public/sounds/${f}`, import.meta.url)), `нет файла ${f}`);
    }
  }
});
