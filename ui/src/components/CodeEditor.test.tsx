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

describe("CodeEditor git gutter", () => {
  function GutterEditor({ initial, baseline, readOnly = false }: { initial: string; baseline: string | null; readOnly?: boolean }) {
    const [value, setValue] = useState(initial);
    const [head, setHead] = useState(baseline);
    return (
      <>
        <CodeEditor value={value} path="a.txt" onChange={setValue} readOnly={readOnly} baseline={head} />
        <output data-testid="draft">{value}</output>
        <button type="button" onClick={() => setHead(null)}>
          no head
        </button>
        <button type="button" onClick={() => setHead(value)}>
          commit the draft
        </button>
      </>
    );
  }
  const marks = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".cm-git-gutter [data-git-change]")).map((mark) => mark.dataset.gitChange);

  // openlore: scenario=ChangedLinesAreMarked spec=git
  it("ChangedLinesAreMarked: a changed line, an added line and a removal, each marked once against HEAD", () => {
    const { container } = render(<GutterEditor initial={"a\nB\nc\nadded\nd"} baseline={"a\nb\nc\nd\ne"} />);
    expect(marks(container)).toEqual(["modified", "added", "deleted"]);
    // The removal was the last line: marked at the foot of what is now the last one.
    expect(container.querySelector(".cm-git-gutter [data-git-change='deleted']")!.classList.contains("cm-git-at-end")).toBe(true);
  });

  // openlore: scenario=TheMarksFollowTheDraft spec=git
  it("TheMarksFollowTheDraft: marks follow the draft as it is typed", () => {
    const { container } = render(<GutterEditor initial={"a\nb\n"} baseline={"a\nb\n"} />);
    expect(marks(container)).toEqual([]);
    typeInEditor("a\nb\nadded\n");
    expect(marks(container)).toEqual(["added"]);
    typeInEditor("a\nb\n");
    expect(marks(container)).toEqual([]);
  });

  // openlore: scenario=AClickShowsHeadsText spec=git
  it("AClickShowsHeadsText: a click opens HEAD's text under the change, and its revert edits the draft", () => {
    const { container, getByTestId, getByRole, queryByRole } = render(<GutterEditor initial={"one\nTWO\nthree"} baseline={"one\ntwo\nthree"} />);
    const mark = container.querySelector<HTMLElement>(".cm-git-gutter [data-git-change='modified']")!;
    fireEvent.mouseDown(mark);
    const peek = getByRole("region", { name: "HEAD version of this change" });
    expect(peek.querySelector(".cm-git-peek-old")?.textContent).toBe("two");
    fireEvent.click(getByRole("button", { name: "Revert this change" }));
    expect(getByTestId("draft").textContent).toBe("one\ntwo\nthree");
    expect(marks(container)).toEqual([]);
    expect(queryByRole("region", { name: "HEAD version of this change" })).toBeNull();
  });

  it("keeps the peek open while the draft is edited elsewhere", () => {
    const { container, getByRole } = render(<GutterEditor initial={"one\nTWO\nthree"} baseline={"one\ntwo\nthree"} />);
    fireEvent.mouseDown(container.querySelector<HTMLElement>(".cm-git-gutter [data-git-change='modified']")!);
    const view = editorView();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\nfour" } }));
    expect(marks(container)).toEqual(["modified", "added"]);
    expect(getByRole("region", { name: "HEAD version of this change" }).querySelector(".cm-git-peek-old")?.textContent).toBe("two");
  });

  it("leaves a press inside the peek to its buttons, not to the editor's selection", () => {
    const { container, getByRole } = render(<GutterEditor initial={"one\nTWO\nthree"} baseline={"one\ntwo\nthree"} />);
    fireEvent.mouseDown(container.querySelector<HTMLElement>(".cm-git-gutter [data-git-change='modified']")!);
    const view = editorView();
    act(() => view.dispatch({ selection: { anchor: 0 } }));
    fireEvent.mouseDown(getByRole("button", { name: "Revert this change" }));
    expect(view.state.selection.main.anchor).toBe(0);
  });

  it("shows HEAD's text in the read-only view without offering to revert", () => {
    const { container, getByRole, queryByRole } = render(<GutterEditor readOnly initial={"one\nthree"} baseline={"one\ntwo\nthree"} />);
    fireEvent.mouseDown(container.querySelector(".cm-git-gutter [data-git-change='deleted']")!);
    expect(getByRole("region", { name: "HEAD version of this change" }).textContent).toContain("two");
    expect(queryByRole("button", { name: "Revert this change" })).toBeNull();
    fireEvent.click(getByRole("button", { name: "Close" }));
    expect(queryByRole("region", { name: "HEAD version of this change" })).toBeNull();
  });

  // openlore: scenario=TheGutterFollowsHead spec=git
  it("TheGutterFollowsHead: compares with the new HEAD once it moves, and closes a peek on the old one", () => {
    const { container, getByText, queryByRole } = render(<GutterEditor initial={"one\nTWO"} baseline={"one\ntwo"} />);
    fireEvent.mouseDown(container.querySelector<HTMLElement>(".cm-git-gutter [data-git-change='modified']")!);
    fireEvent.click(getByText("commit the draft"));
    expect(marks(container)).toEqual([]);
    expect(queryByRole("region", { name: "HEAD version of this change" })).toBeNull();
    typeInEditor("one\nTWO\nthree");
    expect(marks(container)).toEqual(["added"]);
  });

  it("draws nothing without HEAD's text, and drops the marks when it goes", () => {
    const { container, getByText } = render(<GutterEditor initial={"x\ny"} baseline={"x"} />);
    expect(marks(container)).toEqual(["added"]);
    fireEvent.click(getByText("no head"));
    expect(marks(container)).toEqual([]);
  });
});
