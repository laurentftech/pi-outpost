import { useState } from "react";
import type { CSSProperties } from "react";
import type { AgentCollectionSkill, AgentResourceCollection, AgentSkillCatalogueBound } from "@pi-outpost/shared";

/** Above this many, the summary would be the whole list again; "Only on" takes over. */
const SUMMARY_LIMIT = 30;
const CLAMP_TWO_LINES: CSSProperties = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

/**
 * A skill collection's catalogue, grouped by the folders the repository keeps
 * them in, one switch per skill.
 *
 * The switches show `enabled` — the selection the dialog is about to apply —
 * and each skill's supplied state underneath, so a change that has not been
 * applied yet reads as pending rather than as done. Nothing here talks to the
 * server: every switch and bulk action reports the complete next selection
 * through `onChange`.
 */
export function CollectionSkills({
  skills,
  groups,
  enabled,
  onChange,
  disabled = false,
  bound,
}: {
  skills: readonly AgentCollectionSkill[];
  groups: AgentResourceCollection["groups"];
  enabled: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
  bound?: AgentSkillCatalogueBound;
}) {
  // A large collection opens folded — 34 folders fit on a screen, 700 skills do not —
  // except the folders holding a skill that is on: those are what the user looks for.
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    skills.length > 40
      ? new Set(skills.filter((skill) => enabled.has(skill.relativePath)).map((skill) => skill.group))
      : new Set(groups.map((group) => group.path)),
  );
  const [query, setQuery] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);
  const needle = query.trim().toLocaleLowerCase();
  const filtering = needle !== "" || onlyOn;
  const visible = (skill: AgentCollectionSkill) =>
    (!onlyOn || enabled.has(skill.relativePath)) &&
    (!needle || `${skill.name} ${skill.relativePath} ${skill.description ?? ""}`.toLocaleLowerCase().includes(needle));
  const byGroup = new Map<string, AgentCollectionSkill[]>();
  for (const skill of skills) byGroup.set(skill.group, [...(byGroup.get(skill.group) ?? []), skill]);
  const onCount = skills.filter((skill) => enabled.has(skill.relativePath)).length;
  const matchCount = filtering ? skills.filter(visible).length : skills.length;
  const setAll = (members: readonly AgentCollectionSkill[], on: boolean) => {
    const next = new Set(enabled);
    for (const skill of members) {
      if (on) next.add(skill.relativePath);
      else next.delete(skill.relativePath);
    }
    onChange(next);
  };
  const toggle = (relativePath: string) => {
    const next = new Set(enabled);
    if (next.has(relativePath)) next.delete(relativePath);
    else next.add(relativePath);
    onChange(next);
  };
  const flip = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" aria-label="Collection skills">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Skills <span className="font-normal text-zinc-500">· {onCount} of {skills.length} on</span>
        </h3>
        <div className="flex gap-2">
          <button type="button" disabled={disabled || onCount === skills.length} onClick={() => setAll(skills, true)} className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-50">All on</button>
          <button type="button" disabled={disabled || onCount === 0} onClick={() => setAll(skills, false)} className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-50">All off</button>
        </div>
      </div>
      {bound ? (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {bound.kind === "count"
            ? `This repository holds more skills than the ${bound.limit} listed here.`
            : `Folders deeper than ${bound.limit} levels were not searched for skills.`}
        </p>
      ) : null}
      {skills.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search skills"
            placeholder="Search skills by name or folder"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 rounded-md border bg-transparent px-2.5 py-1 text-xs"
          />
          <button
            type="button"
            aria-pressed={onlyOn}
            onClick={() => setOnlyOn((value) => !value)}
            className={`rounded-md px-2.5 py-1 text-xs ${onlyOn ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border"}`}
          >
            Only on ({onCount})
          </button>
        </div>
      ) : null}
      {/* The first question on coming back is "which ones are on?" — answered here,
          above 35 folders, rather than at line 330 of the one folder holding it. */}
      {!filtering && onCount > 0 && onCount <= SUMMARY_LIMIT ? (
        <div role="region" aria-label="Skills that are on" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="px-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">Turned on</p>
          <ul className="mt-1 space-y-1">
            {skills.filter((skill) => enabled.has(skill.relativePath)).map((skill) => (
              <li key={skill.relativePath} className="flex items-start justify-between gap-2 px-1">
                <span className="min-w-0 text-xs">
                  <span className="font-medium text-zinc-800 dark:text-zinc-100">{skill.name}</span>{" "}
                  <span className="font-mono text-[11px] text-zinc-500">{skill.group || "(repository root)"}</span>
                  <SkillState skill={skill} checked />
                </span>
                <button
                  type="button"
                  aria-label={`Turn off ${skill.name} (${skill.relativePath})`}
                  disabled={disabled}
                  onClick={() => toggle(skill.relativePath)}
                  className="shrink-0 rounded border bg-white px-2 py-0.5 text-[11px] disabled:opacity-50 dark:bg-zinc-900"
                >
                  Turn off
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {skills.length === 0 ? <p className="mt-4 text-xs text-zinc-400">This repository holds no skills.</p> : null}
      {filtering && matchCount === 0 ? <p className="mt-4 text-xs text-zinc-400">{onlyOn && !needle ? "No skill is on." : "No skill matches."}</p> : null}
      <ul className="mt-3 space-y-2">
        {groups.map((group) => {
          // While filtering, a folder shows only its matches, open, and its bulk
          // switches act on those alone — never on skills the filter is hiding.
          const all = byGroup.get(group.path) ?? [];
          const members = filtering ? all.filter(visible) : all;
          if (filtering && members.length === 0) return null;
          const on = members.filter((skill) => enabled.has(skill.relativePath)).length;
          const open = filtering || expanded.has(group.path);
          return (
            <li key={group.path} className="rounded-lg border border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button type="button" aria-expanded={open} onClick={() => flip(group.path)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span aria-hidden="true" className="text-xs text-zinc-400">{open ? "▾" : "▸"}</span>
                  <span className="truncate font-mono text-xs font-medium text-zinc-700 dark:text-zinc-200">{group.label}</span>
                  <span className="shrink-0 text-[11px] text-zinc-500">{on}/{members.length} on</span>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button type="button" aria-label={`All on in ${group.label}`} disabled={disabled || on === members.length} onClick={() => setAll(members, true)} className="rounded border px-2 py-0.5 text-[11px] disabled:opacity-50">All on</button>
                  <button type="button" aria-label={`All off in ${group.label}`} disabled={disabled || on === 0} onClick={() => setAll(members, false)} className="rounded border px-2 py-0.5 text-[11px] disabled:opacity-50">All off</button>
                </div>
              </div>
              {open ? (
                <ul className="space-y-1 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                  {members.map((skill) => {
                    const checked = enabled.has(skill.relativePath);
                    return (
                      <li key={skill.relativePath}>
                        <label className={`flex items-start gap-2 rounded px-1 py-1 ${disabled ? "opacity-60" : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60"}`}>
                          <input
                            type="checkbox"
                            role="switch"
                            aria-checked={checked}
                            aria-label={`${skill.name} (${skill.relativePath})`}
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggle(skill.relativePath)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-zinc-800 dark:text-zinc-100">{skill.name}</span>
                            {/* Inline rather than `line-clamp-2`: the embedded build ships no such
                                utility, and unclamped descriptions made each row six lines tall. */}
                            {skill.description ? <span title={skill.description} style={CLAMP_TWO_LINES} className="text-[11px] text-zinc-500">{skill.description}</span> : null}
                            <SkillState skill={skill} checked={checked} />
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SkillState({ skill, checked }: { skill: AgentCollectionSkill; checked: boolean }) {
  const suppliedOn = skill.state !== "off";
  if (checked !== suppliedOn) {
    return <span className="block text-[11px] font-medium text-sky-700 dark:text-sky-300">{checked ? "Pending: on" : "Pending: off"}</span>;
  }
  if (skill.state === "on-loaded") return <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">Loaded</span>;
  if (skill.state === "on-not-loaded") return <span className="block text-[11px] text-amber-700 dark:text-amber-400">Not loaded — {skill.reason}</span>;
  if (skill.state === "on-missing") return <span className="block text-[11px] text-rose-700 dark:text-rose-400">Missing — {skill.reason}</span>;
  return null;
}

/** Folder groups for a catalogue that arrived without them, as a preview does. */
export function groupsOf(skills: readonly { group: string }[], repositoryName: string): AgentResourceCollection["groups"] {
  return [...new Set(skills.map((skill) => skill.group))].sort().map((group) => ({ path: group, label: group || repositoryName }));
}

/** The skills a collection's inventory reports as on, loaded or not. */
export function suppliedSelection(collection: AgentResourceCollection): string[] {
  return collection.skills.filter((skill) => skill.state !== "off").map((skill) => skill.relativePath);
}

export function sameSelection(a: Iterable<string>, b: Iterable<string>): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
}
