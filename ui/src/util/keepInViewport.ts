/**
 * A callback ref for a dropdown anchored to its control: once it is laid out, slide
 * it sideways just enough to keep it inside the window. Anchored to the right edge of
 * a control in the middle of a narrow header, a 24rem menu otherwise opens with its
 * left part off screen, out of reach.
 */
export function keepInViewport(element: HTMLElement | null): void {
  if (!element) return;
  element.style.translate = "";
  const margin = 8;
  const width = element.ownerDocument.documentElement.clientWidth;
  const box = element.getBoundingClientRect();
  let shift = 0;
  if (box.right > width - margin) shift = width - margin - box.right;
  if (box.left + shift < margin) shift = margin - box.left;
  if (shift !== 0) element.style.translate = `${Math.round(shift)}px 0`;
}
