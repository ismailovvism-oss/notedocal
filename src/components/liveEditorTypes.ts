// Типы поля правки «как видишь» — отдельно, чтобы код с ним грузился только при правке
// (src/components/LiveEditor.tsx грузится лениво через LazyLiveEditor.tsx).

import type { KeyBinding } from '@codemirror/view';
import type { FragmentAction } from '../lib/kb/fragmentActions';

/** Что карточка может сделать с полем правки: кнопки оформления над ним. */
export interface LiveEditorHandle {
  /** Обернуть выделение значками (жирный, курсив…); уже обёрнуто — снять. */
  wrap: (open: string, close?: string) => void;
  /** Поставить значок в начало строки (заголовок, список, цитата). */
  prefixLine: (prefix: string) => void;
  /** Заменить выделение тем, что вернёт fn. */
  replaceSelection: (fn: (selected: string) => string) => void;
  /** Вставить на место курсора (после выделенного), не трогая выделенное. */
  insertAtCursor: (text: string) => void;
  /** Заменить первое вхождение строки; false — её в тексте нет. */
  replaceText: (find: string, replace: string) => boolean;
  /** Текст вокруг строки: знак перед ней и после (для пробелов при вставке). */
  around: (find: string) => { before: string; after: string } | null;
  /** Действие над выделенными словами (метка, ссылка, комментарий, набор, кусок) — как с панели
   *  над выделением; для панели инструментов окна «База». */
  run: (action: FragmentAction | 'piece') => void;
  /** Вставить `[[` у курсора и открыть подсказку названий. */
  startLink: () => void;
  /** Выделенный текст (пусто — ничего не выделено). */
  selected: () => string;
  /** Замечание к абзацу под курсором (src/lib/kb/remarks.ts): нет — завести `{>>|<<}` после
   *  абзаца, есть — выделить его текст. */
  remark: (pos?: number) => void;
  /** Место в тексте, где начинается этот элемент редактора (строка под мышью); null — не из него. */
  posAtDOM: (el: HTMLElement) => number | null;
  /** Применить правку текста (одну или несколько — места по тексту до правки); cursor — куда
   *  поставить курсор. */
  apply: (change: { from: number; to: number; insert: string } | { from: number; to: number; insert: string }[], cursor?: number) => void;
  /** Где курсор. */
  cursor: () => number;
  focus: () => void;
  /** Поиск по тексту (src/lib/kb/find.ts): подсветить совпадения; i — текущее с 1, n — всего. */
  find: (query: string, cased: boolean) => { i: number; n: number };
  findStep: (dir: 1 | -1) => { i: number; n: number };
  replaceOne: (text: string) => { i: number; n: number };
  replaceAll: (text: string) => number;
  findClear: () => void;
  /** Курсор на место и показать его. */
  goto: (pos: number) => void;
  /** Текст сейчас (с несохранённым). */
  text: () => string;
}

export interface LiveEditorProps {
  value: string;
  onChange: (v: string) => void;
  /** Заметка, которую правим: для счётчиков меток и действий над словами. Новая — без id. */
  noteId?: string;
  noteTitle?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Куда поставить курсор при открытии (по умолчанию — в конец). */
  cursorAt?: number;
  /** Свои клавиши поверх обычных (Enter — сохранить в поле быстрых заметок и т.п.). */
  keys?: KeyBinding[];
  /** Сохранить текст сразу — комментарий и набор ссылаются на метку, она должна быть в базе. */
  onCommit?: (v: string) => void;
  /** Показывать панель действий над выделенными словами. */
  actions?: boolean;
  /** Кнопка «🎤 Диктовать» (в окне «База» на компьютере диктует само окно — её нет). */
  voice?: boolean;
  className?: string;
  handle?: React.MutableRefObject<LiveEditorHandle | null>;
  /** Режим Хемингуэя: стирать написанное нельзя (src/lib/kb/hemingway.ts). */
  hemingway?: boolean;
  /** Правка приостановлена: только читать (вычитка — Claude сейчас правит этот файл). */
  locked?: boolean;
  /** Окно «База»: замечания ездят с абзацем при вырезании, а у удалённого абзаца — уходят в общие. */
  review?: boolean;
}
