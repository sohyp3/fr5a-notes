import { mount } from 'svelte';
// UI font: Inter. Bundled offline by @fontsource so no network at runtime.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
// Markdown syntax font: JetBrains Mono.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
// Arabic faces (selectable in Settings).
import '@fontsource/noto-naskh-arabic/400.css';
import '@fontsource/noto-naskh-arabic/700.css';
import '@fontsource/amiri/400.css';
import '@fontsource/amiri/700.css';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/600.css';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
	target: document.getElementById('app')!
});

export default app;
