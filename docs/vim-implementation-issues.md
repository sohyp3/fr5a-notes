# Vim implementation notes

The editor already uses a Tiptap/ProseMirror Vim extension (`editor/vim.ts`), with one raw Markdown line per paragraph. Installed Tiptap packages provide no built-in Vim extension. CodeMirror Vim adapters target a different editor document and view, so adopting one here would require replacing the editor. The existing integration was preserved; no new dependency was introduced. This is a finding about the installed dependencies, not a claim that no third-party integration exists.

`r` waits for a character and replaces the character under the cursor. Escape cancels. `R` enters replace mode: characters overwrite existing text and append when the line ends; Escape returns to normal mode. This follows Vim's distinction between `r` and `R`. Replace-mode Backspace moves backward; it does not restore overwritten characters as full Vim does. Undo restores the replacement session. Full Vim parity remains outside this compact motion implementation.

`dd`, visual-line delete, `yy`, and linewise `p` now operate on actual paragraph nodes. Paste creates separate paragraphs instead of embedding newline characters in a paragraph; empty deleted/yanked lines remain valid linewise registers. Deleting the only line leaves one empty paragraph, as required by the editor schema, and `p` inserts the saved line below it.

Validation exercises the real ProseMirror schema, transactions, plugin keyboard handlers, selection, and history without requiring browser DOM rendering.
