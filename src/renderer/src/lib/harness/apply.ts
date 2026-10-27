import { getAppState } from '../stores/app.svelte';
import { platform } from '../platform';
import { docToText, textToDoc, detectLocked } from '../editor/markdown';
import { appendText, insertAfterLine, newNoteText, replaceText } from './edits';
import type { EditProposal, WriteProposal } from './tools';
import { AbortError } from './openai';

/**
 * Turns a write proposal into a concrete before/after (for the diff card) and
 * an `apply()` that performs it — through the live editor for the open note
 * (so it lands in undo history and auto-save), through the platform otherwise.
 */

export interface PreparedWrite {
	/** Human label: "current note (drafts/a.md)", "new note “Title”"… */
	label: string;
	/** Optional readable list of changes for the approval card (maps). */
	summary?: string[];
	before: string;
	after: string;
	apply(signal?: AbortSignal): Promise<string>;
}

/** The note buffer that "current" meant when an AI run started. */
export interface CurrentWriteTarget {
	id: string | null;
	editorSession: number;
}

/** Read the editor buffer, not the last persisted copy, when this note is open. */
function liveText(): string {
	const app = getAppState();
	return app.editor ? docToText(app.editor) : app.activeContent;
}

async function noteText(id: string): Promise<string> {
	const app = getAppState();
	if (!app.notes.some((n) => n.id === id)) throw new Error(`${id} no longer exists.`);
	if (app.activeId === id) return liveText();
	return platform.readNote(id);
}

function assertSafe(id: string, text: string): void {
	const app = getAppState();
	const note = app.notes.find((n) => n.id === id);
	if (
		!note ||
		note.locked ||
		note.encrypted ||
		(app.activeId === id && app.aiBlocksActive) ||
		detectLocked(text)
	)
		throw new Error(`${id} is missing, locked or encrypted.`);
}

/** Targeted replacement and soft-delete both bind approval to the reviewed snapshot. */
export async function prepareEdit(p: EditProposal): Promise<PreparedWrite> {
	const app = getAppState();
	const id = p.target === 'current' ? app.activeId : p.target;
	if (!id) throw new Error('No saved note is open.');
	if (app.activeId === id) await app.flush();
	const before = await noteText(id);
	assertSafe(id, before);
	const diskBefore = await platform.readNote(id);
	if (
		!p.oldText ||
		!before.includes(p.oldText) ||
		before.indexOf(p.oldText) !== before.lastIndexOf(p.oldText)
	)
		throw new Error(
			'The exact old text must occur once in the note. Read it again and choose a unique passage.'
		);
	if (p.oldText === p.newText) throw new Error('The edit makes no change.');
	const after = before.replace(p.oldText, p.newText);
	return {
		label: id,
		before,
		after,
		async apply(signal) {
			const now = await noteText(id);
			assertSafe(id, now);
			if (now !== before || (await platform.readNote(id)) !== diskBefore)
				throw new Error('The note changed since review; nothing edited.');
			if (signal?.aborted) throw new AbortError();
			if (app.activeId === id && app.editor) setEditorText(after);
			else {
				await platform.writeNote(id, after);
				await app.refresh();
			}
			return `Edited ${id}`;
		}
	};
}

export async function prepareDelete(id: string): Promise<PreparedWrite> {
	const app = getAppState();
	if (app.activeId === id) await app.flush();
	const before = await noteText(id);
	assertSafe(id, before);
	const diskBefore = await platform.readNote(id);
	const title = app.notes.find((n) => n.id === id)?.title ?? id;
	return {
		label: `${title} (${id})`,
		before,
		after: '',
		async apply(signal) {
			const now = await noteText(id);
			assertSafe(id, now);
			if (now !== before || (await platform.readNote(id)) !== diskBefore)
				throw new Error('The note changed since review; nothing deleted.');
			if (signal?.aborted) throw new AbortError();
			// Confirm after approval, then recheck once more before touching Trash.
			const decision = app.confirm({
				title: 'Move note to Trash?',
				body: `“${title}” (${id}) will move to Trash. You can restore it later.`,
				confirm: 'Move to Trash',
				danger: true
			});
			const request = app.confirmRequest;
			const cancel = () => {
				if (request && app.confirmRequest === request) app.answerConfirm(false);
			};
			signal?.addEventListener('abort', cancel, { once: true });
			let confirmed: boolean;
			try {
				if (signal?.aborted) cancel();
				confirmed = await decision;
			} finally {
				signal?.removeEventListener('abort', cancel);
			}
			if (signal?.aborted) throw new AbortError();
			if (!confirmed) return 'The user rejected deletion; note kept.';
			const latest = await noteText(id);
			assertSafe(id, latest);
			if (latest !== before || (await platform.readNote(id)) !== diskBefore)
				throw new Error('The note changed since review; nothing deleted.');
			if (signal?.aborted) throw new AbortError();
			await app.deleteNote(id);
			return `Moved ${id} to Trash (restorable)`;
		}
	};
}

