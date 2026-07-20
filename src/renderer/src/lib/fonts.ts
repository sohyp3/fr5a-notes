/**
 * Font registry. Every option maps to a concrete CSS font-family stack. The
 * webfonts (Inter, JetBrains Mono, Amiri, …) are bundled offline by @fontsource
 * and imported in `main.ts`; the rest fall back to system faces.
 */

export interface FontOption {
	id: string;
	label: string;
	/** Full CSS font-family stack (for UI use). */
	stack: string;
	/** Just the primary family name — used to compose mixed-script stacks. */
	family: string;
}

export const UI_FONTS: FontOption[] = [
	{ id: 'inter', label: 'Inter', family: "'Inter'", stack: "'Inter', system-ui, sans-serif" },
	{
		id: 'system',
		label: 'System',
		family: 'system-ui',
		stack: "system-ui, -apple-system, 'Segoe UI', sans-serif"
	}
];

export const EN_FONTS: FontOption[] = [
	{ id: 'inter', label: 'Inter', family: "'Inter'", stack: "'Inter', system-ui, sans-serif" },
	{
		id: 'jetbrains',
		label: 'JetBrains Mono',
		family: "'JetBrains Mono'",
		stack: "'JetBrains Mono', ui-monospace, monospace"
	},
	{
		id: 'georgia',
		label: 'Georgia (serif)',
		family: 'Georgia',
		stack: "Georgia, 'Times New Roman', serif"
	},
	{
		id: 'system',
		label: 'System',
		family: 'system-ui',
		stack: 'system-ui, -apple-system, sans-serif'
	}
];

export const AR_FONTS: FontOption[] = [
	{
		id: 'naskh',
		label: 'Noto Naskh Arabic',
		family: "'Noto Naskh Arabic'",
		stack: "'Noto Naskh Arabic', serif"
	},
	{ id: 'amiri', label: 'Amiri', family: "'Amiri'", stack: "'Amiri', serif" },
	{ id: 'cairo', label: 'Cairo', family: "'Cairo'", stack: "'Cairo', sans-serif" }
];

function optFor(options: FontOption[], id: string): FontOption {
	return options.find((o) => o.id === id) ?? options[0];
}

export const uiStack = (id: string) => optFor(UI_FONTS, id).stack;

/**
 * Compose the editor's font stack for mixed English/Arabic text.
 *
 * The English family comes FIRST so Latin text renders in it; the Arabic family
 * follows so that any Arabic code point (which the Latin face lacks) falls back
 * to the chosen Arabic font — in LTR *and* RTL paragraphs alike. This is what
 * makes Arabic words inside an English note pick up the Arabic face.
 */
export function editorStack(enId: string, arId: string): string {
	const en = optFor(EN_FONTS, enId).family;
	const ar = optFor(AR_FONTS, arId).family;
	return `${en}, ${ar}, system-ui, sans-serif`;
}
