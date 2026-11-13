// Проигрыватель смеси фона. Чтобы звук не надоедал петлёй, сделано как у лучших приложений:
// - основа (дождь, ручей) играет кусками по 18–48 секунд из случайного места записи,
//   соседние куски перекрываются плавно, без провала громкости (как у Noice);
// - удары (гром, сова) звучат по одному, со случайной паузой, громкостью и стороной;
// - громкость каждого слоя медленно гуляет на пару децибел (как «осцилляция» у Noisli).
// Всё расписание — по часам Web Audio и событиям конца куска, без таймеров страницы:
// в свёрнутом окне браузер душит setTimeout, а звук продолжает идти ровно.
//
// Когда играет (как в Noisli: выбрал — играет, пока не остановишь; хозяин 13.11.26):
// - во время работы помидора — сама;
// - включил вручную (открыл панель выбора или ▶) — и после «Готово», до ⏸;
// - ⏸ во время работы глушит до следующего начала работы.
// Смесь меняется по разнице — общие слои не перезапускаются.

import type { AmbientMix } from '../types';
import { SOUNDS, cleanMix, MIX_VOLUME, type SoundDef } from './ambient';
import { wakeAudio } from './sound';

/** Поменял записи в public/sounds — подними версию, иначе останутся старые из кэша. */
const SOUNDS_VERSION = 1;
const CACHE = `ndc-sounds-v${SOUNDS_VERSION}`;
const BASE = `${import.meta.env.BASE_URL}sounds/`;

type Status = 'loading' | 'error';
interface Layer {
  def: SoundDef;
  level: GainNode;
  stop(): void;
}

let master: GainNode | null = null;
let volume = MIX_VOLUME;
/** Выбранная смесь (настройка), идёт ли работа помидора, включено ли вручную, заглушено ли. */
let chosen: AmbientMix = {};
let working = false;
let byHand = false;
let muted = false;
const layers = new Map<string, Layer>();
const buffers = new Map<string, Promise<AudioBuffer>>();
const status = new Map<string, Status>();
const listeners = new Set<() => void>();

// ---------- загрузка записей ----------

/** Запись из кэша браузера, иначе из сети (и в кэш): второй раз звук играет и без связи. */
async function fetchSound(file: string): Promise<ArrayBuffer> {
  const url = new URL(BASE + file, location.href).href;
  if (typeof caches === 'undefined') return (await fetch(url)).arrayBuffer();
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  await cache.put(url, res.clone());
  // Старые версии записей больше не нужны.
  void caches.keys().then((keys) => {
    for (const k of keys) if (k.startsWith('ndc-sounds-') && k !== CACHE) void caches.delete(k);
  });
  return res.arrayBuffer();
}

function loadBuffer(ctx: AudioContext, file: string): Promise<AudioBuffer> {
  let p = buffers.get(file);
  if (!p) {
    p = fetchSound(file).then((data) => ctx.decodeAudioData(data));
    p.catch(() => buffers.delete(file)); // в следующий раз попробовать снова
    buffers.set(file, p);
  }
  return p;
}

function notify(): void {
  for (const fn of listeners) fn();
}

function setStatus(id: string, s: Status | null): void {
  if (s) status.set(id, s);
  else status.delete(id);
  notify();
}

/** Звуки, которые грузятся или не загрузились (нет сети), — для подсказки в панели. */
export function soundStatus(): ReadonlyMap<string, Status> {
  return status;
}

/** Подписка на перемены: загрузка звуков, «играет / не играет». */
export function onSoundStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- звуки из браузера ----------

/** Бурый шум: мягкий, низкий, без шипения — для ровного фона. 12 секунд, дальше кусками. */
function brownNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(2, ctx.sampleRate * 12, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last;
      sum += last * last;
    }
    const gain = 0.1 / Math.sqrt(sum / data.length); // средний уровень около −20 дБ, как у записей
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
  return buffer;
}

