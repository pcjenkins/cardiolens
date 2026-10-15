// Restores the pre-built demo database from api/db/cardiolens.dump (seconds, versus ~2 minutes for db:reset).
// Needs pg_restore on the PATH (Postgres.app and Homebrew both provide it).
// The data was generated on the dump date; run `npm run db:reset` to regenerate it relative to today.
import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { initEnv } from "./init-env.ts";
import { REPO_ROOT } from "../src/config.ts";

initEnv();
const url = process.env.DATABASE_URL!;
const dump = path.join(REPO_ROOT, "api", "db", "cardiolens.dump");

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public");
await client.query("DROP SCHEMA IF EXISTS cardiolens CASCADE");
await client.query(`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path = cardiolens, public', current_database()); END $$`);
await client.end();

console.log(`Restoring ${path.relative(process.cwd(), dump)} ...`);
const r = spawnSync("pg_restore", ["--no-owner", "--no-privileges", "--jobs=4", "-d", url, dump], { stdio: "inherit" });
if (r.error) { console.error("pg_restore not found. Add Postgres's bin folder to your PATH (see README)."); process.exit(1); }
if (r.status !== 0) process.exit(r.status ?? 1);
console.log("Restored. Logins: demo@cardiolens.test / Demo123!  and  admin@cardiolens.test / Admin123!");
