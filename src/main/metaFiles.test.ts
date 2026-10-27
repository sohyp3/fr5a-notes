import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readMeta } from './metaFiles';

describe('desktop app-file reads', () => {
	it('returns null only for missing files, not a read error', async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'fr5a-meta-'));
		try {
			await mkdir(path.join(root, '.fr5a/maps'), { recursive: true });
			await expect(readMeta(root, 'maps/missing.canvas')).resolves.toBeNull();
			await writeFile(path.join(root, '.fr5a/maps/Atlas.canvas'), '{}');
			await expect(readMeta(root, 'maps/Atlas.canvas')).resolves.toBe('{}');
			// Reading a directory fails with EISDIR rather than pretending it was deleted.
			await expect(readMeta(root, 'maps')).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
