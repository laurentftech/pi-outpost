/**
 * The file viewer's editor: CodeMirror 6, set up as a code editor.
 *
 * Line numbers, the current line, matching brackets, brackets and quotes closed as they
 * are typed, Tab and Shift+Tab indenting as in VS Code, folding, several cursors
 * (Ctrl+D on the next occurrence, Alt-click, Alt-drag for a rectangle), moving and
 * copying lines (Alt+arrows), toggling comments (Ctrl+/), undo history, completion on
 * Ctrl+Space, and the file's syntax coloured with the same palette as the read-only view
 * (`tok-*` classes, styled beside `.hljs-*`).
 *
 * The viewer's own find bar searches the draft, so CodeMirror's search panel is left
 * out: one Ctrl+F, wherever the reader is. Mod-S saves through `onSave` and stays here.
 *
 * Line endings: a file written with CRLF is edited and saved with CRLF. CodeMirror counts
 * a line break as one position whatever its length, so `select` converts the draft's
 * string offsets (what the find bar computes) into document positions.
 */
import { useEffect, useRef, type Ref, useImperativeHandle } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, selectNextOccurrence } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension, type StateCommand } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { languageFor } from "./codeEditorLanguages";

export interface CodeEditorHandle {
  focus(): void;
  /** Select `start`–`end`, offsets into the draft string, and scroll it into view. */
  select(start: number, end: number): void;
}

/** The draft's own indentation: a tab where it indents with tabs, else its smallest space run, else two. */
export function detectIndentUnit(text: string): string {
  if (/^\t/m.test(text)) return "\t";
  const widths = [...text.matchAll(/^( +)\S/gm)].map((match) => match[1]!.length).filter((width) => width >= 2 && width <= 8);
  return " ".repeat(widths.length === 0 ? 2 : Math.min(...widths));
}

/** A draft-string offset as a document position: each CRLF before it counts once. */
export function documentPosition(text: string, offset: number): number {
  let crlf = 0;
  for (let index = text.indexOf("\r\n"); index !== -1 && index < offset - 1; index = text.indexOf("\r\n", index + 2)) crlf++;
  return offset - crlf;
}

/**
 * Tab as in VS Code: at a bare cursor, the file's indentation unit is typed there; with
 * a selection, its lines are indented. Shift+Tab outdents either way.
 */
const tabKey: StateCommand = ({ state, dispatch }) => {
  if (state.selection.ranges.some((range) => !range.empty)) return indentMore({ state, dispatch });
  dispatch(state.update(state.replaceSelection(state.facet(indentUnit)), { scrollIntoView: true, userEvent: "input" }));
  return true;
};

export function CodeEditor({
  value,
  path,
  onChange,
  onSave,
  handle,
  label = "File editor",
}: {
  value: string;
  path: string;
  onChange: (value: string) => void;
  onSave: () => void;
  handle?: Ref<CodeEditorHandle>;
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };

  useImperativeHandle(handle, () => ({
    focus: () => view.current?.focus(),
    select(start, end) {
      const editor = view.current;
      if (editor === null) return;
      const text = editor.state.sliceDoc();
      const length = editor.state.doc.length;
      const anchor = Math.min(documentPosition(text, start), length);
      const head = Math.min(documentPosition(text, end), length);
      editor.dispatch({ selection: EditorSelection.single(anchor, head), effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
    },
  }));

  useEffect(() => {
    const language = new Compartment();
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          EditorState.lineSeparator.of(value.includes("\r\n") ? "\r\n" : "\n"),
          indentUnit.of(detectIndentUnit(value)),
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
          closeBrackets(),
          autocompletion({ activateOnTyping: false }),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          keymap.of([
            // Both, whatever the platform: Cmd+S on a Mac, Ctrl+S everywhere.
            ...["Ctrl-s", "Meta-s"].map((key) => ({
              key,
              preventDefault: true,
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            })),
            // Ctrl+D (Cmd+D): add the next occurrence of the selection as another cursor.
            { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            { key: "Tab", run: tabKey, shift: indentLess, preventDefault: true },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.sliceDoc());
          }),
          language.of([]),
        ],
      }),
    });
    view.current = editor;
    // Entering the editor is asking to type.
    editor.focus();
    let current = true;
    languageFor(path).then(
      (extension: Extension | null) => {
        if (current && extension !== null) editor.dispatch({ effects: language.reconfigure(extension) });
      },
      () => {},
    );
    return () => {
      current = false;
      editor.destroy();
      view.current = null;
    };
    // The viewer remounts per file path; the draft flows in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A draft replaced from outside (cancel in the side-by-side mode, a reload) — never
  // the echo of what was just typed, which already equals the document.
  useEffect(() => {
    const editor = view.current;
    if (editor === null || editor.state.sliceDoc() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="code-editor h-full w-full" data-testid="file-editor" />;
}
