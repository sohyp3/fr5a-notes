import { registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { PromiseFsClient } from 'isomorphic-git';
import { fromBase64, toBase64 } from './capHttp';

/**
 * Node-style promise fs for isomorphic-git, backed by Capacitor Filesystem in
 * app-private storage (Directory.Data). Paths are absolute from isomorphic-git's
 * point of view (`/notes/.git/HEAD`) and map to `notes/.git/HEAD` under Data.
 * Binary data crosses the bridge as base64 (Filesystem's default without an
 * encoding).
 */

const DIR = Directory.Data;

/** App-local native plugin (`FileTimesPlugin.java`): Filesystem can't set an mtime. */
const FileTimes = registerPlugin<{
	setMtime(opts: { path: string; mtime: number }): Promise<void>;
}>('FileTimes');

function fsError(code: 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'ENOTEMPTY', path: string): Error {
	return Object.assign(new Error(`${code}: ${path}`), { code });
}

/** Capacitor rejects with free-text messages; isomorphic-git branches on `code`. */
function mapError(err: unknown, path: string): Error {
	const msg = err instanceof Error ? err.message : String(err);
	if (/exist/i.test(msg) && /does not|doesn't|not exist|no such/i.test(msg))
		return fsError('ENOENT', path);
	if (/already exists|exists/i.test(msg)) return fsError('EEXIST', path);
	if (/not empty/i.test(msg)) return fsError('ENOTEMPTY', path);
	return fsError('ENOENT', path);
}

const rel = (p: string) => p.replace(/^\/+/, '');

function statsOf(info: { type: string; size: number; mtime: number; ctime?: number }) {
	const isDir = info.type === 'directory';
	return {
		type: isDir ? 'dir' : 'file',
		mode: isDir ? 0o40000 : 0o100644,
		size: info.size,
		ino: 0,
		uid: 0,
		gid: 0,
		dev: 0,
		mtimeMs: info.mtime,
		ctimeMs: info.ctime ?? info.mtime,
		isFile: () => !isDir,
		isDirectory: () => isDir,
		isSymbolicLink: () => false
	};
}

export function createCapFs(): PromiseFsClient {
	const promises = {
		async readFile(path: string, opts?: { encoding?: string } | string) {
			const encoding = typeof opts === 'string' ? opts : opts?.encoding;
			try {
				if (encoding === 'utf8') {
					const { data } = await Filesystem.readFile({
						path: rel(path),
						directory: DIR,
						encoding: Encoding.UTF8
					});
					return data as string;
				}
				const { data } = await Filesystem.readFile({ path: rel(path), directory: DIR });
				return fromBase64(data as string);
			} catch (err) {
				throw mapError(err, path);
			}
		},
		async writeFile(
			path: string,
			data: Uint8Array | string,
			opts?: { encoding?: string } | string
		) {
			const encoding = typeof opts === 'string' ? opts : opts?.encoding;
			try {
				if (typeof data === 'string' && (encoding === 'utf8' || encoding === undefined))
					await Filesystem.writeFile({
						path: rel(path),
						directory: DIR,
						data,
						encoding: Encoding.UTF8
					});
				else
					await Filesystem.writeFile({
						path: rel(path),
						directory: DIR,
						data: toBase64(typeof data === 'string' ? new TextEncoder().encode(data) : data)
					});
			} catch (err) {
				throw mapError(err, path);
			}
		},
		async unlink(path: string) {
			try {
				await Filesystem.deleteFile({ path: rel(path), directory: DIR });
			} catch (err) {
				throw mapError(err, path);
			}
		},
		async readdir(path: string) {
			try {
				const { files } = await Filesystem.readdir({ path: rel(path), directory: DIR });
				return files.map((f) => f.name);
			} catch (err) {
				throw mapError(err, path);
			}
		},
		async mkdir(path: string) {
			if (await exists(path)) throw fsError('EEXIST', path);
			try {
				await Filesystem.mkdir({ path: rel(path), directory: DIR, recursive: false });
			} catch (err) {
				throw mapError(err, path);
			}
		},
		async rmdir(path: string) {
			try {
				const { files } = await Filesystem.readdir({ path: rel(path), directory: DIR });
				if (files.length > 0) throw fsError('ENOTEMPTY', path);
				await Filesystem.rmdir({ path: rel(path), directory: DIR });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOTEMPTY') throw err;
				throw mapError(err, path);
			}
		},
		async stat(path: string) {
			try {
				return statsOf(await Filesystem.stat({ path: rel(path), directory: DIR }));
			} catch (err) {
				throw mapError(err, path);
			}
		},
		async lstat(path: string) {
			return promises.stat(path);
		},
		// No symlinks in app-private storage.
		async readlink(path: string): Promise<string> {
			throw fsError('ENOENT', path);
		},
		async symlink(_target: string, path: string): Promise<void> {
			throw fsError('ENOENT', path);
		},
		async chmod() {},
		/** Node's signature (seconds or a Date); only the mtime is set. */
		async utimes(path: string, _atime: number | Date, mtime: number | Date) {
			const ms = typeof mtime === 'number' ? mtime * 1000 : mtime.getTime();
			await FileTimes.setMtime({ path: rel(path), mtime: Math.round(ms) });
		}
	};

	async function exists(path: string): Promise<boolean> {
		try {
			await Filesystem.stat({ path: rel(path), directory: DIR });
			return true;
		} catch {
			return false;
		}
	}

	return { promises } as unknown as PromiseFsClient;
}
