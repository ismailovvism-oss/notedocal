import { useEffect, useId, useReducer, useRef, useState } from 'react';
import type { AmbientMix, PomodoroSettings } from '../types';
import {
  LEVEL_MIN,
  MIX_VOLUME,
  PRESETS,
  SOUNDS,
  currentMix,
  isSilent,
  mixName,
  sameMix,
  saveMix,
  setLevel,
  toggleSound,
} from '../lib/ambient';
import { onSoundStatus, setPreviewMix, soundStatus } from '../lib/mixer';

/**
 * Фон на время помидора: кнопка с названием смеси и общая громкость, по нажатию — панель
 * с наборами и звуками (у каждого свой ползунок). Пока панель открыта, смесь звучит, чтобы
 * подобрать её на слух; закрыл — играет только во время работы.
 */
export function AmbientPicker({
  settings,
  setSettings,
  working,
}: {
  settings: PomodoroSettings;
  setSettings: React.Dispatch<React.SetStateAction<PomodoroSettings>>;
  /** Идёт работа: фон уже играет и сам сменится вслед за настройкой. */
  working: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const key = useId();
  const box = useRef<HTMLDivElement>(null);

  const mix = currentMix(settings);
  const mixKey = JSON.stringify(mix);
  const saved = settings.mixes ?? [];
  const volume = settings.backgroundVolume ?? MIX_VOLUME;
  const name = mixName(mix, saved);
  const silent = isSilent(mix);
  const status = soundStatus();

  const setMix = (next: AmbientMix) => setSettings((s) => ({ ...s, mix: next }));
  const volumeSlider = (
    <input
      className="amb-volume"
      type="range"
      min={5}
      max={100}
      step={5}
      value={volume}
      aria-label="Общая громкость фона"
      title={`Громкость фона: ${volume}`}
      onChange={(e) => {
        const backgroundVolume = Number(e.target.value);
        setSettings((s) => ({ ...s, backgroundVolume }));
      }}
    />
  );

  useEffect(() => onSoundStatus(refresh), []);

  // Панель открыта — смесь звучит; закрыл — тихо (или снова таймер, если идёт работа).
  useEffect(() => {
    if (open) setPreviewMix(key, mix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mixKey]);
  useEffect(() => {
    if (!open) return;
    return () => setPreviewMix(key, null);
  }, [open, key]);

  // Нажал мимо панели или Esc — закрыть.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function save() {
    const title = window.prompt('Название смеси', '');
    if (title?.trim()) setSettings((s) => ({ ...s, mixes: saveMix(s.mixes ?? [], title, currentMix(s)) }));
  }

  function remove(id: string, title: string) {
    if (!window.confirm(`Удалить смесь «${title}»?`)) return;
    setSettings((s) => ({ ...s, mixes: (s.mixes ?? []).filter((m) => m.id !== id) }));
  }

  return (
    <div className="ambient" ref={box}>
      <button
        className={`amb-toggle ${silent ? '' : 'on'}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Фон на время помидора"
      >
        <span aria-hidden>{silent ? '🔇' : '🔈'}</span>
        <span>{name}</span>
        <span className="amb-caret" aria-hidden>
          ▾
        </span>
      </button>
      {!silent && volumeSlider}

      {open && (
        <div className="amb-panel" role="dialog" aria-label="Фон на время помидора">
          <div className="amb-sec">Наборы</div>
          <div className="amb-presets">
            <button className={`amb-chip ${silent ? 'on' : ''}`} onClick={() => setMix({})}>
              Тишина
            </button>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`amb-chip ${sameMix(p.levels, mix) ? 'on' : ''}`}
                onClick={() => setMix(p.levels)}
              >
                {p.name}
              </button>
            ))}
            {saved.map((m) => (
              <span key={m.id} className="amb-saved">
                <button
                  className={`amb-chip ${sameMix(m.levels, mix) ? 'on' : ''}`}
                  onClick={() => setMix(m.levels)}
                >
                  {m.name}
                </button>
                <button className="amb-x" onClick={() => remove(m.id, m.name)} aria-label={`Удалить ${m.name}`}>
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="amb-sec">
            <span>Звуки</span>
            <span className="amb-hint">{working ? 'играет, пока идёт помидор' : 'слышно, пока панель открыта'}</span>
          </div>
          <div className="amb-grid">
            {SOUNDS.map((s) => {
              const level = mix[s.id];
              const st = status.get(s.id);
              return (
                <div key={s.id} className={`amb-tile ${level ? 'on' : ''} ${st ?? ''}`}>
                  <button
                    className="amb-tile-btn"
                    aria-pressed={!!level}
                    onClick={() => setMix(toggleSound(mix, s.id))}
                  >
                    <span className="amb-icon" aria-hidden>
                      {s.icon}
                    </span>
                    <span className="amb-label">
                      {s.label}
                      {st === 'loading' && <span className="amb-note">загружается…</span>}
                      {st === 'error' && <span className="amb-note">нет связи</span>}
                    </span>
                  </button>
                  {!!level && (
                    <input
                      type="range"
                      min={LEVEL_MIN}
                      max={100}
                      step={5}
                      value={level}
                      aria-label={`Громкость: ${s.label}`}
                      onChange={(e) => setMix(setLevel(mix, s.id, Number(e.target.value)))}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="amb-foot">
            {!silent && (
              <label className="amb-master">
                <span>Общая громкость</span>
                {volumeSlider}
              </label>
            )}
            {name === 'Своя смесь' && (
              <button className="btn btn-small" onClick={save}>
                Сохранить смесь
              </button>
            )}
            <button className="btn btn-small btn-primary" onClick={() => setOpen(false)}>
              Готово
            </button>
          </div>
          <details className="amb-credits">
            <summary>Откуда звуки</summary>
            <p>
              Записи из открытых приложений{' '}
              <a href="https://github.com/remvze/moodist" target="_blank" rel="noreferrer">
                Moodist
              </a>{' '}
              (CC0 и лицензия Pixabay) и{' '}
              <a href="https://github.com/rafaelmardojai/blanket" target="_blank" rel="noreferrer">
                Blanket
              </a>
              : прибой —{' '}
              <a href="https://freesound.org/people/Luftrum/sounds/48412/" target="_blank" rel="noreferrer">
                Luftrum
              </a>{' '}
              (CC BY), ручей —{' '}
              <a href="https://freesound.org/people/gluckose/sounds/333987/" target="_blank" rel="noreferrer">
                gluckose
              </a>
              , птицы —{' '}
              <a href="https://freesound.org/people/kvgarlic/sounds/156826/" target="_blank" rel="noreferrer">
                kvgarlic
              </a>{' '}
              (CC0). Края обрезаны, громкость выровнена.
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
