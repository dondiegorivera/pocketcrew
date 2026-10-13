// The only Google API requests the connector makes. Everything else is refused before a token is attached, so the
// guarantees hold even if a tool were written wrong: no sending, no trash, spam or delete; archiving only together
// with one of the fleet's labels, so everything it moved out of the inbox can be found and moved back; the importance
// marker may be set or cleared; labels, the operator's own included, may be created and renamed but never deleted;
// standing filters only label (and may skip the inbox with a label, or set importance), never forward, and are never
// deleted by the fleet; calendar
// changes never notify guests; and documents and sheets are edited only if the fleet made them or the operator allowed
// that one file (/docs allow), and then only by inserting or replacing text, writing cells and adding tabs; Drive files
// are found and read, never changed.

import { CONFIG } from "../config.ts";
import { baseName, isAgentName, specOf } from "../fleet.ts";
import { TOOLS } from "../tools.ts";

export type Family = "gmail" | "calendar" | "docs";
/** `binary`: the answer is a file; the connector returns it base64url-encoded. */
export type ApiRequest = { method: "GET" | "POST" | "PUT" | "PATCH"; url: string; body?: unknown; binary?: boolean };
export type Allowed = {
	family: Family;
	/** The URL to call, possibly with sendUpdates=none added. */
	url: string;
	/** A document or sheet id that must be one the fleet created or the operator allowed. */
	mustBeEditable?: string;
	/** The response holds a new document's or sheet's id, to remember as created. */
	recordsCreated?: boolean;
};

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DOCS = "https://docs.googleapis.com/v1/documents";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

/** The fleet's Gmail labels live under the instance's name (such as pocketcrew/). */
export const LABEL_PREFIX = `${CONFIG.name}/`;
const ID = "[A-Za-z0-9_-]+";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const at = (base: string, rest: string) => new RegExp(`^${esc(base)}${rest}(\\?.*)?$`);

const userLabel = (id: unknown) => typeof id === "string" && id.startsWith("Label_");
/** Gmail's importance marker: harmless and undone the same way, so the fleet may set and clear it. */
const IMPORTANT = "IMPORTANT";

/**
 * Label changes the fleet may make: its own labels (ids Label_…) and IMPORTANT freely; INBOX only to archive or
 * restore, and an archive (INBOX removed) must add a fleet label in the same request. No TRASH, SPAM or other system labels.
 */
/** Names Gmail keeps for itself; a label the fleet makes or renames never takes one. */
const RESERVED_LABELS = /^(inbox|spam|trash|unread|starred|important|sent|drafts?|chats?|all mail|scheduled|snoozed|category_\w+)$/i;

/**
 * A label the fleet creates or renames: the operator's own labels may be reorganised (created and renamed, never
 * deleted), so only a plain name and its visibility, never a reserved one.
 */
