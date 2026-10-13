// Published pages: self-contained HTML reports (inline CSS and SVG) that the operator reads on the phone. Agents
// publish them with publish_page; they are kept in the Library object's SQLite next to the reports, served by the
// separate `reports` Worker (site.ts) behind Cloudflare Access, and archived to git by scripts/sync.mjs.
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { slug } from "./jobs.ts";
import type { Sql } from "./sql.ts";

/** `private`: published by an agent that holds the operator's private data (mail, calendar, docs, repos, traffic). */
export type Page = { path: string; topic: string; title: string; html: string; created: number; updated: number; private: boolean };
export type PageInfo = Omit<Page, "html">;

/** What the publishing tool and the site call on the library, as RPC. */
export type PageInput = { path: string; topic: string; title: string; html: string; private: boolean };

export type PagesApi = {
	putPage(page: PageInput): Promise<void>;
	/** Private pages only when `withPrivate`: agents that use the web never get them. */
	getPage(path: string, withPrivate: boolean): Promise<Page | undefined>;
	listPages(withPrivate: boolean): Promise<PageInfo[]>;
};

const READ_PAGE_CHARS = 120_000;

export const MAX_PAGE_CHARS = 1_000_000;

const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/**
 * `<topic>/<YYYY-MM-DD>-<title>.html`: one page per topic, day and title; publishing again the same day replaces it.
 * The path carries the date already, so a date inside the title is left out of the name.
 */
export const pagePath = (topic: string, title: string, now = Date.now()) =>
	`${slug(topic, 40) || "misc"}/${new Date(now).toISOString().slice(0, 10)}-${slug(title.replace(DATE, " "), 60) || "report"}.html`;

/** The title the index shows: the one given, unless it is only a date; then the page's own <title>. */
export function pageTitle(title: string, html: string): string {
	const given = title.trim();
	if (/\p{L}/u.test(given.replace(DATE, ""))) return given.slice(0, 160);
	const own = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
	return (own || given || "Report").slice(0, 160);
}

/**
 * Served with every page. No scripts and nothing loaded from elsewhere: a page cannot run code on the signed-in site
 * or call out with what it shows, and "self-contained" is enforced rather than hoped for.
 */
export const PAGE_HEADERS: Record<string, string> = {
	"content-type": "text/html; charset=utf-8",
	"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"x-robots-tag": "noindex, nofollow",
	"referrer-policy": "no-referrer",
	"x-content-type-options": "nosniff",
	"cache-control": "private, no-store",
};

