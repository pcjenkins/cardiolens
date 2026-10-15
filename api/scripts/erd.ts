// npm run db:erd -> docs/ERD.md. Generates Mermaid ER diagrams from the live cardiolens schema (columns, PKs, FKs) plus the
// logical links the schema deliberately leaves undeclared on the high-volume tables.
import pg from "pg";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { initEnv } from "./init-env.ts";
import { REPO_ROOT } from "../src/config.ts";
initEnv();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const cols = (await c.query(`
  SELECT c.table_name t, c.column_name col, c.ordinal_position pos,
         CASE WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
              WHEN c.data_type LIKE 'timestamp%' THEN 'timestamptz' WHEN c.data_type = 'double precision' THEN 'float8'
              WHEN c.data_type = 'character varying' THEN 'varchar' WHEN c.data_type = 'character' THEN 'char'
              WHEN c.data_type = 'ARRAY' THEN 'array' ELSE c.data_type END typ,
         c.is_nullable = 'YES' nullable, c.is_generated = 'ALWAYS' generated
  FROM information_schema.columns c JOIN pg_tables p ON p.tablename = c.table_name AND p.schemaname = c.table_schema
  WHERE c.table_schema = 'cardiolens' AND c.table_name NOT LIKE 'raw_sample_%' ORDER BY 1, 3`)).rows;
const pks = new Set<string>((await c.query(`
  SELECT tc.table_name t, k.column_name col FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage k USING (constraint_schema, constraint_name)
  WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'cardiolens'`)).rows.map((r: any) => `${r.t}.${r.col}`));
const fks = (await c.query(`
  SELECT cl.relname t, a.attname col, fr.relname ref, NOT a.attnotnull nullable,
         EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = con.conrelid AND i.indisunique AND i.indkey::int2[] = con.conkey) one_to_one
  FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_class fr ON fr.oid = con.confrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND n.nspname = 'cardiolens' ORDER BY 1, 2`)).rows;
const fkSet = new Set(fks.map((f: any) => `${f.t}.${f.col}`));
// Undeclared on purpose (ingest speed / generic aggregates): drawn dotted.
const logical: [string, string, string][] = [
  ["raw_sample", "session_id", "recording_session"], ["raw_sample", "channel_id", "channel"], ["raw_sample", "quality", "sample_quality"],
  ...["agg_minute", "agg_hour", "agg_day", "agg_dirty"].flatMap((t): [string, string, string][] => [[t, "session_id", "recording_session"], [t, "channel_id", "channel"]]),
];
const logicalSet = new Set(logical.map(([t, col]) => `${t}.${col}`));
await c.end();

const tables = [...new Set(cols.map((r: any) => r.t))] as string[];
const entity = (t: string, full: boolean) => {
  if (!full) return `  ${t}`;
  const lines = cols.filter((r: any) => r.t === t).map((r: any) => {
    const keys = [pks.has(`${t}.${r.col}`) && "PK", (fkSet.has(`${t}.${r.col}`) || logicalSet.has(`${t}.${r.col}`)) && "FK"].filter(Boolean).join(",");
    const note = r.generated ? ' "generated"' : logicalSet.has(`${t}.${r.col}`) ? ' "logical FK"' : "";
    return `    ${r.typ.replace(/\s+/g, "_")} ${r.col}${keys ? " " + keys : ""}${note}`;
  });
  return `  ${t} {\n${lines.join("\n")}\n  }`;
};
const rel = (t: string, col: string, ref: string, nullable: boolean, oneToOne: boolean, dotted: boolean, label?: string) =>
  `  ${ref} ${nullable ? "|o" : "||"}${dotted ? ".." : "--"}${oneToOne ? "o|" : "o{"} ${t} : "${label ?? col}"`;

