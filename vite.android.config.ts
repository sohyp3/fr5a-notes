import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Web bundle for the Capacitor Android shell: the same renderer as desktop
// (main window only — conflicts are shown in-app), output to `out/android`.
export default defineConfig({
	root: 'src/renderer',
	base: './',
	resolve: {
		alias: {
			$lib: resolve('src/renderer/src/lib')
		}
	},
	build: {
		outDir: resolve('out/android'),
		emptyOutDir: true
	},
	plugins: [
		svelte({
			compilerOptions: { runes: true }
		})
	]
});
