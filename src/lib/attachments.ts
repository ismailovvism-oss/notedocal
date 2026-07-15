// Загрузка и удаление файлов-вложений через Firebase Storage.
//
// Файл кладётся в users/{uid}/files/{id}-{имя}. В самой заметке/задаче
// хранится только метаинформация (Attachment) со ссылкой на скачивание —
// поэтому лимит документа Firestore (1 МБ) не расходуется на байты файла.

import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from './firebase';
import { uid } from './storage';
import type { Attachment } from '../types';

/** Доступна ли загрузка файлов прямо сейчас (Storage готов и есть вход). */
export function attachmentsReady(): boolean {
  return !!storage && !!auth?.currentUser;
}

/** Человекочитаемый размер файла. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Иконка по типу файла. */
export function fileIcon(type: string): string {
  if (type.startsWith('image/')) return '🖼';
  if (type === 'application/pdf') return '📕';
  if (type.startsWith('audio/')) return '🎵';
  if (type.startsWith('video/')) return '🎬';
  if (type.includes('zip') || type.includes('rar') || type.includes('compressed')) return '🗜';
  return '📎';
}

/** Загрузить файл и вернуть метаданные вложения. */
export async function uploadAttachment(file: File): Promise<Attachment> {
  if (!storage) throw new Error('Хранилище не настроено');
  const user = auth?.currentUser;
  if (!user) throw new Error('Войдите, чтобы прикреплять файлы');

  const id = uid();
  // Безопасное имя в пути; отображаемое имя сохраняем отдельно.
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `users/${user.uid}/files/${id}-${safe}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type || 'application/octet-stream' });
  const url = await getDownloadURL(r);
  return {
    id,
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    url,
    path,
    createdAt: Date.now(),
  };
}

/** Удалить файл из Storage. Ошибки глушим — метаданные уберём в любом случае. */
export async function deleteAttachment(att: Attachment): Promise<void> {
  if (!storage || !att.path) return;
  try {
    await deleteObject(ref(storage, att.path));
  } catch {
    /* файла уже нет или нет прав — не мешаем убрать ссылку из записи */
  }
}
