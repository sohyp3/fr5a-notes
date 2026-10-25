# Mind maps

Enable **Settings → Mind maps**, then press `Mod+G` or choose Mind maps in the
sidebar. The chooser lists your map notes and the automatic **All notes** view.
`Mod+G` reopens the last selected map on this device; a deleted or locked map
falls back to the chooser.

Choose **Create mind map** for a concept root, or **Create from this note** to
reference the open note as the root. The new map is an ordinary Markdown note
in your workspace. Its hierarchy, cross-links, expansion settings, and dragged
positions are saved in YAML frontmatter. The prose below it remains Markdown.

## Author visually

Select a node to open its inspector. You can add concepts or note references,
create a Markdown note from a concept, change its label, reorder its children,
change its parent, and create or label cross-links. Double-click a node, or
press Enter on a selected canvas node, to edit its label inline. Enter commits
the label; Escape cancels. On desktop, a branch handle can be dragged onto an
explicit node to change its parent.

Drag a node body to save its position when you release it. Pan the canvas,
zoom with the wheel or a pinch, and choose Fit to see the whole map. Reflow asks
for confirmation before replacing saved positions with the tree layout.

Automatic links and tags are configured per node. Tags appear only when their
paths are named in that node’s inspector. `work/project` matches that exact tag;
`work/project/*` includes its descendants. Concepts can expand tags too. Depth
is at most two levels, and each node can include at most 100 automatic notes
(24 by default). The inspector reports omitted items. Pin an automatic item to
make it explicit, or hide it from this map.

Removing a node never deletes the linked Markdown note. Removing an explicit
node asks for confirmation and promotes its children to its parent. Missing
references stay visible with a dashed outline and can be repaired in the
inspector.

The desktop inspector occupies a fixed column. Tablets use a bottom sheet.
Phones start with the root unobscured; selecting a node opens a full-height
editor sheet. Close it with its close control, Back, or a downward swipe from
the sheet header.

Choose **Outline** in the canvas toolbar, or Tab to **Outline view**, to use the hierarchy without spatial navigation. Arrow
Left/Right move to the parent/first child, Up/Down move between siblings, and
Enter selects a node. Press O on a note-backed tree item to open its note. The
inspector controls are keyboard accessible.

## Edit the YAML

Choose **Edit source** to open the map in the existing note editor. Return with
`Mod+G`; pending editor changes are saved and the map is parsed again.

```yaml
---
mindmap:
  version: 1
  root: project
  nodes:
    - id: project
      label: Project Atlas
      note: Projects/Atlas.md
      children: [research, build]
      position: { x: 0, y: 0 }
      expand:
        links: both
        tags: [work/atlas]
        depth: 1
        limit: 24
    - id: research
      label: Research
    - id: build
      label: Build
      note: Projects/Atlas Build.md
  edges:
    - from: research
      to: build
      label: informs
---
# Project Atlas Map

Optional prose about the map.
```

Node ids are unique and local to the map. `root` names an explicit node.
`children` defines hierarchy and order; each child has one parent, and the
hierarchy cannot contain cycles. `edges` defines cross-links, which may form
cycles. Concepts require `label`; note references fall back to the note title.
References resolve relative to the map, then from the workspace root, then by
file name. A leading `/` explicitly references the workspace root.

`expand.links` accepts `none`, `outgoing`, `incoming`, or `both`. Visual hiding
uses an optional `mindmap.hidden` list containing `note:Workspace/Path.md` or
`tag:tag/path` identifiers. It affects this map only.

Invalid YAML or invalid hierarchy disables visual editing and reports source
locations. Repair it through Edit source. Unsupported versions display an
upgrade message. If a source changes outside the canvas before an edit saves,
the save is refused and Reload map reads the new source. Visual edits preserve
unrelated frontmatter, comments, and the Markdown body.

## Storage and privacy

Maps are local files and work offline. Commit them through the existing Git
workflow to share their hierarchy and positions between devices. The desktop
SQLite index and mobile metadata index record the map version for the chooser.
The last selected map is a device preference.

Locked map notes are view-only. Encrypted maps remain unavailable while the
vault is locked; their structure and content are encrypted using the existing
note encryption path. Hidden folders retain their normal visibility rules.
Disabling Mind maps exits the map surface and unmounts its canvas and listeners.
