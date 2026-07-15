import { useState } from 'react';
import type { Attachment } from '../types';
import { attachmentsReady, fileIcon, formatSize, uploadAttachment } from '../lib/attachments';

/** Список вложений: ссылки на скачивание (+ удаление, если задан onRemove). */
export function AttachmentList({
  items,
  onRemove,
}: {
  items?: Attachment[];
  onRemove?: (a: Attachment) => void;
}) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="att-list">
      {items.map((a) => (
        <li key={a.id} className="att-item">
          <a className="att-link" href={a.url} target="_blank" rel="noreferrer" title={a.name}>
            <span className="att-ic">{fileIcon(a.type)}</span>
            <span className="att-name">{a.name}</span>
            <span className="att-size muted small">{formatSize(a.size)}</span>
          </a>
          {onRemove && (
            <button className="icon-btn" onClick={() => onRemove(a)} aria-label="Удалить файл">
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Кнопка загрузки файлов в Firebase Storage. */
export function AttachmentAdder({ onAdd }: { onAdd: (added: Attachment[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setErr('');
    setBusy(true);
    try {
      const added: Attachment[] = [];
      for (const f of files) added.push(await uploadAttachment(f));
      onAdd(added);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Не удалось загрузить файл');
    } finally {
      setBusy(false);
    }
  }

  if (!attachmentsReady()) {
    return <p className="muted small att-hint">Войдите в аккаунт, чтобы прикреплять файлы.</p>;
  }
  return (
    <div className="att-add">
      <label className="btn btn-small att-btn">
        {busy ? 'Загрузка…' : '📎 Прикрепить файл'}
        <input type="file" multiple hidden onChange={pick} disabled={busy} />
      </label>
      {err && <span className="rel-error small">{err}</span>}
    </div>
  );
}
