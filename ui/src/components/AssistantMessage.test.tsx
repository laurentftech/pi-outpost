import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import { AssistantMessage, chatHtmlSchema } from "./AssistantMessage";

type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;

function item(overrides: Partial<AssistantItem> = {}): AssistantItem {
  return { kind: "assistant", blocks: [{ type: "text", text: "Here is the answer." }], ...overrides };
}

type Props = React.ComponentProps<typeof AssistantMessage>;

function setup(overrides: Partial<Props> = {}) {
  const onOpenFile = vi.fn();
  render(<AssistantMessage item={item()} onOpenFile={onOpenFile} {...overrides} />);
  return { onOpenFile };
}

describe("AssistantMessage", () => {
  describe("blocks", () => {
    it("renders the reply as markdown", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "# Title\n\nsome **bold** text" }] }) });
      expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
      expect(screen.getByText("bold").tagName).toBe("STRONG");
    });

    it("renders every text block", () => {
      setup({
        item: item({
          blocks: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        }),
      });
      expect(screen.getByText("first")).toBeInTheDocument();
      expect(screen.getByText("second")).toBeInTheDocument();
    });

    it("omits reasoning when its consumer hides it, and keeps the answer", () => {
      setup({
        item: item({
          blocks: [
            { type: "thinking", text: "weighing the options" },
            { type: "text", text: "Here is the answer." },
          ],
        }),
        hideReasoning: true,
      });
      expect(screen.getByText("Here is the answer.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /thinking/ })).not.toBeInTheDocument();
    });

    it("renders nothing at all when hiding reasoning empties the message", () => {
      const { container } = render(
        <AssistantMessage item={item({ blocks: [{ type: "thinking", text: "hmm" }] })} hideReasoning />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("does not discard what it hid", () => {
      const blocks: AssistantItem["blocks"] = [
        { type: "thinking", text: "weighing the options" },
        { type: "text", text: "Here is the answer." },
      ];
      const { rerender } = render(<AssistantMessage item={item({ blocks })} hideReasoning />);
      expect(screen.queryByRole("button", { name: /thinking/ })).not.toBeInTheDocument();

      rerender(<AssistantMessage item={item({ blocks })} />);
      fireEvent.click(screen.getByRole("button", { name: /thinking/ }));
      expect(screen.getByText("weighing the options")).toBeInTheDocument();
    });

    it("keeps thinking folded away until asked for", () => {
      setup({ item: item({ blocks: [{ type: "thinking", text: "weighing the options" }] }) });
      expect(screen.queryByText("weighing the options")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /thinking/ }));
      expect(screen.getByText("weighing the options")).toBeInTheDocument();
    });

    it("folds it back", () => {
      setup({ item: item({ blocks: [{ type: "thinking", text: "weighing the options" }] }) });
      const toggle = screen.getByRole("button", { name: /thinking/ });
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(screen.queryByText("weighing the options")).not.toBeInTheDocument();
    });

    it("mixes thinking and answer in the order they arrived", () => {
      setup({
        item: item({
          blocks: [
            { type: "thinking", text: "hmm" },
            { type: "text", text: "the answer" },
          ],
        }),
      });
      expect(screen.getByRole("button", { name: /thinking/ })).toBeInTheDocument();
      expect(screen.getByText("the answer")).toBeInTheDocument();
    });
  });

  describe("copying", () => {
    it("offers to copy the finished reply", () => {
      setup();
      expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    });

    it("offers nothing while the reply is still arriving", () => {
      setup({ item: item({ streaming: true }) });
      expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
    });

    it("offers nothing for a reply that is only thinking", () => {
      setup({ item: item({ blocks: [{ type: "thinking", text: "hmm" }] }) });
      expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
    });
  });

  describe("workspace references", () => {
    it("loads a relative image through the raw-bytes endpoint", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "![plot](out/plot.png)" }] }), token: "secret" });
      const img = screen.getByRole("img", { name: "plot" });
      expect(img.getAttribute("src")).toContain("/files/raw");
      expect(img.getAttribute("src")).toContain("secret");
    });

    it("leaves an external image URL alone", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "![remote](https://example.com/a.png)" }] }) });
      expect(screen.getByRole("img", { name: "remote" })).toHaveAttribute("src", "https://example.com/a.png");
    });

    it("opens a relative link in the viewer instead of navigating away", () => {
      const { onOpenFile } = setup({ item: item({ blocks: [{ type: "text", text: "see [main](src/main.ts)" }] }) });
      fireEvent.click(screen.getByRole("link", { name: "main" }));
      expect(onOpenFile).toHaveBeenCalledWith("src/main.ts");
    });

    it("sends an external link to a new tab, safely", () => {
      const { onOpenFile } = setup({ item: item({ blocks: [{ type: "text", text: "[docs](https://example.com)" }] }) });
      const link = screen.getByRole("link", { name: "docs" });
      fireEvent.click(link);
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    });

    it("treats a relative link as external when nothing can open it", () => {
      render(<AssistantMessage item={item({ blocks: [{ type: "text", text: "[main](src/main.ts)" }] })} />);
      expect(screen.getByRole("link", { name: "main" })).toHaveAttribute("target", "_blank");
    });
  });

  describe("code fences", () => {
    it("routes a mermaid fence to the diagram renderer", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "```mermaid\ngraph TD; A-->B;\n```" }] }) });
      // Before mermaid has drawn anything the renderer shows the source, so finding
      // it proves the fence reached the renderer rather than a plain <pre>
      expect(screen.getByText(/graph TD; A-->B;/)).toBeInTheDocument();
      expect(document.querySelector("pre.my-2")).not.toBeNull();
    });

    it("leaves any other fence as plain code", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "```ts\nconst a = 1;\n```" }] }) });
      expect(screen.getByText(/const a = 1;/)).toBeInTheDocument();
      expect(document.querySelector("pre.my-2")).toBeNull();
    });

    it("leaves a fence with no language as plain code", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "```\nplain\n```" }] }) });
      expect(document.querySelector("pre.my-2")).toBeNull();
    });
  });

  // Extensions append structured sections — a sources block, a collapsible
  // appendix — as raw HTML in the reply text. The text is model/extension
  // generated, so it reaches the DOM only through the sanitizer.
  describe("raw HTML", () => {
    function renderText(text: string, props: Partial<Props> = {}) {
      return render(<AssistantMessage item={item({ blocks: [{ type: "text", text }] })} {...props} />);
    }

    it("renders a disclosure section as elements, not as visible markup", () => {
      const { container } = renderText(
        '<details class="source-list">\n<summary>Sources (2)</summary>\n\n<p>DOC-42</p>\n</details>',
      );
      const details = container.querySelector("details.source-list");
      expect(details).not.toBeNull();
      expect(details?.querySelector("summary")?.textContent).toBe("Sources (2)");
      expect(container.textContent).not.toContain("<details");
    });

    it("expands and collapses the section natively", () => {
      const { container } = renderText("<details><summary>Sources</summary><p>the note</p></details>");
      const details = container.querySelector("details") as HTMLDetailsElement;
      expect(details.open).toBe(false);
      fireEvent.click(screen.getByText("Sources"));
      // jsdom implements the summary toggle, so this is the element's own behaviour
      expect(details.open).toBe(true);
    });

    // The default schema narrows `className` on seven tags, and a tag's own
    // entry beats the `*` one — so the hook has to be widened per tag, not only
    // added to `*`, or it works on some elements of a section and not others.
    it("keeps the class hook on the tags the default schema narrows", () => {
      const { container } = renderText(
        '<details class="source-list"><summary>s</summary>' +
          '<ul class="refs"><li class="ref"><a class="ref-link" href="https://example.com">DOC-42</a></li></ul>' +
          '<p><code class="ref-id">DOC-42</code></p></details>',
      );
      expect(container.querySelector("ul.refs")).not.toBeNull();
      expect(container.querySelector("li.ref")).not.toBeNull();
      expect(container.querySelector("a.ref-link")).not.toBeNull();
      expect(container.querySelector("code.ref-id")).not.toBeNull();
    });

    it("keeps the class hook a host page styles the section through", () => {
      const { container } = renderText(
        '<details class="source-list"><summary>s</summary><pre class="source-content">excerpt</pre></details>',
      );
      expect(container.querySelector("pre.source-content")?.textContent).toBe("excerpt");
    });

    it("renders inline markup and rules that markdown alone would escape", () => {
      const { container } = renderText("<hr>\n<p>before <strong>after</strong></p>");
      expect(container.querySelector("hr")).not.toBeNull();
      expect(screen.getByText("after").tagName).toBe("STRONG");
    });

    it("still renders the markdown around the raw block", () => {
      renderText("# Title\n\n<details><summary>s</summary><p>x</p></details>\n\n**bold**");
      expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
      expect(screen.getByText("bold").tagName).toBe("STRONG");
    });

    // The transition, not the happy path: a reply re-renders on every streamed
    // token, and `open` lives on the DOM element rather than in React's tree.
    it("keeps a section the reader opened open as the reply keeps arriving", () => {
      const text = "answer\n\n<details class=\"source-list\"><summary>Sources</summary><p>the note</p></details>";
      const { container, rerender } = render(
        <AssistantMessage item={item({ blocks: [{ type: "text", text }], streaming: true })} />,
      );
      fireEvent.click(screen.getByText("Sources"));
      expect(container.querySelector("details")?.open).toBe(true);

      rerender(
        <AssistantMessage
          item={item({ blocks: [{ type: "text", text: `${text}\n\nand one more thing.` }], streaming: true })}
        />,
      );
      expect(container.querySelector("details")?.open).toBe(true);
      expect(container.textContent).toContain("and one more thing.");
    });

    it("draws an unfinished tag from a streaming reply without breaking the message", () => {
      const { container } = renderText("answer so far\n\n<details class=\"source-list\"><summ");
      expect(container.textContent).toContain("answer so far");
      expect(container.querySelector("details.source-list")).not.toBeNull();
    });
  });

  describe("raw HTML that must never reach the DOM", () => {
    function renderText(text: string) {
      return render(<AssistantMessage item={item({ blocks: [{ type: "text", text }] })} />);
    }

    it("drops a script tag and its contents", () => {
      const { container } = renderText('<script>window.__pwned = true;</script><p>after</p>');
      expect(container.querySelector("script")).toBeNull();
      expect(container.textContent).not.toContain("__pwned");
      expect(screen.getByText("after")).toBeInTheDocument();
    });

    it("drops an inline event handler from an image", () => {
      const { container } = renderText('<img src="x.png" alt="a" onerror="window.__pwned = true">');
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("onerror")).toBeNull();
    });

    it("drops an inline event handler from an allowed element", () => {
      const { container } = renderText('<details onclick="window.__pwned = true"><summary>s</summary></details>');
      expect(container.querySelector("details")?.getAttribute("onclick")).toBeNull();
    });

    it("drops a javascript: href, keeping the link text", () => {
      const { container } = renderText('<a href="javascript:window.__pwned = true">click</a>');
      const link = container.querySelector("a");
      // The sanitizer drops the property outright — the href is gone, not neutered
      expect(link?.getAttribute("href")).toBeNull();
      expect(container.textContent).toContain("click");
    });

    it("drops an iframe", () => {
      const { container } = renderText('<iframe src="https://example.com/evil"></iframe><p>after</p>');
      expect(container.querySelector("iframe")).toBeNull();
      expect(screen.getByText("after")).toBeInTheDocument();
    });

    it("drops a style element rather than letting it restyle the page", () => {
      const { container } = renderText("<style>body { display: none }</style><p>after</p>");
      expect(container.querySelector("style")).toBeNull();
      expect(screen.getByText("after")).toBeInTheDocument();
    });

    it("drops a form and its inputs", () => {
      const { container } = renderText('<form action="https://example.com/steal"><input name="token"></form>');
      expect(container.querySelector("form")).toBeNull();
      expect(container.querySelector('input[name="token"]')).toBeNull();
    });

    it("namespaces an id so a reply cannot shadow a global on the host page", () => {
      const { container } = renderText('<p id="token">x</p>');
      expect(container.querySelector("#token")).toBeNull();
      expect(container.querySelector("#user-content-token")).not.toBeNull();
    });

    it("drops a style attribute", () => {
      const { container } = renderText('<p style="position:fixed;inset:0">covering</p>');
      expect(container.querySelector("p[style]")).toBeNull();
      expect(screen.getByText("covering")).toBeInTheDocument();
    });
  });

  // The sanitizer sees the whole tree, markdown-generated nodes included, so
  // every existing rendering has to survive it — including the two classes the
  // default schema narrows away, which is what `allowClassNameEverywhere` is for.
  describe("the sanitize step leaves existing rendering alone", () => {
    it("still renders a GFM table", () => {
      const { container } = render(
        <AssistantMessage item={item({ blocks: [{ type: "text", text: "| a | b |\n| --- | --- |\n| 1 | 2 |" }] })} />,
      );
      expect(container.querySelector("table")).not.toBeNull();
      expect(screen.getByRole("cell", { name: "1" })).toBeInTheDocument();
    });

    it("still routes a mermaid fence to the diagram renderer", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "```mermaid\ngraph TD; A-->B;\n```" }] }) });
      expect(screen.getByText(/graph TD; A-->B;/)).toBeInTheDocument();
      expect(document.querySelector("pre.my-2")).not.toBeNull();
    });

    it("still tags a plain fence with its language", () => {
      const { container } = render(
        <AssistantMessage item={item({ blocks: [{ type: "text", text: "```ts\nconst a = 1;\n```" }] })} />,
      );
      expect(container.querySelector("code.language-ts")).not.toBeNull();
    });

    it("still renders inline maths", () => {
      const { container } = render(
        <AssistantMessage item={item({ blocks: [{ type: "text", text: "the value $x^2$ here" }] })} />,
      );
      expect(container.querySelector(".katex")).not.toBeNull();
    });

    it("still renders block maths in display mode", () => {
      const { container } = render(
        <AssistantMessage item={item({ blocks: [{ type: "text", text: "$$\na + b\n$$" }] })} />,
      );
      expect(container.querySelector(".katex-display")).not.toBeNull();
    });

    it("still keeps the classes GFM task lists are styled by", () => {
      const { container } = render(
        <AssistantMessage item={item({ blocks: [{ type: "text", text: "- [ ] todo\n- [x] done" }] })} />,
      );
      expect(container.querySelector("li.task-list-item")).not.toBeNull();
      expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(2);
    });

    it("still loads a relative image through the raw-bytes endpoint", () => {
      setup({ item: item({ blocks: [{ type: "text", text: "![plot](out/plot.png)" }] }), token: "secret" });
      expect(screen.getByRole("img", { name: "plot" }).getAttribute("src")).toContain("/files/raw");
    });

    it("still opens a relative link in the viewer", () => {
      const { onOpenFile } = setup({ item: item({ blocks: [{ type: "text", text: "see [main](src/main.ts)" }] }) });
      fireEvent.click(screen.getByRole("link", { name: "main" }));
      expect(onOpenFile).toHaveBeenCalledWith("src/main.ts");
    });

    it("applies the same overrides to a link written as raw HTML", () => {
      const { onOpenFile } = setup({
        item: item({ blocks: [{ type: "text", text: '<p><a href="src/main.ts">main</a></p>' }] }),
      });
      fireEvent.click(screen.getByRole("link", { name: "main" }));
      expect(onOpenFile).toHaveBeenCalledWith("src/main.ts");
    });
  });

  // Guards the schema itself, so a dependency bump that re-narrows `className`
  // or drops a disclosure element fails here rather than in the transcript.
  describe("the allow-list", () => {
    it("allows the disclosure elements", () => {
      expect(chatHtmlSchema.tagNames).toContain("details");
      expect(chatHtmlSchema.tagNames).toContain("summary");
      expect(new Set(chatHtmlSchema.tagNames).size).toBe(chatHtmlSchema.tagNames?.length);
    });

    it("allows className on every element, with no tag narrowing it", () => {
      const attributes = chatHtmlSchema.attributes ?? {};
      expect(attributes["*"]).toContain("className");
      for (const [tagName, definitions] of Object.entries(attributes)) {
        if (tagName === "*") continue;
        const narrowed = definitions.filter(
          (definition) => Array.isArray(definition) && definition[0] === "className",
        );
        expect({ tagName, narrowed }).toEqual({ tagName, narrowed: [] });
      }
    });

    it("keeps the default protections it is built on", () => {
      expect(chatHtmlSchema.strip).toContain("script");
      expect(chatHtmlSchema.clobber).toContain("id");
      expect(chatHtmlSchema.clobberPrefix).toBe("user-content-");
      expect(chatHtmlSchema.tagNames).not.toContain("iframe");
      expect(chatHtmlSchema.attributes?.["*"]).not.toContain("style");
      expect(chatHtmlSchema.protocols?.href).toEqual(["http", "https", "irc", "ircs", "mailto", "xmpp"]);
    });
  });

  describe("failures", () => {
    it("shows what went wrong alongside whatever arrived", () => {
      setup({ item: item({ errorMessage: "The provider refused the request" }) });
      expect(screen.getByText("Here is the answer.")).toBeInTheDocument();
      expect(screen.getByText("The provider refused the request")).toBeInTheDocument();
    });

    it("shows an error even when no text arrived at all", () => {
      setup({ item: item({ blocks: [], errorMessage: "Connection lost" }) });
      expect(screen.getByText("Connection lost")).toBeInTheDocument();
    });
  });
});
