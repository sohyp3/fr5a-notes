import type { HttpRequest, HttpResponse } from '../../../../shared/types';

/** One OpenAI-compatible endpoint: DeepSeek, OpenRouter, opencode, llama.cpp, Ollama /v1… */
export interface ProviderProfile {
	id: string;
	name: string;
	/** e.g. https://api.deepseek.com/v1 or http://10.8.0.1:11434/v1 */
	baseUrl: string;
	model: string;
	/** Runs on hardware you control (localhost / VPN). Only these may see local-only notes. */
	local: boolean;
	/** Model supports OpenAI tool calling; off = plain chat, no tools. */
	tools: boolean;
	/** Context window budget in tokens (approx.); history is trimmed to fit. */
	contextTokens: number;
}

export type SearchKind = 'searxng' | 'brave' | 'tavily';

export interface SearchProfile {
	kind: SearchKind;
	/** SearXNG instance URL (ignored for Brave / Tavily). */
	baseUrl: string;
}

/** Persisted under the `ai` state key. API keys live in secrets, never here. */
export interface AiConfig {
	providers: ProviderProfile[];
	defaultProvider: string | null;
	search: SearchProfile | null;
	/** Workspace-relative folders whose notes only go to `local` providers. */
	localOnlyFolders: string[];
	/** Max model round-trips per run (tool calls each cost one). */
	maxSteps: number;
}

/**
 * Default provider: OpenCode Zen's free `big-pickle` model. Zen still needs a
 * (free) API key from https://opencode.ai/zen — paste it in Settings → AI.
 */
export const OPENCODE_ZEN: ProviderProfile = {
	id: 'opencode-zen',
	name: 'OpenCode Zen',
	baseUrl: 'https://opencode.ai/zen/v1',
	model: 'big-pickle',
	local: false,
	tools: true,
	contextTokens: 128_000
};

export const ZEN_KEY_URL = 'https://opencode.ai/zen';

export const DEFAULT_AI_CONFIG: AiConfig = {
	providers: [OPENCODE_ZEN],
	defaultProvider: OPENCODE_ZEN.id,
	search: null,
	localOnlyFolders: [],
	maxSteps: 8
};

/** Secret names for API keys. */
export const providerKeyName = (id: string) => `provider:${id}`;
export const SEARCH_KEY_NAME = 'search';

export interface ToolCall {
	id: string;
	name: string;
	/** Raw JSON arguments as the model sent them. */
	arguments: string;
}

export type ChatMessage =
	| { role: 'system' | 'user'; content: string }
	| { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
	| { role: 'tool'; tool_call_id: string; content: string };

/** JSON-schema tool definition, as sent to the model. */
export interface ToolDef {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

/** The slice of PlatformApi the harness needs for the network. */
export interface Http {
	httpFetch(req: HttpRequest): Promise<HttpResponse>;
	httpStream?(id: string, req: HttpRequest, onChunk: (text: string) => void): Promise<HttpResponse>;
	httpAbort?(id: string): Promise<void>;
}
