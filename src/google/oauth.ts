// Google sign-in for the fleet: the consent URL, the code exchange, token refresh and revocation, and the encryption
// that keeps the refresh token unreadable at rest. Only the Google connector object (connector.ts) uses these.

export const SCOPES = [
	"https://www.googleapis.com/auth/gmail.modify", // read, label, drafts; sending is blocked in connector.ts
	"https://www.googleapis.com/auth/gmail.settings.basic", // filters: only label and skip-inbox ones (allow.ts)
	"https://www.googleapis.com/auth/calendar.events",
	"https://www.googleapis.com/auth/drive.file",
	"https://www.googleapis.com/auth/drive.readonly", // find and read the operator's files (Clerk); never changes them
	"https://www.googleapis.com/auth/documents",
	"https://www.googleapis.com/auth/spreadsheets",
];

/** What each permission is for, in the operator's words: /google names the ones the sign-in lacks. */
export const SCOPE_NAMES: Record<string, string> = {
	"https://www.googleapis.com/auth/gmail.modify": "Gmail (read, label, archive, drafts)",
	"https://www.googleapis.com/auth/gmail.settings.basic": "Gmail filters",
	"https://www.googleapis.com/auth/calendar.events": "Calendar events",
	"https://www.googleapis.com/auth/drive.file": "Drive files the fleet creates",
	"https://www.googleapis.com/auth/drive.readonly": "Drive (find and read your files)",
	"https://www.googleapis.com/auth/documents": "Docs",
	"https://www.googleapis.com/auth/spreadsheets": "Sheets",
};

/** The fleet's permissions missing from a granted scope string (space-separated, as Google returns it). */
export const missingScopes = (granted: string) => {
	const have = new Set(granted.split(/\s+/));
	return SCOPES.filter((s) => !have.has(s));
};

export const CALLBACK_PATH = "/oauth/google/callback";

export type Client = { id: string; secret: string; redirect: string };
export type Tokens = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

/** The client and the sealing key, as read from the secrets (secrets.ts). */
export type GoogleSecrets = { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; GOOGLE_TOKEN_KEY: string };

export const configured = (s: GoogleSecrets) =>
	!!s.GOOGLE_CLIENT_ID && s.GOOGLE_CLIENT_ID !== "unset" && !!s.GOOGLE_CLIENT_SECRET && s.GOOGLE_CLIENT_SECRET !== "unset" && /^[0-9a-f]{64}$/.test(s.GOOGLE_TOKEN_KEY);

/** Offline access with a fresh consent, so Google hands out a refresh token every time. */
export function consentUrl(client: Client, state: string): string {
	const q = new URLSearchParams({
		client_id: client.id,
		redirect_uri: client.redirect,
		response_type: "code",
		scope: SCOPES.join(" "),
		access_type: "offline",
		prompt: "consent",
		include_granted_scopes: "true",
		state,
	});
	return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(body: Record<string, string>, f: typeof fetch): Promise<Tokens> {
	const res = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
	const json = (await res.json()) as Tokens & { error?: string; error_description?: string };
	if (!res.ok || json.error) throw new Error(`Google sign-in: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
	return json;
}

export const exchange = (client: Client, code: string, f: typeof fetch = fetch) =>
	token({ code, client_id: client.id, client_secret: client.secret, redirect_uri: client.redirect, grant_type: "authorization_code" }, f);

export const refresh = (client: Client, refreshToken: string, f: typeof fetch = fetch) =>
	token({ refresh_token: refreshToken, client_id: client.id, client_secret: client.secret, grant_type: "refresh_token" }, f);

export async function revoke(refreshToken: string, f: typeof fetch = fetch) {
	await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => undefined);
}

// ---- Encryption at rest: AES-GCM with a 256-bit key held as the GOOGLE_TOKEN_KEY secret (hex) ----

const key = (hex: string) =>
	crypto.subtle.importKey("raw", Uint8Array.from(hex.match(/../g)!.map((b) => Number.parseInt(b, 16))), "AES-GCM", false, ["encrypt", "decrypt"]);

export async function seal(hexKey: string, plain: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(hexKey), new TextEncoder().encode(plain)));
	return Buffer.concat([iv, ct]).toString("base64");
}

export async function open(hexKey: string, sealed: string): Promise<string> {
	const raw = Buffer.from(sealed, "base64");
	const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, await key(hexKey), raw.subarray(12));
	return new TextDecoder().decode(plain);
}
