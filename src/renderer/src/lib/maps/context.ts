import { getContext, setContext } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import type { NoteMeta } from '../../../../shared/types';
import type { CanvasDoc, CanvasNode } from './canvas';

/** What the map editor offers its node / edge components. */
export interface MapApi {
	/** The node whose text is being edited. */
	readonly editingId: string | null;
	/** The canvas as last committed (not updated per drag frame). */
	readonly doc: CanvasDoc;
	readonly touch: boolean;
	readonly theme: 'light' | 'dark';
	edit(id: string): void;
	commitText(id: string, text: string): void;
	cancelEdit(): void;
	/** The note a note node shows: by path, else (moved outside the app) by file name. */
	noteFor(file: string | undefined): NoteMeta | undefined;
	openNote(nodeId: string): void;
	relink(nodeId: string): void;
	/** Tagged notes not on the map yet (and not taken off it). */
	newFor(tagNodeId: string): string[];
	populate(tagNodeId: string): void;
	/** The tag node of a note node whose note lost that tag. */
	untagged(nodeId: string): CanvasNode | null;
	remove(ids: string[]): void;
	/** Long-press (touch) / right-click: the node's action menu. */
	press(nodeId: string): Attachment<HTMLElement>;
	editLabel(edgeId: string): void;
}

const KEY = Symbol('fr5a-map');

export const setMapApi = (api: MapApi): MapApi => setContext(KEY, api);
export const getMapApi = (): MapApi => getContext<MapApi>(KEY);
