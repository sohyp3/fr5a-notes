import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const git = (args: string): string =>
	execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
		.toString()
		.trim();

/**
 * Compile-time constants for the renderer (`define`): the app version from
 * package.json (the one place to bump it; Android's versionName reads it too)
 * and the commit it was built from, `+` when built with uncommitted changes —
 * so two builds of the same version can be told apart in Settings.
 */
export function buildInfo(): Record<string, string> {
	const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };
	let commit = '';
	try {
		commit = git('rev-parse --short HEAD');
		if (git('status --porcelain --untracked-files=no')) commit += '+';
	} catch {
		// Not a git checkout (e.g. a source tarball): version only.
	}
	return {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__APP_COMMIT__: JSON.stringify(commit)
	};
}
