// База знаний в интерфейсе: указатель связей и переходы по ссылкам доступны любой
// карточке заметки через контекст (docs/ЗАМЕТКИ.md). Компонент «Ссылаются сюда» —
// src/components/Backlinks.tsx.

import { createContext, useContext, useMemo } from 'react';
import type { KbIndex, LinkRef } from './index';
import type { LinkTarget } from './edit';
import type { Note } from '../../types';

/** Куда перейти: по id или по названию из ссылки, к метке или заголовку. */
export interface KbTarget {
  id?: string;
  name?: string;
  anchor?: string;
  heading?: string;
}

/** Выделенные слова, которым уже поставлена метка, — для комментария и набора. */
export interface KbFragment {
  noteId: string;
  title: string;
  anchor: string;
  excerpt: string;
}

/** Цель ссылки, выбранная в окне «Сослаться». */
export interface KbPicked extends LinkTarget {
  id: string;
}

export interface KbApi {
  index: KbIndex;
  /** Открыть заметку поверх текущей. Нет такой — предложить создать (как в Obsidian). */
  open: (t: KbTarget) => void;
  /** Заметку переименовали: переписать ссылки на неё в других заметках. Звать ДО сохранения. */
  renamed: (id: string, oldTitle: string, newTitle: string) => void;
  /** Окно «Сослаться»: заметка, заголовок, готовый фрагмент или новые слова в другой заметке. */
  pickLink: (fromId?: string) => Promise<KbPicked | null>;
  /** Идёт выбор слов в другой заметке для ссылки — у чтения появляется кнопка «Сюда». */
  picking: boolean;
  /** Выбраны слова для ссылки: метка уже стоит и сохранена. */
  pickHere: (f: KbFragment) => void;
  /** Написать комментарий к фрагменту — заметку роли «комментарий». */
  comment: (f: KbFragment) => void;
  /** Добавить фрагмент в набор (новый или существующий). */
  addToSet: (f: KbFragment) => void;
  /** Переименовать или слить тег во всех заметках (с вопросом). Возвращает, сколько переписано. */
  renameTag: (oldTag: string, newTag: string) => number;
  /** Показать заметки с тегом — вкладка «Заметки», отбор по нему. */
  openTag: (tag: string) => void;
  /** Поправить и удалить заметку (комментарий на полях). */
  updateNote: (id: string, patch: Partial<Note>) => void;
  removeNote: (id: string) => void;
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
  const tag = el.closest<HTMLElement>('.kb-tag');
  if (tag) {
    e.stopPropagation();
    const name = tag.dataset.tag ?? tag.textContent?.replace(/^#/, '');
    if (kb && name) kb.openTag(name);
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


/** Видимый текст показанной заметки до точки (без встраиваний чужих кусков) — чтобы понять,
 *  какое по счёту вхождение выделенных слов имелось в виду (src/lib/kb/edit.ts, locateSelection). */
export function textBefore(root: HTMLElement, node: Node, offset: number): string {
  let out = '';
  const walk = (n: Node): boolean => {
    if (n === node && n.nodeType === Node.TEXT_NODE) {
      out += (n.textContent ?? '').slice(0, offset);
      return true;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent ?? '';
      return false;
    }
    if (!(n instanceof HTMLElement)) return false;
    if (n.classList.contains('kb-embed') || n.classList.contains('kb-cm-slot')) return n.contains(node);
    if (n.tagName === 'BR') out += '\n';
    if (/^(P|LI|H[1-6]|DIV|TR|TD|TH|BLOCKQUOTE|PRE)$/.test(n.tagName)) out += ' ';
    const kids = [...n.childNodes];
    if (n === node) {
      for (let i = 0; i < offset && i < kids.length; i++) walk(kids[i]);
      return true;
    }
    for (const k of kids) if (walk(k)) return true;
    return false;
  };
  walk(root);
  return out;
}

/** Комментарии к заметке (роль «комментарий», свойство `к`) — по порядку их мест в тексте. */
export function useCommentRefs(noteId: string | undefined): LinkRef[] {
  const kb = useKb();
  return useMemo(() => {
    if (!kb || !noteId) return [];
    const parsed = kb.index.parsed.get(noteId);
    // по порядку в тексте: так они и стоят на полях
    const pos = (r: LinkRef) =>
      r.anchor
        ? (parsed?.anchors.get(r.anchor.toLowerCase())?.[0]?.start ?? parsed?.anchors.get(r.anchor)?.[0]?.start ?? 0)
        : r.heading
          ? (parsed?.headings.find((h) => h.text.toLowerCase() === r.heading!.toLowerCase())?.start ?? 0)
          : -1;
    return (kb.index.incoming.get(noteId) ?? []).filter((r) => r.kind === 'comment').sort((a, b) => pos(a) - pos(b));
  }, [kb, noteId]);
}

