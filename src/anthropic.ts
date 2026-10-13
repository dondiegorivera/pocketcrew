// Anthropic provider for pi-ai. Its built-in catalog stops at Haiku 4.5, so the models we run are declared here.
// Key: ANTHROPIC_API_KEY (secrets.ts), from a Console workspace of the operator's.
import { createProvider, type Usage } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";

// USD per 1M tokens. cacheWrite is the 5-minute rate. Haiku's rates hold for prompts up to 100K tokens (5x above).
export const PRICES = {
	"claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
	"claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
	"claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
} as const;
export type ModelId = keyof typeof PRICES;
export const MODEL_IDS = Object.keys(PRICES) as ModelId[];
export const isModelId = (id: string): id is ModelId => Object.hasOwn(PRICES, id);
/** `/model lead sonnet` style short names. */
export const MODEL_ALIASES: Record<string, ModelId> = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };

export const SEARCH_USD = 0.01; // web search: $10 per 1,000 searches, on top of tokens

const NAMES: Record<ModelId, string> = {
	"claude-haiku-5-5": "Claude Haiku 5.5",
	"claude-sonnet-5-5": "Claude Sonnet 5.5",
	"claude-opus-5-5": "Claude Opus 5.5",
};
// The window pi compacts against, not the model's 1M: Haiku stays under the 100K price step, the larger models
// under 200K so a long chat with the Lead does not grow into a costly prompt.
const WINDOW: Record<ModelId, number> = { "claude-haiku-5-5": 100_000, "claude-sonnet-5-5": 200_000, "claude-opus-5-5": 200_000 };

/** `key` reads the API key at request time, so a rotated key needs no deploy. */
export const anthropicProvider = (key: () => Promise<string>) =>
	createProvider<"anthropic-messages">({
		id: "anthropic",
		name: "Anthropic",
		auth: {
			apiKey: {
				name: "Anthropic API key",
				resolve: async () => {
					const apiKey = await key();
					return apiKey ? { auth: { apiKey }, source: "ANTHROPIC_API_KEY" } : undefined;
				},
			},
		},
		models: MODEL_IDS.map((id) => ({
			id,
			name: NAMES[id],
			provider: "anthropic",
			api: "anthropic-messages" as const,
			baseUrl: "https://api.anthropic.com",
			reasoning: true,
			input: ["text", "image"] as ("text" | "image")[],
			cost: PRICES[id],
			contextWindow: WINDOW[id],
			maxTokens: 16_000, // a long report fits, and even Opus writes it within the request timeout in agent.ts
			// All three reject budget_tokens and take effort instead; without this pi-ai sends budgets for models it
			// does not know. Never configure thinkingLevel "off": Opus 5.5 rejects disabled thinking outright.
			compat: { forceAdaptiveThinking: true },
		})),
		api: { "anthropic-messages": anthropicMessagesApi() },
	});

/** Token counts priced at `model`'s rates, plus `searches` web searches, in pi's Usage shape. */
export function priced(
	model: ModelId,
	t: { input: number; output: number; cacheRead: number; cacheWrite: number },
	searches = 0,
): Usage {
	const p = PRICES[model];
	const cost = {
		input: (t.input * p.input) / 1e6 + searches * SEARCH_USD,
		output: (t.output * p.output) / 1e6,
		cacheRead: (t.cacheRead * p.cacheRead) / 1e6,
		cacheWrite: (t.cacheWrite * p.cacheWrite) / 1e6,
		total: 0,
	};
	cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;
	return { ...t, totalTokens: t.input + t.output + t.cacheRead + t.cacheWrite, cost };
}
