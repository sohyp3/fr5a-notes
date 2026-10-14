import type { HttpRequest, HttpResponse } from '../../../../shared/types';
import type { Price } from './usage';

/** One OpenAI-compatible endpoint: DeepSeek, OpenRouter, opencode, llama.cpp, Ollama /v1… */
export interface ProviderProfile {
	id: string;
	name: string;
	/** e.g. https://api.deepseek.com/v1 or http://10.8.0.1:11434/v1 */
	baseUrl: string;
	model: string;
	/** Runs on hardware you control (localhost / VPN). Only these may read notes hidden from cloud AI. */
	local: boolean;
	/** Model supports OpenAI tool calling; off = plain chat, no tools. */
	tools: boolean;
	/** Context window budget in tokens (approx.); history is trimmed to fit. */
	contextTokens: number;
	/** USD per 1M tokens, for the cost of chats (used when the provider doesn't report one). */
	price?: Price;
}

export type SearchKind = 'duckduckgo' | 'searxng' | 'brave' | 'tavily' | 'exa';

export const EXA_SEARCH_TYPES = [
	'instant',
	'fast',
	'auto',
	'deep-lite',
	'deep',
	'deep-reasoning'
] as const;
export type ExaSearchType = (typeof EXA_SEARCH_TYPES)[number];

export const EXA_CATEGORIES = [
	'',
	'company',
	'publication',
	'news',
	'personal site',
	'financial report',
	'people'
] as const;
export type ExaCategory = (typeof EXA_CATEGORIES)[number];
export type ExaContent = 'highlights' | 'text' | 'summary';

export interface ExaSearchOptions {
	type: ExaSearchType;
	/** Known category or another Exa category hint. */
	category: string;
	numResults: number;
	content: ExaContent;
	/** Per-result character budget for highlights / text. */
	maxCharacters: number;
	includeDomains: string[];
	excludeDomains: string[];
	/** YYYY-MM-DD in settings; converted to ISO instants for Exa. */
	startPublishedDate: string;
	endPublishedDate: string;
	/** Blank country disables localization; otherwise an ISO 3166-1 alpha-2 code. */
	userLocation: string;
	moderation: boolean;
	/** null = Exa default, -1 = cache only, 0 = fresh, otherwise max cache age. */
	maxAgeHours: number | null;
}

export const DEFAULT_EXA_SEARCH: ExaSearchOptions = {
	type: 'auto',
	category: '',
	numResults: 6,
	content: 'highlights',
	maxCharacters: 600,
	includeDomains: [],
	excludeDomains: [],
	startPublishedDate: '',
	endPublishedDate: '',
	userLocation: '',
	moderation: false,
	maxAgeHours: null
};

export interface SearchProfile {
	kind: SearchKind;
	/** SearXNG instance URL (ignored by the others). */
	baseUrl: string;
	/** Exa-only search and result-content controls. */
	exa?: Partial<ExaSearchOptions>;
}

/** Web search choices, in the order Settings lists them. */
export const SEARCH_KINDS: { kind: SearchKind; label: string; hint: string; needsKey: boolean }[] =
	[
		{ kind: 'duckduckgo', label: 'DuckDuckGo', hint: 'No key needed', needsKey: false },
		{ kind: 'searxng', label: 'SearXNG', hint: 'Your own instance', needsKey: false },
		{ kind: 'brave', label: 'Brave Search', hint: 'API key', needsKey: true },
		{ kind: 'tavily', label: 'Tavily', hint: 'API key', needsKey: true },
		{ kind: 'exa', label: 'Exa', hint: 'API key', needsKey: true }
	];

/** A model starred in Settings → AI: offered in the AI pane's model picker. */
export interface FavoriteModel {
	provider: string;
	model: string;
}

/**
 * APIs other than chat completions. OpenCode serves its GPT, Claude and
 * Gemini models over these only, so they can't be picked here.
 */
export type OtherApi = 'responses' | 'messages' | 'gemini';

export const OTHER_API_NAMES: Record<OtherApi, string> = {
	responses: 'the OpenAI Responses API',
	messages: 'the Anthropic Messages API',
	gemini: 'the Gemini API'
};

/** What a provider's model list (or models.dev) says about one model. */
export interface ModelInfo {
	id: string;
	/** Display name, when it isn't just the id. */
	name?: string;
	/** Context window in tokens. */
	context?: number;
	/** Tool calling: false = known not to support it. */
	tools?: boolean;
	/** Only served over another API: not usable with this client. */
	api?: OtherApi;
	/** USD per 1M tokens, from the provider's own list (OpenRouter) or models.dev. */
	price?: Price;
}

