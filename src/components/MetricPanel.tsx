import { useMemo, useState } from 'react';
import type { Note } from '../types';
import catalog from '../lib/metrics.json';
import {
  METRIC_BY_CODE,
  dueLabs,
  deltaOf,
  fmtValue,
  latestOf,
  rangeLabel,
  seriesOf,
  sinceDays,
  sparkPoints,
  statusOfNote,
  usedCodes,
} from '../lib/metrics';

interface Props {
  notes: Note[];
  todayKey: string;
}

const WATCH: string[] = (catalog as { watch?: string[] }).watch ?? [];

function fmtDate(key: string): string {
  return new Date(key + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Замеры плитками с мини-графиком и таблица анализов с нормой, целью и
 *  напоминанием, что пора пересдать. */
export function MetricPanel({ notes, todayKey }: Props) {
  const [days, setDays] = useState(90);
  const [openLabs, setOpenLabs] = useState(false);

  const metricCodes = useMemo(() => usedCodes(notes, 'metric'), [notes]);
  const labCodes = useMemo(() => usedCodes(notes, 'lab'), [notes]);
  const due = useMemo(() => dueLabs(notes, todayKey, WATCH), [notes, todayKey]);

  if (metricCodes.length === 0 && labCodes.length === 0 && due.length === 0) return null;

  return (
    <div className="hl-metrics">
      {metricCodes.length > 0 && (
        <>
          <div className="hl-metrics-head">
            <span className="hl-section-title">📏 Замеры</span>
            <span className="hl-period">
              {[30, 90, 365].map((d) => (
                <button
                  key={d}
                  className={`hl-period-btn ${days === d ? 'active' : ''}`}
                  onClick={() => setDays(d)}
                >
                  {d === 365 ? 'год' : `${d}д`}
                </button>
              ))}
            </span>
          </div>
          <div className="hl-tiles">
            {metricCodes.map((code) => {
              const def = METRIC_BY_CODE[code];
              const all = seriesOf(notes, code);
              const pts = sinceDays(all, todayKey, days);
              const last = all[all.length - 1];
              const st = statusOfNote(def, last.value, last.value2);
              const delta = deltaOf(pts);
              const d = def.decimals ?? 0;
              return (
                <div key={code} className={`hl-tile st-${st}`} title={def.hint ?? ''}>
                  <span className="hl-tile-label">{def.label}</span>
                  <span className="hl-tile-value">
                    {fmtValue(def, last.note)} <i>{def.unit}</i>
                  </span>
                  {pts.length > 1 && (
                    <svg className="hl-spark" viewBox="0 0 100 26" preserveAspectRatio="none">
                      <polyline points={sparkPoints(pts, 100, 26)} />
                    </svg>
                  )}
                  <span className="hl-tile-foot muted">
                    {fmtDate(last.date)}
                    {delta != null && delta !== 0
                      ? ` · ${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(d)} за ${days === 365 ? 'год' : `${days}д`}`
                      : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {due.length > 0 && (
        <div className="hl-due">
          <span className="hl-section-title">🧪 Пора сдать</span>
          <ul>
            {due.map(({ def, lastDate, overdueDays }) => (
              <li key={def.code}>
                <b>{def.label}</b>{' '}
                {lastDate ? (
                  <span className="muted">
                    последний раз {fmtDate(lastDate)}
                    {overdueDays ? `, просрочено на ${overdueDays} дн.` : ''}
                  </span>
                ) : (
                  <span className="muted">ни разу не сдавался</span>
                )}
                {def.hint && <div className="muted small">{def.hint}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {labCodes.length > 0 && (
        <div className="hl-labs">
          <button className="hl-labs-toggle" onClick={() => setOpenLabs((v) => !v)}>
            {openLabs ? '▾' : '▸'} 🧪 Анализы ({labCodes.length})
          </button>
          {openLabs && (
            <table className="hl-lab-table">
              <tbody>
                {labCodes.map((code) => {
                  const def = METRIC_BY_CODE[code];
                  const last = latestOf(notes, code);
                  if (!last) return null;
                  const st = statusOfNote(def, last.value, last.value2);
                  const all = seriesOf(notes, code);
                  const prev = all.length > 1 ? all[all.length - 2] : null;
                  const d = def.decimals ?? 0;
                  return (
                    <tr key={code} className={`st-${st}`}>
                      <td className="hl-lab-name">
                        {def.label}
                        <div className="muted small">{rangeLabel(def)}</div>
                      </td>
                      <td className="hl-lab-val">
                        <b>{fmtValue(def, last.note)}</b> <span className="muted">{def.unit}</span>
                        {prev && (
                          <div className="muted small">
                            было {prev.value.toFixed(d)} · {fmtDate(prev.date)}
                          </div>
                        )}
                      </td>
                      <td className="hl-lab-date muted small">{fmtDate(last.date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
