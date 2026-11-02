// Кнопки над выделенными словами — те же в правке (LiveEditor) и в чтении (NoteModal).
// Отдельно от редактора: чтение не должно тянуть за собой CodeMirror.

import { ACTION_LABELS, type FragmentAction } from '../lib/kb/fragmentActions';

/** Кнопки над выделением — те же в правке и в чтении. */
export function FragmentButtons({
  onAction,
  pieces,
  canNoteActions,
  inAnchor,
  format,
  picking,
  onPickHere,
}: {
  onAction: (a: FragmentAction | 'piece') => void;
  pieces: number;
  canNoteActions: boolean;
  inAnchor: boolean;
  format?: (f: [string, string?]) => void;
  picking?: boolean;
  onPickHere?: () => void;
}) {
  const btn = (a: FragmentAction) => (
    <button key={a} className="fb-btn" title={ACTION_LABELS[a].hint} onClick={() => onAction(a)}>
      <span aria-hidden>{ACTION_LABELS[a].icon}</span> <span className="fb-label">{ACTION_LABELS[a].label}</span>
    </button>
  );
  return (
    <div className="fb-row">
      {picking && onPickHere && (
        <button className="fb-btn fb-primary" onClick={onPickHere} title="Сослаться сюда — на выделенные слова">
          🎯 Сюда
        </button>
      )}
      {format && (
        <>
          <button className="fb-btn fb-fmt" title="Жирный (Ctrl+B)" onClick={() => format(['**'])}>
            <b>Ж</b>
          </button>
          <button className="fb-btn fb-fmt" title="Курсив (Ctrl+I)" onClick={() => format(['*'])}>
            <i>К</i>
          </button>
          <button className="fb-btn fb-fmt" title="Выделить маркером" onClick={() => format(['=='])}>
            <mark>М</mark>
          </button>
          <span className="fb-sep" />
        </>
      )}
      {btn('anchor')}
      {btn('link')}
      {canNoteActions && btn('comment')}
      {canNoteActions && btn('set')}
      <button className="fb-btn" title="Отложить этот кусок и выделить следующий: метка ляжет на все куски сразу" onClick={() => onAction('piece')}>
        ＋ <span className="fb-label">Кусок{pieces ? ` (${pieces})` : ''}</span>
      </button>
      {inAnchor && btn('unanchor')}
    </div>
  );
}
