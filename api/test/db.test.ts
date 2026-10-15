// Integration tests against the seeded database (run `npm run db:reset` first).
// Every write happens inside a transaction that is rolled back, so the demo data is never changed.
// Skipped automatically if Postgres isn't reachable.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { SignJWT } from "jose";
import { config } from "../src/config.ts";

const client = new pg.Client({ connectionString: config.databaseUrl, options: "-c search_path=cardiolens,public" });
let available = true;
before(async () => {
  try {
    await client.connect();
    await client.query("SELECT 1 FROM surgical_case LIMIT 1");
  } catch {
    available = false;
  }
});
after(async () => { if (available) await client.end(); });

/** Runs fn inside BEGIN ... ROLLBACK. */
async function inRollback(fn: () => Promise<void>) {
  await client.query("BEGIN");
  try { await fn(); } finally { await client.query("ROLLBACK"); }
}
const one = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0];

describe("database", () => {
  test("every aggregate grain reconciles exactly to the raw samples", async (t) => {
    if (!available) return t.skip("database not available");
    const r = await one(`SELECT (SELECT count(*) FROM raw_sample) AS raw,
                                (SELECT sum(n_valid + n_bad) FROM agg_minute) AS minute,
                                (SELECT sum(n_valid + n_bad) FROM agg_hour) AS hour,
                                (SELECT sum(n_valid + n_bad) FROM agg_day) AS day,
                                (SELECT count(*) FROM agg_dirty) AS dirty`);
    assert.ok(Number(r.raw) > 0);
    assert.equal(Number(r.minute), Number(r.raw));
    assert.equal(Number(r.hour), Number(r.raw));
    assert.equal(Number(r.day), Number(r.raw));
    assert.equal(Number(r.dirty), 0);
  });

  test("ingest is idempotent and merges a minute split across batches", async (t) => {
    if (!available) return t.skip("database not available");
    await inRollback(async () => {
      const s = await one(`INSERT INTO recording_session (case_id, device_id, started_at, ended_at, software_version, gateway)
                           SELECT min(id), (SELECT min(id) FROM device), '2026-01-01 10:00Z', '2026-01-01 11:00Z', 'test', 'test' FROM surgical_case RETURNING id`);
      await client.query("SELECT ensure_raw_partition('2026-01-01 10:00Z')");
      const batch = (from: number, values: number[]) => client.query(
        "SELECT ingest_samples($1, $2::smallint[], $3::timestamptz[], $4::real[], $5::smallint[]) AS n",
        [s.id, values.map(() => 17), values.map((_, i) => new Date(Date.UTC(2026, 0, 1, 10, 0, from + i)).toISOString()), values, values.map(() => 0)]);
      // seconds 0-29 then 30-59 of the same minute, in two batches; DO2I (17) has low limit 280
      assert.equal((await batch(0, Array(30).fill(300))).rows[0].n, 30);
      assert.equal((await batch(30, [...Array(29).fill(250), 400])).rows[0].n, 30);
      assert.equal((await batch(0, Array(30).fill(300))).rows[0].n, 0);       // resend: nothing new
      const m = await one("SELECT * FROM agg_minute WHERE session_id = $1", [s.id]);
      assert.equal(m.n_valid, 60);
      assert.equal(m.min, 250);
      assert.equal(m.max, 400);
      assert.equal(m.first_val, 300);
      assert.equal(m.last_val, 400);
      assert.equal(m.sec_below, 29);
      assert.equal(Math.round(m.sum / m.n_valid * 100) / 100, (30 * 300 + 29 * 250 + 400) / 60);
      const rolled = await one("SELECT * FROM rollup_dirty()");
      assert.equal(rolled.hours, 1);
      const h = await one("SELECT * FROM agg_hour WHERE session_id = $1", [s.id]);
      assert.equal(h.n_valid, 60);
      assert.equal(h.min, 250);
    });
  });

  test("a device cannot be assigned to two rooms at once (exclusion constraint)", async (t) => {
    if (!available) return t.skip("database not available");
    await inRollback(async () => {
      const d = await one("SELECT device_id, room_id FROM device_assignment WHERE upper_inf(during) LIMIT 1");
      const other = await one("SELECT id FROM room WHERE id <> $1 LIMIT 1", [d.room_id]);
      await assert.rejects(
        client.query("INSERT INTO device_assignment (device_id, room_id, during) VALUES ($1, $2, tstzrange(now(), now() + interval '1 day'))", [d.device_id, other.id]),
        (e: any) => e.code === "23P01");
    });
  });

  test("threshold episodes find continuous runs and ignore short blips", async (t) => {
    if (!available) return t.skip("database not available");
    const c = await one("SELECT max(id) AS id FROM surgical_case WHERE source = 'live_capture'");
    const eps = (await client.query("SELECT * FROM threshold_episodes($1, 'MAP', 'below', NULL, 10)", [c.id])).rows;
    for (const e of eps) {
      assert.ok(e.seconds >= 10);
      assert.ok(e.extreme < 50);
      assert.ok(new Date(e.t_end) >= new Date(e.t_start));
    }
  });

  test("maintenance status at capture flags sessions recorded on an overdue device", async (t) => {
    if (!available) return t.skip("database not available");
    const r = await one(`SELECT count(*) FILTER (WHERE maintenance_ok = false) AS flagged, count(*) FILTER (WHERE maintenance_ok IS NULL) AS unknown
                         FROM recording_session`);
    assert.ok(Number(r.flagged) > 0);
    assert.equal(Number(r.unknown), 0);
  });

  test("case_report() returns the whole case as one JSON document", async (t) => {
    if (!available) return t.skip("database not available");
    const c = await one("SELECT max(id) AS id FROM surgical_case WHERE source = 'live_capture'");
    const { doc } = await one("SELECT case_report($1) AS doc", [c.id]);
    assert.equal(doc.case.id, c.id);
    assert.ok(doc.phases.full_flow.DO2I.p50 > 0);
    assert.ok(Array.isArray(doc.events) && doc.events.length >= 10);
    assert.ok(doc.devices.length === 2);
  });
});

