// Вложение заметки во вкладке окна «База»: PDF — встроенным просмотрщиком браузера (в окне Qt
// включён: baza.py, PdfViewerEnabled), картинка — как есть, текст и markdown — текстом.
// Файлы лежат в хранилище notedocal; ссылка с ключом доступа, входить не нужно.

import { useEffect, useState } from 'react';
import type { Attachment, Note } from '../types';
import { renderMarkdown } from '../lib/markdown';

export const fileIcon = (a: Attachment) =>
  a.type === 'application/pdf' ? '📕' : a.type.startsWith('image/') ? '🖼' : a.type.startsWith('audio/') ? '🎧' : a.type.startsWith('text/') ? '📄' : '📎';

const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1e3))} КБ`);

export function FileView({ note, file, onBack }: { note: Note; file: Attachment; onBack: () => void }) {
  const isText = file.type.startsWith('text/') || /\.(md|txt)$/i.test(file.name);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!isText) return;
    let alive = true;
    fetch(file.url)
      .then((r) => r.text())
      .then((t) => alive && setText(t))
      .catch(() => alive && setText('Не загрузилось.'));
    return () => {
      alive = false;
    };
  }, [file.url, isText]);
  return (
    <div className="dk-file">
      <div className="dk-file-head">
        <button className="dk-icon" title="К заметке" onClick={onBack}>
          ‹
        </button>
        <span className="dk-file-name" dir="auto">
          {fileIcon(file)} {file.name}
        </span>
        <span className="muted small">
          {size(file.size)} · из «{note.title || 'Без названия'}»
        </span>
        <span className="dk-spacer" />
        <a className="dk-icon" href={file.url} download={file.name} title="Скачать">
          ⤓
        </a>
      </div>
      {file.type === 'application/pdf' ? (
        <iframe className="dk-file-body" src={file.url} title={file.name} />
      ) : file.type.startsWith('image/') ? (
        <div className="dk-file-body dk-file-img">
          <img src={file.url} alt={file.name} />
        </div>
      ) : file.type.startsWith('audio/') ? (
        <div className="dk-file-body dk-file-pad">
          <audio controls src={file.url} />
        </div>
      ) : isText ? (
        <div className="dk-file-body dk-file-pad md" dir="auto" dangerouslySetInnerHTML={{ __html: renderMarkdown(text ?? 'Загружаю…') }} />
      ) : (
        <div className="dk-file-body dk-file-pad muted">
          Для этого вида файла просмотра нет — его можно скачать кнопкой ⤓ справа вверху.
        </div>
      )}
    </div>
  );
}
