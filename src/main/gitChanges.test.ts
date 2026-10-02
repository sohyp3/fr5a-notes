import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePorcelain, repoChanges, workspaceChanges } from './gitChanges';

let tmp: string;

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (dir: string, file: string, body: string) => {
	fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
	fs.writeFileSync(path.join(dir, file), body, 'utf8');
};

function repo(name: string): string {
	const dir = path.join(tmp, name);
	fs.mkdirSync(dir, { recursive: true });
	git(dir, 'init', '--quiet');
	git(dir, 'config', 'user.name', 't');
	git(dir, 'config', 'user.email', 't@t');
	return dir;
}

beforeAll(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fr5a-changes-'));
	const gitconfig = path.join(tmp, 'gitconfig');
	fs.writeFileSync(gitconfig, '[init]\n\tdefaultBranch = main\n');
	process.env.GIT_CONFIG_GLOBAL = gitconfig;
	process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('parsePorcelain', () => {
	it('maps status codes', () => {
		expect(parsePorcelain(' M a.md\0?? b c.md\0D  d.md\0A  e.md\0 D f.md\0')).toEqual([
			{ path: 'a.md', status: 'modified' },
			{ path: 'b c.md', status: 'added' },
			{ path: 'd.md', status: 'deleted' },
			{ path: 'e.md', status: 'added' },
			{ path: 'f.md', status: 'deleted' }
		]);
	});
});

describe('repoChanges', () => {
	it('returns null outside a repo', async () => {
		const plain = path.join(tmp, 'plain');
		fs.mkdirSync(plain);
		expect(await repoChanges(plain)).toBeNull();
	});

	it('lists modified, new and deleted notes with their committed text', async () => {
		const dir = repo('r1');
		write(dir, 'keep.md', '# Keep\n');
		write(dir, 'edit.md', '# Edit\n\nold\n');
		write(dir, 'gone.md', '# Gone\n');
		git(dir, 'add', '-A');
		git(dir, 'commit', '--quiet', '-m', 'init');

		write(dir, 'edit.md', '# Edit\n\nnew\n');
		fs.rmSync(path.join(dir, 'gone.md'));
		write(dir, 'sub/fresh.md', '# Fresh\n');
		write(dir, '.fr5a/sessions/s.md', 'hidden');
		write(dir, 'image.png', 'binary-ish');

		expect(await repoChanges(dir)).toEqual([
			{ path: 'edit.md', status: 'modified', before: '# Edit\n\nold\n', after: '# Edit\n\nnew\n' },
			{ path: 'gone.md', status: 'deleted', before: '# Gone\n', after: null },
			{ path: 'sub/fresh.md', status: 'added', before: null, after: '# Fresh\n' }
		]);
	});

	it('includes nested repos with their folder prefix', async () => {
		const root = repo('r2');
		write(root, 'a.md', 'a\n');
		write(root, '.gitignore', 'private/\n');
		git(root, 'add', '-A');
		git(root, 'commit', '--quiet', '-m', 'init');
		const nested = repo('r2/private');
		write(nested, 'secret.md', 'one\n');
		git(nested, 'add', '-A');
		git(nested, 'commit', '--quiet', '-m', 'init');
		write(nested, 'secret.md', 'two\n');

		expect(await workspaceChanges(root, ['private'])).toEqual([
			{ path: 'private/secret.md', status: 'modified', before: 'one\n', after: 'two\n' }
		]);
	});
});
