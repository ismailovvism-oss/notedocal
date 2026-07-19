// Помидоро-таймер: работа 25 мин → перерыв 5 мин, каждый N-й перерыв длинный.
//
// Активный запуск хранится в localStorage как метка конца фазы (endsAt),
// а не «сколько осталось» — поэтому таймер переживает перезагрузку страницы
// и не плывёт в фоновой вкладке: остаток всегда считается от Date.now().
// Завершённые рабочие фазы отдаются наружу через onWorkDone — App пишет их
// в журнал PomodoroSession (синхронизируется как остальные коллекции).

import { useEffect, useRef, useState } from 'react';
import type { PomodoroPhase, PomodoroSettings } from '../types';
import { useLocalStorage } from './storage';

export const DEFAULT_POMODORO: PomodoroSettings = {
  workMin: 25,
  shortMin: 5,
  longMin: 15,
  cyclesToLong: 4,
};

/** Активный запуск таймера (то, что лежит в localStorage). */
export interface PomodoroRun {
  phase: PomodoroPhase;
  /** Момент старта фазы (мс) — для записи в журнал. */
  startedAt: number;
  /** Момент окончания фазы (мс). */
  endsAt: number;
  /** Если на паузе — сколько осталось (мс); иначе null. */
  pausedLeft: number | null;
  /** Номер рабочего цикла с 1 — для выбора короткого/длинного перерыва. */
  cycle: number;
  /** Задача, над которой идёт работа. */
  itemId: string | null;
  itemText: string;
}

export const PHASE_META: Record<PomodoroPhase, { label: string; icon: string }> = {
  work: { label: 'Работа', icon: '🍅' },
  short: { label: 'Короткий перерыв', icon: '☕️' },
  long: { label: 'Длинный перерыв', icon: '🌿' },
};

function notify(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {
    /* игнорируем */
  }
}

export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface PomodoroApi {
  run: PomodoroRun | null;
  /** Остаток текущей фазы, мс (0, если таймер не идёт). */
  leftMs: number;
  paused: boolean;
  start: (item?: { id: string; text: string } | null) => void;
  pause: () => void;
  resume: () => void;
  /** Полностью остановить (без записи в журнал). */
  stop: () => void;
  /** Досрочно завершить фазу (работа при этом попадает в журнал). */
  finishPhase: () => void;
  /** Сменить задачу на лету (без перезапуска таймера). */
  setTask: (item: { id: string; text: string } | null) => void;
}

export function usePomodoro(
  settings: PomodoroSettings,
  onWorkDone: (startedAt: number, durationMin: number, itemId: string | null, itemText: string) => void,
): PomodoroApi {
  const [run, setRun] = useLocalStorage<PomodoroRun | null>('ndc.pomodoroRun', null);
  const [, setTick] = useState(0);
  const doneRef = useRef(onWorkDone);
  doneRef.current = onWorkDone;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const phaseMin = (p: PomodoroPhase, s: PomodoroSettings) =>
    p === 'work' ? s.workMin : p === 'short' ? s.shortMin : s.longMin;

  /** Завершить текущую фазу: записать работу в журнал и перейти дальше.
   *  `leftMs` > 0 — фаза завершена досрочно, пишем фактическую длительность. */
  const complete = (r: PomodoroRun, leftMs = 0) => {
    const s = settingsRef.current;
    if (r.phase === 'work') {
      const workedMin = Math.max(1, Math.round((phaseMin('work', s) * 60_000 - leftMs) / 60_000));
      doneRef.current(r.startedAt, workedMin, r.itemId, r.itemText);
      const next: PomodoroPhase = r.cycle % s.cyclesToLong === 0 ? 'long' : 'short';
      notify(`Помидорка готова ${PHASE_META.work.icon}`, `${PHASE_META[next].label} — ${phaseMin(next, s)} мин.`);
      const now = Date.now();
      setRun({
        ...r,
        phase: next,
        startedAt: now,
        endsAt: now + phaseMin(next, s) * 60_000,
        pausedLeft: null,
      });
    } else {
      // Перерыв кончился — следующую работу пользователь запускает сам.
      notify('Перерыв окончен 🍅', 'Готов к следующей помидорке?');
      setRun(null);
    }
  };

  // Тик раз в полсекунды — только для отрисовки; окончание фазы ловим здесь же.
  // Если endsAt прошёл, пока вкладка была закрыта, фаза досчитается при открытии.
  useEffect(() => {
    if (!run || run.pausedLeft !== null) return;
    const id = setInterval(() => {
      if (Date.now() >= run.endsAt) complete(run);
      else setTick((t) => t + 1);
    }, 500);
    if (Date.now() >= run.endsAt) complete(run);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const start: PomodoroApi['start'] = (item) => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    const s = settingsRef.current;
    const now = Date.now();
    // Продолжаем счёт циклов, если стартуем после перерыва того же захода.
    const cycle = run && run.phase !== 'work' ? run.cycle + 1 : 1;
    setRun({
      phase: 'work',
      startedAt: now,
      endsAt: now + s.workMin * 60_000,
      pausedLeft: null,
      cycle,
      itemId: item?.id ?? run?.itemId ?? null,
      itemText: item?.text ?? run?.itemText ?? '',
    });
  };

  const pause = () => {
    if (!run || run.pausedLeft !== null) return;
    setRun({ ...run, pausedLeft: Math.max(0, run.endsAt - Date.now()) });
  };

  const resume = () => {
    if (!run || run.pausedLeft === null) return;
    setRun({ ...run, endsAt: Date.now() + run.pausedLeft, pausedLeft: null });
  };

  const stop = () => setRun(null);

  const leftMs = run ? (run.pausedLeft ?? Math.max(0, run.endsAt - Date.now())) : 0;

  const finishPhase = () => {
    if (run) complete(run, leftMs);
  };

  const setTask: PomodoroApi['setTask'] = (item) => {
    if (!run) return;
    setRun({ ...run, itemId: item?.id ?? null, itemText: item?.text ?? '' });
  };

  return {
    run,
    leftMs,
    paused: !!run && run.pausedLeft !== null,
    start,
    pause,
    resume,
    stop,
    finishPhase,
    setTask,
  };
}
