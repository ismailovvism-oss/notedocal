import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { prepareMarkdown, type RenderCtx } from './kb/render';
import { calloutMeta } from './kb/callouts';

marked.setOptions({ gfm: true, breaks: true });

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
export function renderMarkdown(src: string, kb?: RenderCtx): string {
  // Разметка базы знаний (ссылки, теги, метки, встраивания) — src/lib/kb/render.ts.
  // Без kb ссылки тоже рисуются, но без проверки, есть ли цель, и без встраиваний.
  const { markdown, embeds } = prepareMarkdown(src ?? '', kb, renderMarkdown);
  const lines = markdown.split('\n');
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
      const meta = calloutMeta(type);
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

  let html = segments.join('\n');
  // встраивание стоит отдельным абзацем — заменяем абзац целиком, иначе <div> внутри <p>
  for (const [token, embed] of embeds) {
    html = html.replace(`<p>${token}</p>`, embed).replace(token, embed);
  }
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['u', 'mark'],
    ADD_ATTR: ['class', 'target', 'rel'],
  });
}