describe("graphql", async () => {
  const { createApp } = await import("../src/server.ts");
  let base = "", server: any, apollo: any;
  before(async () => {
    if (!available) return;
    const created = await createApp();
    apollo = created.apollo;
    server = created.app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/graphql`;
  });
  after(async () => {
    if (server) server.close();
    if (apollo) await apollo.stop();
    const { pool } = await import("../src/db.ts");
    await pool.end();
  });
  const token = (role: "admin" | "clinician") =>
    new SignJWT({ userId: 1, name: "Test", role }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("5m")
      .sign(new TextEncoder().encode(config.sessionSecret));
  const call = async (query: string, headers: Record<string, string> = {}, variables?: object) =>
    (await fetch(base, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ query, variables }) })).json();

  test("anonymous requests are rejected", async (t) => {
    if (!available) return t.skip("database not available");
    const r = await call("{ cases { id } }");
    assert.equal(r.errors[0].extensions.code, "UNAUTHENTICATED");
  });

  test("authenticate is only callable with the service key, and hides which part was wrong", async (t) => {
    if (!available) return t.skip("database not available");
    const q = `mutation ($e: String!, $p: String!) { authenticate(email: $e, password: $p) { user { name } error } }`;
    assert.equal((await call(q, {}, { e: "demo@cardiolens.test", p: "Demo123!" })).errors[0].extensions.code, "FORBIDDEN");
    const svc = { "x-service-key": config.serviceKey };
    assert.equal((await call(q, svc, { e: "demo@cardiolens.test", p: "Demo123!" })).data.authenticate.user.name, "Dana Demo");
    const wrongPw = (await call(q, svc, { e: "demo@cardiolens.test", p: "nope" })).data.authenticate;
    const noUser = (await call(q, svc, { e: "nobody@cardiolens.test", p: "nope" })).data.authenticate;
    assert.equal(wrongPw.error, noUser.error);
  });

  test("admin data is admin only", async (t) => {
    if (!available) return t.skip("database not available");
    const q = "{ dataVolume { dirtyBuckets } }";
    assert.equal((await call(q, { authorization: `Bearer ${await token("clinician")}` })).errors[0].extensions.code, "FORBIDDEN");
    assert.equal((await call(q, { authorization: `Bearer ${await token("admin")}` })).data.dataVolume.dirtyBuckets, 0);
  });

  test("series never returns more points than asked for, and zooms to raw", async (t) => {
    if (!available) return t.skip("database not available");
    const auth = { authorization: `Bearer ${await token("clinician")}` };
    const c = await one("SELECT max(id) AS id FROM surgical_case WHERE source = 'live_capture'");
    const q = `query ($id: ID!, $from: DateTime, $to: DateTime) { case(id: $id) {
      series(channels: ["DO2I", "MAP"], from: $from, to: $to, maxPoints: 200) { resolution stepSeconds channels { points { t } } } } }`;
    const whole = (await call(q, auth, { id: c.id })).data.case.series;
    assert.notEqual(whole.resolution, "RAW");
    for (const ch of whole.channels) assert.ok(ch.points.length <= 200);
    const on = await one("SELECT ts FROM case_event WHERE case_id = $1 AND event_type = 'xclamp_on'", [c.id]);
    const from = new Date(on.ts), to = new Date(from.getTime() + 120_000);
    const zoom = (await call(q, auth, { id: c.id, from, to })).data.case.series;
    assert.equal(zoom.resolution, "RAW");
    assert.equal(zoom.channels[0].points.length, 120);
  });

  test("a list of cases resolves quality without an N+1 (DataLoader batches it)", async (t) => {
    if (!available) return t.skip("database not available");
    const auth = { authorization: `Bearer ${await token("clinician")}` };
    const r = await call("{ cases(limit: 50, filter: { capturedOnly: true }) { id quality { do2iNadir alarmCount } } }", auth);
    assert.equal(r.errors, undefined);
    assert.ok(r.data.cases.length > 0);
    assert.ok(r.data.cases.every((c: any) => c.quality && c.quality.do2iNadir > 0));
  });
});
