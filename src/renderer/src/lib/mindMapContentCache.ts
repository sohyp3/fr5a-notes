import type { NoteMeta } from '../../../shared/types';

/** Body reads shared by map load, edits and reflow; never retain decrypted bodies after locking. */
export class MindMapContentCache {
	private entries = new Map<string, { mtime: number; content: Promise<string> }>();
	private unlocked: boolean | undefined;

	constructor(private read: (id: string) => Promise<string>) {}

	retain(notes: readonly NoteMeta[], unlocked: boolean): void {
		if (this.unlocked !== unlocked) this.entries.clear();
		this.unlocked = unlocked;
		const current = new Map(notes.map((note) => [note.id, note]));
		for (const [id, entry] of this.entries) {
			const note = current.get(id);
			if (!note || note.mtime !== entry.mtime || (note.encrypted && !unlocked))
				this.entries.delete(id);
		}
	}

	seed(note: NoteMeta, source: string): void {
		this.entries.set(note.id, { mtime: note.mtime, content: Promise.resolve(source) });
	}

	get(note: NoteMeta): Promise<string> {
		const cached = this.entries.get(note.id);
		if (cached?.mtime === note.mtime) return cached.content;
		const entry = {
			mtime: note.mtime,
			content: this.read(note.id).catch((cause) => {
				// Failed reads must be retried, and an older failure must not evict a newer entry.
				if (this.entries.get(note.id) === entry) this.entries.delete(note.id);
				throw cause;
			})
		};
		this.entries.set(note.id, entry);
		return entry.content;
	}
}
