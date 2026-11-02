// Поле правки грузится, только когда его открыли: CodeMirror — заметная часть приложения,
// а на телефоне чаще читают, чем правят.

import { lazy, Suspense } from 'react';
import type { LiveEditorProps } from './liveEditorTypes';

const Editor = lazy(() => import('./LiveEditor'));

export function LiveEditor(props: LiveEditorProps) {
  return (
    <Suspense fallback={<div className={`live-editor ${props.className ?? ''}`}><div className="live-host live-loading md">{props.value || props.placeholder}</div></div>}>
      <Editor {...props} />
    </Suspense>
  );
}
