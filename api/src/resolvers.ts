import bcrypt from "bcryptjs";
import { GraphQLScalarType, Kind } from "graphql";
import { badInput, forbidden, unauthenticated, type SessionUser } from "./auth.ts";
import { query, queryOne } from "./db.ts";
import { devicesWhere, type Loaders } from "./loaders.ts";
import { planSeries, SeriesRangeError, type Resolution } from "./series.ts";
import { camel, fromDb, likeEscape, toDb } from "./util.ts";

export type Context = { user: SessionUser | null; service: boolean; loaders: Loaders };

const requireUser = (ctx: Context) => { if (!ctx.user) throw unauthenticated(); return ctx.user; };
const requireAdmin = (ctx: Context) => { if (requireUser(ctx).role !== "admin") throw forbidden(); };
const intId = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw badInput("id must be a positive integer");
  return n;
};
const round = (v: number | null | undefined, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// Hashed once at start-up: comparing against it when the email is unknown keeps response time
// the same either way, so timing doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

async function channelMap(ctx: Context) {
  const all = await ctx.loaders.channels.load("all");
  return { byId: new Map(all.map((c) => [c.id, c])), byCode: new Map(all.map((c) => [c.code, c])) };
}

async function procedures(): Promise<string[]> {
  return (await query<{ procedure: string }>("SELECT procedure FROM surgical_case GROUP BY procedure ORDER BY count(*) DESC")).map((r) => r.procedure);
}

const allowProcedure = async (p?: string | null) => (p && (await procedures()).includes(p) ? p : null);   // allow-list

const DateTime = new GraphQLScalarType({
  name: "DateTime",
  description: "ISO-8601 timestamp (UTC)",
  serialize: (v) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString()),
  parseValue: (v) => {
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw badInput(`Invalid DateTime: ${v}`);
    return d;
  },
  parseLiteral: (ast) => {
    if (ast.kind !== Kind.STRING) throw badInput("DateTime must be a string");
    const d = new Date(ast.value);
    if (Number.isNaN(d.getTime())) throw badInput(`Invalid DateTime: ${ast.value}`);
    return d;
  },
});

const JSONScalar = new GraphQLScalarType({ name: "JSON", serialize: (v) => v, parseValue: (v) => v });

