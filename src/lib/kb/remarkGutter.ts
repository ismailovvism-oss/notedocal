// Полоса значков ✎ справа от текста в правке (окно «База», вычитка — src/lib/kb/remarks.ts).
// У каждого абзаца, пункта списка, строки таблицы — свой бледный значок: виден всегда, искать
// его мышью не надо. Щёлкнуть можно по всей высоте полосы рядом с абзацем, а не только по
// кружку. Оранжевый — к этому месту замечание уже есть. Чей значок под курсором текста — ярче.

import { RangeSetBuilder, StateField, type Extension, type RangeSet } from '@codemirror/state';
import { BlockType, gutter, GutterMarker, highlightActiveLineGutter, type EditorView } from '@codemirror/view';
import { remarkSpots } from './remarks.ts';

class Pen extends GutterMarker {
  readonly on: boolean;
  constructor(on: boolean) {
    super();
    this.on = on;
  }
  eq(other: Pen) {
    return other.on === this.on;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-pen ${this.on ? 'on' : ''}`;
    el.textContent = '✎';
    el.title = this.on ? 'К этому месту есть замечание — открыть. Выделены слова — новое, к ним' : 'Замечание к этому месту. Выделены слова — к ним';
    return el;
  }
}
const PEN = new Pen(false);
const PEN_ON = new Pen(true);

function build(doc: string): RangeSet<GutterMarker> {
  const b = new RangeSetBuilder<GutterMarker>();
  for (const s of remarkSpots(doc)) b.add(s.at, s.at, s.on ? PEN_ON : PEN);
  return b.finish();
}

/** `onPen(view, pos, whole)` — щёлкнули по полосе у строки, которая начинается в `pos`;
 *  `whole` — у блока, нарисованного целиком (таблица): замечание ко всему блоку. */
export function remarkGutter(onPen: (view: EditorView, pos: number, whole: boolean) => void): Extension {
  const pens = StateField.define<RangeSet<GutterMarker>>({
    create: (state) => build(state.doc.toString()),
    update: (value, tr) => (tr.docChanged ? build(tr.newDoc.toString()) : value),
  });
  return [
    pens,
    gutter({
      class: 'cm-pen-gutter',
      side: 'after',
      markers: (view) => view.state.field(pens),
      // таблица, пока в ней нет курсора, нарисована одним блоком — значок у неё один
      widgetMarker: () => PEN,
      domEventHandlers: {
        mousedown(view, line, event) {
          if ((event as MouseEvent).button !== 0) return false;
          const whole = line.type !== BlockType.Text;
          let has = whole;
          view.state.field(pens).between(line.from, line.from, () => {
            has = true;
          });
          if (!has) return false;
          // выделение в тексте не трогаем: по нему замечание ляжет к выделенным словам
          onPen(view, line.from, whole);
          return true;
        },
      },
    }),
    highlightActiveLineGutter(),
  ];
}
