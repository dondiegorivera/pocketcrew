// Google for the operator: Mail (triage, labels, filters, drafts), Calendar, and Clerk, the private desk across mail,
// Drive, Docs and Sheets; in Telegram, "📬 Needs you", /inbox, /google and /docs, and today's calendar in the briefing.
// Every request goes through core's connector and allow-list (src/google/): no token reaches an agent or this plugin.
import { definePlugin } from "../../src/plugin.ts";
import { secret } from "../../src/secrets.ts";
import { GoogleDesk } from "./desk.ts";
import { Inbox } from "./inbox.ts";

export default definePlugin<GoogleDesk>({
	name: "google",
	about: "Mail, Calendar and a private desk for Drive, Docs and Sheets, through core's checked Google connector.",
	agents: {
		mail: {
			title: "Mail",
			role: "specialist",
			does: "the operator's Gmail: triage new mail with labels, sort out the inbox by archiving (never deletes), standing filters that label or skip the inbox, find and summarise mail, write reply drafts (never sends)",
			model: "claude-haiku-5-5",
			effort: "medium",
			tools: ["gmail_search", "gmail_read", "gmail_label", "gmail_archive", "gmail_restore", "gmail_labels", "gmail_label_create", "gmail_label_rename", "gmail_relabel", "gmail_filters", "gmail_filter_create", "gmail_draft", "gmail_update_draft", "publish_page", "read_skill"],
			mcp: [],
			share: 0.1,
			parallelJobs: 1,
			searchesPerJob: 0,
		},
		calendar: {
			title: "Calendar",
			role: "specialist",
			does: "the operator's Google Calendar: add and move events, find free time, spot clashes (no guests, no deleting)",
			model: "claude-haiku-5-5",
			effort: "medium",
			tools: ["calendar_list", "calendar_create", "calendar_update", "publish_page", "read_skill"],
			mcp: [],
			share: 0.06,
			parallelJobs: 1,
			searchesPerJob: 0,
		},
		clerk: {
			title: "Clerk",
			role: "specialist",
			does: "the private desk: work across Gmail, Google Docs and Sheets and the calendar together, such as the tax advisor's pack (labels the mail it uses, builds the Sheet and Doc, drafts the cover email) and cross-checking mail against documents or earlier private results",
			model: "claude-haiku-5-5",
			effort: "medium",
			tools: [
				"gmail_search", "gmail_read", "gmail_attachment", "gmail_label", "gmail_draft",
				"drive_search", "drive_read", "docs_create", "docs_append", "docs_replace", "docs_read", "sheets_create", "sheets_append", "sheets_update", "sheets_add_tab", "sheets_read",
				"calendar_list", "publish_page", "read_skill",
			],
			mcp: [],
			share: 0.07,
			parallelJobs: 1,
			searchesPerJob: 0,
		},
	},
	tools: {
		gmail_search: { kit: "gmail", risks: ["private", "untrusted"] },
		gmail_read: { kit: "gmail", risks: ["private", "untrusted"] },
		gmail_attachment: { kit: "gmail", risks: ["private", "untrusted"] },
		gmail_label: { kit: "gmail", risks: ["private"] },
		gmail_archive: { kit: "gmail", risks: ["private"] }, // out of the inbox, never deleted; labelled for undo
		gmail_restore: { kit: "gmail", risks: ["private"] },
		gmail_labels: { kit: "gmail", risks: ["private"] },
		gmail_label_create: { kit: "gmail", risks: ["private"] }, // the operator's own label system; never deletes one
		gmail_label_rename: { kit: "gmail", risks: ["private"] },
		gmail_relabel: { kit: "gmail", risks: ["private"] }, // bulk moves between labels; undone the same way
		gmail_filters: { kit: "gmail", risks: ["private"] },
		gmail_filter_create: { kit: "gmail", risks: ["private"] }, // standing rule: fleet labels and skip-inbox only (allow.ts)
		gmail_draft: { kit: "gmail", risks: ["private"] },
		gmail_update_draft: { kit: "gmail", risks: ["private"] },
		calendar_list: { kit: "calendar", risks: ["private", "untrusted"] },
		calendar_create: { kit: "calendar", risks: ["private"] },
		calendar_update: { kit: "calendar", risks: ["private"] },
		drive_search: { kit: "docs", risks: ["private"] }, // the operator's Drive, names and dates; read-only
		drive_read: { kit: "docs", risks: ["private", "untrusted"] }, // files may come from others; read by Claude like attachments
		docs_create: { kit: "docs", risks: ["private"] },
		docs_append: { kit: "docs", risks: ["private"] },
		docs_replace: { kit: "docs", risks: ["private"] },
		docs_read: { kit: "docs", risks: ["private", "untrusted"] },
		sheets_create: { kit: "docs", risks: ["private"] },
		sheets_append: { kit: "docs", risks: ["private"] },
		sheets_update: { kit: "docs", risks: ["private"] },
		sheets_add_tab: { kit: "docs", risks: ["private"] },
		sheets_read: { kit: "docs", risks: ["private", "untrusted"] },
	},
	kits: {
		gmail: async (h) => (await import("./kits/gmail.ts")).gmailKit(h.google, h.agent, () => secret(h.env, "ANTHROPIC_API_KEY")),
		calendar: async (h) => (await import("./kits/calendar.ts")).calendarKit(h.google, h.agent),
		docs: async (h) => (await import("./kits/docs.ts")).docsKit(h.google, h.agent, () => secret(h.env, "ANTHROPIC_API_KEY")),
	},
	director: (host) => {
		const desk = new GoogleDesk(host);
		new Inbox(host, desk);
		return desk;
	},
	tick: (desk) => desk.watch(),
	help: [
		"/inbox [old]: your inbox mail one at a time, with buttons",
		"/google: the Google sign-in · /google connect · /google disconnect · /google watch on|off: new-mail triage",
		"/docs: your Docs and Sheets the fleet may edit · /docs allow <link> · /docs revoke <link>",
	],
	needs: { secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY"], google: ["gmail", "calendar", "docs"] },
});
