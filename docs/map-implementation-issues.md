# Mind map implementation notes

- Interpreted “when clicking in / out on no animation” as immediate mind map zoom controls. Added explicit zoom in/out buttons and made Fit immediate. Tidy keeps its existing reduced-motion-aware transition.
- The magnet is grid snapping, rather than attraction to nearby cards. It now uses a visible 20 px grid, aligns existing cards immediately as one undoable edit, and applies to additions, dragging and Tidy. Enabling snapping may move cards by up to 10 px on each axis.
- New cards use their complete size plus a gutter to find nearby free space. Tag-generated cards use the same collision check. Tidy uses measured rendered sizes with wider spacing; disconnected nodes are included.
- Select mode supports tapping nodes or drawing a box. Switch it off before dragging the selected group. Desktop also supports Shift-drag, Shift/Control/Meta-click, and Control/Meta+A. Group color, Tidy, delete and clear are available in the selection toolbar.
- Imported JSON Canvas group rectangles remain independent nodes; containment and nested-group layout are not introduced here.
- Browser checks use the existing fake storage API. The isolated worktree needed a temporary Vite filesystem allow-list for symlinked dependencies; that local configuration is excluded from the commit.
