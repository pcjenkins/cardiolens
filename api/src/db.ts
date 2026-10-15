import pg from "pg";
import { config } from "./config.ts";

// int8 (bigint) and numeric come back as strings by default; these values fit safely in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);          // keep calendar dates as 'YYYY-MM-DD', no timezone shift

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,              // a runaway report query can't hold a connection forever
  options: `-c search_path=${config.schema},public`,
});

/** Parameterised query only: values always travel as $1, $2..., never concatenated into SQL. */
export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query<T>(sql, params);
  return res.rows;
}

export async function queryOne<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}
