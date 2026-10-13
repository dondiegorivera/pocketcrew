// The dashboard's pages: server-rendered HTML, no scripts, phone-first, light and dark. Every value from disk goes
// through h(); report text is shown as text, never as HTML. Agents' HTML pages are served apart (server.ts), sandboxed.
import { ARCHIVES, type ArchiveName, budget, type Paths, board as readBoard, deploys as readDeploys, pages, report, reports, state as readState } from "./data.ts";
import { type Card, COLUMNS } from "./board.ts";
import { CONFIG, ZONE_NAME } from "../config.ts";
import { type AgentSpec, FLEET, LIMITS, shareOf } from "../fleet.ts";
import { roleOf } from "../instructions.ts";
import { riskSet } from "../safety.ts";
import { parseRole, ROLE_SECTIONS } from "../role-format.ts";
import { BUNDLED_SKILLS } from "../skills.gen.ts";
import { paceLine } from "../budget.ts";
import { markdown } from "./markdown.ts";

export const h = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const day = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "–");
const firstLine = (s: string | null | undefined, n = 140) => {
	const l = (s ?? "").split("\n").find((x) => x.trim()) ?? "";
	return l.length > n ? `${l.slice(0, n - 1)}…` : l;
};
const qs = (o: Record<string, string>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

const NAV: [string, string][] = [["/", "Overview"], ["/board", "Board"], ["/roles", "Roles"], ["/skills", "Skills"], ["/docs", "Documents"], ["/activity", "Activity"], ["/deploys", "Deploys"]];

const CSS = `
:root{--bg:#f7f7f5;--card:#fff;--fg:#1d2024;--muted:#5e656e;--line:#e3e5e8;--accent:#2a5db0;--soft:#eaf1fb;--ok:#1f7a4d;--warn:#a35a00;--bad:#b03a3a;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111315;--card:#181b1f;--fg:#e7e9ec;--muted:#9aa3ad;--line:#2a2e33;--accent:#8fb4f0;--soft:#172235;--ok:#7fd3a6;--warn:#f2b56b;--bad:#f08a8a;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);z-index:2}
.bar{max-width:1280px;margin:0 auto;padding:10px 16px;display:flex;gap:6px 14px;align-items:center;flex-wrap:wrap}
.brand{font-weight:700;margin-right:8px}nav{display:flex;gap:4px;flex-wrap:wrap}
nav a{padding:6px 10px;border-radius:8px;color:var(--muted);text-decoration:none}nav a.on{background:var(--soft);color:var(--accent);font-weight:600}
main{max-width:1280px;margin:0 auto;padding:16px 16px 56px}
h1{font-size:22px;margin:4px 0 14px}h2{font-size:17px;margin:26px 0 10px}h3{font-size:15px;margin:0 0 6px}
a{color:var(--accent)}.muted{color:var(--muted)}.small{font-size:13px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}
.card p{margin:4px 0}.stat{font-size:24px;font-weight:700}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--soft);color:var(--accent);margin:0 4px 4px 0;white-space:nowrap}
.pill.private{color:var(--warn)}.pill.untrusted{color:var(--bad)}.pill.egress{color:var(--ok)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-top:1px solid var(--line);vertical-align:top}th{border-top:0;font-size:13px;color:var(--muted);font-weight:600}
.scroll{overflow-x:auto}
pre{white-space:pre-wrap;word-break:break-word;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;font:13.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}
.kanban{display:grid;gap:12px;grid-template-columns:repeat(6,minmax(240px,1fr));overflow-x:auto;padding-bottom:8px}
@media (max-width:760px){.kanban{grid-template-columns:1fr}}
.col{background:var(--soft);border-radius:12px;padding:10px;min-width:0}.col h3{display:flex;justify-content:space-between}
.col .card{margin-top:8px;padding:10px 12px}
details summary{cursor:pointer;color:var(--muted);font-size:13px}details[open] summary{margin-bottom:4px}
form.search{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}input,select,button{font:inherit;padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.bars{display:flex;align-items:flex-end;gap:3px;height:120px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px}
.bars div{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-height:1px}
.article{max-width:760px;font-size:16px;line-height:1.65}.article h2{font-size:19px;margin:28px 0 8px}.article h3{font-size:16px;margin:20px 0 6px}
.article p,.article ul,.article ol{margin:0 0 12px}.article li{margin:2px 0}.article code{font:14px ui-monospace,Menlo,monospace;background:var(--soft);padding:1px 5px;border-radius:5px}
.article pre{margin:0 0 12px}.article table{margin:0 0 12px}.meta{display:flex;gap:6px 14px;flex-wrap:wrap;margin:-6px 0 16px}
.feed{display:grid;gap:8px}.feed a.item{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.feed a.item:hover{border-color:var(--accent)}.feed .t{font-weight:600;color:var(--accent)}.chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}
.chips a{text-decoration:none}.chips a.on .pill{background:var(--accent);color:var(--bg)}
.status-done{color:var(--ok)}.status-failed{color:var(--bad)}.status-running{color:var(--accent)}.status-queued{color:var(--warn)}
`;

export function layout(path: string, title: string, body: string, note = ""): string {
	const nav = NAV.map(([href, label]) => `<a href="${href}"${(href === "/" ? path === "/" : path.startsWith(href)) ? ' class="on"' : ""}>${label}</a>`).join("");
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${h(title)} · ${h(CONFIG.name)}</title><style>${CSS}</style></head><body><header><div class="bar"><span class="brand">${h(CONFIG.name)}</span><nav>${nav}</nav></div></header>
<main><h1>${h(title)}</h1>${note ? `<p class="muted small">${note}</p>` : ""}${body}</main></body></html>`;
}

const risks = (name: string) => [...riskSet(FLEET[name as keyof typeof FLEET])].map((r) => `<span class="pill ${r}">${r}</span>`).join("") || '<span class="muted small">no risks</span>';
const cardLine = (c: Card) => `<div class="card"><p><span class="muted small">${h(c.id)}</span> ${h(c.title)}</p>
<p class="small">${c.owner ? `<span class="pill">${h(c.owner)}</span>` : ""}${c.updated ? `<span class="muted">${h(c.updated)}</span>` : ""}</p>${c.note ? `<details><summary>note</summary><p class="small">${h(c.note)}</p></details>` : ""}</div>`;

export function overview(p: Paths): string {
	const s = readState(p);
	const b = budget(s);
	const d = readDeploys(p, 5);
	const bd = readBoard(p);
	const nReports = reports(p, "research").length + reports(p, "private").length;
	const nPages = pages(p, "research").length + pages(p, "private").length;
	const fleet = Object.entries(FLEET)
		.map(([n, a]) => {
			const role = parseRole(roleOf(n));
			const model = (s.models?.[n] ?? a.model).replace("claude-", "");
			return `<div class="card"><h3><a href="/roles/${n}">${h(a.title)}</a> <span class="muted small">${h(n)}</span></h3>
<p class="small">${h(model)}${s.models?.[n] ? " (switched)" : ""} · ${Math.round(shareOf(n) * 100)}% share · ${a.parallelJobs} at once · ${a.tools.length} tools${a.mcp.length ? ` · MCP ${h(a.mcp.join(", "))}` : ""}</p>
<p class="small">${typeof role === "string" ? h(a.does) : h(firstLine(role.sections.Purpose, 160))}</p><p>${risks(n)}</p></div>`;
		})
		.join("");
	const waiting = bd?.columns["Waiting on operator"] ?? [];
	return layout(
		"/",
		"Overview",
		`<div class="grid">
<div class="card"><h3>Credit</h3>${b ? `<p class="stat">${usd(b.leftUsd)}</p><p class="small">left of ${usd(s.credit!.usd)} · expires ${h(s.credit!.expires.slice(0, 10))} (${b.daysLeft.toFixed(0)} days)</p>
<p class="small">today ${usd(b.spentTodayUsd)} of ${usd(b.todayUsd)} · even pace ${usd(b.evenDayUsd)}/day</p><p class="small muted">${h(paceLine(b))}</p>` : '<p class="muted">No state synced yet.</p>'}</div>
<div class="card"><h3>Documents</h3><p class="stat">${nReports}</p><p class="small">reports · ${nPages} pages · ${BUNDLED_SKILLS.length} skills · ${Object.keys(FLEET).length} roles</p><p class="small"><a href="/docs">browse</a></p></div>
<div class="card"><h3>Live code</h3><p class="stat">${h(d.live?.slice(0, 7) ?? "–")}</p><p class="small">${h(d.commits.find((c) => d.live?.startsWith(c.sha))?.subject ?? d.commits[0]?.subject ?? "")}</p><p class="small"><a href="/deploys">deploys</a></p></div>
${bd ? `<div class="card"><h3>Waiting on you</h3>${waiting.length ? waiting.map((c) => `<p class="small">${h(c.id)} ${h(c.title)}</p>`).join("") : '<p class="muted small">Nothing.</p>'}<p class="small"><a href="/board">board</a></p></div>` : ""}
</div><h2>Latest documents</h2><div class="feed">${documents(p).slice(0, 8).map(docItem).join("") || '<p class="muted">Nothing yet.</p>'}</div><p class="small"><a href="/docs">All documents</a></p>
<h2>Fleet</h2><div class="grid">${fleet}</div>`,
		s.syncedAt ? `State as of the last sync, ${h(day(s.syncedAt))} UTC. Reserve ${usd(LIMITS.reserveUsd)}.` : "",
	);
}

export function boardPage(p: Paths): string {
	const b = readBoard(p);
	if (!b) return layout("/board", "Board", '<p class="muted">No docs/board.md in the deployed code yet.</p>');
	const cols = COLUMNS.map((c) => `<div class="col"><h3>${h(c)} <span class="muted">${b.columns[c].length}</span></h3>${b.columns[c].map(cardLine).join("")}</div>`).join("");
	return layout("/board", "Board", `${b.problems.length ? `<p class="small" style="color:var(--bad)">${h(b.problems.join("; "))}</p>` : ""}<div class="kanban">${cols}</div>`, "docs/board.md on main. The developer keeps it; it changes with a push.");
}

export function rolesPage(): string {
	const rows = Object.entries(FLEET)
		.map(([n, a]) => {
			const role = parseRole(roleOf(n));
			return `<div class="card"><h3><a href="/roles/${n}">${h(a.title)}</a></h3><p class="small">${typeof role === "string" ? h(role) : h(role.sections.Purpose)}</p><p>${risks(n)}</p></div>`;
		})
		.join("");
	return layout("/roles", "Roles", `<div class="grid">${rows}</div>`, "Each agent's contract (roles/&lt;agent&gt;.md), always part of its instructions. Developer-only.");
}

export function rolePage(name: string): string | undefined {
	if (!Object.hasOwn(FLEET, name)) return undefined;
	const a: AgentSpec = FLEET[name as keyof typeof FLEET];
	const role = parseRole(roleOf(name));
	const sections = typeof role === "string" ? `<pre>${h(role)}</pre>` : ROLE_SECTIONS.map((s) => `<h2>${h(s)}</h2><pre>${h(role.sections[s])}</pre>`).join("");
	const wiring = `<div class="card"><p class="small">Model ${h(a.model.replace("claude-", ""))} · effort ${h(a.effort)} · ${Math.round(shareOf(name) * 100)}% budget share · ${a.parallelJobs} job(s) at once · ${a.searchesPerJob} searches per job</p>
<p class="small">Tools: ${a.tools.map((t) => `<span class="pill">${h(t)}</span>`).join("")}</p>${a.mcp.length ? `<p class="small">MCP: ${h(a.mcp.join(", "))}</p>` : ""}${a.repos?.length ? `<p class="small">Repo views: ${h(a.repos.join(", "))}</p>` : ""}<p>${risks(name)}</p></div>`;
	return layout("/roles", `${a.title} (${name})`, `${wiring}${sections}`, `<a href="/roles">All roles</a> · roles/${h(name)}.md`);
}

export function skillsPage(): string {
	const rows = BUNDLED_SKILLS.map(
		(s) => `<tr><td><a href="/skills/${h(s.name)}">${h(s.name)}</a>${s.devOnly ? ' <span class="pill">dev only</span>' : ""}</td><td>${h(s.description)}</td><td class="small">${h(s.agents.length ? s.agents.join(", ") : "every agent")}</td><td class="small muted">${s.updated ? day(s.updated) : "–"}</td></tr>`,
	).join("");
	return layout("/skills", "Skills", `<div class="scroll"><table><tr><th>Skill</th><th>What it is for</th><th>Who</th><th>Updated</th></tr>${rows}</table></div>`, "skills/ on main. Skills saved in chat appear here once the sync has committed them (within 15 minutes) and the commit has deployed.");
}

export function skillPage(name: string): string | undefined {
	const s = BUNDLED_SKILLS.find((x) => x.name === name);
	if (!s) return undefined;
	const files = Object.entries(s.files ?? {}).map(([f, t]) => `<h2>${h(f)}</h2><pre>${h(t)}</pre>`).join("");
	return layout("/skills", s.name, `<p>${h(s.description)}</p><p class="small muted">For ${h(s.agents.length ? s.agents.join(", ") : "every agent")}${s.origin ? ` · from ${h(s.origin)}` : ""}${s.devOnly ? " · developer-only" : ""}</p><pre>${h(s.body)}</pre>${files}`, '<a href="/skills">All skills</a>');
}

/** A report or a page, as one entry of the documents feed. */
type Doc = { kind: "report" | "page"; archive: ArchiveName; title: string; who: string; date: string; sort: number; href: string; cost?: number };

export function documents(p: Paths): Doc[] {
	const rs = ARCHIVES.flatMap((a) => reports(p, a)).map((r): Doc => ({ kind: "report", archive: r.archive, title: r.title, who: r.agent, date: r.date, sort: Date.parse(r.date) + r.id, href: `/docs/report/${r.archive}/${r.file}` }));
	const ps = ARCHIVES.flatMap((a) => pages(p, a)).map((pg): Doc => ({ kind: "page", archive: pg.archive, title: pg.title, who: pg.topic, date: day(pg.modified).slice(0, 10), sort: pg.modified, href: `/docs/page/${pg.archive}/${pg.path}` }));
	return [...rs, ...ps].sort((a, b) => b.sort - a.sort);
}

const docItem = (d: Doc) =>
	`<a class="item" href="${h(d.href)}"${d.kind === "page" ? ' target="_blank" rel="noopener"' : ""}><div class="t">${h(d.title)}</div><div class="small muted">${h(d.date)} · ${d.kind === "page" ? "page" : "report"} · ${h(d.who)} ${d.archive === "private" ? '<span class="pill private">private</span>' : ""}</div></a>`;

export function docsPage(p: Paths, q: string, archive: string, who = "", kind = ""): string {
	const words = q.toLowerCase().split(/\s+/).filter(Boolean);
	const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w));
	const all = documents(p);
	const shown = all.filter(
		(d) =>
			(!archive || d.archive === archive) &&
			(!who || d.who === who) &&
			(!kind || d.kind === kind) &&
			(!words.length || hit(`${d.title} ${d.who}`) || (d.kind === "report" && hit(report(p, d.archive, d.href.split("/").slice(4).join("/")) ?? ""))),
	);
	const link = (label: string, o: Record<string, string>, on: boolean) => `<a href="/docs?${qs({ q, archive, who, kind, ...o })}"${on ? ' class="on"' : ""}><span class="pill">${h(label)}</span></a>`;
	const whos = [...new Set(all.map((d) => d.who))].sort();
	const sel = (v: string, label: string) => `<option value="${v}"${archive === v ? " selected" : ""}>${label}</option>`;
	return layout(
		"/docs",
		"Documents",
		`<form class="search" method="get" action="/docs"><input name="q" value="${h(q)}" placeholder="Search titles and report text" size="28"><select name="archive">${sel("", "Both archives")}${sel("research", "Research")}${sel("private", "Private")}</select>${who ? `<input type="hidden" name="who" value="${h(who)}">` : ""}${kind ? `<input type="hidden" name="kind" value="${h(kind)}">` : ""}<button>Search</button></form>
<div class="chips">${link("All", { who: "", kind: "" }, !who && !kind)}${link("Reports", { kind: kind === "report" ? "" : "report" }, kind === "report")}${link("Pages", { kind: kind === "page" ? "" : "page" }, kind === "page")}${whos.map((w) => link(w, { who: who === w ? "" : w }, who === w)).join("")}</div>
<p class="small muted">${shown.length} of ${all.length}</p><div class="feed">${shown.map(docItem).join("") || '<p class="muted">Nothing matches.</p>'}</div>`,
		"Newest first. Reports from every agent (private ones built from mail, calendar and docs included) and the pages they published. Pages open in a new tab, sandboxed. As of the last sync.",
	);
}

export function reportPage(p: Paths, archive: ArchiveName, file: string): string | undefined {
	const text = report(p, archive, file);
	if (text === undefined) return undefined;
	const [head, ...rest] = text.split("\n---\n");
	const body = rest.join("\n---\n").trim();
	const field = (k: string) => (new RegExp(`^${k}: (.*)$`, "m").exec(head ?? "")?.[1] ?? "").replace(/^"(.*)"$/, "$1");
	const title = /^# (.+)$/m.exec(body)?.[1] ?? file;
	const meta = `<div class="meta small muted"><span>${h(field("date").slice(0, 16).replace("T", " "))}</span><span>${h(field("agent"))}</span>${field("project") ? `<span>${h(field("project"))}</span>` : ""}<span>job #${h(field("job"))}</span><span>${h(usd(Number(field("cost_usd")) || 0))}</span>${archive === "private" ? '<span class="pill private">private</span>' : ""}</div>`;
	return layout("/docs", title, `${meta}<article class="article">${markdown(body.replace(/^# .+\n+/, ""))}</article>`, '<a href="/docs">All documents</a>');
}

export function activityPage(p: Paths): string {
	const s = readState(p);
	const jobs = [...(s.jobs ?? [])].reverse().slice(0, 60);
	const jobRows = jobs
		.map((j) => `<tr><td class="small muted">#${j.id}</td><td class="small status-${h(j.status)}">${h(j.status)}</td><td class="small">${h(j.agent)}${j.model ? ` · ${h(j.model.replace("claude-", ""))}` : ""}</td><td><span class="small">${h(firstLine(j.task))}</span>${j.summary ? `<details><summary>summary</summary><p class="small">${h(j.summary)}</p></details>` : ""}</td><td class="small muted">${day(j.created)}</td><td class="small muted">${j.cost != null ? usd(j.cost) : ""}</td></tr>`)
		.join("");
	const byDay = new Map<string, number>();
	for (const r of s.spendByDay ?? []) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.usd);
	const days = [...byDay].sort((a, b) => a[0].localeCompare(b[0])).slice(-30);
	const max = Math.max(0.01, ...days.map(([, v]) => v));
	const bars = days.length ? `<div class="bars">${days.map(([d, v]) => `<div title="${h(d)}: ${usd(v)}" style="height:${Math.round((v / max) * 100)}%"></div>`).join("")}</div><p class="small muted">${h(days[0]![0])} to ${h(days.at(-1)![0])} · highest ${usd(max)}</p>` : '<p class="muted">No spend yet.</p>';
	const perAgent = new Map<string, number>();
	const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
	for (const r of s.spendByDay ?? []) if (r.day >= weekAgo) perAgent.set(`${r.agent} · ${r.model.replace("claude-", "")}`, (perAgent.get(`${r.agent} · ${r.model.replace("claude-", "")}`) ?? 0) + r.usd);
	const agentRows = [...perAgent].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td class="small">${h(k)}</td><td class="small">${usd(v)}</td></tr>`).join("");
	const table = (head: string[], rows: string) => (rows ? `<div class="scroll"><table><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr>${rows}</table></div>` : '<p class="muted">None.</p>');
	return layout(
		"/activity",
		"Activity",
		`<h2>Spend per day</h2>${bars}<h2>Last 7 days by agent and model</h2>${table(["Agent · model", "Spent"], agentRows)}
<h2>Routines</h2>${table(["#", "Name", "Agent", `Cron (${ZONE_NAME})`, "Task", "Last run"], (s.routines ?? []).map((r) => `<tr><td class="small muted">${r.id}</td><td>${h(r.name)}</td><td class="small">${h(r.agent)}</td><td class="small"><code>${h(r.cron)}</code></td><td class="small">${h(firstLine(r.task))}</td><td class="small muted">${day(r.last_run)}</td></tr>`).join(""))}
<h2>Wishes</h2>${table(["#", "Agent", "Task", "Status"], (s.wishes ?? []).map((w) => `<tr><td class="small muted">${w.id}</td><td class="small">${h(w.agent)}${w.model ? ` · ${h(w.model.replace("claude-", ""))}` : ""}</td><td class="small">${h(firstLine(w.task))}</td><td class="small">${w.job ? `job #${w.job}` : "waiting"}</td></tr>`).join(""))}
<h2>Projects</h2>${table(["Name", "Goal", "Context"], (s.projects ?? []).map((pr) => `<tr><td>${h(pr.name)}</td><td class="small">${h(pr.goal)}</td><td class="small">${h(pr.context)}</td></tr>`).join(""))}
<h2>The Lead's notes</h2><pre>${h(s.leadNotes ?? "None synced yet.")}</pre>
<h2>Jobs <span class="muted small">latest ${jobs.length}</span></h2>${table(["#", "Status", "Agent", "Task", "Created", "Cost"], jobRows)}`,
		s.syncedAt ? `From the private archive's state/, synced ${h(day(s.syncedAt))} UTC.` : "Nothing synced yet.",
	);
}

export function deploysPage(p: Paths): string {
	const d = readDeploys(p);
	return layout(
		"/deploys",
		"Deploys",
		`<div class="card"><p>Live: <strong>${h(d.live?.slice(0, 7) ?? "unknown")}</strong></p><p class="small muted">A push to main runs scripts/deploy.sh: checks, then the Worker and the reports site. A failed check deploys nothing.</p></div>
<h2>Pipeline log</h2>${d.log.length ? `<div class="scroll"><table><tr><th>When (UTC)</th><th>Commit</th><th>What</th></tr>${d.log.map((l) => `<tr><td class="small muted">${h(l.at.replace("T", " ").slice(0, 16))}</td><td class="small"><code>${h(l.sha)}</code></td><td class="small">${h(l.what)}</td></tr>`).join("")}</table></div>` : '<p class="muted">No deploys yet.</p>'}
<h2>Commits on main</h2>${d.commits.length ? `<div class="scroll"><table><tr><th>When</th><th>Commit</th><th>Subject</th></tr>${d.commits.map((c) => `<tr><td class="small muted">${h(c.date)}</td><td class="small"><code>${h(c.sha)}</code>${d.live?.startsWith(c.sha) ? ' <span class="pill">live</span>' : ""}</td><td class="small">${h(c.subject)}</td></tr>`).join("")}</table></div>` : '<p class="muted">No history.</p>'}`,
	);
}
