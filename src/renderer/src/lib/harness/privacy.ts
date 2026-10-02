import type { AiConfig, ProviderProfile } from './types';

/**
 * Local-only notes never leave the device for a non-local provider. A note is
 * local-only if it sits in a configured folder or carries `<!-- ai: local -->`.
 */

const AI_LOCAL_RE = /^\s*<!--\s*ai:\s*local\s*-->\s*$/im;

export function isLocalOnly(id: string, content: string | null, config: AiConfig): boolean {
	if (content && AI_LOCAL_RE.test(content)) return true;
	const dir = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
	return config.localOnlyFolders.some((f) => {
		const folder = f.replace(/^\/+|\/+$/g, '');
		return folder === '' || dir === folder || dir.startsWith(`${folder}/`);
	});
}

/** Null when allowed, else a human-readable reason. */
export function blockedReason(
	id: string,
	content: string | null,
	profile: ProviderProfile,
	config: AiConfig
): string | null {
	if (profile.local || !isLocalOnly(id, content, config)) return null;
	return `"${id}" is local-only and ${profile.name} is not a local provider.`;
}
