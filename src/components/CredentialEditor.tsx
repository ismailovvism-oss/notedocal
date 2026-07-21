import { useEffect, useState } from 'react';
import type { Note } from '../types';
import { useListActions } from '../lib/storage';
import { decryptStr, encryptStr, type Vault } from '../lib/vault';

/** Редактор пароля: секрет шифруется мастер-паролем перед сохранением. */
export function CredentialEditor({
  note,
  vault,
  setNotes,
  onClose,
}: {
  note: Note;
  vault: Vault;
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  onClose: () => void;
}) {
  const { update, remove } = useListActions(setNotes);
  const [service, setService] = useState(note.title === 'Без названия' ? '' : note.title);
  const [login, setLogin] = useState(note.login ?? '');
  const [url, setUrl] = useState(note.body ?? '');
  const [secret, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');

  // Расшифровать существующий секрет при открытии.
  useEffect(() => {
    let alive = true;
    if (note.secret && vault.key) {
      decryptStr(vault.key, note.secret)
        .then((s) => alive && setSecret(s))
        .catch(() => alive && setErr('Не удалось расшифровать'));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, vault.key]);

  async function save() {
    if (!vault.key) {
      setErr('Хранилище заблокировано');
      return;
    }
    const enc = secret ? await encryptStr(vault.key, secret) : '';
    update(note.id, {
      title: service.trim() || 'Без названия',
      login: login.trim(),
      body: url.trim(),
      secret: enc,
      updatedAt: Date.now(),
    });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="field-label">🔑 Пароль</span>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <input
          className="input modal-title"
          placeholder="Сервис (напр. Gmail)"
          value={service}
          onChange={(e) => setService(e.target.value)}
        />
        <label className="field">
          <span className="field-label">Логин</span>
          <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Пароль</span>
          <div className="cred-secret">
            <input
              className="input"
              type={show ? 'text' : 'password'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <button className="btn btn-small" onClick={() => setShow((v) => !v)}>
              {show ? 'Скрыть' : 'Показать'}
            </button>
          </div>
        </label>
        <label className="field">
          <span className="field-label">Ссылка / заметка</span>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>

        {err && <p className="rel-error small">{err}</p>}

        <div className="modal-foot modal-foot-split">
          <button
            className="btn cl-danger"
            onClick={() => {
              remove(note.id);
              onClose();
            }}
          >
            Удалить
          </button>
          <button className="btn btn-primary" onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
