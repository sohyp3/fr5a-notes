import { defineConfig } from 'vitest/config';

export default defineConfig({
	// The lightweight OpenPGP build only ships for browsers; Node gets the full one.
	resolve: { alias: [{ find: /^openpgp\/lightweight$/, replacement: 'openpgp' }] },
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
