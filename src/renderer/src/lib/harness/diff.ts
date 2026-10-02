/** Line diff (LCS) for the write-approval preview. */

export type DiffLine = { op: 'same' | 'add' | 'del'; text: string };

const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
	const a = before.split('\n');
	const b = after.split('\n');
	// Trim the common head/tail so the table only covers the changed middle.
	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head++;
	let tail = 0;
	while (
		tail < a.length - head &&
		tail < b.length - head &&
		a[a.length - 1 - tail] === b[b.length - 1 - tail]
	)
		tail++;
	const am = a.slice(head, a.length - tail);
	const bm = b.slice(head, b.length - tail);
	const out: DiffLine[] = a.slice(0, head).map((text) => ({ op: 'same', text }));
	if (am.length * bm.length > MAX_CELLS) {
		// Too big for a table: show it as a block replace.
		for (const text of am) out.push({ op: 'del', text });
		for (const text of bm) out.push({ op: 'add', text });
	} else {
		const n = am.length;
		const m = bm.length;
		const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
		for (let i = n - 1; i >= 0; i--)
			for (let j = m - 1; j >= 0; j--)
				lcs[i][j] =
					am[i] === bm[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		let i = 0;
		let j = 0;
		while (i < n && j < m) {
			if (am[i] === bm[j]) {
				out.push({ op: 'same', text: am[i++] });
				j++;
			} else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: 'del', text: am[i++] });
			else out.push({ op: 'add', text: bm[j++] });
		}
		while (i < n) out.push({ op: 'del', text: am[i++] });
		while (j < m) out.push({ op: 'add', text: bm[j++] });
	}
	for (const text of a.slice(a.length - tail)) out.push({ op: 'same', text });
	return out;
}

/** Collapse long unchanged runs to `context` lines around each change. */
export function compactDiff(
	lines: DiffLine[],
	context = 2
): (DiffLine | { op: 'gap'; count: number })[] {
	const keep = lines.map(() => false);
	lines.forEach((l, i) => {
		if (l.op === 'same') return;
		for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++)
			keep[k] = true;
	});
	const out: (DiffLine | { op: 'gap'; count: number })[] = [];
	let gap = 0;
	lines.forEach((l, i) => {
		if (keep[i]) {
			if (gap) out.push({ op: 'gap', count: gap });
			gap = 0;
			out.push(l);
		} else gap++;
	});
	if (gap) out.push({ op: 'gap', count: gap });
	return out;
}
