// Окна базы знаний поверх заметки (docs/ЗАМЕТКИ.md, 3.1): «Сослаться» — выбрать цель ссылки,
// «Комментарий» — написать комментарий к выделенным словам, «В набор» — положить их в набор.

import { useMemo, useState } from 'react';
import type { Note } from '../types';
import type { KbIndex } from '../lib/kb/index';
import type { KbFragment, KbPicked } from '../lib/kb/ui';
import { TYPE_BADGE } from '../lib/noteTypes';

const norm = (s: string) => s.trim().toLowerCase();

/** Заметки по запросу: сначала те, что начинаются с него, потом свежие. */
function search(index: KbIndex, q: string, only?: (n: Note) => boolean): Note[] {
  const want = norm(q);
  const all = [...index.byId.values()].filter((n) => (!only || only(n)) && n.type !== 'folder');
  const hits = want
    ? all.filter((n) => norm(n.title).includes(want) || (n.aliases ?? []).some((a) => norm(a).includes(want)))
    : all;
  const starts = (n: Note) => (norm(n.title).startsWith(want) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b) || b.updatedAt - a.updatedAt).slice(0, 40);
}

export function LinkPicker({
  index,
  fromId,
  onPick,
  onSelectWords,
  onClose,
}: {
  index: KbIndex;
  fromId?: string;
  onPick: (t: KbPicked) => void;
  /** «Выделить слова в этой заметке» — открыть её и ждать выделения. */
  onSelectWords: (noteId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const list = useMemo(() => search(index, q), [index, q]);
  const note = chosen ? index.byId.get(chosen) : undefined;
  const parsed = chosen ? index.parsed.get(chosen) : undefined;
  const exact = list.some((n) => norm(n.title) === norm(q));

  return (
    <div className="modal-overlay kb-dialog-overlay" onClick={onClose}>
      <div className="modal kb-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="field-label">🔗 Сослаться на…</span>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        {!note ? (
          <>
            <input
              className="input"
              autoFocus
              placeholder="Название заметки…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && list[0]) setChosen(list[0].id);
                if (e.key === 'Escape') onClose();
              }}
            />
            <ul className="kb-pick-list">
              {q.trim() && !exact && (
                <li>
                  <button className="kb-pick-item kb-pick-new" onClick={() => onPick({ id: '', title: q.trim() })}>
                    ＋ Ссылка на новую заметку «{q.trim()}»
                  </button>
                </li>
              )}
              {list.map((n) => (
                <li key={n.id}>
                  <button className="kb-pick-item" onClick={() => setChosen(n.id)}>
                    {n.type && n.type !== 'note' && <span className={`type-badge type-${n.type}`}>{TYPE_BADGE[n.type]}</span>}
                    {n.title || 'Без названия'}
                    {n.id === fromId && <span className="muted small"> · эта заметка</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <button className="kb-pick-back" onClick={() => setChosen(null)}>
              ‹ {note.title}
            </button>
            <ul className="kb-pick-list">
              <li>
                <button className="kb-pick-item" autoFocus onClick={() => onPick({ id: note.id, title: note.title })}>
                  📄 Вся заметка
                </button>
              </li>
              <li>
                <button className="kb-pick-item kb-pick-new" onClick={() => onSelectWords(note.id)}>
                  ✋ Выделить слова в ней…
                </button>
              </li>
              {parsed?.headings.map((h, i) => (
                <li key={`h${i}`}>
                  <button className="kb-pick-item" onClick={() => onPick({ id: note.id, title: note.title, heading: h.text })}>
                    <span className="muted">{'#'.repeat(h.level)}</span> {h.text}
                  </button>
                </li>
              ))}
              {[...(parsed?.anchors ?? [])].map(([a, pieces]) => (
                <li key={`a${a}`}>
                  <button className="kb-pick-item" onClick={() => onPick({ id: note.id, title: note.title, anchor: a })}>
                    <span className="muted small">⚓</span> {pieces.map((p) => p.text).join(' … ').slice(0, 120)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export function CommentComposer({
  frag,
  onSave,
  onClose,
}: {
  frag: KbFragment;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <div className="modal-overlay kb-dialog-overlay" onClick={onClose}>
      <div className="modal kb-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="field-label">💬 Комментарий</span>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <blockquote className="kb-quote">{frag.excerpt}</blockquote>
        <textarea
          className="input kb-comment-input"
          autoFocus
          rows={5}
          placeholder="Ваш комментарий… (Ctrl+Enter — сохранить)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) onSave(text.trim());
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="kb-dialog-foot">
          <button className="btn btn-small" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-small btn-primary" disabled={!text.trim()} onClick={() => onSave(text.trim())}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

export function SetPicker({
  index,
  frag,
  onAdd,
  onClose,
}: {
  index: KbIndex;
  frag: KbFragment;
  /** id набора или null — завести новый с таким названием. */
  onAdd: (setId: string | null, title: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const sets = useMemo(() => search(index, q, (n) => n.type === 'set'), [index, q]);
  return (
    <div className="modal-overlay kb-dialog-overlay" onClick={onClose}>
      <div className="modal kb-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="field-label">📚 В набор</span>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <blockquote className="kb-quote">{frag.excerpt}</blockquote>
        <input
          className="input"
          autoFocus
          placeholder="Найти набор или назвать новый…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
        <ul className="kb-pick-list">
          {q.trim() && !sets.some((n) => norm(n.title) === norm(q)) && (
            <li>
              <button className="kb-pick-item kb-pick-new" onClick={() => onAdd(null, q.trim())}>
                ＋ Новый набор «{q.trim()}»
              </button>
            </li>
          )}
          {sets.map((n) => (
            <li key={n.id}>
              <button className="kb-pick-item" onClick={() => onAdd(n.id, n.title)}>
                📚 {n.title}
              </button>
            </li>
          ))}
          {!q.trim() && !sets.length && <li className="muted small">Наборов пока нет — впишите название нового.</li>}
        </ul>
      </div>
    </div>
  );
}
