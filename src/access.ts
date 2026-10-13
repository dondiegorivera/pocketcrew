// Cloudflare Access, checked by the Worker itself: Access signs in the operator and adds a signed JWT to every request;
// the site serves a page only when that JWT verifies against the team's keys and names this application. If Access is
// switched off or misconfigured, requests arrive without a valid token and the site stays closed.

type Jwk = JsonWebKey & { kid?: string };
type Claims = { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };

export type CertsFetcher = (teamDomain: string) => Promise<Jwk[]>;

const fetchCerts: CertsFetcher = async (teamDomain) => {
	const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
	if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
	return ((await res.json()) as { keys: Jwk[] }).keys;
};

const cache = new Map<string, Jwk[]>();

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const json = <T>(s: string) => JSON.parse(new TextDecoder().decode(b64url(s))) as T;

/** The signed-in email, or undefined when the request does not carry a valid Access token for this application. */
export async function accessEmail(req: Request, teamDomain: string, aud: string, certs: CertsFetcher = fetchCerts, now = Date.now()): Promise<string | undefined> {
	const token = req.headers.get("cf-access-jwt-assertion");
	if (!token || !teamDomain || !aud) return undefined;
	const [h, p, sig] = token.split(".");
	if (!h || !p || !sig) return undefined;
	try {
		const header = json<{ alg?: string; kid?: string }>(h);
		if (header.alg !== "RS256") return undefined;
		let keys = cache.get(teamDomain);
		if (!keys?.some((k) => k.kid === header.kid)) cache.set(teamDomain, (keys = await certs(teamDomain))); // keys rotate
		const jwk = keys.find((k) => k.kid === header.kid);
		if (!jwk) return undefined;
		const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
		if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`)))) return undefined;
		const claims = json<Claims>(p);
		const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
		const seconds = now / 1000;
		if (!auds.includes(aud) || claims.iss !== `https://${teamDomain}` || !claims.exp || claims.exp < seconds || (claims.nbf ?? 0) > seconds + 60) return undefined;
		return claims.email;
	} catch {
		return undefined;
	}
}
