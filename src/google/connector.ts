// The Google connector: one Durable Object ("main") that holds the operator's Google sign-in. The refresh token is
// sealed with GOOGLE_TOKEN_KEY; access tokens live in memory only. Agents never see a token: their tools send the
// connector a request, which goes out only if allow.ts permits it and the agent's own tools cover that part of Google.
import { DurableObject } from "cloudflare:workers";
import { baseName } from "../fleet.ts";
import { storageSql } from "../sql.ts";
import { type ApiRequest, allow, familiesOf } from "./allow.ts";
import { secrets } from "../secrets.ts";
import { type Client, configured, consentUrl, exchange, type GoogleSecrets, missingScopes, open, refresh, revoke, seal } from "./oauth.ts";

const FILE_MAX_BYTES = 15 * 1024 * 1024; // a downloaded file the fleet reads (attachment.ts has the same limit)
export type GoogleResponse = { ok: boolean; status: number; data: unknown };
/** `missing`: permissions the fleet asks for that the sign-in did not grant (undefined while not known yet). */
export type GoogleStatus = { configured: boolean; connected: boolean; email?: string; since?: number; missing?: string[] };
import { type FileKind, type GrantedFile } from "./files.ts";
export { type FileKind, fileLink, type GrantedFile } from "./files.ts";

const FILE_URL: Record<FileKind, (id: string) => string> = {
	doc: (id) => `https://docs.googleapis.com/v1/documents/${id}?fields=title`,
	sheet: (id) => `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title`,
};

/** What the Google kits call, as RPC. `agent` is the calling agent's name, a job worker's included. */
export type GoogleApi = { request(agent: string, req: ApiRequest): Promise<GoogleResponse> };

