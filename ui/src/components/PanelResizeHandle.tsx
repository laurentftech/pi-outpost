import { useCallback, useRef, useState } from "react";
import { clampPanelWidth, readPanelWidth, writePanelWidth, type PanelWidthConfig } from "../util/panelWidth";

interface PointerResize {
  pointerId: number;
  startX: number;
  startWidth: number;
}

export function useResizablePanelWidth(config: PanelWidthConfig, axis: "x" | "y" = "x") {
  const [width, setWidth] = useState(() => readPanelWidth(config));
  const widthRef = useRef(width);
  const pointerResizeRef = useRef<PointerResize | null>(null);

  const updateWidth = useCallback(
    (nextWidth: number) => {
      const clamped = clampPanelWidth(nextWidth, config);
      widthRef.current = clamped;
      setWidth(clamped);
      return clamped;
    },
    [config],
  );

  const finishPointerResize = useCallback(() => {
    if (pointerResizeRef.current === null) return;
    pointerResizeRef.current = null;
    writePanelWidth(widthRef.current, config);
  }, [config]);

  const separatorProps = {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.isPrimary === false || (event.button ?? 0) !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      pointerResizeRef.current = { pointerId: event.pointerId, startX: axis === "y" ? event.clientY : event.clientX, startWidth: widthRef.current };
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = pointerResizeRef.current;
      if (resize === null || resize.pointerId !== event.pointerId) return;
      updateWidth(resize.startWidth + (axis === "y" ? resize.startX - event.clientY : event.clientX - resize.startX));
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      if (pointerResizeRef.current?.pointerId !== event.pointerId) return;
      finishPointerResize();
    },
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = pointerResizeRef.current;
      if (resize === null || resize.pointerId !== event.pointerId) return;
      pointerResizeRef.current = null;
      updateWidth(resize.startWidth);
    },
    onLostPointerCapture: finishPointerResize,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      let nextWidth: number | null = null;
      if (event.key === (axis === "y" ? "ArrowDown" : "ArrowLeft")) nextWidth = widthRef.current - config.keyboardStep;
      else if (event.key === (axis === "y" ? "ArrowUp" : "ArrowRight")) nextWidth = widthRef.current + config.keyboardStep;
      else if (event.key === "Home") nextWidth = config.defaultWidth;
      if (nextWidth === null) return;
      event.preventDefault();
      writePanelWidth(updateWidth(nextWidth), config);
    },
  };

  return { width, separatorProps };
}

interface PanelResizeHandleProps {
  axis?: "x" | "y";
  label: string;
  width: number;
  config: PanelWidthConfig;
  separatorProps: ReturnType<typeof useResizablePanelWidth>["separatorProps"];
  className?: string;
}

export function PanelResizeHandle({ axis = "x", label, width, config, separatorProps, className = "" }: PanelResizeHandleProps) {
  return (
    <div
      {...separatorProps}
      role="separator"
      aria-label={label}
      aria-orientation={axis === "y" ? "horizontal" : "vertical"}
      aria-valuemin={config.minWidth}
      aria-valuemax={config.maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      title={label}
      className={`group absolute z-20 touch-none outline-none ${axis === "y" ? "inset-x-0 -top-1 h-2 cursor-row-resize" : "inset-y-0 -right-1 w-2 cursor-col-resize"} ${className}`}
    >
      <span className={`pointer-events-none absolute ${axis === "y" ? "inset-x-0 top-1/2 h-px" : "inset-y-0 left-1/2 w-px"} bg-transparent transition-colors group-hover:bg-blue-400 group-focus-visible:bg-blue-500 group-active:bg-blue-500 dark:group-hover:bg-blue-500`} />
    </div>
  );
}
