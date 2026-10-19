/**
 * The header's controls, sized as one row.
 *
 * Each control used to size itself from its text: on a bar too narrow for all of them,
 * the browser shrank them and wrapped their labels, so "pi-outpost", "files" or a branch
 * name went onto two lines and every box ended up a different height. Every control is
 * now one height and never wraps.
 */
export const HEADER_CONTROL = "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-xs leading-none";

/**
 * For a label whose length the user does not choose — a project, a branch, a root, an
 * extension's status. These give up width before anything else, cut with an ellipsis;
 * the full text is the control's title. Put `truncate` on the text inside. The element
 * that is the header's flex item (the control, or the menu wrapping it) carries the
 * floor — `min-w-[4rem]`, enough for "pi-…" — since a flex item keeps the width of its
 * content unless told it may have less, and one told "0" crushes to an unreadable stub.
 */
export const HEADER_CONTROL_SHRINKS = "inline-flex h-7 min-w-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-xs leading-none";
