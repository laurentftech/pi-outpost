import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A message shown for a moment, then gone: "SVG markup copied", "could not save".
 *
 * The timer that clears it is the component's to cancel. A bare `setTimeout` outlives
 * an unmount — closing the view within the delay — and then sets the state of a
 * component that is gone, or, once the page itself is gone, calls into a `window`
 * that no longer exists. A second message restarts the delay rather than being cut
 * short by the first one's timer.
 */
export function useFlash<T>(ms: number): [T | null, (message: T) => void] {
  const [message, setMessage] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const flash = useCallback(
    (next: T) => {
      if (timer.current !== null) clearTimeout(timer.current);
      setMessage(next);
      timer.current = setTimeout(() => {
        timer.current = null;
        setMessage(null);
      }, ms);
    },
    [ms],
  );
  return [message, flash];
}