function diagram(title: string, members: string[], full: boolean, extraOnly: string[] = []) {
  const set = new Set([...members, ...extraOnly]);
  const body = [];
  for (const t of members) body.push(entity(t, full));
  for (const t of extraOnly) if (!members.includes(t)) body.push(entity(t, false));
  for (const f of fks) if (set.has(f.t) && set.has(f.ref) && (members.includes(f.t) || members.includes(f.ref)))
    body.push(rel(f.t, f.col, f.ref, f.nullable, f.one_to_one, false));
  for (const [t, col, ref] of logical) if (set.has(t) && set.has(ref)) body.push(rel(t, col, ref, false, false, true));
  return `---\ntitle: "${title}"\n---\nerDiagram\n${body.join("\n")}\n`;
}

const groups: Record<string, [string, string[], string[]]> = {
  "1-organisation": ["Organisation hierarchy: health system > facility > location tree > room",
    ["health_system", "facility", "location", "room", "device_assignment"], ["device", "surgical_case", "encounter"]],
  "2-clinical": ["Clinical: patient > encounter > case, staff, events, labs, products",
    ["patient", "encounter", "surgical_case", "case_staff", "staff", "case_event", "lab_result", "transfusion", "disposable_use", "disposable_product", "app_user"], ["room", "facility", "manufacturer"]],
  "3-devices": ["Devices and provenance: model > device > modules > channels",
    ["manufacturer", "device_model", "module_model", "device", "device_module", "software_install", "channel", "module_channel"], ["device_assignment", "facility", "recording_session"]],
  "4-maintenance": ["Maintenance: plans, tasks, work orders",
    ["maintenance_plan", "maintenance_task", "work_order", "work_order_task", "technician"], ["device", "device_model"]],
  "5-capture": ["Capture: sessions, raw samples (partitioned by month), alarms, settings, emboli",
    ["recording_session", "raw_sample", "sample_quality", "alarm_event", "setting_change", "emboli_event"], ["surgical_case", "device", "channel", "staff"]],
  "6-aggregates": ["Aggregates: minute > hour > day, dirty queue, case phases",
    ["agg_minute", "agg_hour", "agg_day", "agg_dirty", "agg_case_phase"], ["recording_session", "channel", "surgical_case"]],
};
const files: Record<string, string> = {};
const spine = ["health_system", "facility", "location", "room", "device_assignment", "device_model", "device", "device_module",
  "maintenance_plan", "work_order", "patient", "encounter", "surgical_case", "recording_session", "channel", "raw_sample", "agg_minute", "agg_case_phase"];
files["0-overview"] = diagram("CardioLens core: where it is, what recorded it, whose case, the samples (dotted = logical FK)", spine, false);
for (const [k, [title, members, extra]] of Object.entries(groups)) files[k] = diagram(title, members, true, extra);
const covered = new Set(Object.values(groups).flatMap(g => g[1]));
const missing = tables.filter((t) => !covered.has(t));
if (missing.length) throw new Error("tables not in any domain diagram: " + missing.join(", "));
const tick = "`";
const fence = tick.repeat(3);
const title = (k: string) => k.replace(/^\d-/, "").replace(/^./, (s) => s.toUpperCase());
const doc = [
  "# CardioLens data model",
  "",
  `Generated from the live ${tick}cardiolens${tick} schema by ${tick}npm run db:erd${tick}: ${tables.length} tables, ${fks.length} declared foreign keys,`,
  `${logical.length} logical ones. Solid lines are declared foreign keys. Dotted lines are relationships the high-volume tables`,
  `deliberately don't declare: raw samples and aggregates are written only through ${tick}ingest_samples()${tick}, and an FK check per row`,
  "costs more than it protects. Rendered copies are in [docs/erd/](erd/).",
  "",
  ...Object.entries(files).map(([k, v]) => `## ${title(k)}\n\n${fence}mermaid\n${v}${fence}\n`),
].join("\n");
writeFileSync(path.join(REPO_ROOT, "docs", "ERD.md"), doc);
console.log(`${tables.length} tables, ${fks.length} declared FKs, ${logical.length} logical FKs -> docs/ERD.md`);
