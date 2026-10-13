// The research library's Durable Object ("main"): filed reports, published pages, and the private archive (vault.ts)
// that no agent reads. The server's git sync reads all three through sync-export.ts; the `reports` Worker (site.ts)
// reads pages from here too.
import { DurableObject } from "cloudflare:workers";
import { type LibraryApi, LibraryStore, type NewReport, type Report } from "./library.ts";
import { type Page, type PageInfo, type PageInput, type PagesApi, PagesStore } from "./pages.ts";
import { storageSql } from "./sql.ts";
import { VaultStore } from "./vault.ts";

export class Library extends DurableObject<Env> implements LibraryApi, PagesApi {
	private readonly reports: LibraryStore;
	private readonly pages: PagesStore;
	private readonly vault: VaultStore;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const sql = storageSql(ctx.storage);
		this.reports = new LibraryStore(sql);
		this.pages = new PagesStore(sql);
		this.vault = new VaultStore(sql);
	}

	async add(report: NewReport) {
		return this.reports.add(report);
	}
	async search(query: string, limit?: number) {
		return this.reports.search(query, limit);
	}
	async read(id: number, from?: number) {
		return this.reports.read(id, from);
	}
	async after(id: number, limit?: number): Promise<Report[]> {
		return this.reports.after(id, limit);
	}

	async putPage(page: PageInput) {
		this.pages.put(page);
	}
	async getPage(path: string, withPrivate: boolean): Promise<Page | undefined> {
		return this.pages.get(path, withPrivate);
	}
	async listPages(withPrivate: boolean): Promise<PageInfo[]> {
		return this.pages.list(withPrivate);
	}
	async pageViewed(path: string) {
		this.pages.viewed(path);
	}
	async pagesOpened(paths: string[]): Promise<string[]> {
		return this.pages.opened(paths);
	}
	async pagesSince(ms: number, which: "public" | "private" = "public"): Promise<Page[]> {
		return this.pages.since(ms, which);
	}

	/** Reports of agents holding private data: kept for the server-only archive, never searchable. */
	async archivePrivate(report: NewReport) {
		return this.vault.add(report);
	}
	async privateAfter(id: number): Promise<Report[]> {
		return this.vault.after(id);
	}

	/** A finished job's full report, from the library or the private archive: the input of a job chained to it. */
	async jobReport(job: number): Promise<Report | undefined> {
		return this.reports.byJob(job) ?? this.vault.byJob(job);
	}
}

export const library = (env: Env) => env.Library.get(env.Library.idFromName("main"));
