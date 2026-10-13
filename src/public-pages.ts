// The Worker's only public pages: a home page and a privacy policy, which Google requires for an OAuth app in
// production. They describe the system, not its operator: no name, no address.
import { CONFIG } from "./config.ts";

const page = (title: string, body: string) =>
	new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{--bg:#fbfbfa;--fg:#1c1f23;--muted:#5b626c;--link:#2a5db0}
@media (prefers-color-scheme:dark){:root{--bg:#111315;--fg:#e7e9ec;--muted:#9aa3ad;--link:#8fb4f0}}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,-apple-system,sans-serif}
main{max-width:680px;margin:0 auto;padding:32px 16px 56px}h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:2em}a{color:var(--link)}p.muted{color:var(--muted)}
</style></head><body><main>${body}</main></body></html>`,
		{ headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } },
	);

export const homePage = () =>
	page(
		CONFIG.name,
		`<h1>${CONFIG.name}</h1>
<p>${CONFIG.name} is a private assistant system run by one person for their own use. Its agents help that person with research,
their own email (sorting and drafting replies), their own calendar and their own documents. It is controlled from a
private Telegram group.</p>
<p>It is not a public service: there are no accounts to sign up for, and only its operator can sign in.</p>
<p><a href="/privacy">Privacy policy</a></p>`,
	);

export const privacyPage = () =>
	page(
		`${CONFIG.name} privacy policy`,
		`<h1>Privacy policy</h1>
<p class="muted">Last updated 2026-10-10</p>
<p>${CONFIG.name} is used by a single person, its operator, with their own Google account. Nobody else signs in or is served.</p>
<h2>What it accesses</h2>
<p>With the operator's consent through Google's sign-in, ${CONFIG.name} reads and labels the operator's Gmail and writes drafts
there; reads and edits events on the operator's Google Calendar; and creates, reads and edits Google Docs and Sheets in
the operator's Drive. It never sends email, deletes mail or events, or shares files.</p>
<h2>How it is used</h2>
<p>The data is used only to perform the tasks the operator asks for: summaries, labels, reply drafts, calendar entries and
documents for the operator. To do that, the relevant text is processed by the Anthropic API, which runs the AI models.
Data is not sold, not used for advertising, not shared with anyone else, and not used to train models.</p>
<p>The use of information received from Google APIs adheres to the
<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
including the Limited Use requirements.</p>
<h2>Storage and security</h2>
<p>The system runs on Cloudflare. Google sign-in tokens are stored encrypted and are never shown to the AI agents. Work
results stay in the operator's own Google account and private Telegram group.</p>
<h2>Removing access</h2>
<p>Access can be removed at any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>,
which revokes the stored sign-in.</p>
<h2>Contact</h2>
<p>Questions go to the support email shown on the app's Google sign-in screen.</p>`,
	);
