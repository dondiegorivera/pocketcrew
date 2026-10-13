import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseBoard, parseCard } from "./board.ts";
import { type Paths } from "./data.ts";
import { answer, bindProblem } from "./server.ts";

test("board cards parse with optional fields and a note that may hold separators", () => {
	assert.deepEqual(parseCard("- [C-001] Token — owner: operator · updated: 2026-10-11 · note: a · b — c"), { id: "C-001", title: "Token", owner: "operator", updated: "2026-10-11", note: "a · b — c" });
	assert.deepEqual(parseCard("- [M-7] Bare title"), { id: "M-7", title: "Bare title" });
	assert.equal(parseCard("plain text"), undefined);
	const b = parseBoard("## Next\n- [C-1] A — owner: dev\n## Odd\n- [C-2] B\n## Done\n- [C-3] C");
	assert.deepEqual(b.columns.Next.map((c) => c.id), ["C-1"]);
	assert.deepEqual(b.columns.Done.map((c) => c.id), ["C-3"]);
	assert.deepEqual(b.problems, ['unknown column "Odd"', "C-2 sits outside the six columns"]);
});

const OWN_BOARD = new URL("../../docs/board.md", import.meta.url);
test("the repo's own board parses cleanly", { skip: !existsSync(OWN_BOARD) && "no docs/board.md here" }, () => {
	const b = parseBoard(readFileSync(OWN_BOARD, "utf8"));
	assert.deepEqual(b.problems, []);
	assert.ok(b.columns["Waiting on operator"].length > 0);
});

test("the dashboard binds only to localhost or a tailnet address this machine has", () => {
	assert.equal(bindProblem("127.0.0.1", []), undefined);
	assert.equal(bindProblem("100.100.1.2", ["100.100.1.2"]), undefined);
	assert.match(bindProblem("100.100.1.2", ["10.0.0.2"])!, /not an address of this machine/);
	assert.match(bindProblem("0.0.0.0", [])!, /refusing/);
	assert.match(bindProblem("192.168.1.5", ["192.168.1.5"])!, /tailnet/);
});

function fixture(): Paths {
	const root = mkdtempSync(join(tmpdir(), "pocketcrew-dash-"));
	const p: Paths = { code: join(root, "code"), research: join(root, "research"), private: join(root, "private"), deploys: join(root, "deploys") };
	mkdirSync(join(p.code, "docs"), { recursive: true });
	writeFileSync(join(p.code, "docs", "board.md"), "## Waiting on operator\n- [C-1] Do <b>this</b> — owner: operator\n");
	mkdirSync(join(p.research, "reports", "2026-10"), { recursive: true });
	writeFileSync(join(p.research, "reports", "2026-10", "3-trends.md"), '---\nid: 3\nagent: research\nproject: ""\ntitle: "Trends <script>"\ndate: 2026-10-10T08:00:00Z\ncost_usd: 0.0400\n---\n\n# Trends\n\nbody <img src=x>\n');
	mkdirSync(join(p.private, "pages", "cf-traffic"), { recursive: true });
	writeFileSync(join(p.private, "pages", "cf-traffic", "2026-10-11-daily.html"), "<!doctype html><title>Traffic</title><script>alert(1)</script>");
	mkdirSync(join(p.private, "state"), { recursive: true });
	writeFileSync(join(p.private, "state", "credit.json"), JSON.stringify({ usd: 99.93, asOf: "2026-10-10T11:30:00Z", expires: "2026-11-01T00:00:00Z" }));
	writeFileSync(join(p.private, "state", "spend-by-day.json"), JSON.stringify([{ day: "2026-10-10", agent: "lead", model: "claude-opus-5-5", usd: 4.7 }]));
	writeFileSync(join(p.private, "state", "jobs.json"), JSON.stringify([{ id: 1, agent: "mail", model: null, project: null, task: "Sort the inbox", status: "done", created: 1, finished: 2, cost: 0.02, summary: "ok" }]));
	return p;
}

test("every view renders from disk, escapes what agents wrote, and serves their pages sandboxed", () => {
	const p = fixture();
	const get = (path: string) => answer(new URL(`http://x${path}`), p);
	for (const path of ["/", "/board", "/roles", "/roles/lead", "/skills", "/skills/crew", "/docs", "/activity", "/deploys", "/healthz"]) assert.equal(get(path).status, 200, path);
	assert.match(get("/board").body, /Do &#60;b&#62;this&#60;\/b&#62;/);
	const docs = get("/docs?q=trends").body;
	assert.match(docs, /Trends &#60;script&#62;/);
	assert.doesNotMatch(docs, /<script>/);
	assert.doesNotMatch(get("/docs/report/research/2026-10/3-trends.md").body, /<img src=x>/);
	const pg = get("/docs/page/private/cf-traffic/2026-10-11-daily.html");
	assert.equal(pg.status, 200);
	assert.match(pg.csp, /^sandbox;.*default-src 'none'/);
	assert.match(get("/activity").body, /Sort the inbox/);
	assert.match(get("/").body, /\$95\.23/, "credit left from the synced day totals");
	for (const bad of ["/docs/page/private/../state/credit.json", "/docs/report/research/../../x.md", "/docs/page/other/x.html", "/roles/nobody", "/skills/NOPE"]) assert.equal(get(bad).status, 404, bad);
});

test("reports render as Markdown, and nothing an agent copied can become markup", async () => {
	const { markdown } = await import("./markdown.ts");
	const out = markdown("## Findings\n\n- **Fast** growth, see https://example.com/a.\n- `code <b>`\n\n1. one\n2. two\n\n| a | b |\n|---|---|\n| <i>x</i> | [link](https://x.org) |\n\n<script>alert(1)</script> [bad](javascript:alert(1))\n```\n<b>raw</b>\n```");
	assert.match(out, /<h3>Findings<\/h3>/);
	assert.match(out, /<ul><li><strong>Fast<\/strong> growth, see <a href="https:\/\/example\.com\/a"[^>]*>https:\/\/example\.com\/a<\/a>\.<\/li><li><code>code &#60;b&#62;<\/code><\/li><\/ul>/);
	assert.match(out, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
	assert.match(out, /<td>&#60;i&#62;x&#60;\/i&#62;<\/td><td><a href="https:\/\/x\.org"/);
	assert.doesNotMatch(out, /<script|<i>|<b>|href="javascript/);
	assert.match(out, /<pre>&#60;b&#62;raw&#60;\/b&#62;<\/pre>/);
});

test("without a board file there is no Board tab and no /board", () => {
	const p = fixture();
	const get = (path: string) => answer(new URL(`http://x${path}`), p);
	assert.match(get("/").body, /href="\/board"/);
	rmSync(join(p.code, "docs", "board.md"));
	assert.doesNotMatch(get("/").body, /href="\/board"/);
	assert.equal(get("/board").status, 404);
});
