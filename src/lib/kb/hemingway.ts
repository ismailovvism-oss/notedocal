// Режим Хемингуэя (из md-редактора): пока включён, написанное стереть нельзя — пиши вперёд,
// правь потом. Молчат Backspace и Delete (и со словами), вырезание, перетаскивание текста и
// отмена. Набор поверх выделения ничего не затирает: буква дописывается после выделенного.
// Кнопки разметки, диктовка, Claude и сверка правят как обычно — у их правок нет «пользовательского»
// события, фильтр их пропускает. Попытка стереть — onBlock (редактор вспыхивает красным).

import { ChangeSet, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

export function hemingway(onBlock: () => void): Extension {
  const block = () => {
    onBlock();
    return true;
  };
  return [
    // клавиши — раньше всех остальных (свой Backspace редактора обходит фильтр)
    Prec.highest(
      keymap.of(
        ['Backspace', 'Delete', 'Mod-Backspace', 'Mod-Delete', 'Alt-Backspace', 'Mod-x', 'Mod-z', 'Mod-y', 'Mod-Shift-z'].map((key) => ({
          key,
          run: block,
          preventDefault: true,
        })),
      ),
    ),
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged) return tr;
      const user = ['input', 'delete', 'move', 'undo', 'redo'].some((e) => tr.isUserEvent(e));
      if (!user) return tr;
      let deletes = false;
      tr.changes.iterChanges((fromA, toA) => {
        if (toA > fromA) deletes = true;
      });
      if (!deletes) return tr;
      onBlock();
      // набрали поверх выделения — оставить выделенное, вставку поставить после него
      if (tr.isUserEvent('input')) {
        const specs: { from: number; insert: string }[] = [];
        let end = 0;
        tr.changes.iterChanges((_fA, toA, _fB, _tB, ins) => {
          specs.push({ from: toA, insert: ins.toString() });
          end = toA + ins.length;
        });
        const changes = ChangeSet.of(specs, tr.startState.doc.length);
        return { changes, selection: EditorSelection.cursor(end), userEvent: 'input', scrollIntoView: true };
      }
      return [];
    }),
  ];
}
