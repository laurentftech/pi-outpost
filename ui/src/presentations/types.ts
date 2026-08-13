import type { ComponentType } from "react";
import type { ChatItem } from "@pi-outpost/shared";

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/**
 * The closed set of things a presentation may ask the application to do.
 * A presentation names an action; it never constructs a wire message, never
 * invokes a tool, and never submits a prompt — that escalation path is closed
 * by construction rather than by an approval prompt (see design.md, decision 4).
 */
export type ToolAction =
  | { kind: "openFile"; path: string }
  | { kind: "openFileHistory"; path: string }
  | { kind: "openWorktreeDiff"; path: string }
  | { kind: "searchWorkspace"; query: string };

export type ToolActionKind = ToolAction["kind"];

/** Runs a named action. Unknown names are dropped, not sent. */
export type ActionDispatch = (action: ToolAction) => void;

export interface PresentationProps {
  item: ToolItem;
  dispatch: ActionDispatch;
}

/**
 * One entry of the ordered registry. `Collapsed` is the preview shown while the
 * card is folded; `Expanded` is the body shown when it is open. A presentation
 * that reshapes its result sets `showsRawReveal` so the original output stays
 * reachable from the expanded body.
 */
export interface Presentation {
  id: string;
  match: (item: ToolItem) => boolean;
  /**
   * True when `match` reads only `toolName`/`args` — both known at tool_start,
   * so the choice cannot change when output arrives.
   */
  stable: boolean;
  /**
   * True when an installed extension supplied this rendering. Such an entry may
   * replace an already-chosen presentation once output lands: the extension owns
   * the tool's presentation more authoritatively than our built-in guess.
   */
  extensionOwned?: boolean;
  /** Card opens expanded (the body is the point of the card, as for a diff). */
  startsExpanded?: boolean;
  /** The expanded body reshapes the output, so offer the original alongside it. */
  showsRawReveal?: boolean;
  /**
   * Whether `Collapsed` has anything to show for this call. Defaults to "yes,
   * whenever `Collapsed` exists"; an entry whose preview depends on a field that
   * may be absent answers per item so the card does not grow an empty panel.
   */
  hasCollapsed?: (item: ToolItem) => boolean;
  Collapsed?: ComponentType<PresentationProps>;
  Expanded: ComponentType<PresentationProps>;
}
