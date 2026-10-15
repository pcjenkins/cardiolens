// Container start-up: seeds the database only if the schema isn't there yet, so restarts keep data.
import pg from "pg";
import { config } from "../src/config.ts";

for (let attempt = 1; ; attempt++) {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  try {
    await client.connect();
    const { rows } = await client.query("SELECT to_regclass('cardiolens.surgical_case') AS t");
    await client.end();
    if (rows[0].t) { console.log("Database already seeded."); process.exit(0); }
    console.log("Empty database: seeding demo data...");
    await import("./reset.ts");
    break;
  } catch (e: any) {
    await client.end().catch(() => {});
    if (attempt >= 30) throw e;
    console.log(`Waiting for Postgres (${e.code ?? e.message})...`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