const STATE_TTL_MS = 15 * 60_000;
export class Google extends DurableObject<Env> implements GoogleApi {
	private readonly sql;
	private access?: { token: string; until: number };

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = storageSql(ctx.storage);
		this.sql("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)");
		this.sql("CREATE TABLE IF NOT EXISTS states (state TEXT PRIMARY KEY, expires INTEGER)");
		this.sql("CREATE TABLE IF NOT EXISTS created (id TEXT PRIMARY KEY, at INTEGER)");
		// The operator's own files the fleet may edit, one by one (/docs allow); created files need no entry.
		this.sql("CREATE TABLE IF NOT EXISTS granted (id TEXT PRIMARY KEY, kind TEXT, title TEXT, at INTEGER)");
		this.sql("CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, at INTEGER)"); // drafts the fleet wrote, for the briefing
	}

	private editable(id: string): boolean {
		return this.sql<{ id: string }>("SELECT id FROM created WHERE id = ? UNION SELECT id FROM granted WHERE id = ?", id, id).length > 0;
	}

	/** `/docs allow`: lets the fleet edit one of the operator's documents or sheets. Checks it opens and returns its title. */
	async grant(id: string, kind?: FileKind): Promise<GrantedFile> {
		const token = await this.token();
		for (const k of kind ? [kind] : (["doc", "sheet"] as const)) {
			const res = await fetch(FILE_URL[k](id), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
			if (!res.ok) continue;
			const data = (await res.json()) as { title?: string; properties?: { title?: string } };
			const f = { id, kind: k, title: data.title ?? data.properties?.title ?? "Untitled", at: Date.now() };
			this.sql("INSERT OR REPLACE INTO granted VALUES (?, ?, ?, ?)", f.id, f.kind, f.title, f.at);
			return f;
		}
		throw new Error("That file did not open with the fleet's Google sign-in: check the link, and that it is a Google Doc or Sheet in this account.");
	}

	/** `/docs revoke`: the fleet goes back to only reading that file. False if it was not allowed. */
	async ungrant(id: string): Promise<boolean> {
		const had = this.sql<{ id: string }>("SELECT id FROM granted WHERE id = ?", id).length > 0;
		this.sql("DELETE FROM granted WHERE id = ?", id);
		return had;
	}

	async files(): Promise<{ granted: GrantedFile[]; created: number }> {
		return {
			granted: this.sql<GrantedFile>("SELECT id, kind, title, at FROM granted ORDER BY at DESC"),
			created: this.sql<{ n: number }>("SELECT COUNT(*) AS n FROM created")[0]?.n ?? 0,
		};
	}

	private get(key: string) {
		return this.sql<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)[0]?.value;
	}
	private set(key: string, value: string) {
		this.sql("INSERT OR REPLACE INTO kv VALUES (?, ?)", key, value);
	}
	private keys(): Promise<GoogleSecrets> {
		return secrets(this.env, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY"]);
	}
	private async client(redirect: string): Promise<Client> {
		const k = await this.keys();
		return { id: k.GOOGLE_CLIENT_ID, secret: k.GOOGLE_CLIENT_SECRET, redirect };
	}

	async status(): Promise<GoogleStatus> {
		const since = this.get("since");
		const connected = !!this.get("refresh");
		// Sign-ins from before scopes were recorded: one refresh tells which permissions the token carries.
		if (connected && !this.get("scopes")) await this.token(true).catch(() => undefined);
		const scopes = this.get("scopes");
		return { configured: configured(await this.keys()), connected, email: this.get("email"), since: since ? Number(since) : undefined, missing: connected && scopes ? missingScopes(scopes) : undefined };
	}

	/** A one-time sign-in link; its state expires in 15 minutes and works once. */
	async connectUrl(redirect: string): Promise<string> {
		if (!configured(await this.keys())) throw new Error("Google is not set up yet: the OAuth client id and secret are missing (scripts/google-secrets.sh).");
		const state = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
		this.sql("DELETE FROM states WHERE expires < ?", Date.now());
		this.sql("INSERT INTO states VALUES (?, ?)", state, Date.now() + STATE_TTL_MS);
		return consentUrl(await this.client(redirect), state);
	}

	/** The redirect from Google: checks the state, keeps the sealed refresh token, and returns the account's address. */
	async finish(code: string, state: string, redirect: string): Promise<string> {
		const ok = this.sql<{ state: string }>("SELECT state FROM states WHERE state = ? AND expires >= ?", state, Date.now()).length > 0;
		this.sql("DELETE FROM states WHERE state = ?", state);
		if (!ok) throw new Error("This sign-in link has expired or was already used. Ask for a new one with /google connect.");
		const tokens = await exchange(await this.client(redirect), code);
		if (!tokens.refresh_token) throw new Error("Google sent no refresh token. Remove the app's access in your Google account and connect again.");
		this.set("refresh", await seal((await this.keys()).GOOGLE_TOKEN_KEY, tokens.refresh_token));
		this.set("since", String(Date.now()));
		if (tokens.scope) this.set("scopes", tokens.scope);
		this.access = { token: tokens.access_token, until: Date.now() + (tokens.expires_in - 60) * 1000 };
		const profile = await this.request("director", { method: "GET", url: "https://gmail.googleapis.com/gmail/v1/users/me/profile" });
		const email = (profile.data as { emailAddress?: string }).emailAddress ?? "your account";
		this.set("email", email);
		return email;
	}

	/** How many drafts the fleet wrote are still in Gmail Drafts (not sent or deleted yet); forgets the rest. */
	async fleetDrafts(): Promise<number> {
		let n = 0;
		for (const { id } of this.sql<{ id: string }>("SELECT id FROM drafts ORDER BY at DESC LIMIT 30")) {
			const r = await this.request("director", { method: "GET", url: `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${id}?format=minimal` });
			if (r.ok) n++;
			else if (r.status === 404) this.sql("DELETE FROM drafts WHERE id = ?", id);
		}
		this.sql("DELETE FROM drafts WHERE at < ?", Date.now() - 60 * 86_400_000);
		return n;
	}

	/** Revokes the sign-in at Google and forgets it here. */
	async disconnect(): Promise<boolean> {
		const sealed = this.get("refresh");
		if (!sealed) return false;
		await revoke(await open((await this.keys()).GOOGLE_TOKEN_KEY, sealed));
		this.sql("DELETE FROM kv WHERE key IN ('refresh', 'email', 'since', 'scopes')");
		this.access = undefined;
		return true;
	}

	private async token(force = false): Promise<string> {
		if (!force && this.access && this.access.until > Date.now()) return this.access.token;
		const sealed = this.get("refresh");
		if (!sealed) throw new Error("Google is not connected. Send /google connect in General.");
		const tokens = await refresh(await this.client(""), await open((await this.keys()).GOOGLE_TOKEN_KEY, sealed));
		if (tokens.scope) this.set("scopes", tokens.scope);
		this.access = { token: tokens.access_token, until: Date.now() + (tokens.expires_in - 60) * 1000 };
		return this.access.token;
	}

	async request(agent: string, req: ApiRequest): Promise<GoogleResponse> {
		const a = allow(req);
		if (typeof a === "string") return { ok: false, status: 403, data: { error: a } };
		if (!familiesOf(agent).has(a.family)) return { ok: false, status: 403, data: { error: `${baseName(agent)} has no ${a.family} access.` } };
		if (a.mustBeEditable && !this.editable(a.mustBeEditable))
			return { ok: false, status: 403, data: { error: "The fleet edits only documents and sheets it created or the operator allowed (/docs allow <link> in General); this one it can only read." } };
		const call = async () =>
			fetch(a.url, {
				method: req.method,
				headers: { authorization: `Bearer ${await this.token()}`, ...(req.body === undefined ? {} : { "content-type": "application/json" }) },
				body: req.body === undefined ? undefined : JSON.stringify(req.body),
				signal: AbortSignal.timeout(30_000),
			});
		let res = await call();
		if (res.status === 401) {
			this.access = undefined; // revoked or expired early: one fresh token, then give up
			res = await call();
		}
		if (req.binary && res.ok) {
			if (Number(res.headers.get("content-length") ?? 0) > FILE_MAX_BYTES) {
				await res.body?.cancel();
				return { ok: false, status: 413, data: { error: `The file is over ${FILE_MAX_BYTES / 1024 / 1024} MB; the operator opens it.` } };
			}
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (bytes.length > FILE_MAX_BYTES) return { ok: false, status: 413, data: { error: `The file is over ${FILE_MAX_BYTES / 1024 / 1024} MB; the operator opens it.` } };
			return { ok: true, status: res.status, data: Buffer.from(bytes).toString("base64url") };
		}
		const text = await res.text();
		let data: unknown = text;
		try {
			data = text ? JSON.parse(text) : {};
		} catch {}
		if (res.ok && req.method === "POST" && /\/gmail\/v1\/users\/me\/drafts$/.test(a.url)) {
			const id = (data as { id?: string }).id;
			if (id) this.sql("INSERT OR IGNORE INTO drafts VALUES (?, ?)", id, Date.now());
		}
		if (res.ok && a.recordsCreated) {
			const id = (data as { documentId?: string; spreadsheetId?: string }).documentId ?? (data as { spreadsheetId?: string }).spreadsheetId;
			if (id) this.sql("INSERT OR IGNORE INTO created VALUES (?, ?)", id, Date.now());
		}
		return { ok: res.ok, status: res.status, data };
	}
}

export const google = (env: Env) => env.Google.get(env.Google.idFromName("main"));
