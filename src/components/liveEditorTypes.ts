// Типы поля правки «как видишь» — отдельно, чтобы код с ним грузился только при правке
// (src/components/LiveEditor.tsx грузится лениво через LazyLiveEditor.tsx).

import type { KeyBinding } from '@codemirror/view';

/** Что карточка может сделать с полем правки: кнопки оформления над ним. */
export interface LiveEditorHandle {
  /** Обернуть выделение значками (жирный, курсив…); уже обёрнуто — снять. */
  wrap: (open: string, close?: string) => void;
  /** Поставить значок в начало строки (заголовок, список, цитата). */
  prefixLine: (prefix: string) => void;
  /** Заменить выделение тем, что вернёт fn. */
  replaceSelection: (fn: (selected: string) => string) => void;
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
}
