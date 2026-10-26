# Scenario coverage

Inventory: `rg '^#### Scenario:' openspec/changes/poster-project-pictures/` lists six scenarios; all six are below. OpenLore's `orient` was not usable in this container, so the surface was found with targeted `rg` over `posters/src/editor.ts`, `ui/src/components/PosterFrame.tsx`, `FileViewer.tsx` (`loadPageResource`) and `ui/src/export/loadReferencedImage.ts`. The draw.io scenarios of `poster-drawio-pictures`, whose code this change generalises, keep their tests and pass.

| Applicable scenario | Status | Tests and assertions |
|---|---|---|
| TheProjectsPicturesAreOffered | covered | `ui/src/components/FileViewer.poster.test.tsx` "TheProjectsPicturesAreOffered": PICTURE_LIST answers the SVG and PNG files (not directories, nor a Markdown file whose name holds ".svg") as paths from the poster's directory. `e2e/poster-files.spec.ts` "Insert → Picture from the project": the running editor's list holds the figure, the generated PNG and the project's logo SVG. |
| AnSvgStaysVector | covered | e2e, same test: the placed picture's `src` decodes to exactly the SVG file's text, and its box is in the SVG's 3:1 proportions. Unit: an SVG read through the raw route comes back as its own bytes with `image/svg+xml`. |
| ARasterIsScaled | covered | e2e, same test: a 2400 × 800 PNG of the project is placed as a PNG data URL whose natural size is 1200 × 400. |
| AFigureTheAgentWroteFillsItsFrame | covered | e2e "AFigureTheAgentWroteFillsItsFrame": a frame naming `../figures/architecture.svg` shows exactly that SVG on open, the status says the picture is in its frame, Save is enabled, and the saved file holds the attribute and the SVG's own base64. |
| AMissingPictureLeavesTheFrameEmpty | covered | Unit: a file the server does not serve is refused as "could not be read", a non-picture path is refused unread, and a file over 20 MB is refused. e2e "AMissingPictureLeavesTheFrameEmpty": frames naming a missing SVG and a Markdown file stay on the placeholder, the status names both with their reasons, and Save stays disabled. |
| TheSkillNamesPictureFrames | covered | `posters/test/guide.test.ts`: the skill holds `data-picture-file="../figures/architecture.svg"`, names `write_structure_figure` figures, says the editor fills the frame, and says never to paste a picture file's SVG into the markup. |

Asked by the person: after inserting, the poster still exports. The "Insert → Picture from the project" e2e downloads the Word and PowerPoint files after placing an SVG and a PNG, decodes each page picture, and finds both: more than 1000 pixels of the SVG's magenta and of the PNG's green. The "Insert → draw.io diagram" e2e downloads both after inserting two diagrams and checks each holds a PNG page picture.

Also: `posters/test/diagrams.test.ts` covers `pictureFileType` and the renamed `svgPicture`.

Running app: `web` rebuilt and the server started on a scratch project. A monkey pass found nothing to fix:
- opening the diagram list then the picture list shows pictures only;
- a double click on an entry fills the selected frame once, and undo empties it;
- an SVG rewritten on disk while the list is open is placed as it is now;
- a Word export after all of it downloads;
- no page errors.

The poster e2e suites (`poster-files`, `mcp-poster-app`, `mcp-poster-elements`) pass, 46 tests. Agent behaviour: the skill change could not be tried with a live model here, so it is covered by the skill test only.