function labelBodyProblem(body: unknown): string | undefined {
	const b = (body ?? {}) as Record<string, unknown>;
	if (Object.keys(b).some((k) => !["name", "labelListVisibility", "messageListVisibility"].includes(k))) return "A label change sets only its name and visibility.";
	const name = b.name;
	if (typeof name !== "string" || !name.trim() || name.length > 225 || /^\/|\/$|\/\//.test(name)) return "A label needs a plain name (slashes only between levels).";
	if (RESERVED_LABELS.test(name.trim())) return `"${name}" is one of Gmail's own labels.`;
	return undefined;
}

function labelChangeProblem(body: unknown): string | undefined {
	const b = (body ?? {}) as { addLabelIds?: unknown[]; removeLabelIds?: unknown[] };
	const add = b.addLabelIds ?? [];
	const remove = b.removeLabelIds ?? [];
	if (![...add, ...remove].every((id) => userLabel(id) || id === "INBOX" || id === IMPORTANT)) return "Only the fleet's own labels, importance and the inbox may change: no trash, spam or other system labels.";
	if (remove.includes("INBOX") && !add.some(userLabel)) return "Archiving needs one of the fleet's labels in the same change, so it can be found and undone.";
	return undefined;
}

/**
 * A standing Gmail filter the fleet may create: its action adds at least one of the fleet's labels (so its filters can be
 * told apart), may mark the mail important or never important, and may skip the inbox (removes INBOX), like an archive.
 * No forwarding, trash, spam or read changes.
 */
function filterProblem(body: unknown): string | undefined {
	const b = (body ?? {}) as { criteria?: unknown; action?: { addLabelIds?: unknown[]; removeLabelIds?: unknown[]; forward?: unknown } };
	if (!b.criteria || typeof b.criteria !== "object" || !Object.keys(b.criteria).length) return "A filter needs criteria.";
	const action = b.action ?? {};
	if (Object.keys(action).some((k) => k !== "addLabelIds" && k !== "removeLabelIds")) return "A fleet filter only adds labels and may skip the inbox: no forwarding.";
	const add = action.addLabelIds ?? [];
	const remove = action.removeLabelIds ?? [];
	if (!add.some(userLabel) || !add.every((id) => userLabel(id) || id === IMPORTANT)) return "A fleet filter adds one of the fleet's labels, and only those or importance.";
	if (!remove.every((id) => id === "INBOX" || id === IMPORTANT)) return "A fleet filter may only skip the inbox or clear importance: no trash, spam or read changes.";
	if (add.includes(IMPORTANT) && remove.includes(IMPORTANT)) return "A filter marks mail important or never important, not both.";
	return undefined;
}

/** The edits a fleet Docs batchUpdate may hold: inserting text and replacing text, nothing that deletes or restructures. */
const DOC_EDITS = new Set(["insertText", "replaceAllText"]);
/** The only structural Sheets change: a new tab. Cells are written through the values API. */
const SHEET_EDITS = new Set(["addSheet"]);

function editsProblem(body: unknown, kinds: Set<string>, what: string): string | undefined {
	const requests = (body as { requests?: unknown })?.requests;
	if (!Array.isArray(requests) || !requests.length) return "No changes given.";
	const ok = requests.every((r) => r && typeof r === "object" && Object.keys(r).length === 1 && kinds.has(Object.keys(r)[0]!));
	return ok ? undefined : `The fleet only ${what}.`;
}

const noGuests = (body: unknown) => !(body && typeof body === "object" && "attendees" in body);

const withNoUpdates = (url: string) => {
	const u = new URL(url);
	u.searchParams.set("sendUpdates", "none");
	return u.href;
};

/** The request as the connector may make it, or why it may not. */
export function allow(r: ApiRequest): Allowed | string {
	const { method, url, body } = r;
	// Gmail
	if (method === "GET" && (at(GMAIL, `/(messages|threads|drafts|labels)(/${ID})?`).test(url) || at(GMAIL, "/(profile|settings/sendAs)").test(url))) return { family: "gmail", url };
	if (method === "POST" && at(GMAIL, "/labels").test(url)) return labelBodyProblem(body) ?? { family: "gmail", url };
	if (method === "PATCH" && at(GMAIL, "/labels/Label_[0-9]+").test(url)) return labelBodyProblem(body) ?? { family: "gmail", url };
	if (method === "POST" && (at(GMAIL, `/messages/${ID}/modify`).test(url) || at(GMAIL, "/messages/batchModify").test(url))) return labelChangeProblem(body) ?? { family: "gmail", url };
	if (method === "GET" && at(GMAIL, `/messages/${ID}/attachments/${ID}`).test(url)) return { family: "gmail", url };
	if (method === "GET" && at(GMAIL, "/settings/filters").test(url)) return { family: "gmail", url };
	if (method === "POST" && at(GMAIL, "/settings/filters").test(url)) return filterProblem(body) ?? { family: "gmail", url };
	if ((method === "POST" && at(GMAIL, "/drafts").test(url)) || (method === "PUT" && at(GMAIL, `/drafts/${ID}`).test(url))) return { family: "gmail", url };
	// Calendar: never a guest list, never an update email
	if (method === "GET" && at(CALENDAR, `(/${ID})?`).test(url)) return { family: "calendar", url };
	if ((method === "POST" && at(CALENDAR, "").test(url)) || (method === "PATCH" && at(CALENDAR, `/${ID}`).test(url)))
		return noGuests(body) ? { family: "calendar", url: withNoUpdates(url) } : "Events with guests are changed by the operator, not the fleet: guests would be notified.";
	// Drive: find and read files (search, metadata, download, export as text); nothing that changes one
	if (method === "GET" && (at(DRIVE, "").test(url) || at(DRIVE, `/${ID}(/export)?`).test(url))) return { family: "docs", url };
	// Docs and Sheets: create, read, and edit only what the fleet created or the operator allowed
	if (method === "POST" && at(DOCS, "").test(url)) return { family: "docs", url, recordsCreated: true };
	if (method === "GET" && at(DOCS, `/${ID}`).test(url)) return { family: "docs", url };
	const docEdit = new RegExp(`^${esc(DOCS)}/(${ID}):batchUpdate$`).exec(url);
	if (method === "POST" && docEdit) return editsProblem(body, DOC_EDITS, "inserts and replaces text in a document") ?? { family: "docs", url, mustBeEditable: docEdit[1] };
	if (method === "POST" && at(SHEETS, "").test(url)) return { family: "docs", url, recordsCreated: true };
	if (method === "GET" && at(SHEETS, `/${ID}`).test(url)) return { family: "docs", url };
	if (method === "GET" && new RegExp(`^${esc(SHEETS)}/${ID}/values/[^/?:]+(\\?.*)?$`).test(url)) return { family: "docs", url };
	const sheetAppend = new RegExp(`^${esc(SHEETS)}/(${ID})/values/[^/?:]+:append(\\?.*)?$`).exec(url);
	if (method === "POST" && sheetAppend) return { family: "docs", url, mustBeEditable: sheetAppend[1] };
	const sheetWrite = new RegExp(`^${esc(SHEETS)}/(${ID})/values/[^/?:]+(\\?.*)?$`).exec(url);
	if (method === "PUT" && sheetWrite) return { family: "docs", url, mustBeEditable: sheetWrite[1] };
	const sheetEdit = new RegExp(`^${esc(SHEETS)}/(${ID}):batchUpdate$`).exec(url);
	if (method === "POST" && sheetEdit) return editsProblem(body, SHEET_EDITS, "adds tabs to a sheet; cells are written one range at a time") ?? { family: "docs", url, mustBeEditable: sheetEdit[1] };
	return `The fleet does not make this Google request: ${method} ${url.split("?")[0]}`;
}

const FAMILIES: Record<string, Family> = { gmail: "gmail", calendar: "calendar", docs: "docs" };

/** The parts of Google an agent's tools reach. The Director lists new mail, today's events and the fleet's drafts, without a model. */
export function familiesOf(agent: string): Set<Family> {
	const name = baseName(agent);
	if (name === "director") return new Set(["gmail", "calendar"]); // the mail watch, the briefing's calendar line and draft count
	if (!isAgentName(name)) return new Set();
	return new Set(specOf(name).tools.flatMap((t) => (FAMILIES[TOOLS[t].kit] ? [FAMILIES[TOOLS[t].kit]!] : [])));
}
