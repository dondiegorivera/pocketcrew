// The developer's check of the analytics token (POST /sync/plugin/ops/sites): what it reaches, never the token itself.
import { isSet } from "../../src/secrets.ts";
import { capabilities, listZones } from "./sites.ts";

/** For the harness developer on the server: whether the analytics token works and what it reaches. */
export async function sitesDiagnosis(token: string) {
	if (!isSet(token)) return { set: false };
	const get = async (path: string) => {
		const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { authorization: `Bearer ${token}` } });
		const json = (await res.json()) as { success?: boolean; result?: unknown; errors?: { code: number; message: string }[] };
		return { http: res.status, success: json.success, errors: json.errors?.map((e) => `${e.code} ${e.message}`), result: json.result };
	};
	const verify = await get("/user/tokens/verify");
	const accounts = await get("/accounts?per_page=50");
	const zones = await listZones(token).catch((e: Error) => `error: ${e.message}`);
	return {
		set: true,
		length: token.length,
		verify: { ...verify, result: (verify.result as { status?: string } | undefined)?.status },
		accounts: { ...accounts, result: Array.isArray(accounts.result) ? accounts.result.map((a: { name: string }) => a.name) : undefined },
		zones: typeof zones === "string" ? zones : zones.length,
		capabilities: typeof zones === "string" || !zones.length ? [] : await capabilities(token, zones),
	};
}
