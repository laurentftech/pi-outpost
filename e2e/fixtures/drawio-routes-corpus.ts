/**
 * Generated diagrams for drawio-wire-overlaps' route comparison (design 3): every pair of
 * relative positions, the supported edge styles with and without waypoints, fixed and floating
 * ends on every side, the supported perimeters, a container, loose ends. Seeded, so a failing
 * case reproduces.
 * scripts/probes/drawio-routes-corpus.mts writes them to files.
 */

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHAPES = ["rounded=0;whiteSpace=wrap;html=1;", "rounded=1;whiteSpace=wrap;html=1;", "ellipse;whiteSpace=wrap;html=1;", "rhombus;whiteSpace=wrap;html=1;", "shape=ellipse;perimeter=ellipsePerimeter;html=1;", "text;html=1;"];
const STYLES = ["", "edgeStyle=none;", "edgeStyle=orthogonalEdgeStyle;", "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;", "edgeStyle=orthogonalEdgeStyle;curved=1;", "edgeStyle=segmentEdgeStyle;", "edgeStyle=elbowEdgeStyle;", "edgeStyle=elbowEdgeStyle;elbow=vertical;", "edgeStyle=sideToSideEdgeStyle;", "edgeStyle=topToBottomEdgeStyle;", "edgeStyle=orthogonalEdgeStyle;endArrow=none;jettySize=auto;", "edgeStyle=orthogonalEdgeStyle;sourcePortConstraint=north;targetPortConstraint=west;"];
const SIDES = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0, 0], [1, 1], [0.25, 0], [0, 0.75]] as const;

export function corpus(files: number, seed: number): string[] {
  const next = random(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const out: string[] = [];
  for (let file = 0; file < files; file++) {
    const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
    // A container holding some of the shapes, so absolute boxes go through a parent
    const container = next() < 0.4;
    if (container) cells.push('<mxCell id="box" value="Group" style="swimlane;html=1;" vertex="1" parent="1"><mxGeometry x="600" y="300" width="500" height="400" as="geometry"/></mxCell>');
    const shapes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = `s${i}`;
      const inside = container && i >= 4;
      const width = 40 + Math.round(next() * 16) * 10;
      const height = 30 + Math.round(next() * 10) * 10;
      const x = inside ? 20 + Math.round(next() * 30) * 10 : Math.round(next() * 90) * 10;
      const y = inside ? 40 + Math.round(next() * 25) * 10 : Math.round(next() * 70) * 10;
      cells.push(`<mxCell id="${id}" value="Box ${i}" style="${pick(SHAPES)}" vertex="1" parent="${inside ? "box" : "1"}"><mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/></mxCell>`);
      shapes.push(id);
    }
    for (let e = 0; e < 8; e++) {
      const source = pick(shapes);
      let target = pick(shapes);
      if (target === source) target = shapes[(shapes.indexOf(source) + 1) % shapes.length]!;
      let style = pick(STYLES) + "html=1;";
      if (next() < 0.35) {
        const [ex, ey] = pick(SIDES);
        style += `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;`;
        if (next() < 0.2) style += "exitPerimeter=0;";
      }
      if (next() < 0.35) {
        const [nx, ny] = pick(SIDES);
        style += `entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;`;
      }
      const loose = next() < 0.08;
      const waypoints = next() < 0.3 ? Array.from({ length: 1 + Math.floor(next() * 3) }, () => `<mxPoint x="${Math.round(next() * 100) * 10}" y="${Math.round(next() * 80) * 10}"/>`) : [];
      const label = next() < 0.5 ? ` value="wire ${e}"` : "";
      cells.push(
        `<mxCell id="e${e}"${label} style="${style}" edge="1" parent="1" source="${source}"${loose ? "" : ` target="${target}"`}><mxGeometry relative="1" as="geometry">` +
          (loose ? `<mxPoint x="${Math.round(next() * 100) * 10}" y="${Math.round(next() * 80) * 10}" as="targetPoint"/>` : "") +
          (waypoints.length > 0 ? `<Array as="points">${waypoints.join("")}</Array>` : "") +
          "</mxGeometry></mxCell>",
      );
    }
    out.push(`<mxfile><diagram name="Generated ${file}"><mxGraphModel><root>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`);
  }
  return out;
}
