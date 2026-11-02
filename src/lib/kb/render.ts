// Подготовка markdown заметки к показу: разметка Obsidian и свои метки → HTML-вставки,
// которые потом понимает marked (docs/ЗАМЕТКИ.md, 3.1 «Как это видно»).
//
// - [[ссылка]] → <a class="kb-link" data-target …>; нет такой заметки — kb-missing;
// - ![[встраивание]] → кусок цели на месте (до двух уровней вложенности);
// - #тег → <span class="kb-tag">; ==выделение== → <mark>; %%скрытое%% — убирается;
// - ` ^метка` абзаца → невидимая точка привязки со счётчиком;
// - <span data-a> на словах → класс kb-a, счётчики ссылок (data-n) и комментариев (data-c).
// Код (``` и `…`) не трогается. Результат — markdown, его рисует renderMarkdown.

import type { KbIndex } from './index.ts';
import { anchorCounts, fragmentOf, resolveName } from './index.ts';
import { findLinks, maskInert, splitLinkInner } from './syntax.ts';

export interface RenderCtx {
  index: KbIndex;
  /** Заметка, которую показываем: для её меток считаются счётчики, `[[#^x]]` ведёт в неё. */
  noteId?: string;
  /** Глубина встраивания: дальше 2 не встраиваем, чтобы не уйти в цикл. */
  depth?: number;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TAG = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_-][\p{L}\p{N}_/-]*)/gu;
const BLOCK_ID = /(^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/gm;
const SPAN_OPEN = /<span\b([^>]*)\bdata-a\s*=\s*"([A-Za-z0-9-]+)"([^>]*)>/gi;
const HIGHLIGHT = /==([^=\n](?:[^\n]*?[^=\n])?)==/g;

interface Repl {
  start: number;
  end: number;
  html: string;
}

/** Встраивания вставляются после marked: внутри markdown блок <div> сломал бы абзац. */
export interface Prepared {
  markdown: string;
  /** Заглушка в тексте → HTML встраивания. */
  embeds: Map<string, string>;
}

export function prepareMarkdown(
  src: string,
  ctx: RenderCtx | undefined,
  renderInner: (md: string, ctx: RenderCtx) => string,
): Prepared {
  const codeOnly = maskInert(src, { comments: false });
  const masked = maskInert(src);
  const repl: Repl[] = [];
  const embeds = new Map<string, string>();

  // %%скрытое%% — убрать (только вне кода); метка диктовки %%🎤:id%% — видна: туда встанет текст
  for (let i = codeOnly.indexOf('%%'); i >= 0; ) {
    const j = codeOnly.indexOf('%%', i + 2);
    const end = j < 0 ? src.length : j + 2;
    const voice = /^%%🎤:[a-z0-9]+%%$/.test(src.slice(i, end));
    repl.push({ start: i, end, html: voice ? '<span class="kb-voice" title="Сюда встанет надиктованное">🎤 распознаётся…</span>' : '' });
    i = j < 0 ? -1 : codeOnly.indexOf('%%', end);
  }

  const counts = ctx?.noteId ? anchorCounts(ctx.index, ctx.noteId) : new Map();
  const countAttrs = (name: string) => {
    const c = counts.get(name.toLowerCase());
    return c ? `${c.links ? ` data-n="${c.links}"` : ''}${c.comments ? ` data-c="${c.comments}"` : ''}` : '';
  };

  for (const l of findLinks(src, masked)) {
    const p = splitLinkInner(src.slice(l.start + (l.embed ? 3 : 2), l.end - 2));
    const found = !p.target ? ctx?.noteId ?? null : ctx ? resolveName(ctx.index, p.target).note?.id ?? null : null;
    const missing = ctx && p.target && !found;
    const attrs =
      ` data-target="${esc(p.target)}"` +
      (p.anchor ? ` data-anchor="${esc(p.anchor)}"` : '') +
      (p.heading ? ` data-heading="${esc(p.heading)}"` : '');
    const depth = ctx?.depth ?? 0;
    if (l.embed && ctx && found && depth < 2) {
      const piece = fragmentOf(ctx.index, found, p);
      const title = ctx.index.byId.get(found)?.title ?? p.target;
      const token = `KBEMBED${embeds.size}X`;
      embeds.set(
        token,
        `<div class="kb-embed"><a class="kb-link kb-embed-head" href="#"${attrs}>↳ ${esc(title)}${p.heading ? ` › ${esc(p.heading)}` : ''}</a>` +
          (piece === null
            ? '<div class="kb-embed-gone">фрагмент удалён</div>'
            : `<div class="kb-embed-body">${renderInner(piece, { index: ctx.index, noteId: found, depth: depth + 1 })}</div>`) +
          '</div>',
      );
      repl.push({ start: l.start, end: l.end, html: token });
      continue;
    }
    const label = p.alias ?? (p.heading ? `${p.target || ''} › ${p.heading}` : p.target || (p.anchor ? '↪ фрагмент' : ''));
    repl.push({
      start: l.start,
      end: l.end,
      html: `<a class="kb-link${missing ? ' kb-missing' : ''}${l.embed ? ' kb-embed-link' : ''}" href="#"${attrs}>${esc(label)}</a>`,
    });
  }

  // теги: не в заголовке `# …`, не внутри ссылки и HTML
  const forTags = masked
    .replace(/^#{1,6}[ \t]/gm, (s) => ' '.repeat(s.length))
    .replace(/!?\[\[[^[\]\n]+?\]\]/g, (s) => ' '.repeat(s.length))
    .replace(/<[^>\n]*>|\]\([^)\n]*\)/g, (s) => ' '.repeat(s.length));
  for (const m of forTags.matchAll(TAG)) {
    const start = m.index! + m[1].length;
    const tag = m[2].replace(/\/+$/, '');
    repl.push({ start, end: start + 1 + tag.length, html: `<span class="kb-tag" data-tag="${esc(tag)}">#${esc(tag)}</span>` });
  }

  for (const m of masked.matchAll(BLOCK_ID)) {
    const start = m.index! + m[1].length;
    repl.push({
      start,
      end: m.index! + m[0].length,
      html: `<span class="kb-blk" data-blk="${m[2]}" id="kb-a-${m[2]}"${countAttrs(m[2])}></span>`,
    });
  }

  // метки на словах: счётчик — только у первого куска фрагмента, иначе он повторится;
  // а жёлтая подсветка комментария — у всех кусков: комментарий относится к фрагменту целиком
  const seen = new Set<string>();
  for (const m of masked.matchAll(SPAN_OPEN)) {
    const name = m[2];
    const first = !seen.has(name.toLowerCase());
    seen.add(name.toLowerCase());
    const commented = counts.get(name.toLowerCase())?.comments ? ' kb-commented' : '';
    repl.push({
      start: m.index!,
      end: m.index! + m[0].length,
      html: `<span class="kb-a${commented}" data-a="${name}"${first ? ` id="kb-a-${name}"${countAttrs(name)}` : ''}>`,
    });
  }

  for (const m of masked.matchAll(HIGHLIGHT)) {
    repl.push({ start: m.index!, end: m.index! + 2, html: '<mark>' });
    repl.push({ start: m.index! + m[0].length - 2, end: m.index! + m[0].length, html: '</mark>' });
  }

  // вставки не должны перекрываться: первая по месту выигрывает
  repl.sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let pos = 0;
  for (const r of repl) {
    if (r.start < pos) continue;
    out += src.slice(pos, r.start) + r.html;
    pos = r.end;
  }
  return { markdown: out + src.slice(pos), embeds };
}
