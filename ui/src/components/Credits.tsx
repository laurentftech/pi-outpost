import { useLayoutEffect, useRef, useState } from "react";
import { credits, projectLicense } from "../credits";

const acknowledgements = [
  ["draw.io / diagrams.net", "Diagram viewer and editor"],
  ["React", "User interface"],
  ["CodeMirror · xterm.js · node-pty", "Code editor and terminal"],
  ["PDF.js · docx", "Document tools"],
  ["Mermaid · KaTeX", "Diagrams and mathematical notation"],
];
const notices = [{ name: "pi-outpost", license: "MIT", text: projectLicense }, ...credits];

export function Credits() {
  const [showNotices, setShowNotices] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const scroller = heading.current?.closest(".overflow-y-auto");
    if (scroller) scroller.scrollTop = 0;
  }, [showNotices]);

  if (showNotices) return <div className="text-zinc-700 dark:text-zinc-300">
    <button type="button" onClick={() => setShowNotices(false)} className="mb-3 text-xs text-zinc-500 hover:underline dark:text-zinc-400">← Back to credits</button>
    <h3 ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">Third-party notices</h3>
    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">License texts and attributions for pi-outpost and the components acknowledged here.</p>
    {notices.map(entry => <section key={entry.name} className="mt-5 border-t border-zinc-200 pt-3 dark:border-zinc-700">
      <h4 className="text-sm font-semibold">{entry.name} <span className="font-normal text-zinc-500 dark:text-zinc-400">· {entry.license}</span></h4>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{entry.text}</pre>
    </section>)}
  </div>;

  return <div className="text-sm text-zinc-700 dark:text-zinc-300">
    <section className="pb-5">
      <h3 ref={heading} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">pi-outpost</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Created by Laurent Francoise · MIT license</p>
      <a className="mt-3 inline-flex items-center gap-2 text-xs underline underline-offset-4" href="https://laurentftech.github.io/pi-outpost/" target="_blank" rel="noopener noreferrer">Project website <span aria-hidden="true">↗</span></a>
    </section>
    <section className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Open-source acknowledgements</h3>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Thanks to the authors and contributors of these projects.</p>
      <dl className="mt-3 space-y-3">
        {acknowledgements.map(([name, role]) => <div key={name}><dt className="text-xs font-medium">{name}</dt><dd className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{role}</dd></div>)}
      </dl>
      <button type="button" onClick={() => setShowNotices(true)} className="mt-4 flex w-full items-center justify-between rounded-md border border-zinc-300 px-3 py-2 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Third-party notices <span aria-hidden="true">→</span></button>
    </section>
  </div>;
}
