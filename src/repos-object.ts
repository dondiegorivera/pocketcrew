// The repo views' Durable Object ("main"): hosts the RepoStore for the repo tools, the GitStore for the git feed,
// and both sides of the server's sync.
import { DurableObject } from "cloudflare:workers";
import { type Commit, type GitApi, GitStore, type Head } from "./git-feed.ts";
import { type PendingWrite, type RepoApi, RepoStore, type WriteMode, type WriteResult } from "./repos.ts";
import { storageSql } from "./sql.ts";

export class Repos extends DurableObject<Env> implements RepoApi, GitApi {
	private readonly store: RepoStore;
	private readonly git: GitStore;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const sql = storageSql(ctx.storage);
		this.store = new RepoStore(sql);
		this.git = new GitStore(sql);
	}

	async gitRepos() {
		return this.git.repos();
	}
	async gitLog(repo: string, o: Parameters<GitStore["log"]>[1]) {
		return this.git.log(repo, o);
	}
	async gitShow(repo: string, sha: string) {
		return this.git.show(repo, sha);
	}
	async gitBranches(repo: string, days?: number) {
		return this.git.branches(repo, days);
	}
	async gitUpload(repo: string, commits: Commit[], heads?: Head[]) {
		this.git.upload(repo, commits, heads);
	}

	async files(view: string, dir?: string) {
		return this.store.files(view, dir);
	}
	async read(view: string, path: string, from?: number) {
		return this.store.read(view, path, from);
	}
	async grep(view: string, pattern: string, glob?: string) {
		return this.store.grep(view, pattern, glob);
	}
	async queueWrite(key: string, agent: string, view: string, path: string, mode: WriteMode, content: string, note: string) {
		return this.store.queueWrite(key, agent, view, path, mode, content, note);
	}

	// For the sync
	async upload(view: string, files: Record<string, string>, revision: string) {
		this.store.replace(view, files, revision);
	}
	async pending(view: string): Promise<PendingWrite[]> {
		return this.store.pending(view);
	}
	async ack(results: WriteResult[]) {
		return this.store.ack(results);
	}
}

export const repos = (env: Env) => env.Repos.get(env.Repos.idFromName("main"));
