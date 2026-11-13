// Фон на время помидора: какие есть звуки, готовые наборы и правила смеси (без Web Audio —
// играет lib/mixer.ts). Устроено как у Noisli, Moodist и Blanket: у каждого звука свой
// ползунок, несколько звуков сразу, готовые наборы и свои (хозяин 13.11.26).

import type { Ambient, AmbientMix, PomodoroSettings, SavedMix } from '../types';

export interface SoundDef {
  id: string;
  label: string;
  icon: string;
  /** Записи в public/sounds (готовит scripts/zvuki.py). У удара их несколько: звучат по одному. */
  files?: string[];
  /** Собирается в браузере, без файла. */
  synth?: 'brown' | 'tick';
  /** Удар (гром, сова): пауза между ними, секунды «от–до». */
  gap?: [number, number];
}

export const SOUNDS: SoundDef[] = [
  { id: 'rain', label: 'Дождь', icon: '🌧️', files: ['rain.mp3'] },
  { id: 'leaves', label: 'Дождь по листьям', icon: '🍃', files: ['leaves.mp3'] },
  {
    id: 'thunder',
    label: 'Гром вдали',
    icon: '⛈️',
    files: ['thunder-1.mp3', 'thunder-2.mp3', 'thunder-3.mp3', 'thunder-4.mp3'],
    gap: [40, 150],
  },
  { id: 'stream', label: 'Ручей', icon: '💧', files: ['stream.mp3'] },
  { id: 'river', label: 'Река', icon: '🏞️', files: ['river.mp3'] },
  { id: 'waves', label: 'Прибой', icon: '🌊', files: ['waves.mp3'] },
  { id: 'trees', label: 'Ветер в листве', icon: '🌳', files: ['trees.mp3'] },
  { id: 'wind', label: 'Ветер', icon: '🌬️', files: ['wind.mp3'] },
  { id: 'birds', label: 'Птицы', icon: '🐦', files: ['birds.mp3'] },
  { id: 'crickets', label: 'Сверчки', icon: '🦗', files: ['crickets.mp3'] },
  { id: 'owl', label: 'Сова', icon: '🦉', files: ['owl-1.mp3', 'owl-2.mp3'], gap: [20, 80] },
  { id: 'fire', label: 'Костёр', icon: '🔥', files: ['fire.mp3'] },
  { id: 'brown', label: 'Ровный шум', icon: '〰️', synth: 'brown' },
  { id: 'tick', label: 'Часы', icon: '🕰️', synth: 'tick' },
];

export interface MixPreset {
  id: string;
  name: string;
  levels: AmbientMix;
}

/** Готовые наборы: основа (дождь, вода) погромче, живое (птицы, гром) потише. */
export const PRESETS: MixPreset[] = [
  { id: 'forest-rain', name: 'Дождь в лесу', levels: { leaves: 60, rain: 30, birds: 15, thunder: 40 } },
  { id: 'stream-morning', name: 'Ручей утром', levels: { stream: 55, birds: 35, trees: 20 } },
  { id: 'river', name: 'У реки', levels: { river: 55, trees: 25, birds: 15 } },
  { id: 'shore', name: 'Берег', levels: { waves: 65, wind: 20 } },
  { id: 'storm', name: 'Гроза', levels: { rain: 60, thunder: 60, wind: 25 } },
  { id: 'fire-rain', name: 'Костёр в дождь', levels: { fire: 80, rain: 35 } },
  { id: 'night', name: 'Ночь', levels: { crickets: 55, trees: 20, owl: 40 } },
  { id: 'even', name: 'Ровный шум', levels: { brown: 55 } },
];

export const MIX_VOLUME = 50;
/** С такой громкостью звук включается в смеси. */
export const LEVEL_DEFAULT = 50;
export const LEVEL_MIN = 5;
export const SAVED_MAX = 12;

const KNOWN = new Set(SOUNDS.map((s) => s.id));

/** Прежний один звук → смесь: настройка, выбранная до смесей, не теряется. */
const FROM_OLD: Record<Ambient, AmbientMix> = {
  off: {},
  tick: { tick: 60 },
  rain: { rain: 60 },
  sea: { waves: 60 },
  wind: { wind: 60 },
};

/** Только известные звуки с громкостью в пределах; молчащие выброшены. */
export function cleanMix(mix: AmbientMix | undefined): AmbientMix {
  const out: AmbientMix = {};
  for (const [id, level] of Object.entries(mix ?? {})) {
    if (KNOWN.has(id) && Number.isFinite(level) && level > 0) {
      out[id] = Math.min(100, Math.max(LEVEL_MIN, Math.round(level)));
    }
  }
  return out;
}

/** Что играет во время работы. */
export function currentMix(s: PomodoroSettings): AmbientMix {
  return cleanMix(s.mix ?? FROM_OLD[s.background ?? 'off'] ?? {});
}

export function isSilent(mix: AmbientMix): boolean {
  return Object.keys(cleanMix(mix)).length === 0;
}

export function sameMix(a: AmbientMix, b: AmbientMix): boolean {
  const x = cleanMix(a);
  const y = cleanMix(b);
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
}

/** Как назвать смесь: «Тишина», название набора (готового или своего) или «Своя смесь». */
export function mixName(mix: AmbientMix, saved: SavedMix[] = []): string {
  if (isSilent(mix)) return 'Тишина';
  const hit = [...PRESETS, ...saved].find((p) => sameMix(p.levels, mix));
  return hit?.name ?? 'Своя смесь';
}

/** Включить звук с обычной громкостью или выключить. */
export function toggleSound(mix: AmbientMix, id: string): AmbientMix {
  const next = { ...cleanMix(mix) };
  if (next[id]) delete next[id];
  else next[id] = LEVEL_DEFAULT;
  return next;
}

export function setLevel(mix: AmbientMix, id: string, level: number): AmbientMix {
  return cleanMix({ ...mix, [id]: level });
}

/** Сохранить смесь под названием; то же название — заменить. Новые сверху, не больше SAVED_MAX. */
export function saveMix(saved: SavedMix[], name: string, levels: AmbientMix, now = Date.now()): SavedMix[] {
  const title = name.trim();
  if (!title || isSilent(levels)) return saved;
  const rest = saved.filter((m) => m.name.toLowerCase() !== title.toLowerCase());
  return [{ id: `mix-${now}`, name: title, levels: cleanMix(levels) }, ...rest].slice(0, SAVED_MAX);
}
