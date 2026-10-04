# Plannings in Claude Desktop

Ask Claude for a project planning — tasks, activities, milestones, what depends on what — and it is
drawn in the conversation as an interactive timeline. Change it by asking; click an item in the
timeline and ask to change "it". Every planning is a file in a folder you choose, and every earlier
version is kept.

Nothing leaves your computer for this: no account, no server, no network. Claude itself still
reads the conversation, as it does for anything you ask.

It works in Claude Desktop, on macOS and Windows, including on the free plan.

## Install it

1. Download **[pi-outpost-plannings.mcpb](https://github.com/laurentftech/pi-outpost/releases/latest/download/pi-outpost-plannings.mcpb)**
   (from the latest [release](https://github.com/laurentftech/pi-outpost/releases/latest)).
2. Double-click it. Claude Desktop opens and offers to install **Plannings (pi-outpost)**.
3. Under **Plannings folder**, click the field and choose a folder — or create one, for example
   *Documents › Plannings*. There is no default: the folder is yours to pick.
4. Click **Install**, then make sure the extension is enabled.

To use another folder later: *Settings › Extensions › Plannings (pi-outpost) › Configure*.

## What to ask

Write as you would to a person, in your own language:

- *"Make me a planning for redoing the kitchen: demolition in March, plumbing and electricity in
  April, the kitchen fitted in May, and a milestone when the worktop is delivered."*
- *"Show me the kitchen planning."*
- *"Move the worktop delivery a week later, and everything that depends on it."*
- *"Show me what changed since the first version."*
- *"What plannings do I have?"* — the folder is drawn as a list; click a planning to open its
  timeline, and *← All plannings* to come back.

In the timeline:
- **Click a task or a milestone** to see its details, then ask *"move it two weeks later"*: Claude
  knows what you selected. Click it again to unselect.
- **Week, month, quarter** change the scale; **Full screen** gives it the whole window.
- **⤓ Download SVG** saves the picture of the timeline. If Claude Desktop does not download it
  itself, it is saved in your plannings folder, and the timeline says so.
- **Copy SVG markup** copies the picture as text, for a tool that accepts SVG.

## Where your plannings are

In the folder you chose:

```
Plannings/
  Kitchen.planning.json      ← the planning, as it is now
  timeline-Kitchen.svg       ← a picture you saved
  .history/                  ← every earlier version (hidden)
```

- Each planning is **one file**, named after its title. You can copy it, back it up or send it.
  Its contents are readable text.
- Every version is kept in the hidden `.history` folder beside it. Claude uses it to show what
  changed; you do not need to touch it.
- If you edit a planning file yourself and make a mistake, Claude tells you what is wrong, and the
  next change starts again from the last correct version. What you wrote is kept in the history.
- You can **rename** a planning file: its history follows it.
- A planning file **put in the folder** — one sent to you, or saved by pi-outpost — is picked up
  as a planning of its own.
- If you delete a planning file, the planning disappears from the list; its history stays until
  you delete `.history` too.

## Remove it

*Settings › Extensions › Plannings (pi-outpost) › Uninstall*. Your plannings folder is not touched:
delete it yourself if you no longer want it.

## If something does not work

- **Claude does not seem to know about plannings.** Check that the extension is enabled under
  *Settings › Extensions*, then start a new conversation.
- **"No planning …"** — ask Claude to list your plannings first; it then uses the right one.

---

For developers: the server is `mcp/` in this repository, an [MCP Apps](https://github.com/modelcontextprotocol/ext-apps)
server over stdio. `npm run pack --workspace @pi-outpost/mcp` builds `mcp/dist/pi-outpost-plannings.mcpb`,
and `npm run test:bundle --workspace @pi-outpost/mcp` starts the packed server over stdio. It shares
its planning gate, update operations, guide and tool descriptions with the
[Open WebUI server](openwebui.md), through `apps-core/`.
