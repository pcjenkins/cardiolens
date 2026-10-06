import "server-only";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

// One connection per server process. SQLite is a single file: data/cardiolens.db
const globalForDb = globalThis as unknown as { db?: DatabaseSync };

// DB_PATH lets Docker keep the database on a volume; locally it defaults to data/cardiolens.db
export const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "cardiolens.db");

export const db = globalForDb.db ?? new DatabaseSync(DB_PATH);

if (process.env.NODE_ENV !== "production") globalForDb.db = db; // survive dev hot-reloads

/** Run a parameterized SELECT and return typed rows. Always use ? placeholders, never string concatenation. */
export function query<T>(sql: string, ...params: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function queryOne<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
