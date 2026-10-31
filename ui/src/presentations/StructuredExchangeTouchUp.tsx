/**
 * A structured-exchange graph arranged in draw.io's touch-up (structured-exchange-arrangement,
 * design 6). The page the figure draws is opened in the touch-up frame, in memory — no `.drawio`
 * is written anywhere — and keeping it reads the boxes' places, the wires' ends and bends and the
 * labels' places back into the arrangement, by identity. What is not arrangement is named and
 * left out.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { readDrawio } from "@pi-outpost/shared/drawio/read";
import { writeDrawio } from "@pi-outpost/shared/drawio/write";
import { arrangedGraph } from "@pi-outpost/shared/structured-exchange/figure";
import { readTouchUp } from "@pi-outpost/shared/structured-exchange/touch-up";
import { elementKey, relationshipKeys, type ArrangementView } from "@pi-outpost/shared/structured-exchange/arrangement";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";
import type { Orientation } from "@pi-outpost/shared/diagram-orientation";
import { DrawioFrame, type DrawioFrameHandle, type DrawioTouchUpState } from "../components/DrawioFrame";
import { useDrawioFiles } from "../components/drawioFiles";
import { DIAGRAM_ACTION, DIAGRAM_ACTIONS } from "../components/diagramControls";
import type { Narrowing } from "./structuredExchange";

const CLEAN: DrawioTouchUpState = { dirty: false, canUndo: false, canRedo: false };
const DISCARD = "Leave without keeping the touch-ups?";

export function StructuredExchangeTouchUp({
  data,
  hidden,
  orientation,
  arrangement,
  onArrange,
  onNote,
  onDone,
}: {
  data: StructuredGraphData;
  hidden: Narrowing;
  orientation: Orientation;
  arrangement: ArrangementView | undefined;
  /** The arrangement the touch-up amounts to, kept. */
  onArrange: (next: ArrangementView) => void;
  /** What was done in the touch-up and not kept, said under the figure; undefined clears it. */
  onNote: (note: string | undefined) => void;
  onDone: () => void;
}) {
  const { serverUrl } = useDrawioFiles();
  const frame = useRef<DrawioFrameHandle>(null);
  const [state, setState] = useState<DrawioTouchUpState>(CLEAN);
  const [keeping, setKeeping] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // "Done" pressed while a keep is in flight: leave once it has landed, not before and not by asking
  const leaveAfterKeep = useRef(false);
  const keepingRef = useRef(false);
  // The page as it was when the touch-up opened: what the touch-up is read against
  const open = () => arrangedGraph(data, { hidden, orientation, ...(arrangement === undefined ? {} : { arrangement }) });
  const [opened, setOpened] = useState(open);
  const openedData = useRef(data);
  // Which opening of the frame this is: a new one draws the page afresh
  const [generation, setGeneration] = useState(0);
  const [changed, setChanged] = useState(false);
  // The document changed on disk under the touch-up. With nothing to keep, the touch-up starts
  // again on what the document holds now; with touch-ups pending it says so, and a keep takes
  // only the places of what the document still holds
  useEffect(() => {
    if (data === openedData.current) return;
    if (state.dirty) {
      setChanged(true);
      return;
    }
    openedData.current = data;
    setOpened(open());
    setGeneration((current) => current + 1);
    setChanged(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state.dirty]);
  // Kept current across keeps, so a second keep reads against the first one's result
  const startedFrom = useRef(arrangement);
  const xml = useMemo(() => writeDrawio(opened.page), [opened]);

  async function keep() {
    if (keepingRef.current) return;
    keepingRef.current = true;
    setKeeping(true);
    setProblem(null);
    try {
      const saved = await frame.current!.save();
      const [page] = readDrawio(saved.xml);
      if (page === undefined) throw new Error("the touch-up returned no page");
      const read = readTouchUp(opened.shown, opened.page, page, startedFrom.current, orientation);
      // Read against the page that was opened; kept only for what the document holds now
      const elements = new Set(data.nodes.map(elementKey));
      const relationships = new Set(relationshipKeys(data));
      const view: ArrangementView = {
        ...read.view,
        elements: Object.fromEntries(Object.entries(read.view.elements).filter(([key]) => elements.has(key) || startedFrom.current?.elements[key] !== undefined)),
        relationships: Object.fromEntries(Object.entries(read.view.relationships).filter(([key]) => relationships.has(key) || startedFrom.current?.relationships[key] !== undefined)),
      };
      const notKept = read.notKept;
      startedFrom.current = view;
      onArrange(view);
      frame.current?.markClean();
      onNote(notKept.length === 0 ? undefined : `Kept the arrangement. Not kept: ${notKept.join("; ")}.`);
      if (leaveAfterKeep.current) onDone();
    } catch (error) {
      // A failed keep keeps the touch-up open, whatever was pressed meanwhile
      leaveAfterKeep.current = false;
      setProblem(`Could not keep the touch-up: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      keepingRef.current = false;
      setKeeping(false);
    }
  }

  function done() {
    if (keepingRef.current) {
      leaveAfterKeep.current = true;
      return;
    }
    if (state.dirty && !window.confirm(DISCARD)) return;
    onDone();
  }

  return (
    <div data-testid="structured-touchup" className="flex flex-col gap-1">
      <div className={DIAGRAM_ACTIONS}>
        <button type="button" className={DIAGRAM_ACTION} disabled={!state.dirty || keeping} onClick={() => void keep()}>
          {keeping ? "keeping…" : "✓ keep"}
        </button>
        <button type="button" className={DIAGRAM_ACTION} disabled={!state.canUndo} onClick={() => frame.current?.undo()} title="Undo (⌘Z / Ctrl+Z)">
          ↶ undo
        </button>
        <button type="button" className={DIAGRAM_ACTION} disabled={!state.canRedo} onClick={() => frame.current?.redo()} title="Redo (⇧⌘Z / Ctrl+Y)">
          ↷ redo
        </button>
        <button
          type="button"
          className={DIAGRAM_ACTION}
          disabled={!state.bends}
          onClick={() => frame.current?.removeBends()}
          title="Remove the bends of the selected wires — or of every wire when none is selected. Click a bend and press Delete to remove just that one."
        >
          remove bends
        </button>
        <button type="button" className={DIAGRAM_ACTION} onClick={done} title="Leave the touch-up; touch-ups not kept are asked about first">
          done
        </button>
        <span className="text-xs text-zinc-400" data-testid="structured-touchup-status">
          {state.dirty ? "● not kept yet" : "arranging — drag boxes, wire ends and labels; the document's content is not changed from here"}
        </span>
        {changed && (
          <span role="status" data-testid="structured-touchup-changed" className="text-xs text-amber-700 dark:text-amber-300">
            The document changed on disk since this touch-up began: keeping takes only the places of what it still holds. Leave and arrange again to see it as it is now.
          </span>
        )}
        {problem !== null && (
          <span role="alert" className="text-xs text-red-600 dark:text-red-400">
            {problem}
          </span>
        )}
      </div>
      <DrawioFrame key={generation} ref={frame} xml={xml} serverUrl={serverUrl} title="Arrange in draw.io" editing onTouchUpChange={setState} onEscape={done} className="flex h-[32rem] flex-col" />
    </div>
  );
}
