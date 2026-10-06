import "server-only";
import { query, queryOne } from "./db";
import type { WeeklyPoint } from "./analytics";

export type CaseRow = {
  id: number; case_date: string; procedure: string; surgeon: string; facility: string;
  bypass_min: number; cross_clamp_min: number; lowest_temp_c: number;
  blood_units: number; los_days: number; outcome: string;
};

const CASE_SELECT = `
  SELECT c.id, c.case_date, c.procedure, s.name AS surgeon, f.name AS facility,
         c.bypass_min, c.cross_clamp_min, c.lowest_temp_c, c.blood_units, c.los_days, c.outcome
  FROM cases c
  JOIN surgeons s   ON s.id = c.surgeon_id
  JOIN facilities f ON f.id = c.facility_id`;

export const PROCEDURES = ["CABG", "AVR", "MVR", "CABG + AVR"] as const;

export function listCases(opts: { procedure?: string; surgeon?: string; limit?: number }) {
  // Build WHERE with placeholders only; user input never touches the SQL text.
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.procedure) { where.push("c.procedure = ?"); params.push(opts.procedure); }
  if (opts.surgeon)   { where.push("s.name LIKE ?");  params.push(`%${opts.surgeon}%`); }
  const sql = `${CASE_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY c.case_date DESC, c.id DESC LIMIT ?`;
  return query<CaseRow>(sql, ...params, opts.limit ?? 100);
}

export function getCase(id: number) {
  return queryOne<CaseRow>(`${CASE_SELECT} WHERE c.id = ?`, id);
}

export function kpis(procedure?: string) {
  const filter = procedure ? "WHERE procedure = ?" : "";
  const p = procedure ? [procedure] : [];
  return queryOne<{ cases: number; avg_bypass: number; avg_los: number; complication_rate: number }>(
    `SELECT COUNT(*) AS cases,
            ROUND(AVG(bypass_min), 1) AS avg_bypass,
            ROUND(AVG(los_days), 1)   AS avg_los,
            ROUND(100.0 * SUM(outcome <> 'Discharged') / COUNT(*), 1) AS complication_rate
     FROM cases ${filter}`, ...p)!;
}

export function weeklyBypass(procedure?: string): WeeklyPoint[] {
  const filter = procedure ? "WHERE procedure = ?" : "";
  const p = procedure ? [procedure] : [];
  // Group by the Monday that starts each week.
  return query<WeeklyPoint>(
    `SELECT date(case_date, '-6 days', 'weekday 1') AS week,
            AVG(bypass_min) AS mean, COUNT(*) AS cases
     FROM cases ${filter}
     GROUP BY week ORDER BY week`, ...p);
}

export function bypassByProcedure() {
  return query<{ procedure: string; id: number; case_date: string; bypass_min: number; surgeon: string }>(
    `SELECT c.procedure, c.id, c.case_date, c.bypass_min, s.name AS surgeon
     FROM cases c JOIN surgeons s ON s.id = c.surgeon_id
     ORDER BY c.procedure, c.case_date`);
}
