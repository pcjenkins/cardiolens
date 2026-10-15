# CardioLens

A case-analytics app for cardiac surgery perfusion data: per-second device data from the heart-lung machine and patient monitor, the location and device hierarchy behind it, maintenance schedules, and the reports clinicians use for quality review. Everything in it is made up: the health system, hospitals, staff, patients, devices and the 7 million samples.

It runs as a four-tier stack:

```
Browser ──► Next.js (App Router)  ──GraphQL──►  Express + Apollo Server  ──SQL──►  PostgreSQL
            tier 2: UI, sessions,                tier 3: business rules,           tier 4: schema, time-sharded raw data,
            server components,                   authorization per field,          maintained aggregates, SQL functions
            server actions                       DataLoader batching
```

The browser only ever talks to Next.js. Next.js is the GraphQL client, from its server components and server actions; it holds no database driver and never sees a password hash. The data service owns the rules, and Postgres owns the data and the logic that belongs next to it (ingest, rollups, phase statistics, episode detection, the JSON case report).

## Running it (macOS)

You need **Node.js 22+** and **PostgreSQL 16+**. [Postgres.app](https://postgresapp.com) is the easiest; put its tools on your PATH once:

```bash
sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
```

Then, in a new terminal:

```bash
psql -c "CREATE ROLE cardiolens LOGIN PASSWORD 'cardiolens';"
createdb -O cardiolens cardiolens

npm install            # web + API packages (the API installs via postinstall)
npm run db:reset       # build the schema and generate the data (~2 minutes)
                       #   or: npm run db:restore   load a pre-built dump, if you have api/db/cardiolens.dump
npm run stack          # API on :4000 and web on :3000, together
```

Open http://localhost:3000.

* `demo@cardiolens.test` / `Demo123!` (clinician)
* `admin@cardiolens.test` / `Admin123!` (admin; also sees Admin)

`.env.local` is created on first run with a random session secret and service key. The API's Apollo Sandbox is at http://127.0.0.1:4000/graphql in development; its requests need an `Authorization: Bearer <session cookie value>` header.

| Command | What it does |
| --- | --- |
| `npm run stack` | API + web in dev mode, hot reload |
| `npm run db:reset` | Drop and rebuild the `cardiolens` schema and generate the data. `SEED_CAPTURED_CASES=all` captures every case (~30M rows) |
| `npm run db:restore` | Restore a pre-built `api/db/cardiolens.dump` (not committed; data as of the dump date) |
| `npm run build` / `npm run start:stack` | Test-gated production build, then run it |
| `npm run test:all` | API tests (node:test, against the database) + web tests (Jest + RTL) |

Windows: `setup.bat`, `dev.bat`, `start.bat`, `release.bat`, `test.bat` do the same.

Docker: `docker compose up --build` runs Postgres, the API and the web app, with only the web port published. Put `SESSION_SECRET` and `SERVICE_KEY` in `.env` first (see `docker-compose.yml`). The compose files were written for this version but not run here; the native setup above is the tested path.

## The data model

`api/db/schema.sql`: 40 tables in six groups (plus the monthly partitions). **[docs/ERD.md](docs/ERD.md)** has the entity-relationship diagrams, an overview plus one per group, generated from the live schema by `npm run db:erd`.

* **Organisation hierarchy:** health system › facility › location › room. `location` references itself, so buildings, floors, suites and units nest to any depth; `v_location_path` walks it with a recursive CTE.
* **Clinical:** patient › encounter › surgical case, with staff roles, milestone events (CPB on/off, cross-clamp, cardioplegia, rewarm…), point-of-care labs, transfusions and disposables with lot numbers. Body surface area is a generated column.
* **Devices and provenance:** manufacturer › device model › device › modules (sensor hub, Hb/SO2 sensors, gas blender, ventilation diagnostics, pump drive), with firmware, software install history, and `device_assignment`, which records where each device was and when. An **exclusion constraint** (`EXCLUDE USING gist (device_id WITH =, during WITH &&)`) makes it impossible for a device to be in two rooms at once.
* **Maintenance:** plans per model, triggered by time, running hours, or whichever comes first; tasks; work orders with per-task results; `v_maintenance_status` computes current / due soon / in grace / overdue.
* **Capture:** a `recording_session` is one device's stream for one case, and freezes provenance at capture time: software version, clock offset, gateway, and whether the device's maintenance was current. Alarms (limit in effect, acknowledgement time), setting changes and emboli detections hang off the session.
* **Raw data and aggregates:** below.

### Raw samples and time shards

`raw_sample` is one row per channel per sample: 22 channels at 1 Hz (pressures, flows, temperatures, SaO2/SvO2/Hb, gases, and device-calculated indices such as DO2i). Each sample carries a quality flag (valid, artifact, sensor off, line flush), so a line flush is a gap in the chart, not a spike in the average. The table is **range-partitioned by month**, with a BRIN index per partition; an old month can be detached and archived without a bulk delete. The bubble detector's 2,500 Hz signal is stored as detected events, not as samples.

### Maintained aggregates

`agg_minute`, `agg_hour` and `agg_day` store **mergeable** statistics per bucket: count, sum, sum of squares, min/max (and when), first/last, and seconds below/above the channel's limits. Averages and standard deviations combine exactly, so an hour is built from its minutes and a day from its hours, never from raw data again.

* `ingest_samples()` writes a batch and folds it into the minute buckets **in the same statement** (`INSERT … ON CONFLICT DO NOTHING RETURNING` → aggregate only what was inserted → upsert). That makes ingest idempotent: resending a batch changes nothing.
* Touched hours and days are queued in `agg_dirty`; `rollup_dirty()` drains the queue. It is safe to run any number of times.
* The seed goes through this same path. The tests prove every grain reconciles exactly to the raw count.

Percentiles can't be merged, so `refresh_case_phase()` computes per-phase statistics (pre-bypass, bypass, full-flow, cross-clamp, rewarming, post-bypass) once per case, including exact `percentile_cont` medians.

### SQL worth looking at

| Where | What |
| --- | --- |
| `functions.sql` `ingest_samples` | Data-modifying CTE chain: insert, aggregate the inserted rows, upsert with merge logic, queue parents |
| `functions.sql` `threshold_episodes` | Gaps and islands: continuous runs of DO2i < 280 or MAP < 50, using `index − row_number()` |
| `functions.sql` `refresh_session_maintenance` | `LATERAL` "last passing work order before this session" per plan, rolled up with `bool_and` |
| `views.sql` `v_case` | Milestone pivot with `FILTER`, several `LATERAL` joins, legacy JSONB fallback |
| `views.sql` `case_report` | The whole case as one JSON document built in the database (`jsonb_build_object` / `jsonb_agg`) |
| `api/src/resolvers.ts` `series` | `generate_series` gap-filled grid + `date_bin` re-binning of the aggregates |
| `api/src/resolvers.ts` `perfusionQuality` | `percentile_cont … FILTER` per perfusionist from the phase aggregates |

## The data

The seed simulates each case second by second from the physiology: oxygen content and delivery (CaO2, DO2i), temperature-dependent oxygen demand, venous saturation from the O2 balance, hemodilution and transfusion, cooling and rewarming, CO2 removal against sweep gas, hypotensive episodes, line flushes, sensor artifacts and emboli. Perfusionists differ in style, which shows up in the goal-directed perfusion table on the dashboard.

The 40 most recent cases have full per-second capture. Older cases are "legacy imports": a case-level summary migrated from an earlier system, with no waveforms. That is the realistic situation after a platform migration, and the UI handles both.

## The GraphQL API

`api/src/schema.graphql` is the contract. Highlights:

* `case.series(channels, from, to, resolution, maxPoints)` picks raw seconds, or minute/hour/day aggregates re-binned to fit, so a chart never pulls more points than it can draw. An explicit `RAW` request that would exceed the budget is refused rather than truncated.
* `case.quality`, `room.devices`, `location.rooms` and the rest are resolved through per-request **DataLoaders**: a list of 100 cases asking for quality costs one query, not 100.
* `case.report` returns the database-built JSON document; `disposableRecall(lot)` answers "which cases used this oxygenator lot".

```graphql
{
  case(id: 262) {
    procedure
    quality { do2iNadir pctTimeDo2iBelowTarget svo2Nadir }
    series(channels: ["DO2I", "MAP"], resolution: AUTO) { resolution stepSeconds channels { points { t avg min max } } }
    sessions { device { assetTag } softwareVersion maintenanceOk maintenanceNote }
  }
}
```

## Security

* **Sessions** are a signed JWT in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production).
* **Auth is checked at every tier.** `proxy.ts` turns anonymous requests away early, every page re-verifies the session (`lib/dal.ts`), and the API verifies the forwarded token and authorizes in each resolver. Admin data is checked by role in both tiers.
* **Login** goes web tier → API `authenticate` mutation, which only accepts calls carrying the service key (compared in constant time). A wrong password and an unknown email produce the same message and the same timing.
* **GraphQL hardening:** query depth limit (validated before execution), point budgets on series, introspection and the sandbox off in production, unexpected errors masked to the client and logged on the server, a per-statement timeout on the database pool.
* **Input:** zod on login; channel codes, procedures and IDs checked against allow-lists; LIKE wildcards escaped; SQL uses `$n` parameters only.
* **Redirects** after login only go to local paths (`lib/safe-redirect.ts`, with tests for each bypass).
* **Network:** the API binds to 127.0.0.1 by default; in Docker only the web port is published.

