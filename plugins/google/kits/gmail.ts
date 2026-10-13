// The Gmail kit: search, read a thread and its attachments, label with the fleet's own labels, archive and restore,
// standing filters, write drafts, and reorganise the operator's own labels (list, create, rename, move mail between
// them; never delete one). The tools live in gmail/ by area; this assembles them.
// There is no tool that sends, trashes or deletes, and the connector refuses those requests anyway (allow.ts).
// Everything archived carries <name>/archived (allow.ts LABEL_PREFIX), so it can be found and moved back in one step.
import { defineExtension, type Extension } from "@earendil-works/pi-durable";
import type { GoogleApi } from "../../../src/google/connector.ts";
import { draftTools } from "./gmail/drafts.ts";
import { filterTools } from "./gmail/filters.ts";
import { labelTools } from "./gmail/labels.ts";
import { readTools } from "./gmail/read.ts";
import { gmailApi } from "./gmail/shared.ts";

export { ARCHIVED, attachmentParts, failure, labelName } from "./gmail/shared.ts";

export function gmailKit(google: () => Promise<GoogleApi>, agent: string, apiKey?: () => Promise<string>): Extension {
	const api = gmailApi(google, agent);
	const [label, labels, create, rename, relabel, archive, restore] = labelTools(api);
	return defineExtension({
		name: "gmail",
		tools: [...readTools(api, apiKey), label!, labels!, create!, rename!, relabel!, ...filterTools(api), archive!, restore!, ...draftTools(api)],
	});
}
