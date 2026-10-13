// Installing a skill from a URL: a SKILL.md, or a GitHub folder holding one plus reference files. The Director fetches
// it, so the Lead never reads it, and scopes it to the specialists: outside text never steers the Lead.
import { MAX_FILE_CHARS, parseSkill, type Skill } from "./skill-format.ts";

const MAX_FILES = 10;

type Fetch = typeof fetch;
type Listing = { type: string; name: string; download_url: string | null }[];

/** github.com/<o>/<r>/blob/<ref>/<path> → raw.githubusercontent.com/<o>/<r>/<ref>/<path>; anything else unchanged. */
export const rawUrl = (url: URL) => {
	const m = url.hostname === "github.com" ? /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname) : null;
	return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url.href;
};

/** github.com/<o>/<r>/tree/<ref>/<path> → the contents API URL for that folder, or undefined. */
export const folderApi = (url: URL) => {
	const m = url.hostname === "github.com" ? /^\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/.exec(url.pathname) : null;
	return m ? `https://api.github.com/repos/${m[1]}/${m[2]}/contents/${m[4]}?ref=${m[3]}` : undefined;
};

async function text(f: Fetch, url: string): Promise<string> {
	const res = await f(url, { headers: { "user-agent": "pocketcrew", accept: "text/plain, application/json" }, signal: AbortSignal.timeout(20_000) });
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	const body = await res.text();
	if (body.length > MAX_FILE_CHARS) throw new Error(`${url} is over ${MAX_FILE_CHARS} characters`);
	return body;
}

/** The skill at `url` with its reference files, or a message saying why not. Nothing is stored here. */
export async function fetchSkill(url: string, f: Fetch = fetch): Promise<Omit<Skill, "source" | "agents"> | string> {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return `"${url}" is not a URL.`;
	}
	if (u.protocol !== "https:") return "Only https URLs.";
	try {
		const api = folderApi(u);
		let skillMd: string;
		const files: Record<string, string> = {};
		if (api) {
			const listing = JSON.parse(await text(f, api)) as Listing;
			const md = listing.find((e) => e.type === "file" && e.name === "SKILL.md");
			if (!md?.download_url) return "That folder has no SKILL.md.";
			skillMd = await text(f, md.download_url);
			for (const e of listing.filter((e) => e.type === "file" && e.name !== "SKILL.md" && /\.(md|txt)$/.test(e.name)).slice(0, MAX_FILES)) {
				if (e.download_url) files[e.name] = await text(f, e.download_url);
			}
		} else skillMd = await text(f, rawUrl(u));
		const parsed = parseSkill(skillMd);
		if (typeof parsed === "string") return parsed;
		return { name: parsed.name, description: parsed.description, body: parsed.body, files };
	} catch (err) {
		return `Could not fetch the skill: ${err instanceof Error ? err.message : String(err)}`;
	}
}
