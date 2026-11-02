// Действия над выделенными словами — общие для редактора и для чтения (docs/ЗАМЕТКИ.md, 3.1):
// ⚓ метка, 🔗 сослаться, 💬 комментарий, 📚 в набор, ✕ снять метку.
// На входе текст заметки и выделенные куски в нём, на выходе — новый текст (или null, если
// ничего не поменялось). Заметки-комментарии и наборы создаёт приложение через KbApi.

import { addAnchor, anchorsAt, excerpt, removeAnchor, replaceWithLink, type Span } from './edit.ts';
import type { KbApi } from './ui.ts';

export type FragmentAction = 'anchor' | 'link' | 'comment' | 'set' | 'unanchor';

export interface FragmentNote {
  id?: string;
  title: string;
}

/** Выполнить действие. Бросает Error с понятным текстом, если сделать нельзя. */
export async function runFragmentAction(
  action: FragmentAction,
  body: string,
  spans: Span[],
  note: FragmentNote,
  kb: KbApi | null,
): Promise<string | null> {
  if (action === 'unanchor') {
    const names = spans.flatMap((s) => anchorsAt(body, s.from));
    if (!names.length) throw new Error('Здесь нет метки');
    return removeAnchor(body, names[names.length - 1]);
  }
  if (action === 'link') {
    if (!kb) return null;
    if (spans.length !== 1) throw new Error('Сослаться можно с одного куска');
    const target = await kb.pickLink(note.id);
    if (!target) return null;
    const same = !!note.id && target.id === note.id;
    return replaceWithLink(body, spans[0], target, same).text;
  }
  const r = addAnchor(body, spans);
  if (action === 'anchor') return r.existed ? null : r.text;
  if (!kb || !note.id) throw new Error('Сначала сохраните заметку');
  const frag = { noteId: note.id, title: note.title, anchor: r.name, excerpt: excerpt(body, spans) };
  // окно комментария или набора откроется поверх; текст с меткой вызывающий сохраняет сразу
  queueMicrotask(() => (action === 'comment' ? kb.comment(frag) : kb.addToSet(frag)));
  return r.existed ? null : r.text;
}

export const ACTION_LABELS: Record<FragmentAction, { icon: string; label: string; hint: string }> = {
  anchor: { icon: '⚓', label: 'Метка', hint: 'Поставить метку: на эти слова можно будет сослаться' },
  link: { icon: '🔗', label: 'Сослаться', hint: 'Сделать эти слова ссылкой на заметку или её фрагмент' },
  comment: { icon: '💬', label: 'Комментарий', hint: 'Прокомментировать эти слова' },
  set: { icon: '📚', label: 'В набор', hint: 'Добавить эти слова в набор (сборку из кусков разных заметок)' },
  unanchor: { icon: '✕', label: 'Снять метку', hint: 'Убрать метку с этих слов (ссылки на неё станут пустыми)' },
};
