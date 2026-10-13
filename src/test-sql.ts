// Tests only: an in-memory node:sqlite database behind the same `Sql` shape the Durable Objects use.
import { DatabaseSync } from "node:sqlite";
import type { Sql, SqlValue } from "./sql.ts";

export function memorySql(): Sql {
	const db = new DatabaseSync(":memory:");
	return <T>(query: string, ...params: SqlValue[]) => {
		const statement = db.prepare(query);
		return (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(query) ? statement.all(...params) : (statement.run(...params), [])) as T[];
	};
}
