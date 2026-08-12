import { CURRENT_COLOR, laneColor, laneX, railWidth, ROW_H, type RailRow } from "./lanes";

/**
 * The rail cell of one graph row: parallel branch lines, this row's node, and the
 * curves where lanes fork away or converge in.
 *
 * `colorOf` maps a lane to its colour. Graphs whose highlighted line always owns
 * lane 0 can take the default; one whose highlight moves between lanes passes a
 * palette that never yields the reserved colour, and marks its rows `highlight`
 * instead.
 *
 * Purely decorative — every row states its identity in text beside the rail, so
 * this carries no information a screen reader would miss.
 */
export function Rail({ row, laneCount, colorOf = laneColor }: { row: RailRow; laneCount: number; colorOf?: (lane: number) => string }) {
  const width = railWidth(laneCount);
  const cx = laneX(row.lane);
  const cy = ROW_H / 2;
  const color = row.highlight ? CURRENT_COLOR : colorOf(row.lane);
  const dash = row.dashed ? "3 3" : undefined;
  return (
    <svg width={width} height={ROW_H} viewBox={`0 0 ${width} ${ROW_H}`} aria-hidden className="shrink-0">
      {row.through.map((lane) => (
        <line key={lane} x1={laneX(lane)} y1={0} x2={laneX(lane)} y2={ROW_H} stroke={colorOf(lane)} strokeWidth={2} opacity={0.55} />
      ))}
      {row.lineAbove && <line x1={cx} y1={0} x2={cx} y2={cy} stroke={color} strokeWidth={2} strokeDasharray={dash} />}
      {row.lineBelow && <line x1={cx} y1={cy} x2={cx} y2={ROW_H} stroke={color} strokeWidth={2} strokeDasharray={dash} />}
      {row.forkTo.map((lane) => (
        <path
          key={`fork-${lane}`}
          d={`M ${cx} ${cy} C ${cx} ${ROW_H}, ${laneX(lane)} ${cy}, ${laneX(lane)} ${ROW_H}`}
          fill="none"
          stroke={colorOf(lane)}
          strokeWidth={2}
          opacity={0.75}
        />
      ))}
      {(row.mergeFrom ?? []).map((lane) => (
        // Mirror of the fork curve: this lane arrives from a newer row above
        <path
          key={`merge-${lane}`}
          d={`M ${cx} ${cy} C ${cx} 0, ${laneX(lane)} ${cy}, ${laneX(lane)} 0`}
          fill="none"
          stroke={colorOf(lane)}
          strokeWidth={2}
          opacity={0.75}
        />
      ))}
      {row.emphasis === "current" ? (
        <>
          <circle cx={cx} cy={cy} r={6} fill="none" stroke={color} strokeWidth={2} />
          <circle cx={cx} cy={cy} r={2.5} fill={color} />
        </>
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill={row.emphasis === "filled" ? color : "var(--tree-off, #d4d4d8)"}
          stroke={color}
          strokeWidth={row.emphasis === "filled" ? 0 : 1.5}
        />
      )}
    </svg>
  );
}
