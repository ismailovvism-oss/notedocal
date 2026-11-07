import type { Ambient, PomodoroSettings } from '../types';
import { AMBIENTS, AMBIENT_VOLUME, previewAmbient } from '../lib/sound';

/** Выбор фона на время помидора. Когда таймер не идёт, выбранный звук играет несколько секунд. */
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
  const kind = settings.background ?? 'off';
  const volume = settings.backgroundVolume ?? AMBIENT_VOLUME;
  return (
    <div className="ambient">
      <label className="ambient-kind">
        <span>🔈 Фон</span>
        <select
          className="input"
          value={kind}
          onChange={(e) => {
            const background = e.target.value as Ambient;
            setSettings((s) => ({ ...s, background }));
            if (!working) previewAmbient(background, volume);
          }}
        >
          {AMBIENTS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {kind !== 'off' && (
        <input
          type="range"
          min={5}
          max={100}
          step={5}
          value={volume}
          aria-label="Громкость фона"
          title={`Громкость фона: ${volume}`}
          onChange={(e) => {
            const backgroundVolume = Number(e.target.value);
            setSettings((s) => ({ ...s, backgroundVolume }));
          }}
        />
      )}
    </div>
  );
}
