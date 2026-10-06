// Creates data/cardiolens.db (a single SQLite file) and fills it with fictitious data.
// Run with:  npm run seed
// Safe to re-run: it drops and recreates every table.

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";

const root = process.cwd();
const dataDir = path.join(root, "data");
const dbPath = process.env.DB_PATH ?? path.join(dataDir, "cardiolens.db");
if (!existsSync(path.dirname(dbPath))) mkdirSync(path.dirname(dbPath), { recursive: true });

// ---- session secret: generated once, kept in .env.local (never committed) ----
const envPath = path.join(root, ".env.local");
const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
if (!process.env.SESSION_SECRET && !/^SESSION_SECRET=/m.test(env)) {
  writeFileSync(envPath, env + `SESSION_SECRET=${randomBytes(32).toString("hex")}\n`);
  console.log("Created .env.local with a random SESSION_SECRET");
}

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  DROP TABLE IF EXISTS cases;
  DROP TABLE IF EXISTS surgeons;
  DROP TABLE IF EXISTS facilities;
  DROP TABLE IF EXISTS users;

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('clinician','admin')),
    password_hash TEXT NOT NULL
  );

  CREATE TABLE surgeons   (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE facilities (id INTEGER PRIMARY KEY, name TEXT NOT NULL);

  CREATE TABLE cases (
    id               INTEGER PRIMARY KEY,
    case_date        TEXT    NOT NULL,              -- ISO yyyy-mm-dd
    procedure        TEXT    NOT NULL,
    surgeon_id       INTEGER NOT NULL REFERENCES surgeons(id),
    facility_id      INTEGER NOT NULL REFERENCES facilities(id),
    bypass_min       INTEGER NOT NULL,              -- cardiopulmonary bypass time
    cross_clamp_min  INTEGER NOT NULL,              -- aortic cross-clamp time
    lowest_temp_c    REAL    NOT NULL,
    blood_units      INTEGER NOT NULL,
    los_days         INTEGER NOT NULL,              -- length of stay
    outcome          TEXT    NOT NULL CHECK (outcome IN ('Discharged','Complication','Readmitted'))
  );

  CREATE INDEX ix_cases_date      ON cases(case_date);
  CREATE INDEX ix_cases_surgeon   ON cases(surgeon_id);
  CREATE INDEX ix_cases_procedure ON cases(procedure);
`);

// ---- users (fictitious) ----
const users = [
  ["demo@cardiolens.test", "Dana Demo", "clinician", "Demo123!"],
  ["admin@cardiolens.test", "Alex Admin", "admin", "Admin123!"],
];
const insUser = db.prepare("INSERT INTO users (email,name,role,password_hash) VALUES (?,?,?,?)");
for (const [email, name, role, pw] of users) insUser.run(email, name, role, bcrypt.hashSync(pw, 10));

// ---- reference data (all names invented) ----
const surgeons = ["Dr. Imani Okafor", "Dr. Theo Lindqvist", "Dr. Priya Raman", "Dr. Marcus Bell"];
const facilities = ["Riverbend Heart Institute", "Northgate Medical Center"];
surgeons.forEach((n, i) => db.prepare("INSERT INTO surgeons (id,name) VALUES (?,?)").run(i + 1, n));
facilities.forEach((n, i) => db.prepare("INSERT INTO facilities (id,name) VALUES (?,?)").run(i + 1, n));

// ---- deterministic pseudo-random generator so every seed produces the same data ----
let s = 42;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const normal = (mean, sd) => {
  const u = 1 - rand(), v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// Procedure mix with typical bypass times; a quality program improves times over the period.
const procedures = [
  { name: "CABG",      bypass: 95,  weight: 5 },
  { name: "AVR",       bypass: 105, weight: 3 },
  { name: "MVR",       bypass: 120, weight: 2 },
  { name: "CABG + AVR", bypass: 150, weight: 1 },
];
const bag = procedures.flatMap((p) => Array(p.weight).fill(p));

const WEEKS = 26;
const start = new Date();
start.setUTCDate(start.getUTCDate() - WEEKS * 7);

const insCase = db.prepare(`INSERT INTO cases
  (case_date, procedure, surgeon_id, facility_id, bypass_min, cross_clamp_min, lowest_temp_c, blood_units, los_days, outcome)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);

db.exec("BEGIN");
let count = 0;
for (let day = 0; day < WEEKS * 7; day++) {
  const d = new Date(start);
  d.setUTCDate(start.getUTCDate() + day);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) continue;            // no elective cases on weekends
  const perDay = 1 + Math.floor(rand() * 3);
  for (let k = 0; k < perDay; k++) {
    const p = pick(bag);
    const improvement = (day / (WEEKS * 7)) * 12;   // ~12 min faster by the end
    let bypass = Math.round(normal(p.bypass - improvement, 14));
    if (rand() < 0.02) bypass += 80 + Math.round(rand() * 40); // rare prolonged case
    bypass = Math.max(45, bypass);
    const clamp = Math.max(25, Math.round(bypass * normal(0.68, 0.05)));
    const blood = Math.max(0, Math.round(normal(bypass > 160 ? 4 : 1.5, 1.2)));
    const los = Math.max(3, Math.round(normal(bypass > 160 ? 9 : 6, 1.5)));
    const r = rand();
    const outcome = bypass > 170 && r < 0.4 ? "Complication" : r < 0.05 ? "Readmitted" : r < 0.09 ? "Complication" : "Discharged";
    insCase.run(
      d.toISOString().slice(0, 10), p.name, 1 + Math.floor(rand() * surgeons.length),
      1 + Math.floor(rand() * facilities.length), bypass, clamp,
      Math.round(normal(32, 1.2) * 10) / 10, blood, los, outcome,
    );
    count++;
  }
}
db.exec("COMMIT");
db.close();

console.log(`Seeded ${count} cases, ${surgeons.length} surgeons, ${users.length} users into ${dbPath}`);
console.log("Logins:  demo@cardiolens.test / Demo123!   and   admin@cardiolens.test / Admin123!");
