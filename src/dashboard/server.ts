// The dashboard: a read-only overview for the operator of roles, skills, the board, the documents the fleet
// made, its activity and deploys. Served on localhost or the tailnet; GET and HEAD only, a
// Host check against DNS rebinding, no scripts. Agents' HTML pages are served sandboxed (no scripts, no outside loads).
//
//   node src/dashboard/server.ts --bind <tailnet address> --port 8341     (deploy/systemd/dashboard.service)
import { CONFIG } from "../config.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { hostname, networkInterfaces } from "node:os";
import { type ArchiveName, board, defaultPaths, page, type Paths } from "./data.ts";
import { activityPage, boardPage, deploysPage, docsPage, h, layout, overview, reportPage, rolePage, rolesPage, skillPage, skillsPage } from "./html.ts";

export type Answer = { status: number; type: string; body: string; csp: string };

const DASHBOARD_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
// Pages agents wrote: their own inline styles and SVG, nothing that runs or loads from elsewhere.
const PAGE_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const html = (body: string, status = 200): Answer => ({ status, type: "text/html; charset=utf-8", body, csp: DASHBOARD_CSP });
const notFound = () => html(layout("/", "Not found", '<p>Nothing here. <a href="/">Overview</a></p>'), 404);

/** One request's answer; pure apart from reading disk, so tests call it directly. */
export function answer(url: URL, p: Paths): Answer {
	const a = route(url, p);
	// The board is the developer's own (docs/board.md); an instance without one shows no Board tab.
	return board(p) || a.csp !== DASHBOARD_CSP ? a : { ...a, body: a.body.replace('<a href="/board">Board</a>', "") };
}

function route(url: URL, p: Paths): Answer {
	const path = decodeURIComponent(url.pathname);
	if (path === "/healthz") return { status: 200, type: "text/plain; charset=utf-8", body: "ok\n", csp: DASHBOARD_CSP };
	if (path === "/") return html(overview(p));
	if (path === "/board") return board(p) ? html(boardPage(p)) : notFound();
	if (path === "/roles") return html(rolesPage());
	if (path === "/skills") return html(skillsPage());
	if (path === "/docs") {
		const q = (k: string) => url.searchParams.get(k) ?? "";
		return html(docsPage(p, q("q"), q("archive"), q("who"), q("kind")));
	}
	if (path === "/activity") return html(activityPage(p));
	if (path === "/deploys") return html(deploysPage(p));
	const role = /^\/roles\/([a-z-]+)$/.exec(path);
	if (role) return ((x) => (x ? html(x) : notFound()))(rolePage(role[1]!));
	const skill = /^\/skills\/([a-z0-9-]+)$/.exec(path);
	if (skill) return ((x) => (x ? html(x) : notFound()))(skillPage(skill[1]!));
	const doc = /^\/docs\/(report|page)\/(research|private)\/(.+)$/.exec(path);
	if (doc) {
		const archive = doc[2] as ArchiveName;
		if (doc[1] === "report") return ((x) => (x ? html(x) : notFound()))(reportPage(p, archive, doc[3]!));
		const body = page(p, archive, doc[3]!);
		return body === undefined ? notFound() : { status: 200, type: "text/html; charset=utf-8", body, csp: PAGE_CSP };
	}
	return notFound();
}

/** Where the dashboard may listen: localhost, or a tailnet (100.64.0.0/10) address this machine actually has. */
export function bindProblem(host: string, local: string[] = Object.values(networkInterfaces()).flatMap((l) => (l ?? []).filter((a) => a.family === "IPv4").map((a) => a.address))): string | undefined {
	if (host === "127.0.0.1") return undefined;
	const m = /^100\.(\d+)\.\d+\.\d+$/.exec(host);
	if (!m || Number(m[1]) < 64 || Number(m[1]) > 127) return `refusing ${host}: use 127.0.0.1 or a tailnet address (100.64.0.0/10)`;
	if (!local.includes(host)) return `refusing ${host}: it is not an address of this machine (is the tailnet up?)`;
}

/** Names the browser may use besides the address: this machine's name and its tailnet (MagicDNS) name. */
export function hostAliases(): string[] {
	const names = [hostname()];
	try {
		const self = JSON.parse(execFileSync("tailscale", ["status", "--self", "--json"], { encoding: "utf8", timeout: 5000 })).Self as { DNSName?: string };
		if (self.DNSName) names.push(self.DNSName.replace(/\.$/, ""));
	} catch {
		// no tailscale CLI: the address and the plain hostname still work
	}
	return names;
}

function serve(req: IncomingMessage, res: ServerResponse, host: string, port: number, p: Paths, aliases: string[]) {
	const send = (a: Answer) => {
		res.writeHead(a.status, {
			"content-type": a.type,
			"content-security-policy": a.csp,
			"x-content-type-options": "nosniff",
			"referrer-policy": "no-referrer",
			"cache-control": "no-store",
			"x-robots-tag": "noindex, nofollow",
		});
		res.end(req.method === "HEAD" ? undefined : a.body);
	};
	if (req.method !== "GET" && req.method !== "HEAD") return send({ status: 405, type: "text/plain", body: "read-only\n", csp: DASHBOARD_CSP });
	const allowed = new Set([`${host}:${port}`, ...(host === "127.0.0.1" ? [`localhost:${port}`] : aliases.map((a) => `${a}:${port}`))]);
	if (!allowed.has(req.headers.host ?? "")) return send({ status: 421, type: "text/plain", body: "wrong host\n", csp: DASHBOARD_CSP });
	try {
		send(answer(new URL(req.url ?? "/", `http://${req.headers.host}`), p));
	} catch (err) {
		console.error(`dashboard: ${req.url}:`, err);
		send(html(layout("/", "Error", `<p>Something failed while reading this page.</p><pre>${h(err instanceof Error ? err.message : String(err))}</pre>`), 500));
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const arg = (name: string, fallback: string) => {
		const i = process.argv.indexOf(`--${name}`);
		return i > 0 ? process.argv[i + 1]! : fallback;
	};
	const host = arg("bind", "127.0.0.1");
	const port = Number(arg("port", "8341"));
	const bad = bindProblem(host);
	if (bad) {
		console.error(`${CONFIG.name} dashboard: ${bad}`);
		process.exit(2);
	}
	const p = defaultPaths();
	const aliases = hostAliases();
	createServer((req, res) => serve(req, res, host, port, p, aliases)).listen(port, host, () =>
		console.log(`${CONFIG.name} dashboard on http://${host}:${port}/ and ${aliases.map((a) => `http://${a}:${port}/`).join(", ")} (code ${p.code})`),
	);
}
