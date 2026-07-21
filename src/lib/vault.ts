// Сквозное (E2E) шифрование секретов мастер-паролем.
//
// Пароль пользователя никогда не покидает устройство. Из него через PBKDF2
// выводится AES-GCM ключ; им шифруются секреты (пароли). В облако уходит только
// шифртекст. Ключ живёт в памяти сессии; при перезагрузке нужно разблокировать.
//
// Соль и «верификатор» (зашифрованная константа для проверки пароля) хранятся в
// служебной заметке VAULT_META_ID и синхронизируются, чтобы разблокировать
// хранилище на другом устройстве тем же мастер-паролем.

import { useMemo, useState } from 'react';
import type { Note } from '../types';
import { useListActions } from './storage';

export const VAULT_META_ID = 'vault-meta';
const CHECK = 'ndc-vault-ok';

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptStr(key: CryptoKey, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return toB64(out.buffer);
}

export async function decryptStr(key: CryptoKey, blob: string): Promise<string> {
  const data = fromB64(blob);
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}

export type VaultStatus = 'unset' | 'locked' | 'unlocked';

export interface Vault {
  status: VaultStatus;
  key: CryptoKey | null;
  /** Задать мастер-пароль впервые. */
  setup: (password: string) => Promise<void>;
  /** Разблокировать существующее хранилище. Возвращает успех. */
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
}

/** Хранилище секретов: ключ в памяти, соль+верификатор — в синхронизируемой заметке. */
export function useVault(notes: Note[], setNotes: React.Dispatch<React.SetStateAction<Note[]>>): Vault {
  const { add, update } = useListActions(setNotes);
  const [key, setKey] = useState<CryptoKey | null>(null);

  const meta = useMemo(() => {
    const n = notes.find((x) => x.id === VAULT_META_ID && !x.deleted);
    if (!n?.body) return null;
    try {
      return JSON.parse(n.body) as { salt: string; verifier: string };
    } catch {
      return null;
    }
  }, [notes]);

  const status: VaultStatus = !meta ? 'unset' : key ? 'unlocked' : 'locked';

  async function setup(password: string) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k = await deriveKey(password, salt);
    const verifier = await encryptStr(k, CHECK);
    const body = JSON.stringify({ salt: toB64(salt.buffer), verifier });
    const now = Date.now();
    if (notes.some((n) => n.id === VAULT_META_ID)) {
      update(VAULT_META_ID, { body, updatedAt: now });
    } else {
      add({ id: VAULT_META_ID, title: '🔒 Хранилище', body, type: 'note', date: null, createdAt: now, updatedAt: now });
    }
    setKey(k);
  }

  async function unlock(password: string): Promise<boolean> {
    if (!meta) return false;
    try {
      const k = await deriveKey(password, fromB64(meta.salt));
      if ((await decryptStr(k, meta.verifier)) === CHECK) {
        setKey(k);
        return true;
      }
    } catch {
      /* неверный пароль */
    }
    return false;
  }

  function lock() {
    setKey(null);
  }

  return { status, key, setup, unlock, lock };
}
