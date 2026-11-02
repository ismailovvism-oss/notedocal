// Своё меню по правой кнопке в окне «База» вместо меню браузера («Назад», «Обновить»,
// «Сохранить страницу» — в программе заметок не нужны). Где какие команды — решает то место,
// по которому нажали (дерево, вкладка, текст); здесь только показ.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type MenuItem =
  | 'sep'
  | {
      label: string;
      icon?: string;
      /** Клавиши — для подсказки. */
      keys?: string;
      run: () => void;
      danger?: boolean;
      disabled?: boolean;
    };

type Open = (e: React.MouseEvent | MouseEvent, items: MenuItem[]) => void;
const MenuContext = createContext<Open>(() => {});
/** Показать меню у курсора: `menu(e, [...])` из onContextMenu. */
export const useMenu = () => useContext(MenuContext);

export function MenuHost({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = useCallback<Open>((e, items) => {
    e.preventDefault();
    e.stopPropagation();
    const list = items.filter((x, i, a) => x !== 'sep' || (i > 0 && a[i - 1] !== 'sep' && i < a.length - 1));
    if (list.length) setState({ x: e.clientX, y: e.clientY, items: list });
  }, []);
  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('wheel', close);
    };
  }, [state]);
  // меню браузера не показываем нигде, кроме полей ввода (там копировать и вставить нужны)
  useEffect(() => {
    const block = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', block);
    return () => window.removeEventListener('contextmenu', block);
  }, []);
  // не вылезать за край окна
  const style = state
    ? {
        left: Math.min(state.x, window.innerWidth - 250),
        top: Math.min(state.y, window.innerHeight - 30 - state.items.length * 30),
      }
    : undefined;
  return (
    <MenuContext.Provider value={open}>
      {children}
      {state && (
        <div className="dk-menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
          {state.items.map((it, i) =>
            it === 'sep' ? (
              <div key={i} className="dk-menu-sep" />
            ) : (
              <button
                key={i}
                className={`dk-menu-item ${it.danger ? 'danger' : ''}`}
                disabled={it.disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setState(null);
                  it.run();
                }}
              >
                <span className="dk-menu-icon">{it.icon ?? ''}</span>
                <span className="dk-menu-label">{it.label}</span>
                {it.keys && <span className="dk-menu-keys">{it.keys}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </MenuContext.Provider>
  );
}
