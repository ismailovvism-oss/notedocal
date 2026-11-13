// Сигналы таймера собираются прямо в браузере, файлы не нужны. Фон на время помидора —
// lib/mixer.ts (записи природы и смеси). Браузер разрешает звук только после нажатия,
// поэтому контекст будят кнопки «старт» и «продолжить».

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
