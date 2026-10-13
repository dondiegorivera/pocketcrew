// The `reports` Worker (deployed from sites/reports): published pages, behind Cloudflare Access, for the phone.
// It only reads: pages come from the Library object of the main Worker. Nothing here is reachable without Access.
import { accessEmail } from "./access.ts";
import type { Library } from "./library-object.ts";
import { PAGE_HEADERS, renderIndex } from "./pages.ts";

type SiteEnv = {
	Library: DurableObjectNamespace<Library>;
	/** `<team>.cloudflareaccess.com`, and the Access application's audience tag. Empty until Access is set up. */
	ACCESS_TEAM_DOMAIN: string;
	ACCESS_AUD: string;
};

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow" } });

export default {
	async fetch(req, env, ctx) {
		const { pathname } = new URL(req.url);
		if (pathname === "/robots.txt") return text("User-agent: *\nDisallow: /\n", 200);
		if (req.method !== "GET") return text("not found", 404);
		if (!env.ACCESS_AUD) return text("This site opens once Cloudflare Access protects it.", 403);
		if (!(await accessEmail(req, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD))) return text("Sign in through Cloudflare Access.", 403);

		const library = env.Library.get(env.Library.idFromName("main"));
		// The operator sees every page, private ones included.
		if (pathname === "/") return new Response(renderIndex(await library.listPages(true)), { headers: PAGE_HEADERS });
		const path = decodeURIComponent(pathname.slice(1));
		const page = await library.getPage(path, true);
		if (!page) return text("No such page.", 404);
		ctx.waitUntil(library.pageViewed(path)); // only that it was opened, for the weekly "nobody reads this" question
		return new Response(page.html, { headers: PAGE_HEADERS });
	},
} satisfies ExportedHandler<SiteEnv>;
