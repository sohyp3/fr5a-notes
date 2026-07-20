import Database from 'better-sqlite3';
import type { NoteMeta } from '../shared/types';

/**
 * A thin SQLite index over the workspace. The filesystem stays the source of
 * truth — this is a disposable cache that lets the sidebar/list render without
 * re-scanning every file. It lives in-memory-fast on disk under userData.
 */
export class NoteIndex {
	private db: Database.Database;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);
		this.db.pragma('journal_mode = WAL');
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS notes (
				id      TEXT PRIMARY KEY,
				absPath TEXT NOT NULL,
				title   TEXT NOT NULL,
				snippet TEXT NOT NULL,
				mtime   INTEGER NOT NULL,
				pinned  INTEGER NOT NULL DEFAULT 0,
				locked  INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE IF NOT EXISTS tags (
				note_id TEXT NOT NULL,
				tag     TEXT NOT NULL,
				PRIMARY KEY (note_id, tag)
			);
			CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
		`);
		// Migrate older index files that predate the `locked` column.
		const cols = this.db.prepare('PRAGMA table_info(notes)').all() as { name: string }[];
		if (!cols.some((c) => c.name === 'locked')) {
			this.db.exec('ALTER TABLE notes ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
		}
	}

	/** Insert or replace a note and its tags atomically. */
	upsert(meta: NoteMeta): void {
		const tx = this.db.transaction((m: NoteMeta) => {
			this.db
				.prepare(
					`INSERT INTO notes (id, absPath, title, snippet, mtime, pinned, locked)
					 VALUES (@id, @absPath, @title, @snippet, @mtime, @pinned, @locked)
					 ON CONFLICT(id) DO UPDATE SET
					   absPath = excluded.absPath,
					   title   = excluded.title,
					   snippet = excluded.snippet,
					   mtime   = excluded.mtime,
					   pinned  = excluded.pinned,
					   locked  = excluded.locked`
				)
				.run({
					id: m.id,
					absPath: m.absPath,
					title: m.title,
					snippet: m.snippet,
					mtime: m.mtime,
					pinned: m.pinned ? 1 : 0,
					locked: m.locked ? 1 : 0
				});
			this.db.prepare('DELETE FROM tags WHERE note_id = ?').run(m.id);
			const insTag = this.db.prepare('INSERT OR IGNORE INTO tags (note_id, tag) VALUES (?, ?)');
			for (const tag of m.tags) insTag.run(m.id, tag);
		});
		tx(meta);
	}

	remove(id: string): void {
		const tx = this.db.transaction((noteId: string) => {
			this.db.prepare('DELETE FROM tags WHERE note_id = ?').run(noteId);
			this.db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
		});
		tx(id);
	}

	/** Wipe everything — used when switching workspaces. */
	clear(): void {
		this.db.exec('DELETE FROM tags; DELETE FROM notes;');
	}

	all(): NoteMeta[] {
		// Pinned notes first, then most-recently-modified.
		const rows = this.db
			.prepare(
				'SELECT id, absPath, title, snippet, mtime, pinned, locked FROM notes ORDER BY pinned DESC, mtime DESC'
			)
			.all() as (Omit<NoteMeta, 'tags' | 'pinned' | 'locked'> & {
			pinned: number;
			locked: number;
		})[];
		const tagStmt = this.db.prepare('SELECT tag FROM tags WHERE note_id = ?');
		return rows.map((r) => ({
			...r,
			pinned: r.pinned === 1,
			locked: r.locked === 1,
			tags: (tagStmt.all(r.id) as { tag: string }[]).map((t) => t.tag)
		}));
	}

	/** Every `(tag, noteId)` pair — feeds the tag-tree builder. */
	tagPairs(): { tag: string; noteId: string }[] {
		return this.db.prepare('SELECT tag, note_id AS noteId FROM tags').all() as {
			tag: string;
			noteId: string;
		}[];
	}

	close(): void {
		this.db.close();
	}
}
