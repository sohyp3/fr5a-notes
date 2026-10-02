/**
 * Incremental Server-Sent Events parser. `feed` takes arbitrary text slices
 * (a chunk may end mid-line); `onData` gets each event's joined `data:` value.
 * `[DONE]` (OpenAI's terminator) is passed through for the caller to ignore.
 */
export function createSseParser(onData: (data: string) => void) {
	let buf = '';
	let data: string[] = [];

	const dispatch = () => {
		if (data.length) onData(data.join('\n'));
		data = [];
	};

	const line = (raw: string) => {
		const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
		if (l === '') return dispatch();
		if (l.startsWith(':')) return; // comment / keep-alive
		const colon = l.indexOf(':');
		const field = colon === -1 ? l : l.slice(0, colon);
		let value = colon === -1 ? '' : l.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'data') data.push(value);
	};

	return {
		feed(text: string) {
			buf += text;
			let nl: number;
			while ((nl = buf.indexOf('\n')) !== -1) {
				line(buf.slice(0, nl));
				buf = buf.slice(nl + 1);
			}
		},
		/** Flush a trailing event that wasn't followed by a blank line. */
		end() {
			if (buf) line(buf);
			buf = '';
			dispatch();
		}
	};
}
