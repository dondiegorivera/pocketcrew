import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_HEADERS, pagePath, PagesStore, pageTitle, renderIndex } from "./pages.ts";
import { memorySql } from "./test-sql.ts";

test("pagePath files a page by topic and day, so a same-day republish replaces it", () => {
	const day = Date.UTC(2026, 9, 11, 6);
	assert.equal(pagePath("GitHub Trending", "Top repos: agents & tools!", day), "github-trending/2026-10-11-top-repos-agents-tools.html");
	assert.equal(pagePath("???", "", day), "misc/2026-10-11-report.html");
	assert.equal(pagePath("github-trending", "Briefing 2026-10-11", day), "github-trending/2026-10-11-briefing.html", "no date twice");
	assert.equal(pagePath("github-trending", "2026-10-11", day), "github-trending/2026-10-11-report.html");
});

test("pageTitle falls back to the page's own <title> when the given one is only a date", () => {
	const html = "<!doctype html><html><head><title>GitHub Trending Briefing 2026-10-11</title></head></html>";
	assert.equal(pageTitle("2026-10-11", html), "GitHub Trending Briefing 2026-10-11");
	assert.equal(pageTitle("  Morning AI news ", html), "Morning AI news");
	assert.equal(pageTitle("", "<!doctype html>"), "Report");
});

test("PagesStore replaces by path, lists newest first, and exports changes in order", () => {
	const pages = new PagesStore(memorySql());
	pages.put({ path: "a/1.html", topic: "a", title: "One", html: "<p>1</p>", private: false }, 1000);
	pages.put({ path: "b/2.html", topic: "b", title: "Two", html: "<p>2</p>", private: false }, 2000);
	pages.put({ path: "a/1.html", topic: "a", title: "One again", html: "<p>1b</p>", private: false }, 3000);
	assert.equal(pages.get("a/1.html")!.html, "<p>1b</p>");
	assert.equal(pages.get("a/1.html")!.created, 1000, "a replacement keeps its creation time");
	assert.deepEqual(pages.list().map((p) => p.path), ["b/2.html", "a/1.html"]);
	assert.deepEqual(pages.since(1500).map((p) => p.path), ["b/2.html", "a/1.html"]);
	assert.deepEqual(pages.since(2500).map((p) => p.path), ["a/1.html"]);
});

