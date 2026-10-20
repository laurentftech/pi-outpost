/**
 * A diagram a reply references, for drawing it in the conversation and touching it up.
 *
 * Two pages: the first is the one touched up — three boxes, A wired to B, and C free to be
 * wired — and the second exists to prove a save leaves it alone, byte for byte. Laid out
 * on draw.io's grid, as the drawio skill asks the agent to.
 */
export const SERVICES_DIAGRAM_PATH = "diagrams/services.drawio";

const cell = (id: string, value: string, x: number, y: number) =>
  `        <mxCell id="${id}" value="${value}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">\n          <mxGeometry x="${x}" y="${y}" width="140" height="60" as="geometry"/>\n        </mxCell>`;

export const SERVICES_SECOND_PAGE = [
  '  <diagram id="later" name="Later">',
  '    <mxGraphModel grid="1" gridSize="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="z" value="Untouched" vertex="1" parent="1"><mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell></root></mxGraphModel>',
  "  </diagram>",
].join("\n");

export const SERVICES_DIAGRAM = [
  '<mxfile host="e2e">',
  '  <diagram id="now" name="Services">',
  '    <mxGraphModel grid="1" gridSize="10" guides="1" connect="1" arrows="1" page="1" pageWidth="1169" pageHeight="827">',
  "      <root>",
  '        <mxCell id="0"/>',
  '        <mxCell id="1" parent="0"/>',
  cell("a", "Alpha", 40, 40),
  cell("b", "Bravo", 320, 40),
  cell("c", "Charlie", 320, 220),
  '        <mxCell id="a-b" edge="1" parent="1" source="a" target="b" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=block;">\n          <mxGeometry relative="1" as="geometry"/>\n        </mxCell>',
  "      </root>",
  "    </mxGraphModel>",
  "  </diagram>",
  SERVICES_SECOND_PAGE,
  "</mxfile>",
  "",
].join("\n");

/** A reply that shows the diagram, and one that is gone. */
export const DRAWIO_REPLY_MESSAGES = [
  { role: "user", content: "Draw the services." },
  {
    role: "assistant",
    content: [{ type: "text", text: `Here they are:\n\n![Services](./${SERVICES_DIAGRAM_PATH})\n\nAnd the one you deleted:\n\n![Gone](./diagrams/gone.drawio)\n` }],
  },
];