export class PagesStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
		sql("CREATE TABLE IF NOT EXISTS pages (path TEXT PRIMARY KEY, topic TEXT, title TEXT, html TEXT, created INTEGER, updated INTEGER)");
		sql("CREATE INDEX IF NOT EXISTS pages_updated ON pages (updated)");
		if (!sql<{ name: string }>("SELECT name FROM pragma_table_info('pages') WHERE name = 'private'").length) sql("ALTER TABLE pages ADD COLUMN private INTEGER NOT NULL DEFAULT 0");
		if (!sql<{ name: string }>("SELECT name FROM pragma_table_info('pages') WHERE name = 'views'").length) {
			sql("ALTER TABLE pages ADD COLUMN views INTEGER NOT NULL DEFAULT 0");
			sql("ALTER TABLE pages ADD COLUMN last_view INTEGER");
		}
	}

	/** The operator opened a page on the reports site: counted, so routines nobody reads can be found (digest.ts). */
	viewed(path: string, now = Date.now()) {
		this.sql("UPDATE pages SET views = views + 1, last_view = ? WHERE path = ?", now, path);
	}
	/** Which of these pages were opened at least once. */
	opened(paths: readonly string[]): string[] {
		if (!paths.length) return [];
		return this.sql<{ path: string }>(`SELECT path FROM pages WHERE views > 0 AND path IN (${paths.map(() => "?").join(", ")})`, ...paths).map((r) => r.path);
	}

	/** A page once private stays private, whoever republishes it. */
	put(p: PageInput, now = Date.now()) {
		this.sql(
			"INSERT INTO pages (path, topic, title, html, created, updated, private) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET title = excluded.title, html = excluded.html, updated = excluded.updated, private = MAX(private, excluded.private)",
			p.path, p.topic, p.title, p.html, now, now, p.private ? 1 : 0,
		);
	}

	private rows<T>(query: string, ...params: (string | number)[]): T[] {
		return this.sql<T & { private: number }>(query, ...params).map((r) => ({ ...r, private: r.private === 1 }));
	}

	get(path: string, withPrivate = true): Page | undefined {
		return this.rows<Page>(`SELECT * FROM pages WHERE path = ?${withPrivate ? "" : " AND private = 0"}`, path)[0];
	}

	list(withPrivate = true, limit = 300): PageInfo[] {
		return this.rows<PageInfo>(`SELECT path, topic, title, created, updated, private FROM pages${withPrivate ? "" : " WHERE private = 0"} ORDER BY created DESC LIMIT ?`, limit);
	}

	/**
	 * Pages changed after `ms`, oldest change first: the export the git sync pulls. Public pages go to the research
	 * archive (mirrored to GitHub), private ones only to the server-only private archive.
	 */
	since(ms: number, which: "public" | "private" = "public", limit = 20): Page[] {
		return this.rows<Page>("SELECT * FROM pages WHERE updated > ? AND private = ? ORDER BY updated LIMIT ?", ms, which === "private" ? 1 : 0, limit);
	}
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The site's front page: every topic, newest first, newest pages first within it. */
export function renderIndex(pages: readonly PageInfo[]): string {
	const topics = new Map<string, PageInfo[]>();
	for (const p of [...pages].sort((a, b) => b.created - a.created)) topics.set(p.topic, [...(topics.get(p.topic) ?? []), p]);
	const sections = [...topics]
		.map(
			([topic, list]) =>
				`<section><h2>${esc(topic)}</h2><ul>${list
					.map((p) => `<li><a href="/${esc(p.path)}">${esc(p.title)}</a><time>${new Date(p.created).toISOString().slice(0, 10)}</time></li>`)
					.join("")}</ul></section>`,
		)
		.join("");
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Reports</title><style>
:root{--bg:#f7f6f2;--fg:#1d1d1b;--muted:#6b6a65;--line:#e2e0d8;--link:#1f5fbf}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#9a988f;--line:#2c2b28;--link:#8ab4f8}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px}h1{font-size:1.6rem;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 24px}
h2{font-size:.85rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:28px 0 8px}
ul{list-style:none;margin:0;padding:0}li{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
a{color:var(--link);text-decoration:none;font-weight:500}time{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
</style></head><body><main><h1>Reports</h1><p class="sub">${pages.length} published by the fleet</p>${sections || "<p>Nothing published yet.</p>"}</main></body></html>`;
}

const reply = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

/**
 * What publish_page reports about the stored page, so every agent can check its work without reading the page back:
 * facts and counts only, never the page's text, so it carries no one else's words (read_page is untrusted; this is not).
 */
export function pageCheck(html: string): string {
	const ok: string[] = [];
	const warn: string[] = [];
	const has = (re: RegExp, label: string, missing: string) => (re.test(html) ? ok.push(label) : warn.push(missing));
	has(/^\s*<!doctype html/i, "doctype", "no <!doctype html> at the start");
	has(/<meta[^>]+charset/i, "charset", "no <meta charset>");
	has(/<meta[^>]+name=["']?viewport/i, "viewport", "no viewport meta: the phone will show it zoomed out");
	has(/<title[^>]*>[^<]*\S[^<]*<\/title>/i, "title", "no <title>");
	has(/prefers-color-scheme\s*:\s*dark/i, "dark mode", "no dark-mode styles (prefers-color-scheme: dark)");
	const scripts = count(html, /<script\b/gi);
	// Not a warning: the html-report skill allows an optional theme-memory script, and the page works without it.
	const notes = scripts ? [`ℹ ${scripts} <script> tag${scripts > 1 ? "s" : ""}: the site does not run scripts; fine if the page works without ${scripts > 1 ? "them" : "it"}`] : [];
	const handlers = count(html, /\son[a-z]+\s*=/gi);
	if (handlers) warn.push(`${handlers} inline event handler${handlers > 1 ? "s" : ""} (onclick= and the like): blocked`);
	const outside = count(html, /<(?:img|iframe|video|audio|source|embed)\b[^>]*\ssrc=["']?(?!data:)[a-z]+:/gi) + count(html, /<link\b[^>]*rel=["']?stylesheet/gi) + count(html, /@import|url\(\s*["']?https?:/gi);
	if (outside) warn.push(`${outside} image, font or stylesheet loaded from elsewhere: blocked, draw it inline`);
	const svgOpen = count(html, /<svg\b/gi);
	const svgClose = count(html, /<\/svg>/gi);
	if (svgOpen !== svgClose) warn.push(`${svgOpen} <svg> opened but ${svgClose} closed: a chart is cut off`);
	const wide = [...html.matchAll(/(?<![\w-])(?:min-)?width\s*[:=]\s*["']?(\d{3,})px/gi)].map((m) => Number(m[1])).filter((w) => w > 430);
	if (wide.length) warn.push(`fixed widths over a phone's 430px (${[...new Set(wide)].slice(0, 4).join(", ")}px): use max-width or a viewBox`);
	if (/<\/body>[\s\S]*\S[\s\S]*<\/html>/i.test(html.replace(/<!--[\s\S]*?-->/g, ""))) warn.push("content after </body>");
	const words = html.replace(/<(style|script|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
	const facts = `${Math.round(html.length / 1024)} KB, ${count(html, /<h1\b/gi)} h1, ${count(html, /<h2\b/gi)} h2, ${svgOpen} svg, ${count(html, /<a\s[^>]*href=/gi)} links, about ${words} words`;
	return [`Checked the stored page: ${facts}.`, `✓ ${ok.join(", ") || "nothing"}`, ...warn.map((w) => `⚠ ${w}`), ...notes].join("\n");
}

/**
 * `published` hears every page URL, so the job's result carries the links even when the answer forgets them.
 * `privateAgent`: this agent's pages are private; `readsPrivate`: read_page may open private pages (never for an
 * agent that uses the web).
 */
export const pagesKit = (
	library: () => Promise<PagesApi>,
	siteUrl: string,
	published: (url: string) => void = () => {},
	access: { privateAgent: boolean; readsPrivate: boolean } = { privateAgent: false, readsPrivate: false },
): Extension =>
	defineExtension({
		name: "pages",
		tools: [
			defineTool({
				name: "publish_page",
				description:
					"Publish a report as a web page the operator opens on the phone, and get its link. Use it when the brief asks for an HTML, " +
					"visual or diagram report. The page must be one complete HTML document that works at phone width: inline <style>, " +
					"diagrams and charts as inline <svg>, a readable light and dark scheme. Scripts and anything loaded from elsewhere " +
					"(fonts, images, CSS) are blocked, so draw everything inline. Publishing the same topic and title on the same day replaces the page. " +
					"The answer includes a check of the stored page (structure, phone width, dark mode, blocked parts), so you need not read it back.",
				parameters: Type.Object({
					topic: Type.String({ description: "Folder on the site, such as github-trending or ai-agents" }),
					title: Type.String({ description: "Page title, as listed on the site's index" }),
					html: Type.String({ description: "The complete HTML document, starting with <!doctype html>" }),
				}),
				replay: "safe",
				execute: async ({ topic, title, html }) => {
					if (!/^\s*(<!doctype html|<html)/i.test(html)) return reply("Not published: send a complete HTML document that starts with <!doctype html>.", true);
					if (html.length > MAX_PAGE_CHARS) return reply(`Not published: the page is over ${MAX_PAGE_CHARS} characters.`, true);
					const shown = pageTitle(title, html);
					const path = pagePath(topic, shown);
					const lib = await library();
					await lib.putPage({ path, topic: slug(topic, 40) || "misc", title: shown, html, private: access.privateAgent });
					// Read back what the site will serve, so the check is of the stored page, not of what was sent.
					const stored = await lib.getPage(path, true);
					if (!stored) return reply("Not published: the page was not stored. Try again.", true);
					published(`${siteUrl}/${path}`);
					return reply(
						`Published: ${siteUrl}/${path}\nAll pages: ${siteUrl}/\n\n${pageCheck(stored.html)}\n\n` +
							"Fix any ⚠ and publish again with the same topic and title; it replaces the page. Put the link in your answer.",
					);
				},
			}),
			defineTool({
				name: "read_page",
				description:
					"Read the HTML of a page published on the operator's site, by its link or path, to review or rework it. The site's links " +
					"need the operator's login, so web_fetch cannot open them; this can. Without a page, lists the newest pages.",
				parameters: Type.Object({ page: Type.Optional(Type.String({ description: "The page's link, or its path such as github-trending/2026-10-11-briefing.html" })) }),
				replay: "safe",
				execute: async ({ page }) => {
					const lib = await library();
					const path = page?.trim().replace(siteUrl, "").replace(/^\/+/, "").split(/[?#]/)[0];
					const newest = async () => (await lib.listPages(access.readsPrivate)).slice(0, 15).map((p) => `${p.path} · ${p.title}`).join("\n") || "Nothing published yet.";
					if (!path) return reply(await newest());
					const found = await lib.getPage(decodeURIComponent(path), access.readsPrivate);
					if (!found) return reply(`No page "${path}". Newest pages:\n${await newest()}`, true);
					const cut = found.html.length > READ_PAGE_CHARS ? `\n\n[cut at ${READ_PAGE_CHARS} characters]` : "";
					return reply(`${found.title} · ${siteUrl}/${found.path}\n\n${found.html.slice(0, READ_PAGE_CHARS)}${cut}`);
				},
			}),
		],
	});
