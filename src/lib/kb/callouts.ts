// Выноски (коллауты) Obsidian: `> [!type] Заголовок` + строки `> …`. Вид — общий для чтения
// (src/lib/markdown.ts) и редактора «как видишь» (./livePreview.ts).

/** Тип выноски → иконка и заголовок по умолчанию (как в Obsidian). */
export const CALLOUTS: Record<string, { icon: string; title: string }> = {
  note: { icon: '📝', title: 'Заметка' },
  info: { icon: 'ℹ️', title: 'Инфо' },
  tip: { icon: '💡', title: 'Совет' },
  hint: { icon: '💡', title: 'Совет' },
  important: { icon: '❗', title: 'Важно' },
  success: { icon: '✅', title: 'Готово' },
  check: { icon: '✅', title: 'Готово' },
  question: { icon: '❓', title: 'Вопрос' },
  help: { icon: '❓', title: 'Вопрос' },
  warning: { icon: '⚠️', title: 'Внимание' },
  caution: { icon: '⚠️', title: 'Внимание' },
  danger: { icon: '🔥', title: 'Опасно' },
  error: { icon: '🛑', title: 'Ошибка' },
  bug: { icon: '🐞', title: 'Баг' },
  example: { icon: '📌', title: 'Пример' },
  quote: { icon: '❝', title: 'Цитата' },
};

export const calloutMeta = (type: string) => CALLOUTS[type.toLowerCase()] ?? { icon: '📌', title: type };
