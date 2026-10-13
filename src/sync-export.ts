// What the server's sync (scripts/sync.mjs) pulls, with LIBRARY_EXPORT_TOKEN as bearer; without that secret
// these paths do not exist. The cloud holds no git credentials: the server pulls and commits.
//   GET /library/export?after=<report id>  the next filed reports      → <name>-research/reports/
//   GET /library/pages?since=<ms>          pages changed since then     → <name>-research/pages/
//   GET /library/skills                    skills saved or installed   → the code repo's skills/
//   GET /library/private?after=<id>        private agents' reports     → <name>-private/reports/ (server only)
//   GET /library/private-pages?since=<ms>  private pages               → <name>-private/pages/
//   GET /sync/state                        projects, routines, wishes, jobs, notes, spend → <name>-private/state/
//   POST /sync/deploy                      the deploy pipeline's outcome, said in General
//   PUT /sync/repos/<view>                 a repo view's files         ← the server's working copy (repo-views.ts)
//   GET /sync/repos/<view>/writes          writes agents queued        → committed by the server
//   POST /sync/repos/acks                  what became of those writes; failures are reported in General
//   PUT /sync/git/<repo>                   new commits and branch heads of a followed repo (git-feed.ts)
//   POST /sync/plugin/<name>/<method>     a plugin's own call (its manifest's rpc), body { args }; answers { result }
//   POST /sync/health                     the sync's problems this run (none: all well); silence is noticed too
//   GET /sync/diag/budget                  the /budget text
//   GET /sync/diag/health                  the Director's state for npm run smoke: ticks, sync, digests, jobs, Google, budget
//   GET /sync/diag/mcp?agent=<name>        what /mcp shows for that agent: servers, offered tools, allowed or hidden
//   GET /sync/diag/trace?agent=<worker>&last=<n>  that agent's or job worker's (`radar~37`) last steps, as /trace
import { getAgentByName } from "agents";
import type { FleetAgent } from "./agent.ts";
import type { Director } from "./director.ts";
import { baseName, isAgentName } from "./fleet.ts";
import { type Commit, type Head, isDevRepo } from "./git-feed.ts";
import { library } from "./library-object.ts";
import { inView, isViewName, viewOf } from "./repo-views.ts";
import type { WriteResult } from "./repos.ts";
import { repos } from "./repos-object.ts";
import { sameSecret } from "./secret.ts";
import { isSet, secret } from "./secrets.ts";
import { bot } from "./telegram.ts";

const LIBRARY_PATHS = ["/library/export", "/library/pages", "/library/skills", "/library/private", "/library/private-pages"];
export const isSyncPath = (path: string) => LIBRARY_PATHS.includes(path) || path.startsWith("/sync/");

async function repoSync(req: Request, env: Env, path: string): Promise<Response> {
	if (req.method === "POST" && path === "/sync/repos/acks") {
		const { results } = (await req.json()) as { results: WriteResult[] };
		const failed = await repos(env).ack(results);
		for (const w of failed)
			await (await bot(env)).say(undefined, `⚠️ ${w.agent}'s write to ${w.path} (${w.view}) was not committed: ${w.result.slice(0, 600)}`);
		return Response.json({ ok: true, failed: failed.length });
	}
	const m = /^\/sync\/repos\/([\w-]+)(\/writes)?$/.exec(path);
	if (!m || !isViewName(m[1]!)) return new Response("not found", { status: 404 });
	const view = m[1]!;
	if (req.method === "GET" && m[2]) return Response.json({ writes: await repos(env).pending(view) });
	if (req.method === "PUT" && !m[2]) {
		const { files, revision } = (await req.json()) as { files: Record<string, string>; revision: string };
		const outside = Object.keys(files).filter((p) => !inView(viewOf(view), p));
		if (outside.length) return new Response(`not in the view: ${outside.join(", ")}`, { status: 400 });
		await repos(env).upload(view, files, revision);
		return Response.json({ ok: true, files: Object.keys(files).length });
	}
	return new Response("not found", { status: 404 });
}

