// Rebuilds the database from scratch: drops and recreates the `cardiolens` schema, loads the DDL,
// functions and views, then generates the demo dataset. Deterministic: same seed, same data
// (dates are relative to today, so the last 26 weeks are always populated).
//
//   npm run db:reset                       default: the 40 most recent cases get full per-second capture
//   SEED_CAPTURED_CASES=all npm run db:reset   every case captured (~30M raw rows, several minutes)

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import bcrypt from "bcryptjs";
import { initEnv } from "./init-env.ts";
import { REPO_ROOT } from "../src/config.ts";
import { CHANNELS } from "../src/seed/channels.ts";
import { createRng } from "../src/seed/random.ts";
import { bsaMosteller } from "../src/seed/physiology.ts";
import { cardioplegiaSchedule, simulateCase, type Stream, type Timeline } from "../src/seed/simulate.ts";
import * as R from "../src/seed/reference.ts";

initEnv();
const DATABASE_URL = process.env.DATABASE_URL!;
const SCHEMA = "cardiolens";
const WEEKS = 26;
const DAY = 86_400_000, MIN = 60_000, HOUR = 3_600_000;
const TZ = "America/New_York";
const capturedSetting = process.env.SEED_CAPTURED_CASES ?? "40";
const WORKERS = Number(process.env.SEED_WORKERS ?? 4);

