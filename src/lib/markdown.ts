import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

/** Тип коллаута -> иконка и заголовок по умолчанию (стиль Obsidian). */
const CALLOUTS: Record<string, { icon: string; title: string }> = {
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Рендер Markdown в безопасный HTML с поддержкой:
 *  - базового Markdown (GFM), переносов строк;
 *  - подчёркивания через <u>…</u> (как в Obsidian);
 *  - коллаутов Obsidian: `> [!type] Заголовок` + строки `> …`.
 */
export function renderMarkdown(src: string): string {
  const lines = (src ?? '').split('\n');
  const segments: string[] = [];
  let mdBuf: string[] = [];

  const flush = () => {
    if (mdBuf.length) {
      segments.push(marked.parse(mdBuf.join('\n')) as string);
      mdBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const head = lines[i].match(/^>\s*\[!(\w+)\][+-]?\s*(.*)$/);
    if (head) {
      flush();
      const type = head[1].toLowerCase();
      const meta = CALLOUTS[type] ?? { icon: '📌', title: type };
      const title = head[2].trim() || meta.title;
      const body: string[] = [];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const bodyHtml = body.length ? (marked.parse(body.join('\n')) as string) : '';
      segments.push(
        `<div class="callout callout-${escapeHtml(type)}">` +
          `<div class="callout-title">${meta.icon} ${escapeHtml(title)}</div>` +
          `<div class="callout-body">${bodyHtml}</div></div>`,
      );
    } else {
      mdBuf.push(lines[i]);
      i++;
    }
  }
  flush();

  return DOMPurify.sanitize(segments.join('\n'), {
    ADD_TAGS: ['u'],
    ADD_ATTR: ['class', 'target', 'rel'],
  });
}
