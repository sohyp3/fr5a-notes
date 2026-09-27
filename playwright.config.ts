import { defineConfig } from '@playwright/test';

// Mobile layout checks: the renderer served by Vite (Android web config), on
// emulated touch devices. The host API is an in-memory fake (see e2e/fakeApi.ts).
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	reporter: 'list',
	use: { baseURL: 'http://localhost:5199' },
	webServer: {
		command: 'npx vite -c vite.android.config.ts --port 5199 --strictPort',
		url: 'http://localhost:5199',
		reuseExistingServer: false
	},
	projects: [
		{
			name: 'phone 390x844',
			use: {
				browserName: 'chromium',
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
				deviceScaleFactor: 3
			}
		},
		{
			name: 'tablet portrait 800x1280',
			use: {
				browserName: 'chromium',
				viewport: { width: 800, height: 1280 },
				isMobile: true,
				hasTouch: true,
				deviceScaleFactor: 2
			}
		},
		{
			name: 'tablet landscape 1280x800',
			use: {
				browserName: 'chromium',
				viewport: { width: 1280, height: 800 },
				isMobile: true,
				hasTouch: true,
				deviceScaleFactor: 2
			}
		}
	]
});