## Tests

* **API (node:test, 20 tests):** physiology formulas, the series planner, the depth limit, simulator determinism and quality flags, alarm detection; then, against the real database inside rolled-back transactions: aggregate reconciliation at every grain, idempotent ingest with a minute split across batches, the exclusion constraint, episodes, maintenance-at-capture, the JSON report, and GraphQL auth, admin-only fields, point budgets and DataLoader batching.
* **Web (Jest + React Testing Library, 30 tests):** the analytics model, the redirect guard, display helpers (including hostile channel input), the procedure filter and the series controls, with the Next.js router mocked.

`npm run build` runs the web suite first; if a test fails, the build never starts. Results and coverage are written to `data/release/`, and **Admin → Release test results** displays them.

## Known gaps

* No end-to-end browser tests in the repo yet (Playwright against the running stack is next).
* GraphQL result types in the web tier are hand-written; GraphQL Code Generator would derive them from the schema.
* Sessions are stateless JWTs: a role change applies at next sign-in, and sign-out doesn't revoke a copied token before it expires (8 h). Production would use SSO (SAML/OIDC) with short-lived tokens or server-side sessions.
* The phase statistics refresh is per case after capture; a live system would trigger it from the CPB-off event.
* Day buckets are UTC days; facility-local reporting days would bucket in the facility's time zone.
