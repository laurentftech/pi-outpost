/**
 * The planning view, inside an MCP Apps host (Claude Desktop, and any host that draws
 * `ui://` resources).
 *
 * The host sends show_planning's result, whose structured content is the planning to draw,
 * or list_plannings', which is the folder: the list of plannings, each opening its timeline
 * in place through show_planning.
 * When the reader selects a task or an item, the view:
 * - calls `select_in_planning`, so get_planning tells the model what "it" is;
 * - offers the same sentence to the host's model context, for hosts that pass it on.
 *
 * "Download SVG" goes through the host when it can download files, and otherwise saves
 * the figure in the plannings folder, through the server: a sandboxed frame's own
 * download goes nowhere in Claude Desktop.
 *
 * It never sends a message on the reader's behalf (`ui/message`): a click is not consent
 * to say anything.
 *
 * In a dark host the timeline stays a light card, as it is drawn in pi-outpost: readable,
 * and the same figure the person would export.
 */
import { Component, StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { StructuredTimelineData } from "@pi-outpost/shared/structured-exchange";
import { TimelineView } from "../../ui/src/presentations/TimelineView";
import "@pi-outpost/apps-core/viewer.css";

/** show_planning's structured content (`ShownPlanning` in src/server.ts). */
interface ShownPlanning {
  id: string;
  title: string;
  revision: number;
  data: StructuredTimelineData;
  comparedWith?: number;
}

type Selection = Parameters<NonNullable<Parameters<typeof TimelineView>[0]["onSelect"]>>[0];

function sentenceFor(planning: ShownPlanning, selection: Selection): string {
  const where = `in planning "${planning.title}" (${planning.id})`;
  if (!selection) return `The user cleared their selection ${where}.`;
  const { task, item } = selection;
  if (!item) return `The user selected task "${task.label}" (${task.id}) ${where}.`;
  const when = item.type === "milestone" ? `on ${item.date}` : `from ${item.start} to ${item.end}`;
  return `The user selected ${item.type} "${item.label ?? item.kind ?? item.id}" (${item.id}) of task "${task.label}" (${task.id}), ${when}, ${where}.`;
}

/** list_plannings' structured content (`ListedPlannings` in src/server.ts). */
interface ListedPlannings {
  folder: string;
  selection?: unknown;
  plannings: Array<{ id: string; title: string; revision: number; file: string; updated: string; unreadable?: unknown }>;
}

type Shown = { mode: "list"; listed: ListedPlannings } | { mode: "planning"; planning: ShownPlanning; fromList?: ListedPlannings };

function contentOf(structured: Record<string, unknown>): Shown | undefined {
  if (Array.isArray(structured.plannings)) return { mode: "list", listed: structured as unknown as ListedPlannings };
  const data = structured.data as { rows?: unknown } | undefined;
  if (typeof structured.id === "string" && Array.isArray(data?.rows)) return { mode: "planning", planning: structured as unknown as ShownPlanning };
  return undefined;
}

/** Says what went wrong instead of leaving an empty frame: an empty frame tells the person nothing. */
class Failsafe extends Component<{ children: ReactNode }, { failure?: Error }> {
  state: { failure?: Error } = {};
  static getDerivedStateFromError(failure: Error) {
    return { failure };
  }
  render() {
    if (!this.state.failure) return this.props.children;
    return (
      <p className="p-2 text-sm" role="alert">
        This could not be drawn: {this.state.failure.message}. Ask again, or reinstall the extension if it persists.
      </p>
    );
  }
}

function folderName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}

