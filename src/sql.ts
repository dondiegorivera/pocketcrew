// The one SQL shape the stores here are written against, so the same store runs on a Durable Object's SQLite and,
// in tests, on node:sqlite (see test-sql.ts).

export type SqlValue = string | number | null;
export type Sql = <T = Record<string, SqlValue>>(query: string, ...params: SqlValue[]) => T[];

export const storageSql =
	(storage: DurableObjectStorage): Sql =>
	<T>(query: string, ...params: SqlValue[]) =>
		storage.sql.exec(query, ...params).toArray() as T[];
