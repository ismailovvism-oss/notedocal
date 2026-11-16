// Режим тестировщика — как в Чатпате (~/projects/tools/wa, раздел «режим тестировщика»).
// Хозяин работает в окне как обычно, а замечание оставляет прямо на месте: Alt+щелчок по кнопке,
// пункту дерева, абзацу (сам щелчок при этом не срабатывает); или F8 → щелчок; или 🐞 →
// «К месту» / «Общее». Страница сама запоминает, где это было: место словами, CSS-путь, текст и
// разметку элемента, обстановку (заметка, вид, вкладка панели, размер окна).
//
// Claude собирает их командой `zametki замечания` (~/projects/apps/zametki/zamechaniya.py),
// правит и закрывает с ответом — ответ виден здесь же, в списке 🐞; «Не то — вернуть» открывает
// снова. Цифра на 🐞 горит цветом, когда есть свежие ответы.

import { useCallback, useEffect, useRef, useState } from 'react';
import { bugApi, type BugNote } from './native';

const OWN = '.bugbox, .bug-backdrop, .bug-hint, .dk-bug, .bug-toast';
const ST: Record<BugNote['status'], string> = { new: 'новое', ask: 'вопрос вам', done: 'сделано', wont: 'не будет' };
const open_ = (n: BugNote) => n.status === 'new' || n.status === 'ask';