test("renderIndex groups by topic and escapes titles", () => {
	const html = renderIndex([
		{ path: "a/x.html", topic: "a", title: "<b>X</b>", created: 2000, updated: 2000, private: false },
		{ path: "b/y.html", topic: "b", title: "Y", created: 1000, updated: 1000, private: false },
	]);
	assert.ok(html.indexOf("<h2>a</h2>") < html.indexOf("<h2>b</h2>"));
	assert.match(html, /&#60;b&#62;X&#60;\/b&#62;/);
	assert.match(html, /noindex/);
});

test("pages may not run scripts or load anything from elsewhere", () => {
	const csp = PAGE_HEADERS["content-security-policy"]!;
	assert.match(csp, /default-src 'none'/);
	assert.ok(!/script-src|https?:/.test(csp));
	assert.equal(PAGE_HEADERS["x-robots-tag"], "noindex, nofollow");
});

test("read_page takes a link or a path and reads through the library, not the login-protected site", async () => {
	const { pagesKit } = await import("./pages.ts");
	const page = { path: "t/2026-10-11-x.html", topic: "t", title: "X", html: "<!doctype html><p>hi</p>", created: 1, updated: 1, private: false };
	const lib = { putPage: async () => {}, getPage: async (p: string) => (p === page.path ? page : undefined), listPages: async () => [page] };
	const tool = pagesKit(async () => lib, "https://reports.example").tools!.find((t) => t.name === "read_page")!;
	const run = async (args: object) => ((await tool.execute(args as never, {} as never, {} as never)) as { content: { text: string }[] }).content[0]!.text;
	assert.match(await run({ page: "https://reports.example/t/2026-10-11-x.html" }), /<p>hi<\/p>/);
	assert.match(await run({ page: "t/2026-10-11-x.html" }), /<p>hi<\/p>/);
	assert.match(await run({ page: "nope.html" }), /No page[\s\S]*t\/2026-10-11-x\.html/);
	assert.match(await run({}), /t\/2026-10-11-x\.html · X/);
});

test("private pages: sticky, never exported to git, and readable only by agents without a way out", async () => {
	const pages = new PagesStore(memorySql());
	pages.put({ path: "ops/1.html", topic: "ops", title: "Repos", html: "<p>private</p>", private: true }, 1000);
	pages.put({ path: "ops/1.html", topic: "ops", title: "Repos", html: "<p>again</p>", private: false }, 2000);
	pages.put({ path: "r/1.html", topic: "r", title: "Web", html: "<p>public</p>", private: false }, 3000);
	assert.equal(pages.get("ops/1.html")!.private, true, "once private, always private");
	assert.equal(pages.get("ops/1.html", false), undefined);
	assert.deepEqual(pages.list(false).map((p) => p.path), ["r/1.html"]);
	assert.deepEqual(pages.list(true).map((p) => p.path), ["r/1.html", "ops/1.html"], "the operator's site lists every page");
	assert.deepEqual(pages.since(0).map((p) => p.path), ["r/1.html"], "private pages never reach the research archive");
	assert.ok(pages.since(0, "private").every((p) => p.private), "they go to the private archive only");

	const { pagesKit } = await import("./pages.ts");
	const puts: { private: boolean }[] = [];
	const lib = { putPage: async (p: { private: boolean }) => void puts.push(p), getPage: async (path: string, withPrivate: boolean) => pages.get(path, withPrivate), listPages: async (w: boolean) => pages.list(w) };
	const tools = (access: { privateAgent: boolean; readsPrivate: boolean }) => Object.fromEntries(pagesKit(async () => lib, "https://r.example", () => {}, access).tools!.map((t) => [t.name, t]));
	const call = async (t: { execute: Function }, args: object) => ((await t.execute(args, {}, {})) as { content: { text: string }[] }).content[0]!.text;
	await call(tools({ privateAgent: true, readsPrivate: true }).publish_page!, { topic: "ops", title: "Daily", html: "<!doctype html><p>x</p>" });
	assert.equal(puts[0]!.private, true, "a private agent's page is private");
	assert.match(await call(tools({ privateAgent: false, readsPrivate: false }).read_page!, { page: "ops/1.html" }), /No page/, "a web agent cannot read it");
	assert.match(await call(tools({ privateAgent: true, readsPrivate: true }).read_page!, { page: "ops/1.html" }), /again/);
});

test("publish_page's check reports facts about the stored page, never its text", async () => {
	const { pageCheck } = await import("./pages.ts");
	const good = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Traffic</title>
<style>@media (prefers-color-scheme: dark){:root{--bg:#111}} main{max-width:680px}</style></head><body><main><h1>Sites</h1><h2>Spikes</h2>
<svg viewBox="0 0 320 150"><rect/></svg><a href="https://x.com">secret-word</a></main></body></html>`;
	const ok = pageCheck(good);
	assert.match(ok, /1 h1, 1 h2, 1 svg, 1 links/);
	assert.match(ok, /✓ doctype, charset, viewport, title, dark mode/);
	assert.doesNotMatch(ok, /⚠|secret-word/);
	const bad = pageCheck(`<html><body style="width:900px"><script>x()</script><img src="https://x.com/a.png"><button onclick="y()">b</button><svg><rect/></body></html>`);
	for (const w of [/doctype/, /viewport/, /1 <script> tag/, /inline event handler/, /loaded from elsewhere/, /1 <svg> opened but 0 closed/, /900px/, /dark-mode/]) assert.match(bad, w);
});

test("page opens are counted, and only opened pages come back", () => {
	const pages = new PagesStore(memorySql());
	pages.put({ path: "hf/a.html", topic: "hf", title: "A", html: "<p>a</p>", private: false });
	pages.put({ path: "hf/b.html", topic: "hf", title: "B", html: "<p>b</p>", private: true });
	pages.viewed("hf/b.html");
	pages.viewed("nope.html");
	assert.deepEqual(pages.opened(["hf/a.html", "hf/b.html", "nope.html"]), ["hf/b.html"]);
	assert.deepEqual(pages.opened([]), []);
});