/** Два удара часов на две секунды, по кругу: ровно по времени. */
function ticks(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (const [from, hz] of [
    [0, 2100],
    [1, 1650],
  ]) {
    const start = from * ctx.sampleRate;
    for (let i = 0; i < ctx.sampleRate * 0.04; i++) {
      const t = i / ctx.sampleRate;
      data[start + i] = 0.55 * Math.exp(-t / 0.004) * Math.sin(2 * Math.PI * hz * t);
    }
  }
  return buffer;
}

// ---------- как играет слой ----------

/** Плавные кривые перекрытия: сумма мощностей двух кусков постоянна, провала нет. */
const FADE_IN = new Float32Array(64).map((_, i) => Math.sin(((i / 63) * Math.PI) / 2));
const FADE_OUT = FADE_IN.slice().reverse();

/** Основа: куски из случайных мест записи с плавным перекрытием. Возвращает «стоп». */
function bed(ctx: AudioContext, buffer: AudioBuffer, out: AudioNode): () => void {
  const d = buffer.duration;
  const overlap = Math.min(3, d / 6);
  const playing = new Set<AudioBufferSourceNode>();
  let at = ctx.currentTime + 0.05;
  let stopped = false;

  const grain = () => {
    if (stopped) return;
    const len = Math.min(d, 18 + Math.random() * 30);
    const offset = Math.random() * (d - len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.setValueCurveAtTime(FADE_IN, at, overlap);
    g.gain.setValueCurveAtTime(FADE_OUT, at + len - overlap, overlap);
    src.connect(g).connect(out);
    src.start(at, offset, len);
    playing.add(src);
    // Кончился кусок — следующий уже звучит, ставим ещё один впрок.
    src.onended = () => {
      playing.delete(src);
      grain();
    };
    at += len - overlap;
  };
  grain();
  grain();
  return () => {
    stopped = true;
    for (const s of playing) s.stop(ctx.currentTime + 2);
  };
}

/** Удары по одному: случайная запись, пауза, громкость, сторона и чуть другой тон. */
function strikes(ctx: AudioContext, list: AudioBuffer[], gap: [number, number], out: AudioNode): () => void {
  let stopped = false;
  let pending: AudioBufferSourceNode | null = null;
  let last = -1;

  const next = (at: number) => {
    if (stopped) return;
    let n = Math.floor(Math.random() * list.length);
    if (list.length > 1 && n === last) n = (n + 1) % list.length;
    last = n;
    const src = ctx.createBufferSource();
    src.buffer = list[n];
    src.playbackRate.value = 0.93 + Math.random() * 0.12;
    const g = ctx.createGain();
    g.gain.value = 0.55 + Math.random() * 0.45;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.2 - 0.6;
    src.connect(g).connect(pan).connect(out);
    src.start(at);
    pending = src;
    src.onended = () => next(ctx.currentTime + gap[0] + Math.random() * (gap[1] - gap[0]));
  };
  // Первый удар вскоре: включил — слышно, что звук есть.
  next(ctx.currentTime + 2 + Math.random() * 6);
  return () => {
    stopped = true;
    pending?.stop(ctx.currentTime + 2);
  };
}

/** Медленное покачивание громкости слоя: ±25 % за 40–100 секунд, у каждого слоя своё. */
function drift(ctx: AudioContext, param: AudioParam): OscillatorNode {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 1 / (40 + Math.random() * 60);
  const depth = ctx.createGain();
  depth.gain.value = 0.25;
  lfo.connect(depth).connect(param);
  lfo.start(ctx.currentTime + Math.random() * 5);
  return lfo;
}

function startLayer(ctx: AudioContext, def: SoundDef, level: number, out: AudioNode): Layer {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(level / 100, ctx.currentTime, 0.5); // нарастает за пару секунд
  gain.connect(out);
  const sway = ctx.createGain();
  sway.connect(gain);
  const stops: (() => void)[] = [];
  let stopped = false;

  if (def.synth === 'tick') {
    const src = ctx.createBufferSource();
    src.buffer = ticks(ctx);
    src.loop = true;
    src.connect(gain);
    src.start();
    stops.push(() => src.stop(ctx.currentTime + 2));
  } else if (def.synth === 'brown') {
    stops.push(bed(ctx, brownNoise(ctx), gain));
  } else if (def.files) {
    setStatus(def.id, 'loading');
    Promise.all(def.files.map((f) => loadBuffer(ctx, f))).then(
      (list) => {
        setStatus(def.id, null);
        if (stopped) return;
        if (def.gap) {
          stops.push(strikes(ctx, list, def.gap, gain));
          return;
        }
        const lfo = drift(ctx, sway.gain);
        stops.push(() => lfo.stop(ctx.currentTime + 2), bed(ctx, list[0], sway));
      },
      () => setStatus(def.id, 'error'),
    );
  }

  return {
    def,
    level: gain,
    stop() {
      stopped = true;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      for (const s of stops) s();
      setTimeout(() => gain.disconnect(), 2500);
    },
  };
}

// ---------- общий выход ----------

/** Записи выровнены тихо (−24 LUFS, как в Blanket): ползунок 50 даёт примерно прежнюю громкость. */
const MAKEUP = 3;
/** Вход ограничителя ужат в столько раз: кривая WaveShaper работает только на [−1, 1]. */
const HEADROOM = 4;

/** Мягкий ограничитель: до 0,7 звук не трогает, выше плавно прижимает к 1 — гром на полной
 *  громкости вместе с дождём не хрипит. Без DynamicsCompressor: тот сам поднимает громкость. */
function limiter(ctx: AudioContext): WaveShaperNode {
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const x = ((i / (curve.length - 1)) * 2 - 1) * HEADROOM;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3));
  }
  const shaper = ctx.createWaveShaper();
  shaper.curve = curve;
  return shaper;
}

