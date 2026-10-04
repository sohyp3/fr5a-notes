/**
 * Turns a failed run into something the transcript can act on: a short title,
 * a hint, and whether "Retry" or "Settings" is the useful next step.
 */

export type ErrorKind = 'network' | 'content' | 'auth' | 'rate' | 'server' | 'setup' | 'other';

export interface ErrorInfo {
	kind: ErrorKind;
	title: string;
	hint: string;
	/** Sending the same message again could work. */
	retry: boolean;
	/** The fix is in Settings → AI. */
	settings: boolean;
}

const NETWORK =
	/network|failed to fetch|fetch failed|timed? ?out|timeout|ENOTFOUND|ECONN|EAI_AGAIN|ENETUNREACH|ERR_(INTERNET|NETWORK|CONNECTION|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE)|disconnected|socket|unreachable|resolve host|offline|connection (refused|reset|closed)|aborted by the host/i;

/** A provider's moderation refusing the request (Qwen, GLM, DeepSeek, Kimi, OpenRouter, Azure…). */
const FILTERED =
	/inappropriate|sensitive (content|information|words)|unsafe|content.?(filter|polic|management|exists risk)|data_inspection|moderation|flagged|high risk|prohibited|敏感|不安全/i;

export function describeError(message: string, status?: number, online = true): ErrorInfo {
	const m = message || 'Something went wrong.';
	if (!online || (status === undefined && NETWORK.test(m)))
		return {
			kind: 'network',
			title: online ? 'Network problem' : 'You are offline',
			hint: 'Check the connection (or VPN for a local server), then retry. Your message is kept.',
			retry: true,
			settings: false
		};
	// Before auth: some providers refuse flagged input with a 403.
	if (FILTERED.test(m))
		return {
			kind: 'content',
			title: "Blocked by the provider's content filter",
			hint: 'Something in the chat, often a search result or a web page, tripped it. Retry leaves out the last tool results; if it fails again, pick another model.',
			retry: true,
			settings: false
		};
	if (status === 401 || status === 403 || /api key|unauthori[sz]ed|forbidden|invalid.*key/i.test(m))
		return {
			kind: 'auth',
			title: 'The provider refused the key',
			hint: 'Check the API key for this provider in Settings → AI.',
			retry: false,
			settings: true
		};
	if (status === 429 || /rate.?limit|too many requests|quota/i.test(m))
		return {
			kind: 'rate',
			title: 'Rate limited',
			hint: 'The provider is throttling requests. Wait a moment, then retry.',
			retry: true,
			settings: false
		};
	if (
		(status !== undefined && status >= 500) ||
		/overloaded|bad gateway|service unavailable/i.test(m)
	)
		return {
			kind: 'server',
			title: 'The provider had a problem',
			hint: 'This is usually temporary. Retry, or switch provider.',
			retry: true,
			settings: false
		};
	if (/add an ai provider|no provider|needs a free api key|has no api key/i.test(m))
		return { kind: 'setup', title: 'Setup needed', hint: '', retry: false, settings: true };
	return { kind: 'other', title: 'The run failed', hint: '', retry: true, settings: false };
}
