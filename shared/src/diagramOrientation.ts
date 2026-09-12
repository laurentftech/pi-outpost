/**
 * Which way a diagram flows, and who decides.
 *
 * One rule for two surfaces that are nothing alike. The structured-exchange graph is
 * laid out here, so its orientation is chosen before anything is drawn. A Mermaid
 * diagram is a source string the model wrote, rendered by a library we do not lay
 * out, so its orientation can only be judged after a first render. Both end up
 * asking the same question of the same function, which is the point: a reader
 * scrolling one transcript past both should not meet two different notions of when a
 * diagram is too wide.
 *
 * What deliberately does not enter the decision is the window. A figure is also
 * produced where no window exists — `AFigureCanBeProducedWithoutABrowser`, and the
 * agent writing one to a path — and a viewport-dependent rule would orient those
 * differently from the reader's screen. The figure an agent references from a report
 * would then not be the figure the reader approved, which is the one promise this
 * whole surface is built on.
 */

export type Orientation = "landscape" | "portrait";

/**
 * The width a diagram gets to be read in, measured rather than guessed.
 *
 * A structured-exchange block is 710px wide in the conversation column at its widest
 * — a `max-w-3xl` column of 768px, less the column's and the tool card's padding —
 * read off the running bench. It is a constant and not a measurement of the actual
 * container on purpose; see the note above.
 *
 * The two surfaces punish going past it differently, and both are bad. The graph
 * rendering draws at natural size in a horizontally scrolling box, so the reader
 * stops seeing the whole diagram at once. A Mermaid block shrinks its SVG to fit, so
 * the diagram stays whole and its labels go under reading size.
 */
export const READING_WIDTH = 710;

/**
 * How much narrower the turned layout has to be before turning is worth it.
 *
 * Turning a diagram the reader did not ask to turn is a surprise, and a surprise that
 * buys five percent of width is a bug with a rationale. A fifth is the point where
 * the picture is visibly a different, better shape.
 */
const WORTH_TURNING = 0.8;

/** The other one. */
export function otherOrientation(orientation: Orientation): Orientation {
  return orientation === "landscape" ? "portrait" : "landscape";
}

/**
 * The orientation to draw in, given how wide the diagram comes out each way.
 *
 * Landscape holds while it fits: below the reading width nothing is lost, and there
 * is no case for rearranging a picture that was already whole. Past it, turning is
 * offered only when it actually buys the width back — a three-box chain is narrower
 * stacked, and stacking it would be pure churn.
 *
 * A width that is not a number means a layout we could not measure, which is not a
 * reason to rearrange anything: it leaves the diagram as it is.
 */
export function orientationFor(landscapeWidth: number, portraitWidth: number): Orientation {
  if (!Number.isFinite(landscapeWidth) || !Number.isFinite(portraitWidth)) return "landscape";
  if (landscapeWidth <= READING_WIDTH) return "landscape";
  return portraitWidth <= landscapeWidth * WORTH_TURNING ? "portrait" : "landscape";
}
