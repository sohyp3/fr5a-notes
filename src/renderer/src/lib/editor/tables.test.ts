import { describe, expect, it } from 'vitest';
import {
	cellRanges,
	findTables,
	parsePastedTable,
	pipeOffsets,
	tableHtml,
	toMarkdownTable
} from './tables';

describe('finding tables', () => {
	it('marks header, separator and body rows', () => {
		const lines = [
			'intro',
			'| a | b |',
			'|---|:-:|',
			'| 1 | 2 |',
			'x | y',
			'',
			'| not | a table |'
		];
		const t = findTables(lines);
		expect([...t.keys()]).toEqual([1, 2, 3, 4]);
		expect(t.get(1)).toEqual({ role: 'head', last: false });
		expect(t.get(2)?.role).toBe('sep');
		expect(t.get(4)).toEqual({ role: 'body', last: true });
	});

	it('skips fenced code and escaped pipes', () => {
		expect(findTables(['```', '| a |', '|---|', '```']).size).toBe(0);
		expect(pipeOffsets('| a \\| b | c |')).toEqual([0, 9, 13]);
	});

	it("finds each cell's text", () => {
		const cells = (l: string) => cellRanges(l).map((c) => l.slice(c.from, c.to));
		expect(cells('| a  | b c |   |')).toEqual(['a', 'b c', '']);
		expect(cells('x | y')).toEqual(['x', 'y']);
		expect(cellRanges('|  |')).toEqual([{ from: 2, to: 2 }]);
	});

	it('accepts tables without outer pipes', () => {
		expect(findTables(['a | b', '--- | ---', '1 | 2']).size).toBe(3);
	});
});

describe('rendering tables', () => {
	it('renders escaped cells with alignment and source positions', () => {
		const html = tableHtml(['| a | **b** |', '|---|--:|', '| <x> | [l](https://e.com) |', '| 1 |']);
		expect(html).toBe(
			'<table><thead><tr><th data-line="0" data-cell="0">a</th>' +
				'<th data-line="0" data-cell="1" style="text-align:right"><strong>b</strong></th></tr></thead>' +
				'<tbody><tr><td data-line="2" data-cell="0">&lt;x&gt;</td>' +
				'<td data-line="2" data-cell="1" style="text-align:right"><span class="md-link">l</span></td></tr>' +
				'<tr><td data-line="3" data-cell="0">1</td>' +
				'<td data-line="3" data-cell="0" style="text-align:right"></td></tr></tbody></table>'
		);
	});
});

describe('pasting tables', () => {
	it('turns a spreadsheet selection into a Markdown table', () => {
		const tsv =
			'\tContent Lite\tContent Core\tContent + Growth\n' +
			'Hero\t—\t1 reel + 2 posts/mo\t2 reels + 4 posts/mo\n' +
			'Stories\t3×/week\tdaily\tdaily\n';
		const rows = parsePastedTable(tsv)!;
		expect(rows).toHaveLength(3);
		expect(rows[0]).toEqual(['', 'Content Lite', 'Content Core', 'Content + Growth']);
		expect(toMarkdownTable(rows)).toEqual([
			'|         | Content Lite | Content Core        | Content + Growth     |',
			'| ------- | ------------ | ------------------- | -------------------- |',
			'| Hero    | —            | 1 reel + 2 posts/mo | 2 reels + 4 posts/mo |',
			'| Stories | 3×/week      | daily               | daily                |'
		]);
	});

	it('reads quoted cells and space-aligned columns', () => {
		expect(parsePastedTable('a\t"line 1\nline ""2"""\nb\tc')).toEqual([
			['a', 'line 1\nline "2"'],
			['b', 'c']
		]);
		expect(parsePastedTable('    Lite    Core    Growth\nHero    —    1 reel    2 reels')).toEqual([
			['', 'Lite', 'Core', 'Growth'],
			['Hero', '—', '1 reel', '2 reels']
		]);
		expect(toMarkdownTable([['a|b', 'c\nd']])[0]).toBe('| a\\|b | c d |');
	});

	it('leaves ordinary text alone', () => {
		expect(parsePastedTable('one line\tonly')).toBeNull();
		expect(parsePastedTable('  - a list\n  - of items')).toBeNull();
		expect(parsePastedTable('a\tb\nc')).toBeNull();
		expect(parsePastedTable('| a | b |\n|---|---|')).toBeNull();
	});
});
