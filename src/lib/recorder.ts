// Запись с микрофона в браузере (MediaRecorder): вкладка «Быстрые» и 🎤 в поле правки.
// Распознаёт не браузер, а окно на компьютере: файл уходит в хранилище, окно его забирает.

import { useEffect, useRef, useState } from 'react';

export const fmtSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Запись с микрофона в браузере: запись, пауза, готово → файл. */
export function useRecorder() {
  const [state, setState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);

  const tick = (on: boolean) => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = on ? window.setInterval(() => setSeconds((s) => s + 1), 1000) : null;
  };
  const release = () => {
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    tick(false);
    setState('idle');
    setSeconds(0);
  };
  useEffect(() => () => release(), []);

  return {
    state,
    seconds,
    async start() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.start(1000);
      rec.current = r;
      setSeconds(0);
      setState('recording');
      tick(true);
    },
    pause() {
      rec.current?.pause();
      setState('paused');
      tick(false);
    },
    resume() {
      rec.current?.resume();
      setState('recording');
      tick(true);
    },
    cancel() {
      rec.current?.stop();
      release();
    },
    stop(): Promise<File | null> {
      const r = rec.current;
      if (!r) return Promise.resolve(null);
      return new Promise((resolve) => {
        r.onstop = () => {
          const type = r.mimeType || 'audio/webm';
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
          resolve(new File(chunks.current, `голос-${stamp}.${ext}`, { type: type.split(';')[0] }));
          release();
        };
        r.stop();
      });
    },
  };
}