/** Persisted under the `ai` state key (so per device). API keys live in secrets, never here. */
export interface AiConfig {
	providers: ProviderProfile[];
	defaultProvider: string | null;
	search: SearchProfile | null;
	/** Workspace-relative folders whose notes only go to `local` providers. */
	localOnlyFolders: string[];
	/** Workspace folder "Save to notes" puts chats in ('' = top level). */
	chatsFolder: string;
	/** Max model round-trips per run (tool calls each cost one). */
	maxSteps: number;
	/** Starred models, in the order they were starred. */
	favorites: FavoriteModel[];
}

/**
 * Default provider: OpenCode's pay-as-you-go models (the OpenCode Console,
 * formerly Zen). Needs an API key from https://opencode.ai/console — its free
 * models only answer inside the OpenCode app itself.
 */
export const OPENCODE: ProviderProfile = {
	id: 'opencode-zen',
	name: 'OpenCode',
	baseUrl: 'https://opencode.ai/inference/v1',
	model: 'big-pickle',
	local: false,
	tools: true,
	contextTokens: 128_000
};

export const OPENCODE_KEY_URL = 'https://opencode.ai/console';

/** OpenCode's subscription plan: same console key, its own endpoint. */
export const OPENCODE_GO_URL = 'https://opencode.ai/inference/go/v1';

/**
 * OpenCode's endpoints before its v2 console (`/zen/v1`, `/zen/go/v1`) →
 * the current ones (`/inference/v1`, `/inference/go/v1`). Others as they are.
 */
export function currentBaseUrl(url: string): string {
	return url.replace(/^(\s*https?:\/\/(?:www\.)?opencode\.ai)\/zen(?=\/)/i, '$1/inference');
}

/** OpenCode's endpoints (Console and Go). */
export const isOpencode = (baseUrl: string) =>
	/^\s*https?:\/\/(?:www\.)?opencode\.ai\//i.test(baseUrl);

export const isOpenRouter = (baseUrl: string) => /^\s*https?:\/\/openrouter\.ai\//i.test(baseUrl);

export const OPENROUTER: ProviderProfile = {
	id: 'openrouter',
	name: 'OpenRouter',
	baseUrl: 'https://openrouter.ai/api/v1',
	model: 'openrouter/auto',
	local: false,
	tools: true,
	contextTokens: 128_000
};

export const OPENAI: ProviderProfile = {
	id: 'openai',
	name: 'OpenAI',
	baseUrl: 'https://api.openai.com/v1',
	model: 'gpt-4o-mini',
	local: false,
	tools: true,
	contextTokens: 128_000
};

export const DEEPSEEK: ProviderProfile = {
	id: 'deepseek',
	name: 'DeepSeek',
	baseUrl: 'https://api.deepseek.com/v1',
	model: 'deepseek-chat',
	local: false,
	tools: true,
	contextTokens: 64_000
};

/** Always listed in Settings → AI (just add a key); custom ones come after. */
export const BUILTIN_PROVIDERS = [OPENCODE, OPENROUTER, OPENAI, DEEPSEEK];
export const isBuiltinProvider = (id: string) => BUILTIN_PROVIDERS.some((p) => p.id === id);

/** Where to get a key, per built-in provider. */
export const KEY_URLS: Record<string, string> = {
	[OPENCODE.id]: OPENCODE_KEY_URL,
	[OPENROUTER.id]: 'https://openrouter.ai/settings/keys',
	[OPENAI.id]: 'https://platform.openai.com/api-keys',
	[DEEPSEEK.id]: 'https://platform.deepseek.com/api_keys'
};

export const DEFAULT_AI_CONFIG: AiConfig = {
	providers: [...BUILTIN_PROVIDERS],
	defaultProvider: OPENCODE.id,
	search: null,
	localOnlyFolders: [],
	chatsFolder: 'AI chats',
	maxSteps: 8,
	favorites: []
};

/** Secret names for API keys. */
export const providerKeyName = (id: string) => `provider:${id}`;
/** One key per search provider, so switching between them never sends another's key. */
export const searchKeyName = (kind: SearchKind) => `search:${kind}`;
/** The single (Brave or Tavily) search key older versions kept (read as a fallback). */
export const LEGACY_SEARCH_KEY_NAME = 'search';

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
