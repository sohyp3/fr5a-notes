import { promises as fs } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { NoteIndex } from './db';
import { parseTags } from './tags';
import type { NoteMeta } from '../shared/types';

const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.txt']);

/** Hidden folder (at the workspace root) that holds soft-deleted notes. */
const TRASH_DIR = '.fr5a_trash';

/**
 * The "Local File Service": owns a workspace directory of Markdown files.
 *
 * Responsibilities, in the spirit of a self-contained Rust service:
 *   - full scan of the directory into the SQLite index,
 *   - incremental re-index on filesystem changes (via chokidar),
 *   - the read / write / create / delete operations the UI drives.
 *
 * It never holds note bodies in memory beyond a single operation — the disk is
 * always the source of truth. `onChange` fires (debounced) whenever the index
 * shifts so the renderer can refetch.
 */
export class FileService {
	private watcher: FSWatcher | null = null;
	private changeTimer: NodeJS.Timeout | null = null;

	constructor(
		public root: string,
		private index: NoteIndex,
		private onChange: () => void
	) {}

	/** Absolute path -> workspace-relative id. */
	private toId(absPath: string): string {
		return path.relative(this.root, absPath);
	}

	private isNote(p: string): boolean {
		return MD_EXT.has(path.extname(p).toLowerCase());
	}