function PlanningList({ listed, locale, onOpen }: { listed: ListedPlannings; locale?: string; onOpen: (id: string) => void }) {
  const when = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return iso;
    }
  };
  return (
    <div className="px-3 py-2 text-sm" data-testid="planning-list">
      <p className="mb-2 text-neutral-500" title={listed.folder}>
        Folder <span className="font-medium text-neutral-800">{folderName(listed.folder)}</span> · {listed.plannings.length}{" "}
        {listed.plannings.length === 1 ? "planning" : "plannings"}
      </p>
      {listed.plannings.length === 0 ? (
        <p className="text-neutral-500">No planning yet: ask for one.</p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {listed.plannings.map((planning) => (
            <li key={planning.id} data-planning={planning.id}>
              <button type="button" className="flex w-full items-baseline gap-3 py-1.5 text-left hover:bg-neutral-50" onClick={() => onOpen(planning.id)}>
                <span className="font-medium">{planning.title}</span>
                <span className="text-xs text-neutral-500">revision {planning.revision}</span>
                {planning.unreadable !== undefined && <span className="text-xs text-red-700">unreadable file</span>}
                <span className="ml-auto truncate text-xs text-neutral-500" title={planning.file}>
                  {planning.file} · {when(planning.updated)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanningApp() {
  const [shown, setShown] = useState<Shown | undefined>();
  const [opening, setOpening] = useState<string | undefined>();
  const [unknown, setUnknown] = useState(false);
  const [context, setContext] = useState<McpUiHostContext | undefined>();
  const { app, error } = useApp({
    appInfo: { name: "pi-outpost planning", version: "1" },
    capabilities: {},
    onAppCreated: (created) => {
      created.ontoolresult = async (result) => {
        if (!result.structuredContent || result.isError) return;
        const content = contentOf(result.structuredContent as Record<string, unknown>);
        if (content) setShown(content);
        else setUnknown(true);
      };
      created.onhostcontextchanged = (params) => setContext((previous) => ({ ...previous, ...params }));
    },
  });

  useEffect(() => {
    if (app) setContext(app.getHostContext());
  }, [app]);

  useEffect(() => {
    // The page itself follows the host, so nothing glares around the card.
    document.documentElement.dataset.hostTheme = context?.theme === "dark" ? "dark" : "light";
  }, [context?.theme]);

  if (error) return <p className="p-2 text-sm">This planning could not be drawn: {error.message}</p>;
  if (unknown && !shown) return <p className="p-2 text-sm" role="alert">This view does not know what it was sent. Reinstall the extension.</p>;
  if (!app || !shown) return <p className="p-2 text-sm opacity-70">Loading the planning…</p>;

  const fullscreen = context?.displayMode === "fullscreen";
  const canFullscreen = context?.availableDisplayModes?.includes("fullscreen") ?? false;
  const fullscreenButton = canFullscreen && (
    <button
      type="button"
      className="ml-auto rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
      onClick={() => void app.requestDisplayMode({ mode: fullscreen ? "inline" : "fullscreen" }).catch(() => undefined)}
    >
      {fullscreen ? "Exit full screen" : "Full screen"}
    </button>
  );

  /** Opens a planning from the list, through the server, in place: nothing is said in the conversation. */
  const open = async (listed: ListedPlannings, id: string) => {
    setOpening(id);
    try {
      const result = await app.callServerTool({ name: "show_planning", arguments: { id } });
      if (!result.isError && result.structuredContent) setShown({ mode: "planning", planning: result.structuredContent as unknown as ShownPlanning, fromList: listed });
    } finally {
      setOpening(undefined);
    }
  };

  if (shown.mode === "list") {
    const { listed } = shown;
    return (
      <div className="planning-card rounded-lg bg-white text-neutral-900" data-theme="light">
        <div className="flex items-center gap-2 px-3 pt-2 text-sm">
          {opening !== undefined && <span className="text-neutral-500">Opening…</span>}
          {fullscreenButton}
        </div>
        <PlanningList listed={listed} locale={context?.locale} onOpen={(id) => void open(listed, id)} />
      </div>
    );
  }

  const { planning, fromList } = shown;
  return (
    <div className="planning-card rounded-lg bg-white text-neutral-900" data-theme="light">
      <div className="flex items-center gap-2 px-3 pt-2 text-sm">
        {fromList && (
          <button type="button" className="text-neutral-600 underline" onClick={() => setShown({ mode: "list", listed: fromList })}>
            ← All plannings
          </button>
        )}
        {/* No title here: the timeline draws its own. */}
        <span className="text-neutral-500">
          revision {planning.revision}
          {planning.comparedWith !== undefined ? ` · compared with revision ${planning.comparedWith}` : ""}
        </span>
        {fullscreenButton}
      </div>
      <TimelineView
        key={planning.id}
        data={planning.data}
        saveFigure={async (fileName, markup) => {
          if (app.getHostCapabilities()?.downloadFile) {
            const { isError } = await app.downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${fileName}`, mimeType: "image/svg+xml", text: markup } }] });
            if (!isError) return "SVG downloaded";
          }
          const saved = await app.callServerTool({ name: "save_figure", arguments: { file_name: fileName, svg: markup } });
          const file = (saved.structuredContent as { file?: string } | undefined)?.file;
          return saved.isError || !file ? false : `Saved in your plannings folder as "${file}"`;
        }}
        onSelect={(selection) => {
          const args = !selection ? { id: planning.id } : { id: planning.id, task: selection.task.id, ...(selection.item?.id !== undefined ? { item: selection.item.id } : {}) };
          void app.callServerTool({ name: "select_in_planning", arguments: args }).catch(() => undefined);
          void app.updateModelContext({ content: [{ type: "text", text: sentenceFor(planning, selection) }] }).catch(() => undefined);
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Failsafe>
      <PlanningApp />
    </Failsafe>
  </StrictMode>,
);
