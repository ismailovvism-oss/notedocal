// Звуки таймера собираются прямо в браузере, файлы не нужны: сигналы конца фазы и фон
// на время помидора. Браузер разрешает звук только после нажатия, поэтому контекст
// будят кнопки «старт» и «продолжить».

import type { Ambient } from '../types';

export const AMBIENTS: [Ambient, string][] = [
  ['off', 'Тишина'],
  ['tick', 'Тиканье'],
  ['rain', 'Дождь'],
  ['sea', 'Прибой'],
  ['wind', 'Ветер'],
];
export const AMBIENT_VOLUME = 35;
/** Сколько секунд играет проба при выборе звука. */
const PREVIEW_SEC = 6;

export const WORK_DONE_NOTES = [659.25, 783.99, 1046.5]; // вверх: помидор готов
export const BREAK_DONE_NOTES = [1046.5, 783.99]; // вниз: перерыв кончился

let audio: AudioContext | null = null;

export function wakeAudio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  audio ??= new AudioContext();
  return audio;
}

export function chime(notes: number[]): void {
  const ctx = wakeAudio();
  if (!ctx) return;
  const asked = Date.now();
  void ctx.resume().then(() => {
    // Браузер не дал звук сразу — запоздавший сигнал по следующему нажатию не нужен.
    if (Date.now() - asked > 5000) return;
    notes.forEach((hz, i) => {
      const at = ctx.currentTime + i * 0.22;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 1.15);
    });
  });
}

/** Стереошум по кругу: в нём нет плавной линии, поэтому стык петли не щёлкает. */
function noise(ctx: BaseAudioContext): AudioBufferSourceNode {
  const buffer = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, hz: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

function level(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Медленное покачивание параметра: волна, порыв ветра. */
function sway(ctx: BaseAudioContext, param: AudioParam, hz: number, depth: number): OscillatorNode {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = hz;
  lfo.connect(level(ctx, depth)).connect(param);
  return lfo;
}

/** Два удара часов на две секунды, дальше по кругу: точно по времени и без таймеров страницы. */
function ticks(ctx: BaseAudioContext): AudioBufferSourceNode {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (const [from, hz] of [[0, 2100], [1, 1650]]) {
    const start = from * ctx.sampleRate;
    for (let i = 0; i < ctx.sampleRate * 0.04; i++) {
      const t = i / ctx.sampleRate;
      data[start + i] = 0.55 * Math.exp(-t / 0.004) * Math.sin(2 * Math.PI * hz * t);
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

/** Собрать фон и подключить его к `out`; вернуть источники, которые надо запустить и остановить. */
export function buildAmbient(ctx: BaseAudioContext, kind: Ambient, out: AudioNode): AudioScheduledSourceNode[] {
  if (kind === 'tick') {
    const src = ticks(ctx);
    src.connect(out);
    return [src];
  }
  if (kind === 'rain') {
    const hiss = noise(ctx);
    hiss.connect(filter(ctx, 'highpass', 900)).connect(filter(ctx, 'lowpass', 7000)).connect(level(ctx, 0.3)).connect(out);
    const body = noise(ctx);
    body.connect(filter(ctx, 'lowpass', 500)).connect(level(ctx, 0.7)).connect(out);
    return [hiss, body];
  }
  if (kind === 'sea') {
    const wave = level(ctx, 1.1);
    const foam = level(ctx, 0.1);
    const roar = noise(ctx);
    roar.connect(filter(ctx, 'lowpass', 420)).connect(wave).connect(out);
    const spray = noise(ctx);
    spray.connect(filter(ctx, 'bandpass', 1800, 0.5)).connect(foam).connect(out);
    return [
      roar,
      spray,
      sway(ctx, wave.gain, 0.09, 0.7),
      sway(ctx, wave.gain, 0.053, 0.25),
      sway(ctx, foam.gain, 0.09, 0.08),
    ];
  }
  if (kind === 'wind') {
    const band = filter(ctx, 'bandpass', 380, 0.8);
    const gust = level(ctx, 1.05);
    const air = noise(ctx);
    air.connect(band).connect(gust).connect(out);
    return [
      air,
      sway(ctx, band.frequency, 0.07, 180),
      sway(ctx, band.frequency, 0.19, 90),
      sway(ctx, gust.gain, 0.11, 0.45),
    ];
  }
  return [];
}

let current: { kind: Ambient; master: GainNode; sources: AudioScheduledSourceNode[] } | null = null;
let previewTimer: ReturnType<typeof setTimeout> | undefined;

export function stopAmbient(): void {
  clearTimeout(previewTimer);
  if (!current) return;
  const { master, sources } = current;
  current = null;
  const now = master.context.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(0, now, 0.2);
  for (const s of sources) s.stop(now + 1);
}

export function playAmbient(kind: Ambient, volume: number): void {
  clearTimeout(previewTimer);
  if (current?.kind === kind) return;
  stopAmbient();
  const ctx = kind === 'off' ? null : wakeAudio();
  if (!ctx) return;
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(volume / 100, ctx.currentTime + 1.5);
  master.connect(ctx.destination);
  const sources = buildAmbient(ctx, kind, master);
  for (const s of sources) s.start();
  current = { kind, master, sources };
}

export function setAmbientVolume(volume: number): void {
  if (!current) return;
  const { master } = current;
  const now = master.context.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(volume / 100, now, 0.1);
}

/** Послушать звук при выборе, когда таймер не идёт. */
export function previewAmbient(kind: Ambient, volume: number): void {
  playAmbient(kind, volume);
  previewTimer = setTimeout(stopAmbient, PREVIEW_SEC * 1000);
}
