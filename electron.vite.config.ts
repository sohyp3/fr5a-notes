import { resolve } from 'node:path';
import { builtinModules } from 'node:module';
import { defineConfig } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Node built-ins (with and without the `node:` prefix) must never be bundled.
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

// Runtime packages the main/preload code imports directly. Keeping them
// external means they load from node_modules at runtime — essential for the
// native `better-sqlite3` binding and for `electron` to resolve to the built-in.
const runtimeExternals = ['electron', 'better-sqlite3', 'chokidar'];

/** Authoritative rollup `external` predicate for the Node-side bundles. */
function isExternal(id: string): boolean {
	if (nodeBuiltins.has(id)) return true;
	if (id === 'electron' || id.startsWith('electron/')) return true;
	return runtimeExternals.some((dep) => id === dep || id.startsWith(`${dep}/`));
}

export default defineConfig({
	main: {
		build: {
			rollupOptions: {
				external: isExternal,
				input: { index: resolve('src/main/index.ts') }
			}
		}
	},
	preload: {
		build: {
			rollupOptions: {
				external: isExternal,
				input: { index: resolve('src/preload/index.ts') }
			}
		}
	},
	renderer: {
		root: 'src/renderer',
		resolve: {
			alias: {
				$lib: resolve('src/renderer/src/lib')
			}
		},
		build: {
			rollupOptions: {
				input: { index: resolve('src/renderer/index.html') }
			}
		},
		plugins: [
			svelte({
				compilerOptions: { runes: true }
			})
		]
	}
});
