import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useClickOutside } from "../util/clickOutside";
import type { RowAction, RowActionId } from "./fileTreeModel";

interface RowMenuProps {
  /** Accessible name: what the menu acts on. */
  label: string;
  groups: RowAction[][];
  /**
   * Where to open, in the coordinates of the positioned element that holds the menu:
   * below `top`, or ending at `above` when there is no room below.
   */
  anchor: { left: number; top: number; above?: number };
  /** Items that exist but cannot run right now (an operation is pending). */
  disabled?: ReadonlySet<RowActionId>;
  onSelect: (id: RowActionId) => void;
  /** Escape, Tab, a click elsewhere: the menu closes and nothing runs. */
  onClose: () => void;
}

/**
 * The actions menu of a Files tree row, following the WAI-ARIA menu pattern: focus
 * moves into it, arrows and Home/End move between items, Enter runs one, Escape
 * closes it. It stays inside the Files panel — no portal — because the embed must
 * not leak elements into a host page; it flips above its anchor and is clamped
 * sideways when the panel would cut it off.
 */
export function RowMenu({ label, groups, anchor, disabled, onSelect, onClose }: RowMenuProps) {
  const ref = useClickOutside<HTMLDivElement>(onClose);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState(anchor);

  useLayoutEffect(() => {
    items.current.find((item) => item && !item.disabled)?.focus({ preventScroll: true });
    const menu = ref.current;
    const container = menu?.offsetParent as HTMLElement | null;
    if (!menu || !container) return;
    // What can be seen is the nearest scrolling ancestor's box, not the whole tree:
    // a menu opened on the last visible row must open upwards.
    let viewport: HTMLElement | null = container;
    while (viewport && !/(auto|scroll)/.test(getComputedStyle(viewport).overflowY)) viewport = viewport.parentElement;
    const visible = (viewport ?? document.documentElement).getBoundingClientRect();
    const box = container.getBoundingClientRect();
    const height = menu.offsetHeight;
    const width = menu.offsetWidth;
    const visibleBottom = Math.min(visible.bottom, window.innerHeight) - box.top;
    const visibleTop = Math.max(visible.top, 0) - box.top;
    const above = anchor.above ?? anchor.top;
    const top = anchor.top + height > visibleBottom && above - height >= visibleTop ? above - height : anchor.top;
    const left = Math.max(0, Math.min(anchor.left, container.clientWidth - width));
    setPosition({ left, top });
  }, [anchor.left, anchor.top, anchor.above, ref]);

  const enabled = () => items.current.filter((item): item is HTMLButtonElement => item !== null && !item.disabled);
  const move = (event: KeyboardEvent, to: (index: number, count: number) => number) => {
    event.preventDefault();
    const list = enabled();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    list[to(index, list.length)].focus();
  };

  let index = 0;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{ left: position.left, top: position.top }}
      className="absolute z-30 min-w-[12rem] max-w-[calc(100%-0.5rem)] rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") move(event, (i, n) => (i + 1) % n);
        else if (event.key === "ArrowUp") move(event, (i, n) => (i <= 0 ? n - 1 : i - 1));
        else if (event.key === "Home") move(event, () => 0);
        else if (event.key === "End") move(event, (_, n) => n - 1);
        else if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} role="group">
          {groupIndex > 0 && <div role="separator" className="my-1 border-t border-zinc-100 dark:border-zinc-800" />}
          {group.map((action) => {
            const position = index++;
            const off = disabled?.has(action.id) ?? false;
            return (
              <button
                key={action.id}
                ref={(node) => {
                  items.current[position] = node;
                }}
                type="button"
                role="menuitem"
                disabled={off}
                onClick={() => onSelect(action.id)}
                className={`flex w-full items-center gap-3 px-3 py-1 text-left hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none disabled:opacity-40 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800 ${
                  action.danger ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <span className="flex-1 truncate">{action.label}</span>
                {action.shortcut && <span aria-hidden className="text-[10px] text-zinc-400 dark:text-zinc-500">{action.shortcut}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
