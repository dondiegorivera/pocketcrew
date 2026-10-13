// Secrets, wherever they are kept. Each name in cloudflare.config.ts is either a Worker secret (the Worker sees a
// string) or, once STORE_ID is set there, a binding to Cloudflare's account-level Secrets Store (an object whose
// get() reads it). Code asks here and never cares which. Store reads are cached briefly per isolate, so a rotated
// secret takes effect within minutes without a deploy.
import { CONFIG } from "./config.ts";

/**
 * The account's Secrets Store (pocketcrew.config.ts secretsStore), once created in the dashboard. Empty: every secret is a
 * Worker secret. Its secrets are named with STORE_PREFIX, since the store is shared by everything on the account.
 */
export const STORE_ID = CONFIG.secretsStore;
/** The instance's name in capitals, such as POCKETCREW_. */
export const STORE_PREFIX = `${CONFIG.name.toUpperCase().replace(/-/g, "_")}_`;

export const SECRET_NAMES = [
	"ANTHROPIC_API_KEY",
	"TELEGRAM_BOT_TOKEN",
	"TELEGRAM_WEBHOOK_SECRET",
	"TELEGRAM_CHAT_ID",
	"TELEGRAM_USER_ID",
	"LIBRARY_EXPORT_TOKEN",
	"GOOGLE_CLIENT_ID",
	"GOOGLE_CLIENT_SECRET",
	"GOOGLE_TOKEN_KEY",
	"GITHUB_TOKEN",
	"CF_ANALYTICS_TOKEN",
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

/** Secrets that may stay unset: their feature then says it is not set up. The rest must exist for a deploy. */
export const OPTIONAL_SECRETS: readonly SecretName[] = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_TOKEN", "CF_ANALYTICS_TOKEN"];

/** Whether a secret holds a real value, not the "unset" placeholder or nothing. */
export const isSet = (value: string) => value !== "" && value !== "unset";

type Source = string | { get(): Promise<string> } | undefined;

const TTL_MS = 5 * 60_000;
const cache = new Map<SecretName, { value: string; until: number }>();

/** The secret's value, or "" when it is not set. `fresh` skips the cache, for a check right after a rotation. */
export async function secret(env: Partial<Record<SecretName, Source>> | Env, name: SecretName, opts: { fresh?: boolean; now?: number } = {}): Promise<string> {
	const now = opts.now ?? Date.now();
	const source = (env as Record<string, Source>)[name];
	if (typeof source === "string" || source === undefined) return source ?? "";
	const hit = cache.get(name);
	if (hit && hit.until > now && !opts.fresh) return hit.value;
	const value = await source.get().catch(() => "");
	cache.set(name, { value, until: now + TTL_MS });
	return value;
}

/** Several at once, read in parallel. */
export async function secrets<const N extends readonly SecretName[]>(env: Env, names: N): Promise<{ [K in N[number]]: string }> {
	const values = await Promise.all(names.map((n) => secret(env, n)));
	return Object.fromEntries(names.map((n, i) => [n, values[i]])) as { [K in N[number]]: string };
}

/** Tests only: forget cached store reads. */
export const clearSecretCache = () => cache.clear();
