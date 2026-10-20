import type { SuggestionOptions } from '@tiptap/suggestion';

/**
 * The floating dropdown of a `@tiptap/suggestion` plugin (tags, note links):
 * plain DOM, not a Svelte component — it lives outside the editor's
 * ProseMirror DOM, is created/destroyed by the Suggestion lifecycle, and
 * needs no reactivity beyond the keystrokes the plugin already delivers.
 * Arrows move, Tab / Enter pick, Escape closes; no items, no dropdown.
 */
export function suggestMenu<T>(
	row: (item: T) => Node[]
): NonNullable<SuggestionOptions<T>['render']> {
	return () => {
		let el: HTMLDivElement | null = null;
		let items: T[] = [];
		let selected = 0;
		let pick: (item: T) => void = () => {};

		const destroy = (): void => {
			el?.remove();
			el = null;
		};

		const paint = (): void => {
			if (!el) return;
			el.innerHTML = '';
			items.forEach((item, i) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'tag-suggest-item' + (i === selected ? ' active' : '');
				button.append(...row(item));
				// mousedown, not click — click fires after the editor regains
				// focus and the suggestion range may already be gone.
				button.addEventListener('mousedown', (e) => {
					e.preventDefault();
					pick(item);
				});
				el!.appendChild(button);
			});
		};

		const position = (clientRect?: (() => DOMRect | null) | null): void => {
			const rect = clientRect?.();
			if (!el || !rect) return;
			el.style.left = `${Math.min(rect.left, window.innerWidth - el.offsetWidth - 12)}px`;
			el.style.top = `${rect.bottom + 6}px`;
		};

		const show = (props: {
			items: T[];
			command: (item: T) => void;
			clientRect?: (() => DOMRect | null) | null;
		}): void => {
			items = props.items;
			selected = Math.min(selected, Math.max(0, items.length - 1));
			pick = (item) => props.command(item);
			if (items.length === 0) return destroy();
			if (!el) {
				el = document.createElement('div');
				el.className = 'tag-suggest';
				document.body.appendChild(el);
			}
			paint();
			position(props.clientRect);
		};

		return {
			onStart: (props) => {
				selected = 0;
				show(props);
			},
			onUpdate: show,
			onKeyDown: ({ event }) => {
				if (!el || items.length === 0) return false;
				if (event.key === 'ArrowDown') {
					selected = (selected + 1) % items.length;
					paint();
					return true;
				}
				if (event.key === 'ArrowUp') {
					selected = (selected + items.length - 1) % items.length;
					paint();
					return true;
				}
				if (event.key === 'Tab' || event.key === 'Enter') {
					pick(items[selected]);
					return true;
				}
				if (event.key === 'Escape') {
					destroy();
					return true;
				}
				return false;
			},
			onExit: destroy
		};
	};
}

/** A span with a class, for a dropdown row. */
export function span(className: string, text: string): HTMLSpanElement {
	const el = document.createElement('span');
	el.className = className;
	el.textContent = text;
	return el;
}
