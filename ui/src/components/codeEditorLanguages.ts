/**
 * The editor's language for a file, loaded when a file of that kind is first edited.
 *
 * The same files the read-only view colours (`CodeHighlight`'s extension hints): the
 * modern grammars where CodeMirror has one, its legacy stream modes for the rest.
 */
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

type Loader = () => Promise<Extension>;

async function legacy(load: () => Promise<StreamParser<unknown>>): Promise<Extension> {
  return StreamLanguage.define(await load());
}

const typescript: Loader = async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
const tsx: Loader = async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true });
const javascript: Loader = async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
const json: Loader = async () => (await import("@codemirror/lang-json")).json();
const css: Loader = async () => (await import("@codemirror/lang-css")).css();
const html: Loader = async () => (await import("@codemirror/lang-html")).html();
const xml: Loader = async () => (await import("@codemirror/lang-xml")).xml();
const markdown: Loader = async () => (await import("@codemirror/lang-markdown")).markdown();
const python: Loader = async () => (await import("@codemirror/lang-python")).python();
const go: Loader = async () => (await import("@codemirror/lang-go")).go();
const rust: Loader = async () => (await import("@codemirror/lang-rust")).rust();
const java: Loader = async () => (await import("@codemirror/lang-java")).java();
const cpp: Loader = async () => (await import("@codemirror/lang-cpp")).cpp();
const php: Loader = async () => (await import("@codemirror/lang-php")).php();
const sql: Loader = async () => (await import("@codemirror/lang-sql")).sql();
const yaml: Loader = async () => (await import("@codemirror/lang-yaml")).yaml();
const shell: Loader = () => legacy(async () => (await import("@codemirror/legacy-modes/mode/shell")).shell as StreamParser<unknown>);
const dockerfile: Loader = () => legacy(async () => (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile as StreamParser<unknown>);
const toml: Loader = () => legacy(async () => (await import("@codemirror/legacy-modes/mode/toml")).toml as StreamParser<unknown>);
const ini: Loader = () => legacy(async () => (await import("@codemirror/legacy-modes/mode/properties")).properties as StreamParser<unknown>);
const ruby: Loader = () => legacy(async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby as StreamParser<unknown>);
const csharp: Loader = () => legacy(async () => (await import("@codemirror/legacy-modes/mode/clike")).csharp as StreamParser<unknown>);

const BY_EXTENSION: Record<string, Loader> = {
  ts: typescript,
  mts: typescript,
  cts: typescript,
  tsx,
  js: javascript,
  jsx: javascript,
  mjs: javascript,
  cjs: javascript,
  json,
  jsonc: json,
  css,
  scss: css,
  less: css,
  html,
  htm: html,
  xml,
  svg: xml,
  md: markdown,
  markdown,
  py: python,
  go,
  rs: rust,
  java,
  c: cpp,
  h: cpp,
  cpp,
  cc: cpp,
  cxx: cpp,
  hpp: cpp,
  php,
  sql,
  yaml,
  yml: yaml,
  sh: shell,
  bash: shell,
  zsh: shell,
  toml,
  ini,
  cfg: ini,
  properties: ini,
  env: ini,
  rb: ruby,
  cs: csharp,
};

/** The language for `path`, or `null` for a file edited as plain text. */
export function languageFor(path: string): Promise<Extension | null> {
  const base = path.split("/").pop() ?? path;
  if (/^dockerfile$/i.test(base)) return dockerfile();
  if (/^\.env(\..+)?$/.test(base)) return ini();
  const dot = base.lastIndexOf(".");
  const load = dot < 0 ? undefined : BY_EXTENSION[base.slice(dot + 1).toLowerCase()];
  return load === undefined ? Promise.resolve(null) : load();
}