const rng = createRng(42);
const started = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s] ${msg}`);

// ---------------------------------------------------------------- helpers
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}
/** Local wall-clock time in `tz` -> epoch ms. */
function zoned(y: number, m: number, d: number, hh: number, mm: number, tz = TZ): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - tzOffsetMs(guess - tzOffsetMs(guess, tz), tz);
}
const iso = (ms: number) => new Date(ms).toISOString();
const sqlFile = (name: string) => readFileSync(path.join(REPO_ROOT, "api", "db", name), "utf8");

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
  } catch (e) {
    console.error(`Could not connect to ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}\n` +
      `Is Postgres running, and do the role and database exist? See README "Running it".`);
    throw e;
  }

  // ---------------------------------------------------------------- schema
  log("Rebuilding schema");
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path = ${SCHEMA}, public', current_database()); END $$`);
  await client.query(`SET search_path = ${SCHEMA}, public`);
  for (const f of ["schema.sql", "functions.sql", "views.sql"]) await client.query(sqlFile(f));

  const one = async <T = any>(sql: string, params: unknown[] = []): Promise<T> => (await client.query(sql, params)).rows[0];
  const id = async (sql: string, params: unknown[] = []) => (await one<{ id: number }>(sql + " RETURNING id", params)).id;

  await client.query("BEGIN");

  // ---------------------------------------------------------------- organization
  log("Organization hierarchy, devices, staff");
  const hs = await id("INSERT INTO health_system (name) VALUES ($1)", [R.HEALTH_SYSTEM]);
  const fac: Record<string, { id: number; ors: number[]; storage: number; workshop: number; icu: number }> = {};
  for (const f of R.FACILITIES) {
    const fid = await id("INSERT INTO facility (health_system_id, name, city, state) VALUES ($1,$2,$3,$4)", [hs, f.name, f.city, f.state]);
    const loc = (parent: number | null, kind: string, name: string) =>
      id("INSERT INTO location (facility_id, parent_id, kind, name) VALUES ($1,$2,$3,$4)", [fid, parent, kind, name]);
    const room = (location: number, name: string, kind: string) =>
      id("INSERT INTO room (location_id, name, kind) VALUES ($1,$2,$3)", [location, name, kind]);
    const tower = await loc(null, "building", "Heart Tower");
    const f3 = await loc(tower, "floor", "Floor 3");
    const suite = await loc(f3, "or_suite", "Cardiac OR Suite");
    const f4 = await loc(tower, "floor", "Floor 4");
    const cvicu = await loc(f4, "icu", "CVICU");
    const support = await loc(null, "building", "Support Services");
    const biomed = await loc(support, "biomed", "Clinical Engineering");
    const store = await loc(f3, "storage", "Perfusion Equipment Room");
    const ors: number[] = [];
    for (const name of f.ors) ors.push(await room(suite, name, "operating_room"));
    for (let b = 1; b <= 4; b++) await room(cvicu, `Bay ${b}`, "icu_bay");
    fac[f.key] = { id: fid, ors, storage: await room(store, "Equipment Storage", "storage"), workshop: await room(biomed, "Biomed Workshop", "workshop"), icu: cvicu };
  }

  const maker: Record<string, number> = {};
  for (const m of R.MANUFACTURERS) maker[m] = await id("INSERT INTO manufacturer (name) VALUES ($1)", [m]);
  const model: Record<string, number> = {};
  for (const m of R.DEVICE_MODELS)
    model[m.key] = await id("INSERT INTO device_model (manufacturer_id, name, device_type, udi_di, regulatory_class) VALUES ($1,$2,$3,$4,$5)",
      [maker[m.maker], m.name, m.type, m.udi, m.cls]);
  const moduleModel: Record<string, number> = {};
  const moduleModelByType: Record<string, number> = {};
  for (const m of R.MODULE_MODELS) {
    moduleModel[m.key] = await id("INSERT INTO module_model (manufacturer_id, name, module_type) VALUES ($1,$2,$3)", [maker[m.maker], m.name, m.type]);
    moduleModelByType[m.type] = moduleModel[m.key];
  }
  for (const c of CHANNELS) {
    await client.query(
      `INSERT INTO channel (id, code, name, unit, sample_rate_hz, kind, formula, low_limit, high_limit, decimals)
       VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9)`,
      [c.id, c.code, c.name, c.unit, c.kind, c.formula ?? null, c.low ?? null, c.high ?? null, c.decimals]);
    await client.query("INSERT INTO module_channel VALUES ($1,$2)", [moduleModelByType[c.module], c.id]);
  }

  // timeline anchors
  const now = Date.now();
  const todayParts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(now)).split("-").map(Number);
  const startLocal = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]) - WEEKS * 7 * DAY);
  const START = zoned(startLocal.getUTCFullYear(), startLocal.getUTCMonth() + 1, startLocal.getUTCDate(), 0, 0);
  const HISTORY_START = START - 365 * DAY;

  // devices: one workstation, monitor and heater-cooler per OR, plus a spare workstation in storage
  type Dev = { id: number; facility: string; model: string; tag: string };
  const devices: Dev[] = [];
  const serial = (p: string) => `${p}-${String(rng.int(100000, 999999))}`;
  const firmware: Record<string, string> = { hub: "3.2.1", hbso2: "2.4.0", gas: "1.9.3", vent: "2.1.0", drive: "4.0.2" };
  for (const f of R.FACILITIES) {
    const F = fac[f.key];
    const addDevice = async (modelKey: string, prefix: string, n: number, roomId: number) => {
      const tag = `${prefix}-${f.key}-${String(n).padStart(2, "0")}`;
      const installed = new Date(HISTORY_START - rng.int(30, 400) * DAY).toISOString().slice(0, 10);
      const did = await id("INSERT INTO device (model_id, serial, asset_tag, facility_id, installed_on) VALUES ($1,$2,$3,$4,$5)",
        [model[modelKey], serial(modelKey), tag, F.id, installed]);
      devices.push({ id: did, facility: f.key, model: modelKey, tag });
      // where it lives (the swap below rewrites RB-02's history)
      await client.query("INSERT INTO device_assignment (device_id, room_id, during) VALUES ($1,$2,tstzrange($3::date, NULL))", [did, roomId, installed]);
      if (modelKey === "WS") {
        for (const m of R.WORKSTATION_MODULES)
          await client.query("INSERT INTO device_module (device_id, module_model_id, serial, firmware, position) VALUES ($1,$2,$3,$4,$5)",
            [did, moduleModel[m.key], serial(m.key.toUpperCase()), firmware[m.key], m.position]);
        await client.query("INSERT INTO software_install (device_id, version, installed_at, installed_by) VALUES ($1,'4.1.3',$2::date,'Helix Field Service')", [did, installed]);
        if (f.key === "RB")  // Riverbend upgraded mid-period; Northgate did not
          await client.query("INSERT INTO software_install (device_id, version, installed_at, installed_by) VALUES ($1,'4.2.0',$2,'Riverbend Clinical Engineering')", [did, iso(START + 77 * DAY + n * HOUR)]);
      } else if (modelKey === "MON") {
        await client.query("INSERT INTO device_module (device_id, module_model_id, serial, firmware, position) VALUES ($1,$2,$3,'5.1.0','Slot A')",
          [did, moduleModel.vitals, serial("VLH")]);
        await client.query("INSERT INTO software_install (device_id, version, installed_at, installed_by) VALUES ($1,'2.8.1',$2::date,'Halcyon Service')", [did, installed]);
        await client.query("INSERT INTO software_install (device_id, version, installed_at, installed_by) VALUES ($1,'2.9.0',$2,'Halcyon Service')", [did, iso(START + 120 * DAY + n * HOUR)]);
      } else {
        await client.query("INSERT INTO software_install (device_id, version, installed_at, installed_by) VALUES ($1,'1.4.0',$2::date,'Thermacore Service')", [did, installed]);
      }
      return did;
    };
    for (let k = 0; k < f.ors.length; k++) {
      await addDevice("WS", "PW", k + 1, F.ors[k]);
      await addDevice("MON", "PM", k + 1, F.ors[k]);
      await addDevice("HC", "HC", k + 1, F.ors[k]);
    }
    await addDevice("WS", "PW", f.ors.length + 1, F.storage);   // spare
  }
  const dev = (tag: string) => devices.find((d) => d.tag === tag)!;

  // A failed calibration on PW-RB-02: it goes to the workshop for six days and the spare covers OR 2.
  const swapAt = now - 70 * DAY, swapEnd = swapAt + 6 * DAY;
  const reassign = async (tag: string, segments: { roomId: number; until: number | null }[]) => {
    const d = dev(tag);
    const { lower } = await one<{ lower: Date }>("SELECT lower(during) AS lower FROM device_assignment WHERE device_id = $1", [d.id]);
    await client.query("DELETE FROM device_assignment WHERE device_id = $1", [d.id]);
    let from = lower.getTime();
    for (const s of segments) {
      await client.query("INSERT INTO device_assignment (device_id, room_id, during) VALUES ($1,$2,tstzrange($3,$4))",
        [d.id, s.roomId, iso(from), s.until === null ? null : iso(s.until)]);
      if (s.until !== null) from = s.until;
    }
  };
  await reassign("PW-RB-02", [{ roomId: fac.RB.ors[1], until: swapAt }, { roomId: fac.RB.workshop, until: swapEnd }, { roomId: fac.RB.ors[1], until: null }]);
  await reassign("PW-RB-04", [{ roomId: fac.RB.storage, until: swapAt }, { roomId: fac.RB.ors[1], until: swapEnd }, { roomId: fac.RB.storage, until: null }]);
  // the exclusion constraint guarantees none of this overlaps; prove it by trying
  try {
    await client.query("SAVEPOINT overlap_check");
    await client.query("INSERT INTO device_assignment (device_id, room_id, during) VALUES ($1,$2,tstzrange($3,$4))",
      [dev("PW-RB-02").id, fac.RB.ors[2], iso(swapAt + DAY), iso(swapAt + 2 * DAY)]);
    throw new Error("exclusion constraint did not fire");
  } catch (e: any) {
    if (e.code !== "23P01") throw e;
    await client.query("ROLLBACK TO SAVEPOINT overlap_check");
  }

  // staff
  const staffId = async (name: string, discipline: string) => id("INSERT INTO staff (name, discipline) VALUES ($1,$2)", [name, discipline]);
  const surgeons: number[] = [];
  for (const s of R.SURGEONS) surgeons.push(await staffId(s, "surgeon"));
  const perfusionists = [];
  for (const p of R.PERFUSIONISTS) perfusionists.push({ ...p, id: await staffId(p.name, "perfusionist") });
  const anesthesia: number[] = [];
  for (const a of R.ANESTHESIOLOGISTS) anesthesia.push(await staffId(a, "anesthesiologist"));
  const techs: number[] = [];
  for (const t of R.TECHNICIANS)
    techs.push(await id("INSERT INTO technician (name, company, cert_expires_on) VALUES ($1,$2,$3)", [t.name, t.company, iso(now + rng.int(60, 700) * DAY).slice(0, 10)]));
  for (const u of R.USERS)
    await client.query("INSERT INTO app_user (email, name, role, password_hash) VALUES ($1,$2,$3,$4)", [u.email, u.name, u.role, bcrypt.hashSync(u.password, 10)]);

  // ---------------------------------------------------------------- maintenance
  log("Maintenance plans and work-order history");
  const plans: { id: number; model: string; days?: number; hours?: number; name: string; tasks: number[] }[] = [];
  for (const p of R.MAINTENANCE_PLANS) {
    const pid = await id("INSERT INTO maintenance_plan (device_model_id, name, interval_days, interval_hours, grace_days, regulatory) VALUES ($1,$2,$3,$4,$5,$6)",
      [model[p.model], p.name, "days" in p ? p.days : null, "hours" in p ? p.hours : null, p.grace, p.regulatory]);
    const tasks = [];
    for (const [i, [desc, spec]] of p.tasks.entries())
      tasks.push(await id("INSERT INTO maintenance_task (plan_id, seq, description, spec) VALUES ($1,$2,$3,$4)", [pid, i + 1, desc, spec]));
    plans.push({ id: pid, model: p.model, days: "days" in p ? p.days : undefined, hours: "hours" in p ? p.hours : undefined, name: p.name, tasks });
  }
  const workOrder = async (d: Dev, planId: number | null, completed: number, result: "pass" | "fail" | "repaired", notes?: string, taskIds: number[] = []) => {
    const tech = planId === null || d.model === "WS" && rng.chance(0.3) ? techs[2] : d.facility === "RB" ? techs[0] : techs[1];
    const wo = await id(
      "INSERT INTO work_order (device_id, plan_id, kind, opened_at, completed_at, technician_id, result, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [d.id, planId, planId ? "preventive" : "corrective", iso(completed - rng.int(1, 5) * HOUR), iso(completed), tech, result, notes ?? null]);
    for (const [i, t] of taskIds.entries())
      await client.query("INSERT INTO work_order_task VALUES ($1,$2,$3,$4)", [wo, t, result === "fail" && i === 0 ? "Flow error 4.6% (limit 2%)" : "Within spec", !(result === "fail" && i === 0)]);
  };
  // Deliberate exceptions, so the maintenance screens have something to show.
  const lastDoneOverride: Record<string, number> = {
    "PW-NG-02|Flow and pressure sensor calibration": now - (180 + 14 + 18) * DAY,  // overdue: sessions on it get flagged
    "HC-RB-03|Weekly disinfection": now - 9 * DAY,                                 // overdue, no grace on disinfection
    "PM-RB-01|Annual safety inspection": now - 356 * DAY,                          // due soon
    "PW-RB-02|Flow and pressure sensor calibration": swapEnd,                      // re-calibrated after repair
  };
  for (const d of devices) {
    for (const p of plans.filter((x) => x.model === d.model)) {
      if (p.days) {
        let t = lastDoneOverride[`${d.tag}|${p.name}`] ?? now - Math.floor(rng.next() * p.days * 0.85 * DAY) - HOUR;
        while (t > HISTORY_START) {
          await workOrder(d, p.id, t, "pass", undefined, p.tasks);
          t -= Math.round(p.days * (0.85 + rng.next() * 0.15) * DAY);
        }
      } else {
        for (const ago of [rng.int(20, 60), rng.int(200, 300)]) await workOrder(d, p.id, now - ago * DAY, "pass", undefined, p.tasks);
      }
    }
  }
  const calib = plans.find((p) => p.model === "WS" && p.name.startsWith("Flow and pressure"))!;
  await workOrder(dev("PW-RB-02"), calib.id, swapAt, "fail", "Arterial flow reading 4.6% high against reference. Device removed from service.", calib.tasks);
  await workOrder(dev("PW-RB-02"), null, swapEnd - 2 * HOUR, "repaired", "Replaced sensor hub flow transducer; verified against reference.");
  await client.query("UPDATE device_module SET serial = $2, firmware = '3.2.2' WHERE device_id = $1 AND position = 'Sensor hub'", [dev("PW-RB-02").id, serial("HUB")]);

  // disposables
  const products: { id: number; prefix: string }[] = [];
  for (const d of R.DISPOSABLES)
    products.push({ id: await id("INSERT INTO disposable_product (manufacturer_id, name, kind, udi_di) VALUES ($1,$2,$3,$4)",
      [maker[d.name.startsWith("Helix") ? "Helix Perfusion Systems" : "Meridian Disposables"], d.name, d.kind, d.udi]), prefix: d.prefix });

  // ---------------------------------------------------------------- cases
  log("Patients, encounters and cases");
  const procedures = [{ name: "CABG", bypass: 95, weight: 5 }, { name: "AVR", bypass: 105, weight: 3 }, { name: "MVR", bypass: 120, weight: 2 }, { name: "CABG + AVR", bypass: 150, weight: 1 }];
  const bag = procedures.flatMap((p) => Array(p.weight).fill(p));
  type CaseRow = {
    caseId: number; timeline: Timeline; roomId: number; facility: string; bsa: number; hb: number; lowestTemp: number;
    perfusionist: (typeof perfusionists)[number]; outcome: string; blood: number; index: number;
  };
  const cases: CaseRow[] = [];
  let mrn = 4100000, index = 0;
  for (let day = 0; day < WEEKS * 7; day++) {
    const d = new Date(startLocal.getTime() + day * DAY);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;                       // elective cases only, weekdays
    const perDay = 1 + Math.floor(rng.next() * 3);
    const usedRooms: Record<string, number> = { RB: 0, NG: 0 };
    for (let k = 0; k < perDay; k++) {
      const f = rng.chance(0.62) ? R.FACILITIES[0] : R.FACILITIES[1];
      const slot = usedRooms[f.key]++;
      const roomId = fac[f.key].ors[slot % f.ors.length];
      const second = slot >= f.ors.length;
      const sched = zoned(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), second ? 13 : 7, second ? 0 : 30);

      // case-level outcomes, with the same shape as the original demo (quality program shortens bypass times)
      const p = rng.pick(bag);
      const improvement = (day / (WEEKS * 7)) * 12;
      let bypass = Math.round(rng.normal(p.bypass - improvement, 14));
      if (rng.chance(0.02)) bypass += 80 + rng.int(0, 40);
      bypass = Math.max(55, bypass);
      const blood = Math.max(0, Math.round(rng.normal(bypass > 160 ? 4 : 1.5, 1.2)));
      const los = Math.max(3, Math.round(rng.normal(bypass > 160 ? 9 : 6, 1.5)));
      const r = rng.next();
      const outcome = bypass > 170 && r < 0.4 ? "Complication" : r < 0.05 ? "Readmitted" : r < 0.09 ? "Complication" : "Discharged";
      const lowestTemp = Math.round(rng.normal(32, 1.2) * 10) / 10;

      // timeline
      const inRoom = sched + rng.int(-10, 20) * MIN;
      const incision = inRoom + rng.int(35, 50) * MIN;
      const heparin = incision + rng.int(40, 60) * MIN;
      const cpbOn = heparin + rng.int(6, 12) * MIN;
      const xclampOn = cpbOn + rng.int(4, 10) * MIN;
      const clampMin = Math.min(Math.round(bypass * rng.normal(0.68, 0.05)), bypass - (xclampOn - cpbOn) / MIN - 12);
      const xclampOff = xclampOn + clampMin * MIN;
      const cpbOff = cpbOn + bypass * MIN;
      const rewarmStart = Math.max(cpbOn + 20 * MIN, xclampOff - rng.int(15, 25) * MIN);
      const timeline: Timeline = {
        inRoom, incision, heparin, cpbOn, xclampOn, xclampOff, rewarmStart, cpbOff,
        protamine: cpbOff + rng.int(5, 12) * MIN, outRoom: cpbOff + rng.int(55, 80) * MIN,
      };
      if (timeline.outRoom > now) continue;

      // patient
      const sex = rng.chance(0.7) ? "M" : "F";
      const height = sex === "M" ? rng.normal(176, 7) : rng.normal(162, 6);
      const weight = sex === "M" ? rng.normal(88, 14) : rng.normal(74, 13);
      const age = Math.round(Math.min(88, Math.max(38, rng.normal(66, 9))));
      const birth = new Date(inRoom - age * 365.25 * DAY - rng.int(0, 364) * DAY).toISOString().slice(0, 10);
      const hb = (sex === "M" ? rng.normal(13.6, 1.3) : rng.normal(12.4, 1.2)) - (rng.chance(0.15) ? 2 : 0);
      const first = sex === "M" ? rng.pick(R.FIRST_NAMES_M) : rng.pick(R.FIRST_NAMES_F);
      const pid = await id("INSERT INTO patient (mrn, first_name, last_name, birth_date, sex, height_cm, weight_kg) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [`${f.key}${mrn++}`, first, rng.pick(R.LAST_NAMES), birth, sex, height.toFixed(1), weight.toFixed(1)]);
      const admitted = inRoom - rng.int(2, 20) * HOUR;
      const enc = await id("INSERT INTO encounter (patient_id, facility_id, admitted_at, discharged_at, outcome) VALUES ($1,$2,$3,$4,$5)",
        [pid, fac[f.key].id, iso(admitted), iso(admitted + los * DAY + rng.int(0, 8) * HOUR), outcome]);

      const caseId = await id("INSERT INTO surgical_case (encounter_id, room_id, procedure, scheduled_start, source, legacy_summary) VALUES ($1,$2,$3,$4,'live_capture',NULL)",
        [enc, roomId, p.name, iso(sched)]);
      const perf = rng.pick(perfusionists.filter((x) => x.facility === f.key));
      await client.query("INSERT INTO case_staff VALUES ($1,$2,'primary_surgeon'),($1,$3,'primary_perfusionist'),($1,$4,'anesthesiologist')",
        [caseId, rng.pick(surgeons), perf.id, rng.pick(anesthesia)]);
      const ev = (type: string, ts: number, detail: object = {}) =>
        client.query("INSERT INTO case_event (case_id, ts, event_type, detail) VALUES ($1,$2,$3,$4)", [caseId, iso(ts), type, JSON.stringify(detail)]);
      await ev("in_room", timeline.inRoom); await ev("incision", timeline.incision);
      await ev("heparin", timeline.heparin, { dose_units: Math.round(300 * weight / 100) * 100 });
      await ev("cpb_on", timeline.cpbOn); await ev("xclamp_on", timeline.xclampOn);
      for (const c of cardioplegiaSchedule(timeline)) await ev("cardioplegia", c.ts, { dose_ml: c.doseMl, route: "antegrade", temp_c: 4 });
      await ev("rewarm_start", timeline.rewarmStart); await ev("xclamp_off", timeline.xclampOff);
      await ev("cpb_off", timeline.cpbOff); await ev("protamine", timeline.protamine); await ev("out_of_room", timeline.outRoom);

      // disposables: lots roll over every three weeks
      const lotWeek = Math.floor((inRoom - START) / (21 * DAY));
      for (const pr of products)
        await client.query("INSERT INTO disposable_use VALUES ($1,$2,$3,$4)",
          [caseId, pr.id, `${pr.prefix}-${f.key}-${String(lotWeek + 31).padStart(3, "0")}`, iso(START + (lotWeek * 21 + 730) * DAY).slice(0, 10)]);

      cases.push({ caseId, timeline, roomId, facility: f.key, bsa: bsaMosteller(height, weight), hb, lowestTemp, perfusionist: perf, outcome, blood, index: index++ });
    }
  }

  // most recent N cases are captured per second; older ones are legacy imports with a summary only
  const nCaptured = capturedSetting === "all" ? cases.length : Math.min(cases.length, Number(capturedSetting));
  const captured = cases.slice(cases.length - nCaptured);
  const legacy = cases.slice(0, cases.length - nCaptured);
  for (const c of legacy) {
    await client.query("UPDATE surgical_case SET source = 'legacy_import', legacy_summary = $2 WHERE id = $1", [c.caseId, JSON.stringify({
      lowest_temp_c: c.lowestTemp, source_system: "Legacy perfusion records v3", record_id: `LPR-${700000 + c.caseId}`,
      migrated_at: iso(START + 150 * DAY), note: "Case-level summary only; no device waveforms were migrated",
    })]);
    if (c.blood > 0) await client.query("INSERT INTO transfusion (case_id, ts, product, units) VALUES ($1,$2,'PRBC',$3)", [c.caseId, iso(c.timeline.cpbOff + 30 * MIN), c.blood]);
  }

  // time shards: one partition per month across the whole period
  for (let t = START - 31 * DAY; t < now + 31 * DAY; t += 28 * DAY) await client.query("SELECT ensure_raw_partition($1)", [iso(t)]);
  await client.query("COMMIT");
  log(`${cases.length} cases (${captured.length} captured per second, ${legacy.length} legacy imports)`);

  // ---------------------------------------------------------------- capture
  log(`Simulating and ingesting ${captured.length} captured cases with ${WORKERS} workers`);
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: WORKERS, options: `-c search_path=${SCHEMA},public` });
  let rows = 0, done = 0;
  const queue = [...captured];
  const worker = async () => {
    const c = await pool.connect();
    try {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const n = await captureCase(c, job);   // not `rows += await ...`: that reads `rows` before the await and loses updates
        rows += n;
        if (++done % 10 === 0 || done === captured.length) log(`  ${done}/${captured.length} cases, ${rows.toLocaleString()} raw samples`);
      }
    } finally { c.release(); }
  };

  async function captureCase(c: pg.PoolClient, k: CaseRow): Promise<number> {
    const sim = simulateCase({
      seed: 1000 + k.caseId, bsa: k.bsa, timeline: k.timeline, lowestTempC: k.lowestTemp,
      targetCI: k.perfusionist.ci, proactive: k.perfusionist.proactive, hbBaseline: k.hb,
      hypotensionRate: k.outcome === "Complication" ? 3 : 1.2,
      hotRewarm: k.perfusionist.proactive ? (k.caseId % 10 === 0) : (k.caseId % 2 === 0),
    });
    const deviceIn = async (type: string) => (await c.query(
      `SELECT da.device_id FROM device_assignment da JOIN device d ON d.id = da.device_id JOIN device_model dm ON dm.id = d.model_id
       WHERE da.room_id = $1 AND da.during @> $2::timestamptz AND dm.device_type = $3`, [k.roomId, iso(k.timeline.cpbOn), type])).rows[0].device_id as number;
    const session = async (deviceId: number, start: number, end: number, offset: number) => (await c.query(
      `INSERT INTO recording_session (case_id, device_id, started_at, ended_at, software_version, clock_offset_ms, gateway)
       SELECT $1, $2, $3, $4,
              (SELECT version FROM software_install WHERE device_id = $2 AND installed_at <= $3 ORDER BY installed_at DESC LIMIT 1),
              $5, $6
       RETURNING id`, [k.caseId, deviceId, iso(start), iso(end), offset, `QI-GW-${k.facility}`])).rows[0].id as number;

    const wsId = await session(await deviceIn("perfusion_workstation"), sim.workstation.start, sim.workstation.end, rng.int(-150, 150));
    const monId = await session(await deviceIn("patient_monitor"), sim.monitor.start, sim.monitor.end, rng.int(-1500, 900));
    const n = (await ingest(c, wsId, sim.workstation.stream)) + (await ingest(c, monId, sim.monitor.stream));

    const sessionFor = (src: string) => (src === "workstation" ? wsId : monId);
    const perfusionist = k.perfusionist.id;
    for (const a of sim.alarms)
      await c.query(`INSERT INTO alarm_event (session_id, channel_id, ts, limit_kind, limit_value, value, acked_at, acked_by)
                     SELECT $1, id, $3, $4, $5, $6, $7, $8 FROM channel WHERE code = $2`,
        [sessionFor(a.source), a.channel, iso(a.ts), a.limitKind, a.limitValue, a.value, iso(a.ts + a.ackDelayS * 1000), perfusionist]);
    for (const s of sim.settings)
      await c.query("INSERT INTO setting_change (session_id, ts, parameter, old_value, new_value, staff_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [wsId, iso(s.ts), s.parameter, s.oldValue, s.newValue, perfusionist]);
    if (sim.emboli.length)
      await c.query(`INSERT INTO emboli_event (session_id, ts, line, est_volume_nl)
                     SELECT $1, to_timestamp(t / 1000.0), l, v FROM unnest($2::float8[], $3::text[], $4::real[]) AS u(t, l, v)`,
        [wsId, sim.emboli.map((e) => e.ts), sim.emboli.map((e) => e.line), sim.emboli.map((e) => e.volumeNl)]);
    for (const l of sim.labs)
      await c.query("INSERT INTO lab_result (case_id, ts, test, value, unit) VALUES ($1,$2,$3,$4,$5)", [k.caseId, iso(l.ts), l.test, l.value, l.unit]);
    for (const t of sim.transfusions)
      await c.query("INSERT INTO transfusion (case_id, ts, product, units) VALUES ($1,$2,'PRBC',$3)", [k.caseId, iso(t.ts), t.units]);
    const extra = k.blood - sim.transfusions.length;
    if (extra > 0) await c.query("INSERT INTO transfusion (case_id, ts, product, units) VALUES ($1,$2,'PRBC',$3)", [k.caseId, iso(k.timeline.cpbOff + 30 * MIN), extra]);
    if (k.blood >= 4) await c.query("INSERT INTO transfusion (case_id, ts, product, units) VALUES ($1,$2,'FFP',2)", [k.caseId, iso(k.timeline.protamine + 10 * MIN)]);
    return n;
  }

  /** Sends the stream in ten-minute batches through ingest_samples(), the same path a live gateway would use. */
  async function ingest(c: pg.PoolClient, sessionId: number, s: Stream): Promise<number> {
    let total = 0;
    for (let i = 0; i < s.ts.length;) {
      const cutoff = s.ts[i] + 10 * MIN;
      let j = i;
      while (j < s.ts.length && s.ts[j] < cutoff) j++;
      const res = await c.query("SELECT ingest_samples($1, $2::smallint[], $3::timestamptz[], $4::real[], $5::smallint[]) AS n",
        [sessionId, s.channel.slice(i, j), s.ts.slice(i, j).map(iso), s.value.slice(i, j), s.quality.slice(i, j)]);
      total += res.rows[0].n;
      i = j;
    }
    return total;
  }

  await Promise.all(Array.from({ length: WORKERS }, worker));

  // ---------------------------------------------------------------- derived data
  log("Rolling up hours and days");
  const rolled = (await pool.query("SELECT * FROM rollup_dirty()")).rows[0];
  log(`  ${rolled.hours} hour buckets, ${rolled.days} day buckets`);
  log("Case-phase statistics");
  const phaseQueue = captured.map((k) => k.caseId);
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    for (let caseId = phaseQueue.shift(); caseId; caseId = phaseQueue.shift()) await pool.query("SELECT refresh_case_phase($1)", [caseId]);
  }));
  log("Maintenance status at capture");
  await pool.query("SELECT refresh_session_maintenance()");
  await pool.query("ANALYZE");

  const counts = (await pool.query(`
    SELECT (SELECT count(*) FROM surgical_case) AS cases, (SELECT count(*) FROM raw_sample) AS raw,
           (SELECT count(*) FROM agg_minute) AS minutes, (SELECT count(*) FROM agg_hour) AS hours,
           (SELECT count(*) FROM agg_day) AS days, (SELECT count(*) FROM alarm_event) AS alarms,
           (SELECT count(*) FROM recording_session WHERE NOT maintenance_ok) AS flagged,
           pg_size_pretty(pg_database_size(current_database())) AS size`)).rows[0];
  log(`Done: ${counts.cases} cases, ${Number(counts.raw).toLocaleString()} raw samples, ${counts.minutes} minute / ${counts.hours} hour / ${counts.days} day buckets, ` +
      `${counts.alarms} alarms, ${counts.flagged} sessions captured on overdue devices. Database size ${counts.size}.`);
  console.log("Logins:  demo@cardiolens.test / Demo123!   and   admin@cardiolens.test / Admin123!");
  await pool.end();
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
