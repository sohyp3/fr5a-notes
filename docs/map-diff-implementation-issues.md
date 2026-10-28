# Map changes implementation notes

Changes now includes `.fr5a/maps/<Name>.canvas` on desktop and mobile. Visible nested repository prefixes are supported for comparison. Map files remain outside the note index. The path helper refuses traversal, hidden prefixes, nested directories under `maps`, and non-canvas app files.

Map differences group node and connection additions, removals, and edits. Fields show before/after content, position, size, color, endpoints, labels, arrow settings, app settings, and unknown properties. Connections use node names. Root metadata and drawing order changes open the source comparison. All maps also have a Source changes disclosure; malformed/ambiguous documents fall back to that comparison automatically. Ciphertext retains the existing locked-note guard.

Map stash and revert are intentionally unavailable: current destructive operations restore notes and may move new notes into the note trash. Map rows omit these actions; mixed batches explicitly offer Stash notes / Revert notes. Desktop note validation is unchanged, and mobile rejects map paths before note operations mutate any file. Map stashes created outside this app are not newly exposed by this change.

Open map is available for existing maps in the current workspace when Mind maps is enabled. Nested repository maps can be compared but cannot be opened through this action because current map navigation accepts a map name only, with no repository context. Deleted maps have no Open action. When Mind maps is disabled, comparisons remain available without loading map persistence or enabling the graph feature.

Changes refresh flushes active map writers and queued saves before reading Git while Mind maps is enabled. A failed save preserves the previous Changes snapshot and logs the existing refresh error path; it does not claim the failed write reached Git.

Verification includes semantic and hostile path tests, real desktop Git repositories including nested maps, real isomorphic-git map inclusion and destructive-operation rejection, and browser checks at 1440×900 and 390×844 with fake Git snapshots. Browser checks cover semantic fields, Open map, map-only action restrictions, mixed note/map actions, and malformed source fallback.
