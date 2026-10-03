/**
 * Thin Preact wrapper around CodeMirror 6 used by the code tools (formatter, diff).
 * Structural styles are set here; colours follow the design tokens via the
 * `.cm-editor` rules in global.css, so dark mode needs no work in the island.
 */
import { useEffect, useRef } from 'preact/hooks';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  placeholder as placeholderExt,
  scrollPastEnd,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { setDiagnostics, lintGutter } from '@codemirror/lint';
import { classHighlighter } from '@lezer/highlight';

export interface EditorError {
  /** 0-based character offset of the problem. */
  offset: number;
  message: string;
}

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** Language extension from a @codemirror/lang-* package, or null for plain text. */
  language?: Extension | null;
  readOnly?: boolean;
  placeholder?: string;
  wrap?: boolean;
  /** Underlines the character at `offset` and shows the message as a lint tooltip. */
  error?: EditorError | null;
  ariaLabel: string;
  class?: string;
  /** Called with the pasted text after CodeMirror has inserted it; `wasEmpty` says whether the editor held nothing before. */
  onPaste?: (text: string, info: { wasEmpty: boolean }) => void;
  /** Called when a file is dropped on the editor; the drop is then handled by the caller. */
  onDropFile?: (file: File) => void;
}

const baseTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { padding: '8px 0', minHeight: '100%' },
  '.cm-gutters': { minWidth: '2.5rem' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px' },
  '.cm-placeholder': { color: 'var(--color-ink-3)', fontStyle: 'normal' },
});

export function CodeEditor(p: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(p.value);
  const comps = useRef({
    language: new Compartment(),
    readOnly: new Compartment(),
    wrap: new Compartment(),
    placeholder: new Compartment(),
  });
  const handlers = useRef(p);
  handlers.current = p;

  useEffect(() => {
    if (!hostRef.current) return;
    const c = comps.current;
    const state = EditorState.create({
      doc: p.value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(classHighlighter),
        bracketMatching(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lintGutter(),
        scrollPastEnd(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
        baseTheme,
        c.language.of(p.language ?? []),
        c.readOnly.of([EditorState.readOnly.of(!!p.readOnly), EditorView.editable.of(!p.readOnly)]),
        c.wrap.of(p.wrap ? EditorView.lineWrapping : []),
        c.placeholder.of(p.placeholder ? placeholderExt(p.placeholder) : []),
        EditorView.contentAttributes.of({ 'aria-label': p.ariaLabel }),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          const text = u.state.doc.toString();
          latest.current = text;
          handlers.current.onChange?.(text);
        }),
        EditorView.domEventHandlers({
          paste: (e, view) => {
            const text = e.clipboardData?.getData('text/plain');
            const wasEmpty = view.state.doc.length === 0;
            if (text && handlers.current.onPaste) setTimeout(() => handlers.current.onPaste?.(text, { wasEmpty }), 0);
            return false;
          },
          drop: (e) => {
            const file = e.dataTransfer?.files?.[0];
            if (file && handlers.current.onDropFile) {
              e.preventDefault();
              handlers.current.onDropFile(file);
              return true;
            }
            return false;
          },
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prop -> editor (only when the text really differs, so typing is not interrupted)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || p.value === latest.current) return;
    latest.current = p.value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: p.value } });
  }, [p.value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: comps.current.language.reconfigure(p.language ?? []) });
  }, [p.language]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: comps.current.readOnly.reconfigure([EditorState.readOnly.of(!!p.readOnly), EditorView.editable.of(!p.readOnly)]),
    });
  }, [p.readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: comps.current.wrap.reconfigure(p.wrap ? EditorView.lineWrapping : []) });
  }, [p.wrap]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: comps.current.placeholder.reconfigure(p.placeholder ? placeholderExt(p.placeholder) : []) });
  }, [p.placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!p.error) {
      view.dispatch(setDiagnostics(view.state, []));
      return;
    }
    const len = view.state.doc.length;
    const from = Math.min(Math.max(0, p.error.offset), Math.max(0, len - 1));
    const to = Math.min(len, from + 1);
    view.dispatch(setDiagnostics(view.state, [{ from, to, severity: 'error', message: p.error.message }]));
  }, [p.error?.offset, p.error?.message, p.value]);

  return <div ref={hostRef} class={'min-h-0 min-w-0 overflow-hidden ' + (p.class ?? '')} />;
}

/** Focus helper for callers that keep a ref to the host element. */
export function focusEditor(host: HTMLElement | null): void {
  host?.querySelector<HTMLElement>('.cm-content')?.focus();
}
