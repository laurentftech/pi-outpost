/**
 * Test helpers for the file editor (CodeMirror): its text, its selection, and typing
 * into it as a transaction — jsdom has no input pipeline for a contenteditable.
 */
import { act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";

/** The editor's content element, or `null` when no editor is open (a read-only source view is not one). */
export function editorElement(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-testid="file-editor"] .cm-content');
}

/** The read-only source view's content element, or `null`. */
export function sourceElement(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-testid="file-source"] .cm-content');
}

export function editorView(root: ParentNode = document): EditorView {
  const element = editorElement(root);
  const view = element === null ? null : EditorView.findFromDOM(element);
  if (view === null) throw new Error("no editor open");
  return view;
}

/** The draft the editor holds, line endings included. */
export function editorText(root: ParentNode = document): string {
  return editorView(root).state.sliceDoc();
}

/** Replace the whole draft, as typing it would. */
export function typeInEditor(text: string, root: ParentNode = document) {
  const view = editorView(root);
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.type" });
  });
}

export function editorSelection(root: ParentNode = document): { from: number; to: number; text: string } {
  const { state } = editorView(root);
  const { from, to } = state.selection.main;
  return { from, to, text: state.sliceDoc(from, to) };
}

/** The read-only source view's selection — where the find bar put the current match. */
export function sourceSelection(): { from: number; to: number; text: string } {
  const element = sourceElement();
  const view = element === null ? null : EditorView.findFromDOM(element);
  if (view === null) throw new Error("no source view open");
  const { from, to } = view.state.selection.main;
  return { from, to, text: view.state.sliceDoc(from, to) };
}
