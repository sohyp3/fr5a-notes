/**
 * What chats cost. Each model call reports its tokens (`usage` in the
 * response; streams send it in the last chunk). Cost is what the provider
 * reports when it does (OpenRouter), else tokens × the provider's price set
 * in Settings → AI, else the model's models.dev price (prices.ts), else free
 * for local models, else unknown. One record per
 * run (a message and its tool steps) goes into the session file, so a chat's
 * cost syncs with it and the Usage window can add everything up.
 */

/** Tokens of one or more model calls, as the provider reported them. */
export interface Usage {
	input: number;
	output: number;
	/** USD, when the provider reports it (every call did). */
	cost?: number;
}

/** USD per 1M tokens. */
export interface Price {
	input: number;
	output: number;
}

/** One run, as stored in a session file. */
export interface UsageRecord {
	/** ISO time the run finished. */
	at: string;
	/** Provider profile id (prices it after the fact when `cost` is null). */
	provider: string;
	model: string;
	input: number;
	output: number;
	/** USD; null when neither the provider nor a price said. */
	cost: number | null;
}

/** The pricing side of a provider profile. */
export interface Priced {
	local?: boolean;
	price?: Price;
}

const num = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

/** A response's `usage` object → tokens (+ cost), or null when it has none. */
export function readUsage(raw: unknown): Usage | null {
	if (!raw || typeof raw !== 'object') return null;
	const u = raw as Record<string, unknown>;
	const input = num(u.prompt_tokens) ?? num(u.input_tokens);
	const output = num(u.completion_tokens) ?? num(u.output_tokens);
	if (input === null && output === null) return null;
	const cost = num(u.cost) ?? num(u.total_cost);
	return { input: input ?? 0, output: output ?? 0, ...(cost !== null ? { cost } : {}) };
}

/** Sum two usages; the cost stays known only while every call reported one. */
export function addUsage(a: Usage | null, b: Usage): Usage {
	if (!a) return { ...b };
	const cost = a.cost !== undefined && b.cost !== undefined ? a.cost + b.cost : undefined;
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		...(cost !== undefined ? { cost } : {})
	};
}

/** Tokens × price; 0 for local models; null when there's no price. */
export function priceTokens(input: number, output: number, p: Priced | undefined): number | null {
	if (p?.local) return 0;
	if (!p?.price) return null;
	return (input * p.price.input + output * p.price.output) / 1_000_000;
}

export function runRecord(
	usage: Usage,
	profile: { id: string; model: string },
	priced: Priced | undefined,
	at = new Date()
): UsageRecord {
	return {
		at: at.toISOString(),
		provider: profile.id,
		model: profile.model,
		input: usage.input,
		output: usage.output,
		cost: usage.cost ?? priceTokens(usage.input, usage.output, priced)
	};
}

/** A provider (+ model) → how its runs are priced. */
export type PriceLookup = (provider: string, model: string) => Priced | undefined;

/** A record's cost: as stored, else priced with the provider's current price. */
export function recordCost(r: UsageRecord, p: Priced | undefined): number | null {
	return r.cost ?? priceTokens(r.input, r.output, p);
}

// --- session file form: `at|provider|model|input|output|cost` --------------

export function formatRecord(r: UsageRecord): string {
	const clean = (s: string) => s.replace(/[|,"]/g, ' ');
	return [r.at, clean(r.provider), clean(r.model), r.input, r.output, r.cost ?? ''].join('|');
}

export function parseRecord(s: string): UsageRecord | null {
	const [at, provider, model, input, output, cost] = s.split('|');
	if (!at || Number.isNaN(Date.parse(at)) || input === undefined || output === undefined)
		return null;
	return {
		at,
		provider: provider ?? '',
		model: model ?? '',
		input: Number(input) || 0,
		output: Number(output) || 0,
		cost: cost ? Number(cost) : null
	};
}

// --- totals -------------------------------------------------------------------

export interface Totals {
	input: number;
	output: number;
	/** USD of the runs whose cost is known. */
	cost: number;
	runs: number;
	/** Runs with no cost (no provider report, no price). */
	unpriced: number;
}

const empty = (): Totals => ({ input: 0, output: 0, cost: 0, runs: 0, unpriced: 0 });

function add(t: Totals, r: UsageRecord, cost: number | null): void {
	t.input += r.input;
	t.output += r.output;
	t.runs++;
	if (cost === null) t.unpriced++;
	else t.cost += cost;
}

export function totalOf(records: UsageRecord[], priced: PriceLookup) {
	const t = empty();
	for (const r of records) add(t, r, recordCost(r, priced(r.provider, r.model)));
	return t;
}

export interface ChatUsage {
	file: string;
	title: string;
	records: UsageRecord[];
}

export interface UsageReport {
	today: Totals;
	month: Totals;
	all: Totals;
	byModel: (Totals & { model: string; provider: string })[];
	/** Chats that used anything, most recently used first. */
	byChat: (Totals & { file: string; title: string; last: string })[];
}

/** Everything the Usage window shows; days and months are local time. */
export function usageReport(
	chats: ChatUsage[],
	priced: PriceLookup,
	now = new Date()
): UsageReport {
	const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	const report: UsageReport = {
		today: empty(),
		month: empty(),
		all: empty(),
		byModel: [],
		byChat: []
	};
	const models = new Map<string, UsageReport['byModel'][number]>();
	for (const chat of chats) {
		if (!chat.records.length) continue;
		const row = { ...empty(), file: chat.file, title: chat.title, last: '' };
		for (const r of chat.records) {
			const cost = recordCost(r, priced(r.provider, r.model));
			const at = Date.parse(r.at);
			add(report.all, r, cost);
			if (at >= month) add(report.month, r, cost);
			if (at >= day) add(report.today, r, cost);
			add(row, r, cost);
			if (r.at > row.last) row.last = r.at;
			const key = `${r.provider}\0${r.model}`;
			let m = models.get(key);
			if (!m) models.set(key, (m = { ...empty(), model: r.model, provider: r.provider }));
			add(m, r, cost);
		}
		report.byChat.push(row);
	}
	report.byChat.sort((a, b) => b.last.localeCompare(a.last));
	report.byModel = [...models.values()].sort(
		(a, b) => b.cost - a.cost || b.input + b.output - (a.input + a.output)
	);
	return report;
}

// --- display ------------------------------------------------------------------

export function formatUsd(usd: number): string {
	if (usd === 0) return '$0';
	if (usd < 0.0001) return '<$0.0001';
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	if (usd < 1) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "1.2k in · 340 out · $0.0004" (no cost part when it's unknown). */
export function usageLine(input: number, output: number, cost: number | null): string {
	const parts = [`${formatTokens(input)} in`, `${formatTokens(output)} out`];
	if (cost !== null) parts.push(formatUsd(cost));
	return parts.join(' · ');
}
