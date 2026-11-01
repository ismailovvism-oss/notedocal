// База знаний в интерфейсе: указатель связей и переходы по ссылкам доступны любой
// карточке заметки через контекст (docs/ЗАМЕТКИ.md). Компонент «Ссылаются сюда» —
// src/components/Backlinks.tsx.

import { createContext, useContext } from 'react';
import type { KbIndex } from './index';

/** Куда перейти: по id или по названию из ссылки, к метке или заголовку. */
export interface KbTarget {
  id?: string;
  name?: string;
  anchor?: string;
  heading?: string;
}

export interface KbApi {
  index: KbIndex;
  /** Открыть заметку поверх текущей. Нет такой — предложить создать (как в Obsidian). */
  open: (t: KbTarget) => void;
  /** Заметку переименовали: переписать ссылки на неё в других заметках. Звать ДО сохранения. */
  renamed: (id: string, oldTitle: string, newTitle: string) => void;
}

export const KbContext = createContext<KbApi | null>(null);
export const useKb = () => useContext(KbContext);

/** Щелчок по ссылке, тегу или фрагменту в показанном тексте. true — обработан (не открывать правку). */
export function handleKbClick(
  e: React.MouseEvent,
  kb: KbApi | null,
  noteId: string | undefined,
  onFragment?: (anchor: string) => void,
): boolean {
  const el = e.target as HTMLElement;
  const link = el.closest<HTMLElement>('a.kb-link');
  if (link) {
    e.preventDefault();
    e.stopPropagation();
    const { target, anchor, heading } = link.dataset;
    if (kb) kb.open(target ? { name: target, anchor, heading } : { id: noteId, anchor, heading });
    return true;
  }
  const frag = el.closest<HTMLElement>('.kb-a, .kb-blk');
  if (frag && onFragment) {
    e.stopPropagation();
    onFragment(frag.dataset.a ?? frag.dataset.blk ?? '');
    return true;
  }
  if (el.closest('.kb-tag')) {
    e.stopPropagation(); // поиск по тегу — этап 3 (docs/ЗАМЕТКИ.md, раздел 7)
    return true;
  }
  return false;
}

/** Наведение на кусок фрагмента подсвечивает все его куски — фрагмент может быть разбросан. */
export function handleKbHover(e: React.MouseEvent, on: boolean) {
  const frag = (e.target as HTMLElement).closest<HTMLElement>('.kb-a');
  const root = e.currentTarget as HTMLElement;
  root.querySelectorAll('.kb-lit').forEach((x) => x.classList.remove('kb-lit'));
  if (on && frag?.dataset.a) {
    root.querySelectorAll(`.kb-a[data-a="${CSS.escape(frag.dataset.a)}"]`).forEach((x) => x.classList.add('kb-lit'));
  }
}

/** Показать фрагмент, к которому перешли: прокрутить и мигнуть всеми кусками. */
export function focusFragment(root: HTMLElement | null, sel: { anchor?: string; heading?: string }) {
  if (!root) return;
  let els: HTMLElement[] = [];
  if (sel.anchor) {
    const a = CSS.escape(sel.anchor);
    els = [...root.querySelectorAll<HTMLElement>(`.kb-a[data-a="${a}" i], .kb-blk[data-blk="${a}" i]`)].map((x) =>
      x.classList.contains('kb-blk') ? (x.closest<HTMLElement>('p, li, blockquote') ?? x) : x,
    );
  } else if (sel.heading) {
    const want = sel.heading.trim().toLowerCase();
    const h = [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].find(
      (x) => x.textContent?.trim().toLowerCase() === want,
    );
    if (h) els = [h];
  }
  if (!els.length) return;
  els[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  for (const x of els) {
    x.classList.remove('kb-flash');
    void x.offsetWidth; // перезапуск анимации
    x.classList.add('kb-flash');
  }
}

