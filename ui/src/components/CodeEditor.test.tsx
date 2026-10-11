import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CodeEditor, detectIndentUnit, documentPosition } from "./CodeEditor";
import { editorElement, editorSelection, editorText, editorView, typeInEditor } from "./codeEditorTesting";

function Editor({ initial, path = "a.ts", onSave = () => {} }: { initial: string; path?: string; onSave?: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CodeEditor value={value} path={path} onChange={setValue} onSave={onSave} />
      <output data-testid="draft">{value}</output>
      <button type="button" onClick={() => setValue("replaced\n")}>
        replace
      </button>
    </>
  );
}

describe("detectIndentUnit", () => {
  it("follows the file: tabs, its smallest space run, two spaces by default", () => {
    expect(detectIndentUnit("a\n\tb\n")).toBe("\t");
    expect(detectIndentUnit("a\n    b\n        c\n")).toBe("    ");
    expect(detectIndentUnit("a\nb\n")).toBe("  ");
  });
});

describe("documentPosition", () => {
  it("counts each CRLF before the offset once", () => {
    const text = "ab\r\ncd\r\nef";
    expect(documentPosition(text, 0)).toBe(0);
    expect(documentPosition(text, 4)).toBe(3); // "c"
    expect(documentPosition(text, 8)).toBe(6); // "e"
    expect(documentPosition("plain\ntext", 6)).toBe(6);
  });
});

describe("CodeEditor", () => {
  it("numbers the lines, colours the language once loaded, and reports what is typed", async () => {
    const { container, getByTestId } = render(<Editor initial={"const a = 1;\nlet b;\n"} />);
    const numbers = Array.from(container.querySelectorAll(".cm-lineNumbers .cm-gutterElement")).map((element) => element.textContent);
    expect(numbers).toEqual(expect.arrayContaining(["1", "2", "3"]));
    await waitFor(() => expect(container.querySelector(".tok-keyword")?.textContent).toBe("const"));
    typeInEditor("const a = 2;\n");
    expect(getByTestId("draft").textContent).toBe("const a = 2;\n");
  });

  it("saves on Ctrl+S and on Cmd+S, without the browser's own save", () => {
    const onSave = vi.fn();
    render(<Editor initial="x" onSave={onSave} />);
    const ctrl = fireEvent.keyDown(editorElement()!, { key: "s", ctrlKey: true });
    fireEvent.keyDown(editorElement()!, { key: "s", metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(ctrl).toBe(false); // default prevented
  });

  it("keeps a CRLF file's line endings in the draft it reports", () => {
    const { getByTestId } = render(<Editor initial={"a\r\nb\r\n"} />);
    const view = editorView();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "c" } }));
    expect(getByTestId("draft").textContent).toBe("a\r\nb\r\nc");
  });

  it("closes brackets as they are typed, and indents with the file's unit", () => {
    render(<Editor initial={"\tfoo"} />);
    const view = editorView();
    const end = view.state.doc.length;
    act(() => view.dispatch({ selection: { anchor: end } }));
    // closeBrackets is an input handler: offer it "(" as the browser's input would.
    const insert = () => view.state.update({ changes: { from: end, insert: "(" } });
    let handled = false;
    act(() => {
      handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, end, end, "(", insert));
    });
    expect(handled).toBe(true);
    expect(editorText()).toBe("\tfoo()");
    expect(editorSelection().from).toBe(5);
    // Tab inserts the file's own unit — a tab here.
    act(() => {
      fireEvent.keyDown(editorElement()!, { key: "Tab" });
    });
    expect(editorText()).toBe("\tfoo(\t)");
  });

  it("takes a draft replaced from outside, and focuses itself on opening", () => {
    const { getByText } = render(<Editor initial="first\n" />);
    expect(editorElement()).toHaveFocus();
    fireEvent.click(getByText("replace"));
    expect(editorText()).toBe("replaced\n");
  });
});
