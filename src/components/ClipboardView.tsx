import { useMemo, useState } from 'react';
import type { ClipItem } from '../types';
import { uid, useListActions } from '../lib/storage';
import { fromKey } from '../lib/dates';
import {
  attachmentsReady,
  deleteAttachment,
  fileIcon,
  formatSize,
  uploadAttachment,
} from '../lib/attachments';

interface Props {
  clipboard: ClipItem[];
  setClipboard: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  signedIn: boolean;
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} ч`;
  return fromKey(new Date(ts).toISOString().slice(0, 10)).toLocaleDateString('ru-RU');
}

export function ClipboardView({ clipboard, setClipboard, signedIn }: Props) {
  const { add, remove } = useListActions(setClipboard);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const items = useMemo(
    () => clipboard.filter((c) => !c.deleted).sort((a, b) => b.createdAt - a.createdAt),
    [clipboard],
  );
  const canFiles = attachmentsReady();

  function sendText() {
    const t = text.trim();
    if (!t) return;
    const now = Date.now();
    add({ id: uid(), kind: 'text', text: t, createdAt: now, updatedAt: now });
    setText('');
  }

  async function sendFiles(files: File[]) {
    if (files.length === 0) return;
    setErr('');
    setBusy(true);
    try {
      for (const f of files) {
        const att = await uploadAttachment(f);
        const now = Date.now();
        add({ id: uid(), kind: 'file', attachment: att, createdAt: now, updatedAt: now });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить файл');
    } finally {
      setBusy(false);
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length && canFiles) {
      e.preventDefault();
      sendFiles(files);
    }
  }

  function copyItem(c: ClipItem) {
    navigator.clipboard?.writeText(c.text ?? '').then(() => {
      setCopied(c.id);
      setTimeout(() => setCopied((v) => (v === c.id ? null : v)), 1500);
    });
  }

  function removeItem(c: ClipItem) {
    if (c.attachment) deleteAttachment(c.attachment);
    remove(c.id);
  }

  return (
    <section className="view view-narrow">
      <div className="view-head">
        <h2>Буфер</h2>
        <span className="muted small">между устройствами</span>
      </div>

      {!signedIn && (
        <p className="cb-hint muted small">
          Войдите через Google, чтобы буфер синхронизировался между телефоном и компьютером.
        </p>
      )}

      <div className="cb-compose">
        <textarea
          className="input"
          rows={3}
          placeholder="Вставьте или введите текст… (можно вставить и файл/скриншот)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
        />
        <div className="cb-actions">
          <button className="btn btn-primary btn-small" onClick={sendText} disabled={!text.trim()}>
            Отправить текст
          </button>
          {canFiles ? (
            <label className="btn btn-small cb-file">
              {busy ? 'Загрузка…' : '📎 Файл'}
              <input
                type="file"
                multiple
                hidden
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  sendFiles(files);
                }}
              />
            </label>
          ) : (
            <span className="muted small">файлы — после входа</span>
          )}
        </div>
        {err && <span className="rel-error small">{err}</span>}
      </div>

      {items.length === 0 ? (
        <p className="empty">Буфер пуст</p>
      ) : (
        <ul className="cb-list">
          {items.map((c) => (
            <li key={c.id} className="cb-item">
              {c.kind === 'text' ? (
                <>
                  <pre className="cb-text">{c.text}</pre>
                  <div className="cb-item-foot">
                    <span className="muted small">{relTime(c.createdAt)}</span>
                    <button className="btn btn-small" onClick={() => copyItem(c)}>
                      {copied === c.id ? 'Скопировано' : 'Копировать'}
                    </button>
                    <button className="icon-btn" onClick={() => removeItem(c)} aria-label="Удалить">
                      ✕
                    </button>
                  </div>
                </>
              ) : (
                <div className="cb-item-foot">
                  <a
                    className="att-link cb-file-link"
                    href={c.attachment?.url}
                    target="_blank"
                    rel="noreferrer"
                    download
                  >
                    <span className="att-ic">{fileIcon(c.attachment?.type ?? '')}</span>
                    <span className="att-name">{c.attachment?.name}</span>
                    <span className="att-size muted small">{formatSize(c.attachment?.size ?? 0)}</span>
                  </a>
                  <span className="muted small">{relTime(c.createdAt)}</span>
                  <button className="icon-btn" onClick={() => removeItem(c)} aria-label="Удалить">
                    ✕
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