/** Index of the line (top-level paragraph) holding the caret, or the last line. */
function caretLine(): number | null {
	const ed = getAppState().editor;
	if (!ed) return null;
	const { $from } = ed.state.selection;
	return $from.index(0);
}

function setEditorText(text: string): void {
	const ed = getAppState().editor;
	// emitUpdate: the editor's onUpdate queues the debounced save as for typing.
	ed?.commands.setContent(textToDoc(text), { emitUpdate: true });
}

export async function prepareWrite(
	p: WriteProposal,
	current?: CurrentWriteTarget | null
): Promise<PreparedWrite> {
	const app = getAppState();
	if (p.target === 'current' && current === null)
		throw new Error('No note was open when this run started.');
	if (p.target === 'current' && current?.id) p = { ...p, target: current.id };
	if (
		p.target === 'current' &&
		current &&
		current.id === null &&
		app.editorSession !== current.editorSession
	)
		throw new Error('The note this run started with is no longer open; nothing written.');
	const isCurrent = p.target === 'current' || (p.target !== 'new' && p.target === app.activeId);

	if (p.target === 'new') {
		const title = (p.title || p.content.match(/^#\s+(.+)$/m)?.[1] || 'AI note').trim().slice(0, 80);
		const after = newNoteText(title, p.content);
		return {
			label: `new note “${title}”`,
			before: '',
			after,
			async apply() {
				// Not into `.fr5a/chats` while the AI chats list is open: it's the user's note.
				const folder = app.chatsOpen ? '' : (app.selectedFolder ?? '');
				// A folder whose notes are all encrypted keeps new ones encrypted.
				const seal = app.vault?.hasKey && app.folderEncrypted(folder);
				const body = seal ? await app.vault!.encrypt(after) : after;
				const meta = await platform.createNote(title, folder, body);
				await app.refresh();
				return `Created note ${meta.id}`;
			}
		};
	}

	if (isCurrent) {
		if (!app.activeId && !app.draft) throw new Error('No note is open.');
		if (app.aiBlocksActive)
			throw new Error('The open note is encrypted; the assistant can’t change it.');
		const ed = app.editor;
		const before = ed ? docToText(ed) : app.activeContent;
		if (detectLocked(before)) throw new Error('The open note is locked.');
		const line = p.mode === 'insert' ? caretLine() : null;
		const after =
			p.mode === 'replace'
				? replaceText(before, p.content)
				: p.mode === 'insert' && line !== null
					? insertAfterLine(before, line, p.content)
					: appendText(before, p.content);
		const id = app.activeId;
		return {
			label: `current note${id ? ` (${id})` : ''}`,
			before,
			after,
			async apply() {
				// The user may have switched notes while the card was open.
				if (app.activeId !== id) throw new Error('The open note changed; nothing written.');
				if (app.editor) setEditorText(after);
				else if (id) await platform.writeNote(id, after);
				return `Applied to ${id ?? 'the open note'} (${p.mode})`;
			}
		};
	}

	const id = p.target;
	// The open note named by path: its last keystrokes may still be waiting to save.
	if (id === app.activeId) await app.flush();
	const before = await platform.readNote(id);
	if (detectLocked(before)) throw new Error(`${id} is locked.`);
	const after =
		p.mode === 'replace' ? replaceText(before, p.content) : appendText(before, p.content);
	return {
		label: id,
		before,
		after,
		async apply() {
			if (id === app.activeId && app.editor) setEditorText(after);
			else {
				await platform.writeNote(id, after);
				await app.refresh();
			}
			return `Applied to ${id} (${p.mode === 'replace' ? 'replace' : 'append'})`;
		}
	};
}
