import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import legacy from '@vitejs/plugin-legacy';
import { buildInfo } from './build-info';

// Oldest WebView we ship to: a Huawei tablet's Chromium 92 (no findLast,
// structuredClone, Object.hasOwn, color-mix()…).
const WEBVIEW_TARGET = 'chrome92';

// Web bundle for the Capacitor Android shell: the same renderer as desktop
// (main window only — conflicts are shown in-app), output to `out/android`.
export default defineConfig({
	root: 'src/renderer',
	base: './',
	define: buildInfo(),
	resolve: {
		alias: {
			$lib: resolve('src/renderer/src/lib')
		}
	},
	build: {
		outDir: resolve('out/android'),
		emptyOutDir: true,
		// Lower syntax (e.g. class static blocks) for the old WebView.
		target: WEBVIEW_TARGET
	},
	plugins: [
		svelte({
			compilerOptions: { runes: true }
		}),
		// Polyfill the ES/web APIs the bundle actually uses (core-js, usage-based)
		// into the modern chunk; no separate legacy (nomodule) build.
		legacy({
			renderLegacyChunks: false,
			modernPolyfills: true,
			modernTargets: ['chrome >= 92']
		})
	]
});
