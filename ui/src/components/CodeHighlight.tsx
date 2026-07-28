import { useEffect, useRef, useState } from "react";
import type { HLJSApi } from "highlight.js";

let hljsPromise: Promise<HLJSApi> | null = null;

/** Curated set of common languages — keeps the highlighter lean instead of bundling all ~190. */
const LANGUAGE_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  javascript: () => import("highlight.js/lib/languages/javascript"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  json: () => import("highlight.js/lib/languages/json"),
  xml: () => import("highlight.js/lib/languages/xml"),
  css: () => import("highlight.js/lib/languages/css"),
  scss: () => import("highlight.js/lib/languages/scss"),
  bash: () => import("highlight.js/lib/languages/bash"),
  python: () => import("highlight.js/lib/languages/python"),
  go: () => import("highlight.js/lib/languages/go"),
  rust: () => import("highlight.js/lib/languages/rust"),
  java: () => import("highlight.js/lib/languages/java"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  php: () => import("highlight.js/lib/languages/php"),
  sql: () => import("highlight.js/lib/languages/sql"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  ini: () => import("highlight.js/lib/languages/ini"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  plaintext: () => import("highlight.js/lib/languages/plaintext"),
};

/** Lazy-load highlight.js's core (heavy-ish) only when a code file is actually previewed. */
async function loadHljs(): Promise<HLJSApi> {
  if (!hljsPromise) {
    hljsPromise = (async () => {
      const { default: hljs } = await import("highlight.js/lib/core");
      await Promise.all(
        Object.entries(LANGUAGE_LOADERS).map(async ([name, load]) => {
          const mod = await load();
          hljs.registerLanguage(name, mod.default as never);
        }),
      );
      return hljs;
    })();
  }
  return hljsPromise;
}

const EXTENSION_HINTS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  ini: "ini",
  toml: "ini",
  dockerfile: "dockerfile",
  md: "markdown",
  markdown: "markdown",
};

function languageHint(path: string): string | undefined {
  const base = path.split("/").pop() ?? path;
  if (/^dockerfile$/i.test(base)) return "dockerfile";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return undefined;
  return EXTENSION_HINTS[base.slice(dot + 1).toLowerCase()];
}

/** Syntax-highlighted code, falling back to plain text until highlight.js has loaded. */
export function CodeHighlight({ code, path }: { code: string; path: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    loadHljs().then((hljs) => {
      if (cancelled) return;
      const hint = languageHint(path);
      const result =
        hint && hljs.getLanguage(hint)
          ? hljs.highlight(codeRef.current, { language: hint })
          : hljs.highlightAuto(codeRef.current);
      setHtml(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [code, path]);

  if (html === null) {
    return <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-700 dark:text-zinc-300">{code}</pre>;
  }
  return (
    <pre
      className="hljs whitespace-pre-wrap font-mono text-xs text-zinc-700 dark:text-zinc-300"
      // eslint-disable-next-line react/no-danger -- HTML produced by highlight.js from the file's own text (escaped by its tokenizer)
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