	/** Derive metadata from a file's raw contents. */
	private buildMeta(absPath: string, raw: string, mtime: number): NoteMeta {
		const pinned = /^\s*<!--\s*pinned:\s*true\s*-->\s*$/im.test(raw);
		const locked = /^\s*<!--\s*locked:\s*true\s*-->\s*$/im.test(raw);
		// Strip hidden metadata comments (dir / pinned / locked) so they never
		// surface as the title or in the snippet.
		const body = raw.replace(
			/^\s*<!--\s*(?:dir:\s*(?:rtl|ltr)|pinned:\s*(?:true|false)|locked:\s*(?:true|false))\s*-->\s*$/gim,
			''
		);
		const lines = body.split('\n');
		// Title: first Markdown heading, else first non-empty line, else filename.
		let title = '';
		for (const line of lines) {
			const t = line.trim();
			if (!t) continue;
			title = t.replace(/^#{1,6}\s*/, '');
			break;
		}
		if (!title) title = path.basename(absPath, path.extname(absPath));

		// Snippet: the body after the title line, flattened, first ~140 chars.
		const snippet = body
			.replace(/^#{1,6}\s.*$/m, '')
			.replace(/[#>*_`~-]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 140);

		return {
			id: this.toId(absPath),
			absPath,
			title,
			snippet,
			mtime,
			tags: parseTags(body),
			pinned,
			locked
		};
	}

	/** True for anything inside the `.fr5a_trash` folder. */
	private isTrashPath(absPath: string): boolean {
		const rel = this.toId(absPath);
		return rel === TRASH_DIR || rel.startsWith(`${TRASH_DIR}/`) || rel.startsWith(`${TRASH_DIR}\\`);
	}

	private async indexFile(absPath: string): Promise<void> {
		// Trashed notes must never enter the live index (a note reopened from the
		// trash and saved would otherwise reappear in the main list).
		if (this.isTrashPath(absPath)) return;
		try {
			const [raw, stat] = await Promise.all([fs.readFile(absPath, 'utf8'), fs.stat(absPath)]);
			this.index.upsert(this.buildMeta(absPath, raw, stat.mtimeMs));
		} catch {
			// File vanished between the event and the read — treat as removed.
			this.index.remove(this.toId(absPath));
		}
	}

	/** Recursively collect note paths, skipping dot-dirs and node_modules. */
	private async collect(dir: string, out: string[]): Promise<void> {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) await this.collect(full, out);
			else if (entry.isFile() && this.isNote(full)) out.push(full);
		}
	}

	/** Full scan: rebuild the index from scratch, then start watching. */
	async start(): Promise<void> {
		this.index.clear();
		const files: string[] = [];
		await this.collect(this.root, files);
		await Promise.all(files.map((f) => this.indexFile(f)));
		this.startWatching();
		this.onChange();
	}

	private startWatching(): void {
		this.watcher = chokidar.watch(this.root, {
			ignored: (p) => /(^|[/\\])(\.|node_modules)/.test(p),
			ignoreInitial: true,
			awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
		});
		const onFsEvent = async (absPath: string, removed = false) => {
			if (!this.isNote(absPath)) return;
			if (removed) this.index.remove(this.toId(absPath));
			else await this.indexFile(absPath);
			this.scheduleChange();
		};
		this.watcher
			.on('add', (p) => onFsEvent(p))
			.on('change', (p) => onFsEvent(p))
			.on('unlink', (p) => onFsEvent(p, true))
			// Empty folders don't touch the note index, but the sidebar tree still
			// needs to learn about them — nudge the renderer to refetch folders.
			.on('addDir', () => this.scheduleChange())
			.on('unlinkDir', () => this.scheduleChange());
	}

	/** Coalesce bursty watcher events into a single UI refresh. */
	private scheduleChange(): void {
		if (this.changeTimer) clearTimeout(this.changeTimer);
		this.changeTimer = setTimeout(() => this.onChange(), 120);
	}

	// --- operations the renderer calls -------------------------------------

	async read(id: string): Promise<string> {
		return fs.readFile(path.join(this.root, id), 'utf8');
	}

	/** Write body to disk and re-index synchronously so the UI stays coherent. */
	async write(id: string, content: string): Promise<void> {
		const absPath = path.join(this.root, id);
		await fs.mkdir(path.dirname(absPath), { recursive: true });
		await fs.writeFile(absPath, content, 'utf8');
		await this.indexFile(absPath);
		this.scheduleChange();
	}

	/**
	 * Create a fresh note with a unique filename derived from `title`, inside the
	 * workspace-relative `folder` (defaults to the root). When `content` is given
	 * it becomes the file body verbatim (used when a draft written in the editor
	 * is first saved — the typed H1 names the file).
	 */
	async create(title = 'Untitled', folder = '', content?: string): Promise<NoteMeta> {
		const base = title.trim().replace(/[/\\?%*:|"<>]/g, '-') || 'Untitled';
		// Guard against a folder escaping the workspace (e.g. `..`).
		const dir = this.safeSubdir(folder);
		let name = `${base}.md`;
		let n = 1;
		// Avoid clobbering an existing file.
		while (await this.exists(path.join(this.root, dir, name))) {
			name = `${base} ${++n}.md`;
		}
		const id = dir ? `${dir}/${name}` : name;
		await this.write(id, content ?? `# ${base}\n\n`);
		const raw = await this.read(id);
		const stat = await fs.stat(path.join(this.root, id));
		return this.buildMeta(path.join(this.root, id), raw, stat.mtimeMs);
	}

	/**
	 * Create an empty sub-directory named `name` inside `parent`
	 * (workspace-relative, '' = root). Returns the new folder's relative id.
	 */
	async createFolder(name: string, parent = ''): Promise<string> {
		const clean = name.trim().replace(/[/\\?%*:|"<>]/g, '-');
		if (!clean) throw new Error('Folder name is empty');
		const dir = this.safeSubdir(parent);
		let rel = dir ? `${dir}/${clean}` : clean;
		let n = 1;
		while (await this.exists(path.join(this.root, rel))) {
			rel = dir ? `${dir}/${clean} ${++n}` : `${clean} ${++n}`;
		}
		await fs.mkdir(path.join(this.root, rel), { recursive: true });
		this.scheduleChange();
		return rel;
	}

	/** Every sub-directory in the workspace (relative paths), including empty ones. */
	async listFolders(): Promise<string[]> {
		const out: string[] = [];
		await this.collectDirs(this.root, out);
		return out.sort();
	}

	/** Recursively collect sub-directory paths, skipping dot-dirs and node_modules. */
	private async collectDirs(dir: string, out: string[]): Promise<void> {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
			const full = path.join(dir, entry.name);
			out.push(this.toId(full));
			await this.collectDirs(full, out);
		}
	}

	/** Normalise a caller-supplied folder to a safe, workspace-relative path. */
	private safeSubdir(folder: string): string {
		const norm = path.normalize(folder).replace(/^([/\\]|\.\.?([/\\]|$))+/, '');
		return norm === '.' ? '' : norm.replace(/\\/g, '/');
	}

	/**
	 * Soft-delete: move the note into `.fr5a_trash`, mirroring its original
	 * relative path so it can be restored to exactly where it came from. The
	 * trash dir is dot-prefixed, so the scanner/watcher ignore it — trashed notes
	 * never pollute the live index.
	 */
	async delete(id: string): Promise<void> {
		const src = path.join(this.root, id);
		// A locked note is protected: refuse to delete until it's unlocked.
		try {
			const raw = await fs.readFile(src, 'utf8');
			if (/^\s*<!--\s*locked:\s*true\s*-->\s*$/im.test(raw)) {
				throw new Error(`Note is locked: ${id}`);
			}
		} catch (err) {
			// Re-throw the lock error; ignore a missing file (nothing to delete).
			if (err instanceof Error && err.message.startsWith('Note is locked')) throw err;
		}
		const dest = await this.uniquePath(path.join(this.root, TRASH_DIR, id));
		try {
			await fs.mkdir(path.dirname(dest), { recursive: true });
			await fs.rename(src, dest);
		} catch {
			// Cross-device or vanished file: fall back to a hard delete.
			await fs.rm(src, { force: true });
		}
		this.index.remove(id);
		this.scheduleChange();
	}

	/** List the notes currently sitting in `.fr5a_trash` (ids include the prefix). */
	async listTrash(): Promise<NoteMeta[]> {
		const trashRoot = path.join(this.root, TRASH_DIR);
		const files: string[] = [];
		await this.collectAll(trashRoot, files);
		const metas = await Promise.all(
			files.map(async (absPath) => {
				try {
					const [raw, stat] = await Promise.all([fs.readFile(absPath, 'utf8'), fs.stat(absPath)]);
					return this.buildMeta(absPath, raw, stat.mtimeMs);
				} catch {
					return null;
				}
			})
		);
		return metas.filter((m): m is NoteMeta => m !== null).sort((a, b) => b.mtime - a.mtime);
	}

	/** The original workspace-relative path a trashed note came from. */
	private originalId(trashId: string): string {
		const prefix = `${TRASH_DIR}/`;
		return trashId.startsWith(prefix) ? trashId.slice(prefix.length) : path.basename(trashId);
	}

	/** Move a trashed note back to its original location (deduping on collision). */
	async restore(trashId: string): Promise<string> {
		const src = path.join(this.root, trashId);
		const targetId = this.originalId(trashId);
		const dest = await this.uniquePath(path.join(this.root, targetId));
		await fs.mkdir(path.dirname(dest), { recursive: true });
		await fs.rename(src, dest);
		const restoredId = this.toId(dest);
		await this.indexFile(dest);
		this.scheduleChange();
		return restoredId;
	}

	/** Permanently remove a note from the trash. */
	async permanentDelete(trashId: string): Promise<void> {
		await fs.rm(path.join(this.root, trashId), { force: true });
		this.scheduleChange();
	}

	/** Collect every note under `dir`, including dot-dirs (used for the trash). */
	private async collectAll(dir: string, out: string[]): Promise<void> {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) await this.collectAll(full, out);
			else if (entry.isFile() && this.isNote(full)) out.push(full);
		}
	}

	/** Return `p`, or `p` with a numeric suffix if it already exists. */
	private async uniquePath(p: string): Promise<string> {
		if (!(await this.exists(p))) return p;
		const dir = path.dirname(p);
		const ext = path.extname(p);
		const base = path.basename(p, ext);
		let n = 1;
		let candidate = path.join(dir, `${base} ${++n}${ext}`);
		while (await this.exists(candidate)) {
			candidate = path.join(dir, `${base} ${++n}${ext}`);
		}
		return candidate;
	}

	private async exists(p: string): Promise<boolean> {
		try {
			await fs.access(p);
			return true;
		} catch {
			return false;
		}
	}

	async stop(): Promise<void> {
		if (this.changeTimer) clearTimeout(this.changeTimer);
		await this.watcher?.close();
		this.watcher = null;
	}
}