export const resolvers = {
  DateTime,
  JSON: JSONScalar,

  Query: {
    me: async (_: unknown, __: unknown, ctx: Context) => {
      const u = requireUser(ctx);
      return camel((await queryOne("SELECT id, email, name, role FROM app_user WHERE id = $1", [u.userId]))!);
    },
    procedures: (_: unknown, __: unknown, ctx: Context) => { requireUser(ctx); return procedures(); },
    channels: (_: unknown, __: unknown, ctx: Context) => { requireUser(ctx); return ctx.loaders.channels.load("all"); },

    dashboard: async (_: unknown, args: { procedure?: string }, ctx: Context) => {
      requireUser(ctx);
      return { procedure: await allowProcedure(args.procedure) };     // field resolvers below run only if asked for
    },

    cases: async (_: unknown, args: { filter?: any; limit?: number }, ctx: Context) => {
      requireUser(ctx);
      const f = args.filter ?? {};
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
      if (f.procedure) add("procedure = ?", await allowProcedure(f.procedure));
      if (f.surgeon) add("surgeon ILIKE ? ESCAPE '\\'", `%${likeEscape(String(f.surgeon).slice(0, 50))}%`);
      if (f.facilityId) add("facility_id = ?", intId(f.facilityId));
      if (f.perfusionistId) add("perfusionist_id = ?", intId(f.perfusionistId));
      if (f.capturedOnly) where.push("source = 'live_capture'");
      params.push(Math.min(500, Math.max(1, args.limit ?? 100)));
      const rows = await query(`SELECT * FROM v_case ${where.length ? "WHERE " + where.join(" AND ") : ""}
                                ORDER BY case_date DESC, id DESC LIMIT $${params.length}`, params);
      return rows.map(camel);
    },
    case: async (_: unknown, { id }: { id: string }, ctx: Context) => {
      requireUser(ctx);
      const row = await queryOne("SELECT * FROM v_case WHERE id = $1", [intId(id)]);
      return row ? camel(row) : null;
    },

    facilities: async (_: unknown, __: unknown, ctx: Context) => {
      requireUser(ctx);
      return (await query(`SELECT f.*, hs.name AS health_system FROM facility f JOIN health_system hs ON hs.id = f.health_system_id ORDER BY f.name`)).map(camel);
    },
    devices: async (_: unknown, { facilityId }: { facilityId?: string }, ctx: Context) => {
      requireUser(ctx);
      return facilityId ? devicesWhere("d.facility_id = $1", [intId(facilityId)]) : devicesWhere("true", []);
    },
    device: (_: unknown, { id }: { id: string }, ctx: Context) => { requireUser(ctx); return ctx.loaders.device.load(intId(id)); },
    maintenance: async (_: unknown, { status }: { status?: string[] }, ctx: Context) => {
      requireUser(ctx);
      const rows = await query(`
        SELECT * FROM v_maintenance_status
        WHERE ($1::text[] IS NULL OR status = ANY($1))
        ORDER BY array_position(ARRAY['overdue','in_grace','due_soon','current'], status), due_at NULLS FIRST, asset_tag`,
        [status?.length ? status.map(toDb) : null]);
      return rows.map(camel);
    },
    disposableRecall: async (_: unknown, { lot }: { lot: string }, ctx: Context) => {
      requireUser(ctx);
      const rows = await query(`SELECT v.* FROM v_case v WHERE v.id IN (SELECT case_id FROM disposable_use WHERE lot = $1)
                                ORDER BY v.case_date DESC`, [lot.trim().slice(0, 40)]);
      return rows.map(camel);
    },
    dataVolume: async (_: unknown, __: unknown, ctx: Context) => {
      requireAdmin(ctx);
      const partitions = await query(`
        SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS range,
               greatest(c.reltuples, 0)::float8 AS rows, pg_total_relation_size(c.oid)::float8 AS bytes
        FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'raw_sample'::regclass ORDER BY c.relname`);
      const tables = await query(`
        SELECT c.relname AS name, greatest(c.reltuples, 0)::float8 AS rows, pg_total_relation_size(c.oid)::float8 AS bytes
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname IN
              ('agg_minute','agg_hour','agg_day','agg_case_phase','alarm_event','emboli_event','surgical_case','work_order')
        ORDER BY pg_total_relation_size(c.oid) DESC`);
      const dirty = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM agg_dirty");
      return { partitions, tables, dirtyBuckets: dirty!.n };
    },
  },

  Mutation: {
    authenticate: async (_: unknown, args: { email: string; password: string }, ctx: Context) => {
      if (!ctx.service) throw forbidden();                            // only the web tier may check passwords
      const email = String(args.email).trim().toLowerCase().slice(0, 200);
      const row = await queryOne<any>("SELECT id, email, name, role, password_hash FROM app_user WHERE email = $1", [email]);
      const ok = await bcrypt.compare(String(args.password).slice(0, 200), row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) return { user: null, error: "Invalid email or password" };   // same answer either way
      return { user: { id: row.id, email: row.email, name: row.name, role: row.role }, error: null };
    },
  },

  Dashboard: {
    kpis: async ({ procedure }: { procedure: string | null }) => camel((await queryOne(`
      SELECT count(*)::int AS cases,
             count(*) FILTER (WHERE source = 'live_capture')::int AS captured_cases,
             round(avg(bypass_min), 1) AS avg_bypass_min,
             round(avg(los_days), 1) AS avg_los_days,
             round(100.0 * avg((outcome <> 'Discharged')::int), 1) AS complication_rate
      FROM v_case WHERE ($1::text IS NULL OR procedure = $1)`, [procedure]))!),

    weekly: async ({ procedure }: { procedure: string | null }) => (await query(`
      SELECT to_char(date_trunc('week', case_date), 'YYYY-MM-DD') AS week, avg(bypass_min)::float8 AS mean, count(*)::int AS cases
      FROM v_case WHERE ($1::text IS NULL OR procedure = $1)
      GROUP BY 1 ORDER BY 1`, [procedure])).map(camel),

    bypassByCase: async ({ procedure }: { procedure: string | null }) => (await query(`
      SELECT id, case_date, procedure, surgeon, bypass_min FROM v_case
      WHERE ($1::text IS NULL OR procedure = $1) ORDER BY procedure, case_date`, [procedure])).map(camel),

    perfusionQuality: async ({ procedure }: { procedure: string | null }) => (await query(`
      SELECT s.id AS perfusionist_id, s.name AS perfusionist_name,
             count(DISTINCT acp.case_id)::int AS cases,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY acp.p50) FILTER (WHERE c.code = 'DO2I')) AS median_do2i,
             round((100.0 * sum(acp.sec_below) FILTER (WHERE c.code = 'DO2I')  / nullif(sum(acp.n_valid) FILTER (WHERE c.code = 'DO2I'), 0))::numeric, 1)  AS pct_time_do2i_below_target,
             round((100.0 * sum(acp.sec_below) FILTER (WHERE c.code = 'MAP')   / nullif(sum(acp.n_valid) FILTER (WHERE c.code = 'MAP'), 0))::numeric, 1)   AS pct_time_map_below50,
             round((100.0 * sum(acp.sec_above) FILTER (WHERE c.code = 'T_ART') / nullif(sum(acp.n_valid) FILTER (WHERE c.code = 'T_ART'), 0))::numeric, 1) AS pct_time_arterial_above37
      FROM agg_case_phase acp
      JOIN channel c ON c.id = acp.channel_id
      JOIN surgical_case sc ON sc.id = acp.case_id
      JOIN case_staff cs ON cs.case_id = sc.id AND cs.role = 'primary_perfusionist'
      JOIN staff s ON s.id = cs.staff_id
      WHERE acp.phase = 'full_flow' AND ($1::text IS NULL OR sc.procedure = $1)
      GROUP BY s.id, s.name
      ORDER BY pct_time_do2i_below_target`, [procedure])).map((r: any) => ({
        ...camel(r), perfusionist: { id: r.perfusionist_id, name: r.perfusionist_name },
      })),
  },

  Case: {
    surgeon: (c: any) => (c.surgeonId ? { id: c.surgeonId, name: c.surgeon } : null),
    perfusionist: (c: any) => (c.perfusionistId ? { id: c.perfusionistId, name: c.perfusionist } : null),
    patient: (c: any) => ({ mrn: c.mrn, age: c.patientAge, sex: c.sex, bsaM2: c.bsaM2 }),
    lowestTempC: (c: any) => round(c.lowestTempC, 1),

    events: async (c: any) => (await query("SELECT ts, event_type AS type, detail FROM case_event WHERE case_id = $1 ORDER BY ts", [c.id])),
    labs: async (c: any) => await query("SELECT ts, test, value, unit FROM lab_result WHERE case_id = $1 ORDER BY ts, test", [c.id]),
    sessions: (c: any, _: unknown, ctx: Context) => ctx.loaders.sessionsByCase.load(c.id),
    phaseWindows: async (c: any) => (await query("SELECT phase, t_start AS start, t_end AS end FROM case_phases($1) ORDER BY t_start, phase", [c.id]))
      .map((r: any) => ({ ...r, phase: fromDb(r.phase) })),
    phases: async (c: any, { channels }: { channels?: string[] }, ctx: Context) => {
      const { byId } = await channelMap(ctx);
      const rows = await query(`
        SELECT acp.* FROM agg_case_phase acp JOIN channel ch ON ch.id = acp.channel_id
        WHERE acp.case_id = $1 AND ($2::text[] IS NULL OR ch.code = ANY($2))
        ORDER BY acp.t_start, acp.phase, acp.channel_id`, [c.id, channels?.length ? channels : null]);
      return rows.map((r: any) => {
        const ch = byId.get(r.channel_id), d = ch.decimals;
        return {
          phase: fromDb(r.phase), channel: ch, start: r.t_start, end: r.t_end,
          avg: round(r.avg, d), min: round(r.min, d), minAt: r.t_min, max: round(r.max, d), maxAt: r.t_max,
          p10: round(r.p10, d), p50: round(r.p50, d), p90: round(r.p90, d),
          secondsBelow: r.sec_below, secondsAbove: r.sec_above, validSamples: r.n_valid, badSamples: r.n_bad,
        };
      });
    },
    quality: (c: any, _: unknown, ctx: Context) => ctx.loaders.caseQuality.load(c.id),
    episodes: async (c: any, a: { channel: string; direction: string; limit?: number; minSeconds: number; phase: string }, ctx: Context) => {
      const { byCode } = await channelMap(ctx);
      if (!byCode.has(a.channel)) throw badInput(`Unknown channel ${a.channel}`);
      return query(`SELECT t_start AS start, t_end AS end, seconds, extreme FROM threshold_episodes($1, $2, $3, $4, $5, $6)`,
        [c.id, a.channel, a.direction === "ABOVE" ? "above" : "below", a.limit ?? null, Math.max(1, a.minSeconds), toDb(a.phase)]);
    },

    series: async (c: any, a: { channels: string[]; from?: Date; to?: Date; resolution: Resolution; maxPoints: number }, ctx: Context) => {
      const { byCode } = await channelMap(ctx);
      if (!a.channels.length || a.channels.length > 8) throw badInput("Ask for between 1 and 8 channels");
      const chans = a.channels.map((code) => byCode.get(code) ?? (() => { throw badInput(`Unknown channel ${code}`); })());
      const span = await queryOne<{ s0: Date | null; s1: Date | null }>(
        "SELECT min(started_at) AS s0, max(ended_at) AS s1 FROM recording_session WHERE case_id = $1", [c.id]);
      if (!span?.s0 || !span.s1) {
        const now = new Date();
        return { resolution: "MINUTE", stepSeconds: 60, from: now, to: now, channels: chans.map((ch) => ({ channel: ch, points: [] })) };
      }
      const from = new Date(Math.max(span.s0.getTime(), a.from?.getTime() ?? 0));
      const to = new Date(Math.min(span.s1.getTime(), a.to?.getTime() ?? Infinity));
      let plan;
      try {
        plan = planSeries((to.getTime() - from.getTime()) / 1000, a.maxPoints, a.resolution);
      } catch (e) {
        if (e instanceof SeriesRangeError) throw badInput(e.message);
        throw e;
      }
      const ids = chans.map((ch) => ch.id);
      const points = new Map<number, any[]>(ids.map((id) => [id, []]));

      if (plan.source === "raw") {
        // Invalid samples come back as null so the chart shows a gap instead of a spike.
        const rows = await query<any>(`
          SELECT r.channel_id, r.ts AS t, CASE WHEN r.quality = 0 THEN r.value END AS v
          FROM recording_session rs JOIN raw_sample r ON r.session_id = rs.id
          WHERE rs.case_id = $1 AND r.channel_id = ANY($2) AND r.ts >= $3 AND r.ts < $4
          ORDER BY r.channel_id, r.ts`, [c.id, ids, from, to]);
        for (const r of rows) points.get(r.channel_id)!.push({ t: r.t, avg: r.v, min: r.v, max: r.v });
      } else {
        // Re-bin the aggregate to the planned step and lay it on a gap-filled grid (generate_series),
        // so missing minutes are visible as missing rather than silently joined up.
        const table = ({ agg_minute: "agg_minute", agg_hour: "agg_hour", agg_day: "agg_day" } as const)[plan.source];
        const rows = await query<any>(`
          WITH step AS (SELECT make_interval(secs => $5) AS w),
          grid AS (
            SELECT generate_series(date_bin(step.w, $3::timestamptz, timestamptz '2000-01-01 00:00+00'),
                                   $4::timestamptz - interval '1 microsecond', step.w) AS t FROM step
          ),
          agg AS (
            SELECT a.channel_id, date_bin(step.w, a.bucket, timestamptz '2000-01-01 00:00+00') AS t,
                   sum(a.sum) / nullif(sum(a.n_valid), 0) AS avg, min(a.min) AS min, max(a.max) AS max
            FROM ${table} a JOIN recording_session rs ON rs.id = a.session_id, step
            WHERE rs.case_id = $1 AND a.channel_id = ANY($2) AND a.bucket >= $3 AND a.bucket < $4
            GROUP BY 1, 2
          )
          SELECT ch.id AS channel_id, g.t, agg.avg, agg.min, agg.max
          FROM grid g CROSS JOIN unnest($2::smallint[]) AS ch(id)
          LEFT JOIN agg ON agg.channel_id = ch.id AND agg.t = g.t
          ORDER BY 1, 2`, [c.id, ids, from, to, plan.stepSeconds]);
        for (const r of rows) points.get(r.channel_id)!.push({ t: r.t, avg: r.avg, min: r.min, max: r.max });
      }
      return {
        resolution: plan.resolution, stepSeconds: Math.max(1, Math.round(plan.stepSeconds)), from, to,
        channels: chans.map((ch) => ({
          channel: ch,
          points: points.get(ch.id)!.map((p) => ({ t: p.t, avg: round(p.avg, ch.decimals + 1), min: round(p.min, ch.decimals + 1), max: round(p.max, ch.decimals + 1) })),
        })),
      };
    },

    alarms: async (c: any, _: unknown, ctx: Context) => {
      const { byId } = await channelMap(ctx);
      const rows = await query<any>(`
        SELECT a.*, extract(epoch FROM a.acked_at - a.ts)::float8 AS ack_seconds
        FROM alarm_event a JOIN recording_session rs ON rs.id = a.session_id
        WHERE rs.case_id = $1 ORDER BY a.ts`, [c.id]);
      return rows.map((r) => ({ ...camel(r), channel: byId.get(r.channel_id) }));
    },
    settingChanges: async (c: any) => (await query(`
      SELECT s.ts, s.parameter, s.old_value, s.new_value FROM setting_change s
      JOIN recording_session rs ON rs.id = s.session_id WHERE rs.case_id = $1 ORDER BY s.ts`, [c.id])).map(camel),
    emboli: async (c: any) => {
      const rows = await query<any>(`
        SELECT e.line, count(*)::int AS count, round(sum(e.est_volume_nl)::numeric, 1) AS volume_nl
        FROM emboli_event e JOIN recording_session rs ON rs.id = e.session_id
        WHERE rs.case_id = $1 GROUP BY e.line ORDER BY e.line`, [c.id]);
      return {
        count: rows.reduce((n, r) => n + r.count, 0),
        totalVolumeNl: round(rows.reduce((n, r) => n + r.volume_nl, 0), 1),
        byLine: rows.map(camel),
      };
    },
    disposables: async (c: any) => (await query(`
      SELECT dp.name AS product, dp.kind, du.lot, du.expires_on FROM disposable_use du
      JOIN disposable_product dp ON dp.id = du.product_id WHERE du.case_id = $1 ORDER BY dp.kind, dp.name`, [c.id])).map(camel),
    report: async (c: any) => (await queryOne<{ doc: unknown }>("SELECT case_report($1) AS doc", [c.id]))!.doc,
  },

  RecordingSession: {
    device: (s: any, _: unknown, ctx: Context) => ctx.loaders.device.load(s.deviceId),
  },

  Facility: {
    locations: (f: any, _: unknown, ctx: Context) => ctx.loaders.locationsByFacility.load(f.id),
  },
  Location: {
    rooms: (l: any, _: unknown, ctx: Context) => ctx.loaders.roomsByLocation.load(l.id),
  },
  Room: {
    devices: (r: any, _: unknown, ctx: Context) => ctx.loaders.devicesByRoom.load(r.id),
  },

  Device: {
    runningHours: (d: any) => d.runningHours ?? 0,
    cases: (d: any) => d.cases ?? 0,
    maintenanceStatus: (d: any) => fromDb(d.maintenanceStatus),
    modules: async (d: any) => (await query(`
      SELECT dmod.position, mm.name AS model, mm.module_type AS type, dmod.serial, dmod.firmware,
             coalesce(array_agg(c.code ORDER BY c.id) FILTER (WHERE c.id IS NOT NULL), '{}') AS channels
      FROM device_module dmod JOIN module_model mm ON mm.id = dmod.module_model_id
      LEFT JOIN module_channel mc ON mc.module_model_id = mm.id LEFT JOIN channel c ON c.id = mc.channel_id
      WHERE dmod.device_id = $1 GROUP BY dmod.id, mm.id ORDER BY dmod.position`, [d.id])).map(camel),
    software: async (d: any) => (await query(
      "SELECT version, installed_at, installed_by FROM software_install WHERE device_id = $1 ORDER BY installed_at DESC", [d.id])).map(camel),
    assignments: async (d: any) => await query(`
      SELECT r.name AS room, lp.path AS location, lower(da.during) AS "from", upper(da.during) AS "to"
      FROM device_assignment da JOIN room r ON r.id = da.room_id JOIN v_location_path lp ON lp.id = r.location_id
      WHERE da.device_id = $1 ORDER BY lower(da.during) DESC`, [d.id]),
    maintenance: (d: any, _: unknown, ctx: Context) => ctx.loaders.maintenanceByDevice.load(d.id),
    workOrders: async (d: any, { limit }: { limit: number }) => (await query(`
      SELECT wo.id, wo.kind, mp.name AS plan, wo.opened_at, wo.completed_at, t.name AS technician, wo.result, wo.notes,
             coalesce((SELECT json_agg(json_build_object('description', mt.description, 'spec', mt.spec,
                                                         'measured', wt.measured, 'passed', wt.passed) ORDER BY mt.seq)
                       FROM work_order_task wt JOIN maintenance_task mt ON mt.id = wt.task_id WHERE wt.work_order_id = wo.id), '[]') AS tasks
      FROM work_order wo LEFT JOIN maintenance_plan mp ON mp.id = wo.plan_id LEFT JOIN technician t ON t.id = wo.technician_id
      WHERE wo.device_id = $1 ORDER BY wo.completed_at DESC NULLS FIRST LIMIT $2`, [d.id, Math.min(200, Math.max(1, limit))])).map(camel),
  },

  MaintenanceItem: {
    device: (m: any, _: unknown, ctx: Context) => ctx.loaders.device.load(m.deviceId),
    status: (m: any) => fromDb(m.status),
  },
};