function textOf(el: Element | null, n = 120): string {
  if (!el) return '';
  const e = el as HTMLInputElement;
  return (e.innerText || e.textContent || e.value || e.placeholder || e.title || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** Место словами: что это и где в окне. */
function placeOf(el: HTMLElement, noteTitle: string): string {
  const q = (s: string) => el.closest<HTMLElement>(s);
  const parts: string[] = [];
  const ctl = q('button, a, input, select, textarea, summary, [role=tab]');
  if (ctl) {
    const name = textOf(ctl, 40) || ctl.title || ctl.getAttribute('aria-label') || '';
    if (ctl.tagName === 'INPUT' || ctl.tagName === 'TEXTAREA') parts.push(`поле «${(ctl as HTMLInputElement).placeholder || name || 'ввод'}»`);
    else if (ctl.tagName === 'SELECT') parts.push(`выбор «${ctl.title || name}»`);
    else parts.push(`кнопка «${name}»${ctl.title && ctl.title !== name ? ` (${ctl.title.slice(0, 60)})` : ''}`);
  }
  const rail = document.querySelector('.dk-rail-tabs button.on .dk-rail-label')?.textContent ?? '';
  const areas: [string, string | (() => string)][] = [
    ['.dk-menu', 'выпадающее меню'],
    ['.dk-find', 'строка поиска и замены'],
    ['.pv-edit', 'поле замечания под абзацем'],
    ['.pv-note', 'карточка замечания в просмотре'],
    ['.pv-fn, .pv-foots', 'сноска в просмотре'],
    ['.dk-preview', () => `просмотр заметки, блок «${textOf(q('.pv-block'), 50)}»`],
    ['.cm-editor', () => `текст заметки (правка), строка «${textOf(q('.cm-line'), 50)}»`],
    ['.dk-viewbar', 'переключатель вида в шапке заметки'],
    ['.dk-title', 'название заметки'],
    ['.dk-note-head', 'шапка заметки'],
    ['.dk-tags', 'теги заметки'],
    ['.dk-files', 'файлы заметки'],
    ['.dk-ext-bar', 'полоса «файл вне хранилища»'],
    ['.dk-stat', 'строка под текстом (знаков, сохранено)'],
    ['.dk-rail-tabs', 'вкладки правой панели'],
    ['.dk-right', `правая панель, вкладка «${rail}»`],
    ['.dk-tabs', 'полоса вкладок над текстом'],
    ['.dk-tree', () => `дерево заметок, пункт «${textOf(q('.dk-node')?.querySelector('.dk-node-title') ?? null, 50)}»`],
    ['.dk-left', 'левая панель'],
    ['.dk-page', 'страница заметки'],
  ];
  for (const [sel, what] of areas) {
    if (q(sel)) {
      parts.push(typeof what === 'string' ? what : what());
      break;
    }
  }
  const own = textOf(el, 60);
  if (!ctl && own && !q('.cm-editor') && !q('.dk-preview') && !q('.dk-tree')) parts.unshift(`«${own}»`);
  if (noteTitle && !q('.dk-left')) parts.push(`· заметка «${noteTitle}»`);
  return parts.join(' ') || el.tagName.toLowerCase();
}

/** CSS-путь до элемента — найти его снова («Показать место») и в коде. */
function selectorOf(el: HTMLElement): string {
  const path: string[] = [];
  for (let e: HTMLElement | null = el; e && e !== document.body && path.length < 6; e = e.parentElement) {
    if (e.id) {
      path.unshift('#' + CSS.escape(e.id));
      break;
    }
    let s = e.tagName.toLowerCase();
    const cls = [...e.classList].filter((c) => !/^(on|open|flash|marked|drop|bug-hover|bugflash|cm-activeLine|cm-focused)$/.test(c)).slice(0, 2);
    if (cls.length) s += '.' + cls.map((c) => CSS.escape(c)).join('.');
    // среди одинаковых соседей — по счёту
    const same = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === e!.tagName && (cls[0] ? x.classList.contains(cls[0]) : true)) : [];
    if (same.length > 1) s += `:nth-of-type(${[...e.parentElement!.children].filter((x) => x.tagName === e!.tagName).indexOf(e) + 1})`;
    path.unshift(s);
  }
  return path.join(' > ');
}

export interface Tester {
  /** Сколько открытых; fresh — есть свежие ответы Claude. */
  open: number;
  fresh: number;
  showList: () => void;
  /** Окошки и подсветка — положить в корень страницы. */
  overlay: React.ReactNode;
}

export function useTester(context: () => Record<string, unknown>, noteTitle: string): Tester {
  const [notes, setNotes] = useState<BugNote[]>([]);
  const [picking, setPicking] = useState(false);
  const [box, setBox] = useState<{ el: HTMLElement | null; place: string; text: string } | null>(null);
  const [list, setList] = useState<null | 'open' | 'closed' | 'all'>(null);
  const [edit, setEdit] = useState<{ id: number; mode: 'edit' | 'answer' | 'reopen'; text: string } | null>(null);
  const [toast, setToast] = useState('');
  const [seen, setSeen] = useState(() => Number(localStorage.getItem('dk.bug-seen') || 0));
  const hover = useRef<HTMLElement | null>(null);
  const ctxRef = useRef(context);
  ctxRef.current = context;
  const titleRef = useRef(noteTitle);
  titleRef.current = noteTitle;
  const pickRef = useRef(picking);
  pickRef.current = picking;
  const busyRef = useRef(false); // открыто окошко или список — места не выбираем
  busyRef.current = !!box || !!list;

  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast((x) => (x === t ? '' : x)), 3500);
  };
  const load = useCallback(() => {
    bugApi
      .list()
      .then(setNotes)
      .catch(() => {});
  }, []);
  useEffect(() => {
    // окно подключается не сразу — первая загрузка чуть позже, потом раз в минуту
    const first = setTimeout(load, 1500);
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 60000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const unhover = () => {
    hover.current?.classList.remove('bug-hover');
    hover.current = null;
  };
  const stopPick = useCallback(() => {
    setPicking(false);
    document.body.classList.remove('bugpick');
    unhover();
  }, []);
  const startPick = () => {
    setList(null);
    setPicking(true);
    document.body.classList.add('bugpick');
  };

  useEffect(() => {
    const mine = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.(OWN);
    const onMove = (e: MouseEvent) => {
      const on = (pickRef.current || e.altKey) && !busyRef.current;
      const el = on && !mine(e.target) ? (e.target as HTMLElement) : null;
      if (el === hover.current) return;
      unhover();
      hover.current = el;
      el?.classList.add('bug-hover');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && !pickRef.current) unhover();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pickRef.current) {
        e.preventDefault();
        stopPick();
      }
      if (e.key === 'F8') {
        e.preventDefault();
        if (pickRef.current) stopPick();
        else if (!busyRef.current) startPick();
      }
    };
    // Alt+щелчок или щелчок в режиме выбора — замечание к этому месту; сам щелчок не срабатывает
    const onClick = (e: MouseEvent) => {
      if (!(pickRef.current || e.altKey) || busyRef.current || mine(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const el = e.target as HTMLElement;
      stopPick();
      el.classList.add('bugflash');
      setBox({ el, place: placeOf(el, titleRef.current), text: '' });
    };
    const onDown = (e: MouseEvent) => {
      if ((pickRef.current || e.altKey) && !busyRef.current && !mine(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [stopPick]);

  const closeBox = () => {
    box?.el?.classList.remove('bugflash');
    setBox(null);
  };
  const saveBox = async () => {
    if (!box) return;
    const note = box.text.trim();
    if (!note) return;
    const el = box.el;
    try {
      await bugApi.act({
        do: 'add',
        note,
        place: box.place,
        selector: el ? selectorOf(el) : '',
        target: el ? textOf(el, 500) : '',
        html: el ? el.outerHTML.slice(0, 4000) : '',
        ctx: { ...ctxRef.current(), w: innerWidth, h: innerHeight },
      });
      closeBox();
      say(bugApi.shared() ? 'Замечание записано — спасибо' : 'Записано в окне. До Claude дойдёт после перезапуска программы');
      load();
    } catch (e) {
      say('Не записалось: ' + (e as Error).message);
    }
  };

  const showList = () => {
    const now = Math.floor(Date.now() / 1000);
    try {
      localStorage.setItem('dk.bug-seen', String(now));
    } catch {
      /* без памяти — не страшно */
    }
    load();
    setEdit(null);
    setList('open');
    // свежие ответы остаются подсвеченными, пока список открыт; «увидено» — после закрытия
  };
  const closeList = () => {
    setList(null);
    setEdit(null);
    setSeen(Math.floor(Date.now() / 1000));
  };
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setNotes(await bugApi.list());
      setEdit(null);
    } catch (e) {
      say('Не вышло: ' + (e as Error).message);
    }
  };
  const saveEdit = (n: BugNote) =>
    act(async () => {
      if (!edit) return;
      const t = edit.text.trim();
      if (edit.mode === 'edit') {
        if (t) await bugApi.act({ do: 'edit', id: n.id, note: t });
      } else if (edit.mode === 'answer') {
        if (!t) return;
        await bugApi.act({ do: 'edit', id: n.id, note: `${n.note}\n— Ответ на вопрос: ${t}` });
        await bugApi.act({ do: 'status', id: n.id, status: 'new' });
      } else {
        if (t) await bugApi.act({ do: 'edit', id: n.id, note: `${n.note}\n— Вернул: ${t}` });
        await bugApi.act({ do: 'status', id: n.id, status: 'new' });
      }
    });
  const showPlace = (n: BugNote) => {
    let el: HTMLElement | null = null;
    try {
      el = document.querySelector<HTMLElement>(n.selector);
    } catch {
      /* путь устарел */
    }
    if (!el) return say('Этого места сейчас нет на экране — откройте ту же заметку и тот же вид');
    closeList();
    el.scrollIntoView({ block: 'center' });
    el.classList.add('bugflash');
    setTimeout(() => el!.classList.remove('bugflash'), 3500);
  };

  const opened = notes.filter(open_);
  const closed = notes.filter((n) => !open_(n));
  const fresh = notes.filter((n) => (n.done_ts > seen && !open_(n)) || (n.status === 'ask' && !!n.reply)).length;
  const shown = list === 'all' ? notes : list === 'open' ? opened : closed;

  const overlay = (
    <>
      {picking && <div className="bug-hint">Нажмите на место, к которому замечание · Esc — отмена</div>}
      {toast && <div className="bug-toast">{toast}</div>}
      {box && (
        <>
          <div className="bug-backdrop" onClick={closeBox} />
          <div className="bugbox">
            <div className="bug-head">
              🐞 Замечание
              <button onClick={closeBox}>×</button>
            </div>
            <div className="bug-where">Где: {box.place}</div>
            <textarea
              autoFocus
              dir="auto"
              placeholder="Что не так или как должно быть…"
              value={box.text}
              onChange={(e) => setBox({ ...box, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void saveBox();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeBox();
                }
              }}
            />
            <div className="bug-acts">
              <span className="muted small">Ctrl+Enter — сохранить</span>
              <button onClick={closeBox}>Отмена</button>
              <button className="primary" disabled={!box.text.trim()} onClick={() => void saveBox()}>
                Сохранить
              </button>
            </div>
          </div>
        </>
      )}
      {list && (
        <>
          <div className="bug-backdrop" onClick={closeList} />
          <div className="bugbox buglist">
            <div className="bug-head">
              🐞 Замечания
              <button onClick={closeList}>×</button>
            </div>
            <div className="muted small bug-about">
              Alt+щелчок по любому месту — замечание к нему. Или F8, потом щелчок. Claude собирает их по слову «собери замечания по Базе».
              {!bugApi.shared() && ' Сейчас они хранятся только в этом окне: до Claude дойдут после перезапуска программы.'}
            </div>
            <div className="bug-filters">
              <button className={list === 'open' ? 'on' : ''} onClick={() => setList('open')}>
                Открытые {opened.length}
              </button>
              <button className={list === 'closed' ? 'on' : ''} onClick={() => setList('closed')}>
                Закрытые {closed.length}
              </button>
              <button className={list === 'all' ? 'on' : ''} onClick={() => setList('all')}>
                Все
              </button>
              <span className="dk-spacer" />
              {list === 'closed' && closed.length > 0 && (
                <button onClick={() => confirm(`Удалить закрытые замечания (${closed.length})? Открытые останутся.`) && void act(() => bugApi.act({ do: 'clear' }))}>
                  Очистить закрытые
                </button>
              )}
              <button onClick={startPick}>＋ К месту</button>
              <button
                onClick={() => {
                  setList(null);
                  setBox({ el: null, place: 'общее (не к месту)', text: '' });
                }}
              >
                ＋ Общее
              </button>
            </div>
            <div className="bug-notes">
              {shown.length === 0 && <div className="bug-empty muted">Пусто</div>}
              {shown.map((n) => (
                <div key={n.id} className={`bug-note ${n.done_ts > seen && !open_(n) ? 'fresh' : ''}`}>
                  <div className="bug-note-h">
                    <b>#{n.id}</b>
                    <span className={`bug-st ${n.status}`}>{ST[n.status] ?? n.status}</span>
                    <span className="muted">{n.when}</span>
                  </div>
                  <div className="bug-note-t" dir="auto">
                    {n.note}
                  </div>
                  <div className="bug-note-w muted">{n.place}</div>
                  {n.reply && (
                    <div className={`bug-note-r ${n.status}`} dir="auto">
                      {n.status === 'ask' ? '❓ ' : n.status === 'new' ? '↩ прежний ответ: ' : '✓ '}
                      {n.reply}
                    </div>
                  )}
                  {edit?.id === n.id ? (
                    <div className="bug-edit">
                      <textarea
                        autoFocus
                        dir="auto"
                        placeholder={edit.mode === 'answer' ? 'Ответ на вопрос Claude…' : edit.mode === 'reopen' ? 'Что не так? (можно пусто)' : 'Замечание'}
                        value={edit.text}
                        onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            void saveEdit(n);
                          } else if (e.key === 'Escape') {
                            e.stopPropagation();
                            setEdit(null);
                          }
                        }}
                      />
                      <div className="bug-acts">
                        <button onClick={() => setEdit(null)}>Отмена</button>
                        <button className="primary" onClick={() => void saveEdit(n)}>
                          {edit.mode === 'reopen' ? 'Вернуть' : 'Сохранить'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bug-note-b">
                      {n.selector && <button onClick={() => showPlace(n)}>Показать место</button>}
                      {open_(n) ? (
                        <button onClick={() => setEdit({ id: n.id, mode: n.status === 'ask' ? 'answer' : 'edit', text: n.status === 'ask' ? '' : n.note })}>
                          {n.status === 'ask' ? 'Ответить' : 'Изменить'}
                        </button>
                      ) : (
                        <button onClick={() => setEdit({ id: n.id, mode: 'reopen', text: '' })}>Не то — вернуть</button>
                      )}
                      <button onClick={() => confirm(`Удалить замечание #${n.id}?`) && void act(() => bugApi.act({ do: 'del', id: n.id }))}>Удалить</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );

  return { open: opened.length, fresh, showList, overlay };
}
