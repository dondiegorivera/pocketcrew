// The two archives, same layout, different sources: the research library (mirrored to GitHub) and the private archive
// (server only), with reports, pages and, for the private one, the fleet's state. One commit per run when anything changed.
import { CONFIG } from "../../src/config.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { get, gitIn } from "./lib.mjs";

/** `researchDir`: where the research archive's working copy is (the full run's optional argument). */
export const archives = (researchDir) => [
	{
		name: "library",
		dir: researchDir || join(homedir(), `${CONFIG.name}-research`),
		reports: "/library/export",
		pages: "/library/pages",
		title: "Research library",
		intro: "Reports the fleet filed, newest first. Synced from the fleet's library; edits here do not flow back.",
		summary: "Summary for the Lead",
	},
	{
		name: "private",
		dir: join(homedir(), `${CONFIG.name}-private`),
		reports: "/library/private",
		pages: "/library/private-pages",
		state: "/sync/state",
		title: "Private archive",
		intro: "Reports of the agents that work on private data (Mail, Calendar, Clerk, Outreach, Ops), newest first. Server only, never mirrored. state/ holds the fleet's projects, routines, wishes, jobs, notes and spend.",
		summary: "Summary",
	},
];;

const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "");
const yaml = (s) => JSON.stringify(String(s ?? "")); // a JSON string is a valid YAML scalar

/** Every report file of an archive as [dir, name], read from disk, so the repo itself is the sync cursor. */
const files = (reports) =>
	existsSync(reports) ? readdirSync(reports).flatMap((month) => readdirSync(join(reports, month)).filter((f) => /^\d+-.*\.md$/.test(f)).map((f) => [month, f])) : [];

function markdown(r, summary) {
	const date = new Date(r.created).toISOString();
	return [
		"---",
		`id: ${r.id}`,
		`job: ${r.job}`,
		`agent: ${r.agent}`,
		`project: ${yaml(r.project)}`,
		`title: ${yaml(r.title)}`,
		`date: ${date}`,
		`cost_usd: ${Number(r.cost).toFixed(4)}`,
		"---",
		"",
		`# ${r.title}`,
		"",
		`Report #${r.id} · job #${r.job} · ${r.agent}${r.project ? ` · project ${r.project}` : ""} · ${date.slice(0, 10)}`,
		"",
		"## Brief",
		"",
		r.brief.trim(),
		"",
		"## Report",
		"",
		r.body.trim(),
		"",
		`## ${summary}`,
		"",
		r.summary.trim(),
		"",
	].join("\n");
}

function index(a) {
	const reports = join(a.dir, "reports");
	const rows = files(reports)
		.map(([month, f]) => {
			const head = readFileSync(join(reports, month, f), "utf8").split("\n---\n")[0];
			const field = (k) => (new RegExp(`^${k}: (.*)$`, "m").exec(head)?.[1] ?? "").replace(/^"(.*)"$/, (_, v) => JSON.parse(`"${v}"`));
			return { id: Number(field("id")), date: field("date").slice(0, 10), agent: field("agent"), project: field("project"), title: field("title"), path: `reports/${month}/${f}` };
		})
		.sort((a, b) => b.id - a.id);
	const cell = (s) => s.replace(/\|/g, "\\|");
	return [
		`# ${a.title}`,
		"",
		a.intro,
		"",
		"| # | Date | Agent | Project | Title |",
		"|---|---|---|---|---|",
		...rows.map((r) => `| ${r.id} | ${r.date} | ${r.agent} | ${cell(r.project)} | [${cell(r.title)}](${r.path}) |`),
		"",
	].join("\n");
}

/** Pages changed since the cursor, written where the site serves them. Returns how many. */
async function syncPages(a) {
	const dir = join(a.dir, "pages");
	const cursorFile = join(dir, ".cursor"); // the newest page change already copied, in ms
	let since = existsSync(cursorFile) ? Number(readFileSync(cursorFile, "utf8")) : 0;
	let n = 0;
	for (;;) {
		const { pages } = await get(`${a.pages}?since=${since}`);
		for (const p of pages) {
			if (p.path.split("/").some((part) => part === ".." || part === "")) continue; // never write outside pages/
			mkdirSync(join(dir, p.path, ".."), { recursive: true });
			writeFileSync(join(dir, p.path), p.html);
			since = p.updated;
			n++;
		}
		if (pages.length < 20) break;
	}
	if (n) writeFileSync(cursorFile, `${since}\n`);
	return n;
}

/** The fleet's state as files: JSON per part, the Lead's notes as text. Returns whether anything changed on disk. */
async function syncState(a) {
	const state = await get(a.state);
	const dir = join(a.dir, "state");
	mkdirSync(dir, { recursive: true });
	for (const [key, value] of Object.entries(state)) {
		const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
		if (typeof value === "string") writeFileSync(join(dir, `${name}.md`), `${value.trim()}\n`);
		else writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(value, null, "\t")}\n`);
	}
	return gitIn(a.dir, "status", "--porcelain", "state") !== "";
}

/** One archive: new reports, changed pages and (private) the state, one commit when anything changed. */
export async function syncArchive(a) {
	if (!existsSync(join(a.dir, ".git"))) return console.error(`${a.name}: no working copy at ${a.dir}; run scripts/library-setup.sh`);
	const reports = join(a.dir, "reports");
	gitIn(a.dir, "pull", "--ff-only", "--quiet");
	let cursor = Math.max(0, ...files(reports).map(([, f]) => Number.parseInt(f, 10)));
	const first = cursor + 1;
	for (;;) {
		const { reports: batch } = await get(`${a.reports}?after=${cursor}`);
		for (const r of batch) {
			const month = new Date(r.created).toISOString().slice(0, 7);
			mkdirSync(join(reports, month), { recursive: true });
			writeFileSync(join(reports, month, `${r.id}-${slug(r.title) || r.agent}.md`), markdown(r, a.summary));
			cursor = r.id;
		}
		if (batch.length < 50) break;
	}
	const pages = await syncPages(a);
	const state = a.state ? await syncState(a) : false;
	if (cursor < first && !pages && !state) return;
	const parts = [];
	if (cursor >= first) {
		writeFileSync(join(a.dir, "INDEX.md"), index(a));
		parts.push(cursor === first ? `report #${first}` : `reports #${first} to #${cursor}`);
	}
	if (pages) parts.push(`${pages} page${pages > 1 ? "s" : ""}`);
	if (state) parts.push("state");
	gitIn(a.dir, "add", "-A");
	gitIn(a.dir, "commit", "--quiet", "-m", `${a.title}: ${parts.join(", ")}`);
	gitIn(a.dir, "push", "--quiet", "origin", "HEAD");
	console.log(`${a.name}: synced ${parts.join(", ")}`);
}