const masterGain = (v: number) => ((v / 100) * MAKEUP) / HEADROOM;

// ---------- смесь ----------

/** Звучит ли фон сейчас (если в смеси что-то есть). */
export function isHeard(): boolean {
  return !muted && (byHand || working);
}

function wanted(): AmbientMix {
  return isHeard() ? cleanMix(chosen) : {};
}

function apply(): void {
  const mix = wanted();
  for (const [id, layer] of layers) {
    if (!mix[id]) {
      layer.stop();
      layers.delete(id);
    }
  }
  const ids = Object.keys(mix);
  if (ids.length === 0) return;
  const ctx = wakeAudio();
  if (!ctx) return;
  void ctx.resume();
  if (!master) {
    master = ctx.createGain();
    master.gain.value = masterGain(volume);
    master.connect(limiter(ctx)).connect(ctx.destination);
  }
  for (const id of ids) {
    const layer = layers.get(id);
    if (layer) {
      layer.level.gain.setTargetAtTime(mix[id] / 100, ctx.currentTime, 0.15);
      continue;
    }
    const def = SOUNDS.find((s) => s.id === id);
    if (def) layers.set(id, startLayer(ctx, def, mix[id], master));
  }
}

/** Выбранная смесь из настроек. */
export function setChosenMix(mix: AmbientMix): void {
  chosen = mix;
  apply();
}

/** Идёт ли работа помидора (не перерыв, не пауза). Началась работа — заглушка снимается. */
export function setWorking(next: boolean): void {
  if (next && !working) muted = false;
  working = next;
  notify();
  apply();
}

/** ▶ — играть и без таймера, пока не остановишь; ⏸ — тишина (во время работы — до следующей). */
export function playByHand(on: boolean): void {
  byHand = on;
  muted = !on && working;
  notify();
  apply();
}

export function setMixVolume(next: number): void {
  volume = next;
  if (master) master.gain.setTargetAtTime(masterGain(volume), master.context.currentTime, 0.1);
}
