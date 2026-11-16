// Карточка замечания — одна на оба места: под абзацем в просмотре и во вкладке «Замечания».
// Показывает слова автора, фразу, переписку с Claude и состояние (src/lib/kb/remarks.ts):
// открыто → Claude ответил ✓ (учтено) / ❓ (вопрос) / ✗ (не принято) → автор принимает
// (замечание уходит из файла), возвращает («не то») или отвечает на вопрос.

import { useState } from 'react';
import { editRemark, removeRemark, replyRemark, STATUS_LABEL, type Change, type Remark } from '../lib/kb/remarks';

export function RemarkCard({
  r,
  resolve,
  onApply,
  onJump,
  onMove,
  where,
  missing,
}: {
  r: Remark;
  /** Свежий текст и это же замечание в нём (места могли сдвинуться); null — уже нет. */
  resolve: () => { doc: string; r: Remark } | null;
  onApply: (c: Change | Change[]) => void;
  /** Показать место в тексте (в панели). */
  onJump?: () => void;
  /** Перенести к другому абзацу: дальше щелчок по абзацу в просмотре. */
  onMove?: () => void;
  /** Подпись «к какому месту» (в панели; под абзацем не нужна). */
  where?: boolean;
  /** Фразы, к которой замечание, в абзаце уже нет. */
  missing?: boolean;
}) {
  // правим свои слова или дописываем ответ (↩) — на месте
  const [edit, setEdit] = useState<{ mode: 'edit' | 'reply'; text: string } | null>(null);
  const run = (fn: (doc: string, x: Remark) => Change | Change[]) => {
    const cur = resolve();
    if (cur) onApply(fn(cur.doc, cur.r));
    setEdit(null);
  };
  const save = () => {
    if (!edit) return;
    const t = edit.text.trim();
    if (edit.mode === 'edit') run((doc, x) => (t ? editRemark(doc, x, t) : removeRemark(doc, x)));
    else run((doc, x) => replyRemark(doc, x, '↩', t));
  };
  const reply = (text = '') => setEdit({ mode: 'reply', text });
  const drop = () => run((doc, x) => removeRemark(doc, x));
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className={`rk-card st-${r.status} ${r.kind}`} onClick={onJump} title={onJump ? 'Показать место в тексте' : undefined}>
      <div className="rk-head">
        <span className="rk-n">{r.n}</span>
        <span className={`rk-st ${r.status}`}>{STATUS_LABEL[r.status]}</span>
        {where && (
          <span className="rk-where" dir="auto">
            {r.kind === 'gen' ? (r.gone ? 'к удалённому тексту' : 'ко всему тексту') : r.anchor}
          </span>
        )}
        <button
          className="rk-x"
          title={r.status === 'open' ? 'Снять замечание' : 'Убрать из файла'}
          onClick={(e) => {
            stop(e);
            drop();
          }}
        >
          ✕
        </button>
      </div>
      {r.gone && (
        <div className="rk-quote" dir="auto">
          абзац удалён: «{r.gone}»
        </div>
      )}
      {r.phrase && (
        <div className={`rk-quote ${missing ? 'missing' : ''}`} dir="auto">
          к словам «{r.phrase}»{missing ? ' — этих слов здесь больше нет' : ''}
        </div>
      )}
      {edit?.mode === 'edit' ? null : (
        <div className="rk-text" dir="auto">
          {r.text || '…'}
        </div>
      )}
      {r.thread.map((m, i) => (
        <div key={i} className={`rk-msg ${m.by} ${m.mark === '✓' ? 'done' : m.mark === '❓' ? 'ask' : m.mark === '✗' ? 'no' : ''}`} dir="auto">
          <span className="rk-by">{m.by === 'claude' ? `${m.mark} Claude` : '↩ вы'}</span>
          {m.text}
        </div>
      ))}
      {edit ? (
        <div className="rk-edit" onClick={stop}>
          <textarea
            autoFocus
            dir="auto"
            placeholder={edit.mode === 'edit' ? 'Замечание…' : r.status === 'ask' ? 'Ответ на вопрос…' : 'Что не так? (можно пусто)'}
            value={edit.text}
            onChange={(e) => setEdit({ ...edit, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setEdit(null);
              }
            }}
          />
          <div className="rk-acts">
            <button className="primary" onClick={save}>
              {edit.mode === 'edit' ? 'Сохранить' : r.status === 'ask' ? 'Ответить' : 'Вернуть в работу'}
            </button>
            <button onClick={() => setEdit(null)}>Отмена</button>
            <span className="muted small">Ctrl+Enter</span>
          </div>
        </div>
      ) : (
        <div className="rk-acts" onClick={stop}>
          {r.status === 'open' && <button onClick={() => setEdit({ mode: 'edit', text: r.text })}>Изменить</button>}
          {r.status === 'open' && r.thread.length > 0 && <button onClick={() => reply()}>Дописать</button>}
          {r.status === 'done' && (
            <button className="primary ok" title="Правка устраивает — убрать замечание из файла" onClick={drop}>
              ✓ Принять
            </button>
          )}
          {r.status === 'done' && (
            <button title="Сделано не то — вернуть в работу, можно дописать почему" onClick={() => reply()}>
              ↩ Не то
            </button>
          )}
          {r.status === 'ask' && (
            <button className="primary" onClick={() => reply()}>
              Ответить
            </button>
          )}
          {r.status === 'no' && (
            <button className="primary ok" title="Согласен с доводом — убрать замечание" onClick={drop}>
              Согласен — снять
            </button>
          )}
          {r.status === 'no' && (
            <button title="Не согласен — вернуть в работу со своим доводом" onClick={() => reply()}>
              ↩ Настаиваю
            </button>
          )}
          {onMove && (
            <button title="Перенести замечание к другому абзацу: дальше — щелчок по абзацу" onClick={onMove}>
              ↪ Перенести
            </button>
          )}
        </div>
      )}
    </div>
  );
}
