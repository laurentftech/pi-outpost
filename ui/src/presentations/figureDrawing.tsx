/**
 * Drawing a figure in the browser: the shapes, the groups, and the arrowheads.
 *
 * Shared by every view that draws a figure computed in `shared/` — graphs,
 * sequences and timelines — so all of them paint from the same model the file
 * serializer writes, and add only what a pointer needs.
 */
import type { FigureGroup, FigureMarker, Primitive } from "@pi-outpost/shared/structured-exchange/figure";

/**
 * One shape, as an element.
 *
 * Decides nothing. Every colour, coordinate and piece of text arrived computed, from
 * the same function that feeds the serializer — which is what stops the picture on
 * screen and the picture in a file from being two different pictures.
 */
export function Shape({ primitive }: { primitive: Primitive }) {
  const data = Object.fromEntries(
    Object.entries(primitive.data ?? {}).map(([name, value]) => [`data-${name}`, value]),
  );
  switch (primitive.shape) {
    case "rect":
      return (
        <rect
          {...data}
          x={primitive.x}
          y={primitive.y}
          width={primitive.width}
          height={primitive.height}
          rx={primitive.rx}
          fill={primitive.fill}
          fillOpacity={primitive.fillOpacity}
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
          strokeDasharray={primitive.strokeDasharray}
          opacity={primitive.opacity}
        />
      );
    case "text":
      return (
        <text
          {...data}
          data-testid={primitive.testId}
          x={primitive.x}
          y={primitive.y}
          fontSize={primitive.fontSize}
          fontFamily={primitive.fontFamily}
          fontWeight={primitive.fontWeight}
          fontStyle={primitive.fontStyle}
          textAnchor={primitive.textAnchor}
          fill={primitive.fill}
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
          paintOrder={primitive.paintOrder}
          textDecoration={primitive.textDecoration}
          opacity={primitive.opacity}
        >
          {primitive.text}
          {primitive.note !== undefined && (
            <>
              {" "}
              <tspan fontStyle="italic">{primitive.note}</tspan>
            </>
          )}
        </text>
      );
    case "line":
      return (
        <line
          {...data}
          x1={primitive.x1}
          y1={primitive.y1}
          x2={primitive.x2}
          y2={primitive.y2}
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
          strokeDasharray={primitive.strokeDasharray}
          opacity={primitive.opacity}
          markerEnd={primitive.markerEnd === undefined ? undefined : `url(#${primitive.markerEnd})`}
        />
      );
    case "path":
      return (
        <path
          {...data}
          d={primitive.d}
          fill={primitive.fill ?? "none"}
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
          strokeDasharray={primitive.strokeDasharray}
          strokeLinecap={primitive.strokeLinecap}
          opacity={primitive.opacity}
          markerEnd={primitive.markerEnd === undefined ? undefined : `url(#${primitive.markerEnd})`}
          pointerEvents="none"
        />
      );
  }
}

/** What a browser adds to a drawn group: handlers, cursors, and a hit area. */
export type Interaction = { extra?: React.SVGProps<SVGGElement>; before?: React.ReactNode };

/**
 * The shapes of one declared thing, with whatever this browser adds to them.
 *
 * Recurses one level, because the key is a group of switchable groups. The
 * interaction function is passed down rather than applied here, so a nested entry is
 * offered a pointer on the same terms as anything else drawn.
 */
export function Drawn({
  group,
  interaction,
}: {
  group: FigureGroup;
  interaction?: (group: FigureGroup) => Interaction;
}) {
  const data = Object.fromEntries(
    Object.entries(group.data ?? {}).map(([name, value]) => [`data-${name}`, value]),
  );
  const { extra, before } = interaction?.(group) ?? {};
  return (
    <g {...data} data-testid={group.testId} opacity={group.opacity} {...extra}>
      {group.title === undefined ? null : <title>{group.title}</title>}
      {before}
      {group.primitives.map((primitive, index) => (
        <Shape key={index} primitive={primitive} />
      ))}
      {(group.groups ?? []).map((inner) => (
        <Drawn key={inner.id} group={inner} interaction={interaction} />
      ))}
    </g>
  );
}

/** The arrowheads a figure declares, since a marker cannot inherit a stroke colour. */
export function FigureMarkers({ markers }: { markers: FigureMarker[] }) {
  return (
    <defs>
      {markers.map((marker) => (
        <marker
          key={marker.id}
          id={marker.id}
          markerWidth="7"
          markerHeight="7"
          refX="9"
          refY="5"
          viewBox="0 0 10 10"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill={marker.paint} />
        </marker>
      ))}
    </defs>
  );
}

