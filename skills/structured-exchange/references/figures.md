# Putting a diagram in a document you are writing

Part of the `structured-exchange` skill. A timeline's own figure options are in `references/timelines.md`.

`present_structure` shows a document in the conversation. When you are *writing* a
file — a report, a design note, a README — a diagram belongs in that file instead,
and `write_structure_figure` puts it there:

```
write_structure_figure(
  path: "models/vehicle.json",
  output_path: "figures/power-train.svg",
  hide_relationship_kinds: ["diagnostic"]
)
```

It reads a structured-exchange document from the workspace, draws it, and writes one
`.svg`. Reference it from your Markdown as a relative path — `![Power
train](figures/power-train.svg)` — and the interface renders it in the preview.

Three things about it are worth knowing before you use it.

**The two hide lists are different vocabularies.** `hide_element_kinds` hides boxes by
their `kind`; `hide_relationship_kinds` hides arrows by theirs. The same name in both
means two unrelated things, and naming one where you meant the other hides nothing,
draws a perfectly valid figure of the whole document, and looks like it worked.

**Write one figure per view worth having.** A narrowed figure is the reason the tool
takes a narrowing at all: three figures each about one thing beat one figure of
everything, which is the diagram nobody reads. A figure that shows less than its
document says so, inside the picture, so a figure separated from its source is never
mistaken for the whole of it.

**A relationship whose endpoint you hid goes with it.** An arrow to a box that is not
drawn cannot be drawn. The result tells you how much of the document the figure shows,
so a narrowing that took more than you meant is visible in the answer rather than in
the file.

A table has no figure — it is data. To put one in a document you are writing,
`write_structure_table` writes it as Markdown:

```
write_structure_table(
  path: "requirements/braking.json",
  output_path: "reports/braking-requirements.md"
)
```

It reads a table from the workspace and writes a new `.md` file — each chapter a heading
followed by a Markdown table of its rows — which you can include in the document or hand on.
It never overwrites an existing file, and a table the project's profile or rules refuse is not
written. The reader can also export a table they are shown as a spreadsheet or as Markdown.
