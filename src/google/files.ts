// The operator's Docs and Sheets the fleet may edit, as plain data: shared by the connector and the Director's /docs.

export type FileKind = "doc" | "sheet";
export type GrantedFile = { id: string; kind: FileKind; title: string; at: number };

export const fileLink = (f: Pick<GrantedFile, "id" | "kind">) => `https://docs.google.com/${f.kind === "doc" ? "document" : "spreadsheets"}/d/${f.id}/edit`;

/** A document or spreadsheet id from its link, or the id itself. */
export const fileId = (linkOrId: string) => /\/(?:document|spreadsheets)\/d\/([A-Za-z0-9_-]+)/.exec(linkOrId)?.[1] ?? linkOrId.trim();
