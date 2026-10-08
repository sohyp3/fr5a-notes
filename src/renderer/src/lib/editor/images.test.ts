import { describe, expect, it } from 'vitest';
import {
	assetName,
	findImages,
	imageLine,
	imageSource,
	parseImage,
	parseSize,
	relativeLink,
	sizeComment
} from './images';

describe('image lines', () => {
	it('reads a line holding only an image', () => {
		expect(parseImage('![A cat](assets/cat.png)')).toEqual({ alt: 'A cat', src: 'assets/cat.png' });
		expect(parseImage('  ![](<my pic.png> "title")  ')).toEqual({ alt: '', src: 'my pic.png' });
		expect(parseImage('see ![a](b.png)')).toBeNull();
		expect(parseImage('![a](b.png) and more')).toBeNull();
	});

	it('pairs each image with the size comment right below it', () => {
		const lines = ['![a](a.png)', '<!-- size: 40% -->', '![b](b.png)', 'text', '<!-- size: 5% -->'];
		const found = findImages(lines);
		expect([...found.keys()]).toEqual([0, 2]);
		expect(found.get(0)).toMatchObject({ size: 40, sizeLine: 1 });
		expect(found.get(2)).toMatchObject({ size: null, sizeLine: null });
	});

	it('skips fenced code and clamps sizes', () => {
		expect(findImages(['```', '![a](a.png)', '```']).size).toBe(0);
		expect(parseSize('<!-- size: 400% -->')).toBe(100);
		expect(parseSize('<!--size:3%-->')).toBe(10);
		expect(parseSize('<!-- size: 50 -->')).toBeNull();
		expect(sizeComment(62.4)).toBe('<!-- size: 62% -->');
	});
});

describe('where an image is', () => {
	it('resolves workspace paths from the note’s folder or the root', () => {
		expect(imageSource('cat.png', 'work')).toEqual({ kind: 'file', path: 'work/cat.png' });
		expect(imageSource('../assets/My%20cat.png', 'work/x')).toEqual({
			kind: 'file',
			path: 'work/assets/My cat.png'
		});
		expect(imageSource('/assets/a.png', 'deep/er')).toEqual({ kind: 'file', path: 'assets/a.png' });
		expect(imageSource('./a.png?v=2', '')).toEqual({ kind: 'file', path: 'a.png' });
	});

	it('refuses paths out of the workspace, other schemes and non-images', () => {
		expect(imageSource('../../a.png', 'work')).toBeNull();
		expect(imageSource('http://x.com/a.png', '')).toBeNull();
		expect(imageSource('file:///etc/a.png', '')).toBeNull();
		expect(imageSource('notes.md', '')).toBeNull();
		expect(imageSource('https://x.com/a', '')).toEqual({ kind: 'url', url: 'https://x.com/a' });
		expect(imageSource('data:image/png;base64,AA', '')?.kind).toBe('url');
	});

	it('links a saved image from the note’s folder', () => {
		expect(relativeLink('', 'assets/a.png')).toBe('assets/a.png');
		expect(relativeLink('work/2026', 'assets/a.png')).toBe('../../assets/a.png');
		expect(relativeLink('assets/sub', 'assets/a.png')).toBe('../a.png');
		expect(relativeLink('', 'my pics/a (1).png')).toBe('my%20pics/a%20%281%29.png');
	});

	it('names saved files so links need no escaping', () => {
		const at = new Date(2026, 9, 6, 9, 5, 3);
		expect(assetName('image.png', 'image/png', at)).toBe('image-20261006-090503.png');
		expect(assetName('My photo (2).JPG', 'image/jpeg', at)).toBe('My-photo-2.jpg');
		expect(assetName('صورة.webp', '', at)).toBe('صورة.webp');
		expect(imageLine('a [b]', 'x.png')).toBe('![a b](x.png)');
	});
});
