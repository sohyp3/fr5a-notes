# Mind maps

Settings → Links & maps → **Mind maps** (off by default). Mod+G opens the last map you used, the
sidebar's **Mind maps** entry opens the list. **Graph (automatic)** — every note, its links and
tags — is part of **Note links & graph** and stays as it was.

## Files

Each map is one [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) file,
`.fr5a/maps/<Name>.canvas`, synced with the notes. Other canvas apps (Obsidian) open it; fields
they don't know are kept. fr5a adds its own under `fr5a`:

```json
{
	"nodes": [
		{
			"id": "a",
			"type": "text",
			"text": "Launch plan",
			"x": 0,
			"y": 0,
			"width": 200,
			"height": 60,
			"color": "5"
		},
		{
			"id": "b",
			"type": "file",
			"file": "Projects/Atlas.md",
			"x": 300,
			"y": 0,
			"width": 240,
			"height": 90
		},
		{
			"id": "t",
			"type": "text",
			"text": "#work/atlas",
			"x": 0,
			"y": 200,
			"width": 160,
			"height": 44,
			"fr5a": { "tag": "work/atlas", "exclude": ["Old.md"] }
		},
		{
			"id": "n1",
			"type": "file",
			"file": "Projects/Spec.md",
			"x": 260,
			"y": 220,
			"width": 240,
			"height": 90,
			"fr5a": { "from": "t" }
		}
	],
	"edges": [
		{ "id": "e1", "fromNode": "a", "toNode": "b", "label": "informs", "toEnd": "none" },
		{ "id": "e2", "fromNode": "t", "toNode": "n1", "toEnd": "none", "fr5a": { "from": "t" } }
	]
}
```

- `fr5a.tag`: a tag node. Adding one places every note that carries the tag (or a tag below it)
  around it, read from the index — no note is opened or changed.
- `fr5a.exclude`: notes taken off that tag node; it never adds them back.
- `fr5a.from`: a note node or edge a tag node added.

Map text (ideas, labels) is stored in the clear, even with encryption on. Note nodes store only
the path; titles of encrypted notes are never written to the map.

## Using a map

- Any number of separate ideas; connect any two nodes by dragging from a dot on a node's side.
- Double-click (or F2) edits an idea; Tab adds a connected idea after the selection, Enter one
  beside it. Delete / Backspace removes. Mod+Z / Mod+Shift+Z undo / redo.
- Double-click or Mod+click a note node to open the note. A note moved or renamed in the app is
  followed in every map; one that's gone shows dashed with **Relink…**.
- **Select** lets you tap multiple nodes on touch or drag a selection box. On desktop, Shift+drag
  draws a box and Shift/Mod+click extends the selection; Mod+A selects all nodes. Drag any selected node to move the group, including while Select is on. The selection bar offers color, Tidy, delete and clear; edits support undo.
- **Magnet** moves a node’s subnodes along with it, following outgoing connections through all levels.
  Selected nodes and shared subnodes move once, even when connections form a cycle.
- **Tidy** arranges the selection or map horizontally or vertically. Right-click Tidy to choose
  a direction; subsequent clicks reuse it. The selection’s **Tidy…** and **More** also offer both directions.
- **More** offers snapping to a 20 px grid (aligns existing cards when enabled). **Fit** frames the map.
- Touch: long-press a node for its actions; tap a connection to label or delete it.
