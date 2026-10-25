/**
 * Cheap index hint, deliberately independent of YAML parsing. `null` means no
 * declaration; `-1` means a declaration without a recognizable integer version.
 * A recognized version is still only a hint: the canvas validates the document
 * and displays diagnostics. Malformed declared maps must stay in the picker.
 * Keep this function self-contained so browser fixtures can inject it verbatim.
 */
export function mindMapVersion(source: string): number | null {
	const opening = /^\ufeff?---\r?\n/.exec(source);
	if (!opening) return null;
	const rest = source.slice(opening[0].length);
	const closing = /^---\r?$/m.exec(rest);
	const header = closing ? rest.slice(0, closing.index) : rest;
	const declaration = /^(?:mindmap|"mindmap"|'mindmap')[ \t]*:[ \t]*(.*)\r?$/m.exec(header);
	if (!declaration) return null;
	let version: string | undefined;
	const inline = declaration[1].trim();
	if (inline.startsWith('{')) {
		version =
			/(?:^\{|,)[ \t]*(?:version|"version"|'version')[ \t]*:[ \t]*([+-]?\d+)(?=[ \t]*(?:[,}]|$))/.exec(
				inline
			)?.[1];
	} else if (!inline || inline.startsWith('#')) {
		const after = header.slice(declaration.index + declaration[0].length);
		const rows = after.split('\n');
		let indent: number | undefined;
		for (const row of rows) {
			if (!row.trim() || /^\s*#/.test(row)) continue;
			const spaces = /^ +/.exec(row)?.[0].length;
			if (!spaces) break;
			indent ??= spaces;
			if (spaces !== indent) continue;
			const match =
				/^ +(?:version|"version"|'version')[ \t]*:[ \t]*([+-]?\d+)[ \t]*(?:#.*)?\r?$/.exec(row);
			if (match) {
				version = match[1];
				break;
			}
		}
	}
	const value = version === undefined ? NaN : Number(version);
	return Number.isSafeInteger(value) ? value : -1;
}