export async function syncExport(req: Request, env: Env): Promise<Response> {
	const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
	if (!sameSecret(token, await secret(env, "LIBRARY_EXPORT_TOKEN"))) return new Response("not found", { status: 404 });
	const url = new URL(req.url);
	if (url.pathname === "/sync/diag/mcp" && req.method === "GET") {
		const name = url.searchParams.get("agent") ?? "";
		if (!isAgentName(name)) return new Response("unknown agent", { status: 404 });
		const agent = await getAgentByName(env.FleetAgent as DurableObjectNamespace<FleetAgent>, name);
		return new Response(await agent.mcpText());
	}
	if (url.pathname === "/sync/diag/trace" && req.method === "GET") {
		const name = url.searchParams.get("agent") ?? "";
		if (!isAgentName(baseName(name))) return new Response("unknown agent", { status: 404 });
		const agent = await getAgentByName(env.FleetAgent as DurableObjectNamespace<FleetAgent>, name);
		const last = Math.min(200, Number(url.searchParams.get("last") ?? 40) || 40);
		return new Response(await agent.trace(last, true));
	}
	if (url.pathname === "/sync/state" && req.method === "GET") {
		const director = await getAgentByName(env.Director as DurableObjectNamespace<Director>, "main");
		return Response.json(await director.stateSnapshot());
	}
	if (url.pathname === "/sync/deploy" && req.method === "POST") {
		const { ok, text, changes } = (await req.json()) as { ok: boolean; text: string; changes?: unknown };
		const director = await getAgentByName(env.Director as DurableObjectNamespace<Director>, "main");
		const shipped = Array.isArray(changes) ? changes.slice(0, 30).map((c) => String(c).slice(0, 300)) : [];
		await director.deployNotice(ok === true, String(text ?? "").slice(0, 1500), shipped);
		return Response.json({ ok: true });
	}
	if (url.pathname === "/sync/health" && req.method === "POST") {
		const director = await getAgentByName(env.Director as DurableObjectNamespace<Director>, "main");
		const { problems } = (await req.json()) as { problems: string[] };
		await director.syncHealth(Array.isArray(problems) ? problems.map(String) : []);
		return Response.json({ ok: true });
	}
	const plugin = /^\/sync\/plugin\/([\w-]+)\/(\w+)$/.exec(url.pathname);
	if (plugin && req.method === "POST") {
		const director = await getAgentByName(env.Director as DurableObjectNamespace<Director>, "main");
		const { args } = (await req.json()) as { args?: unknown };
		try {
			return Response.json({ result: (await director.pluginRpc(plugin[1]!, plugin[2]!, args)) ?? null });
		} catch (err) {
			return new Response(err instanceof Error ? err.message : String(err), { status: 404 });
		}
	}
	if (url.pathname === "/sync/diag/health" && req.method === "GET") {
		const director = await getAgentByName(env.Director as DurableObjectNamespace<Director>, "main");
		return Response.json(await director.health());
	}
	if (url.pathname === "/sync/diag/budget" && req.method === "GET") {
		const director = await getAgentByName(env.Director as DurableObjectNamespace<Director>, "main");
		return new Response(await director.budgetReport());
	}
	const git = /^\/sync\/git\/([\w-]+)$/.exec(url.pathname);
	if (git && req.method === "PUT") {
		if (!isDevRepo(git[1]!)) return new Response("not found", { status: 404 });
		const { commits, heads } = (await req.json()) as { commits: Commit[]; heads?: Head[] };
		await repos(env).gitUpload(git[1]!, commits, heads);
		return Response.json({ ok: true, commits: commits.length });
	}
	if (url.pathname.startsWith("/sync/")) return repoSync(req, env, url.pathname);
	if (req.method !== "GET") return new Response("not found", { status: 404 });
	if (url.pathname === "/library/skills") {
		const director = await getAgentByName(env.Director as DurableObjectNamespace<Director>, "main");
		return Response.json({ skills: await director.exportSkills() });
	}
	const pages = url.pathname.endsWith("pages");
	const n = Number(url.searchParams.get(pages ? "since" : "after") ?? 0);
	if (!Number.isSafeInteger(n) || n < 0) return new Response("bad cursor", { status: 400 });
	const lib = library(env);
	if (url.pathname === "/library/private") return Response.json({ reports: await lib.privateAfter(n) });
	if (url.pathname === "/library/private-pages") return Response.json({ pages: await lib.pagesSince(n, "private") });
	return Response.json(pages ? { pages: await lib.pagesSince(n) } : { reports: await lib.after(n, 50) });
}
