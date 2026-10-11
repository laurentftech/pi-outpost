import { EditorState } from "@codemirror/state";
import { language } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { languageFor } from "./codeEditorLanguages";

/** The name of the language an extension installs, as the editor would see it ("" for an unnamed legacy mode). */
async function languageName(path: string): Promise<string | null> {
  const extension = await languageFor(path);
  if (extension === null) return null;
  return EditorState.create({ extensions: extension }).facet(language)?.name ?? "(none)";
}

describe("languageFor", () => {
  it.each([
    ["a.ts", "typescript"],
    ["a.mts", "typescript"],
    ["a.cts", "typescript"],
    ["a.tsx", "typescript"],
    ["a.js", "javascript"],
    ["a.jsx", "javascript"],
    ["a.mjs", "javascript"],
    ["a.cjs", "javascript"],
    ["a.json", "json"],
    ["a.jsonc", "json"],
    ["a.css", "css"],
    ["a.scss", "css"],
    ["a.less", "css"],
    ["a.html", "html"],
    ["a.htm", "html"],
    ["a.xml", "xml"],
    ["a.svg", "xml"],
    ["a.md", "markdown"],
    ["a.markdown", "markdown"],
    ["a.py", "python"],
    ["a.go", "go"],
    ["a.rs", "rust"],
    ["a.java", "java"],
    ["a.c", "cpp"],
    ["a.h", "cpp"],
    ["a.cpp", "cpp"],
    ["a.cc", "cpp"],
    ["a.cxx", "cpp"],
    ["a.hpp", "cpp"],
    ["a.php", "php"],
    ["a.sql", "sql"],
    ["a.yaml", "yaml"],
    ["a.yml", "yaml"],
    ["a.sh", "shell"],
    ["a.bash", "shell"],
    ["a.zsh", "shell"],
    ["a.toml", "toml"],
    ["a.ini", "properties"],
    ["a.cfg", "properties"],
    ["a.properties", "properties"],
    ["a.env", "properties"],
    ["a.rb", "ruby"],
    ["a.cs", "csharp"],
    ["deploy/Dockerfile", ""],
    ["dockerfile", ""],
    [".env", "properties"],
    ["config/.env.local", "properties"],
    ["src/Main.TS", "typescript"],
  ])("gives %s its language (%s)", async (path, name) => {
    expect(await languageName(path)).toBe(name);
  });

  it("leaves a file with no known kind as plain text", async () => {
    expect(await languageFor("notes.txt")).toBeNull();
    expect(await languageFor("Makefile")).toBeNull();
    expect(await languageFor("archive.tar.unknown")).toBeNull();
  });
});
