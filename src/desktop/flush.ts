// Несохранённое — сохранить сразу, не дожидаясь паузы в наборе: при перезагрузке страницы (F5),
// когда окно прячут и когда программа выходит (baza.py зовёт window.__flush и ждёт). Иначе
// последние полсекунды набора терялись.

const flushers = new Set<() => void>();

export function onFlush(f: () => void) {
  flushers.add(f);
  return () => void flushers.delete(f);
}

export function flushAll() {
  for (const f of flushers) {
    try {
      f();
    } catch {
      /* одна заметка не мешает остальным */
    }
  }
}

declare global {
  interface Window {
    __flush?: () => void;
  }
}
window.__flush = flushAll;
window.addEventListener('pagehide', flushAll);
window.addEventListener('beforeunload', flushAll);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAll();
});
