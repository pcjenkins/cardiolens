// Per-request DataLoaders: a list of 100 cases asking for `quality` costs one query, not 100 (the N+1 problem).
// Created fresh for every request so one user's cached results can never leak to another.
import DataLoader from "dataloader";
import { query } from "./db.ts";
import { camel, groupBy } from "./util.ts";

const byKey = <K, V>(keys: readonly K[], rows: V[], keyOf: (r: V) => K) => {
  const m = new Map(rows.map((r) => [keyOf(r), r]));
  return keys.map((k) => m.get(k) ?? null);
};
const grouped = <K, V>(keys: readonly K[], rows: V[], keyOf: (r: V) => K) => {
  const m = groupBy(rows, keyOf);
  return keys.map((k) => m.get(k) ?? []);
};

export function createLoaders() {
  return {
    channels: new DataLoader<"all", any[]>(async (keys) => {
      const rows = (await query("SELECT * FROM channel ORDER BY id")).map(camel);
      return keys.map(() => rows);
    }),

    device: new DataLoader<number, any>(async (ids) => byKey(ids, await devicesWhere("d.id = ANY($1)", [ids]), (r) => r.id)),

    devicesByRoom: new DataLoader<number, any[]>(async (roomIds) =>
      grouped(roomIds, await devicesWhere("loc.room_id = ANY($1)", [roomIds]), (r) => r.roomId)),

    locationsByFacility: new DataLoader<number, any[]>(async (ids) =>
      grouped(ids, (await query("SELECT * FROM v_location_path WHERE facility_id = ANY($1) ORDER BY path", [ids])).map(camel), (r) => r.facilityId)),

    roomsByLocation: new DataLoader<number, any[]>(async (ids) =>
      grouped(ids, (await query("SELECT * FROM room WHERE location_id = ANY($1) ORDER BY name", [ids])).map(camel), (r) => r.locationId)),

    sessionsByCase: new DataLoader<number, any[]>(async (ids) =>
      grouped(ids, (await query("SELECT * FROM recording_session WHERE case_id = ANY($1) ORDER BY started_at", [ids])).map(camel), (r) => r.caseId)),

    maintenanceByDevice: new DataLoader<number, any[]>(async (ids) =>
      grouped(ids, (await query("SELECT * FROM v_maintenance_status WHERE device_id = ANY($1) ORDER BY plan", [ids])).map(camel), (r) => r.deviceId)),

    /** Headline perfusion quality, from the full-flow phase aggregates plus alarm/emboli counts. */
    caseQuality: new DataLoader<number, any>(async (ids) => {
      const [phase, counts] = await Promise.all([
        query(`
          SELECT acp.case_id,
                 min(acp.min)        FILTER (WHERE c.code = 'DO2I')   AS do2i_nadir,
                 sum(acp.sec_below)  FILTER (WHERE c.code = 'DO2I')   AS seconds_do2i_below_target,
                 round((100.0 * sum(acp.sec_below) FILTER (WHERE c.code = 'DO2I')
                        / nullif(sum(acp.n_valid) FILTER (WHERE c.code = 'DO2I'), 0))::numeric, 1) AS pct_time_do2i_below_target,
                 min(acp.min)        FILTER (WHERE c.code = 'SVO2')   AS svo2_nadir,
                 sum(acp.sec_below)  FILTER (WHERE c.code = 'MAP')    AS seconds_map_below50,
                 max(acp.max)        FILTER (WHERE c.code = 'T_ART')  AS max_arterial_temp,
                 sum(acp.sec_above)  FILTER (WHERE c.code = 'T_ART')  AS seconds_arterial_above37,
                 min(acp.min)        FILTER (WHERE c.code = 'HCT')    AS hct_nadir,
                 round((100.0 * sum(acp.n_bad) / nullif(sum(acp.n_valid + acp.n_bad), 0))::numeric, 2) AS artifact_pct
          FROM agg_case_phase acp JOIN channel c ON c.id = acp.channel_id
          WHERE acp.case_id = ANY($1) AND acp.phase = 'full_flow'
          GROUP BY acp.case_id`, [ids]),
        query(`
          SELECT rs.case_id, coalesce(sum(e.n), 0)::int AS emboli_count, coalesce(sum(a.n), 0)::int AS alarm_count
          FROM recording_session rs
          LEFT JOIN LATERAL (SELECT count(*) AS n FROM emboli_event WHERE session_id = rs.id) e ON true
          LEFT JOIN LATERAL (SELECT count(*) AS n FROM alarm_event  WHERE session_id = rs.id) a ON true
          WHERE rs.case_id = ANY($1) GROUP BY rs.case_id`, [ids]),
      ]);
      const p = new Map(phase.map((r: any) => [r.case_id, camel(r)]));
      const c = new Map(counts.map((r: any) => [r.case_id, camel(r)]));
      return ids.map((id) => (p.has(id) ? { ...p.get(id), ...c.get(id) } : null));
    }),
  };
}
export type Loaders = ReturnType<typeof createLoaders>;

/** Devices with model, location now, usage and worst maintenance status, in one query. */
export async function devicesWhere(where: string, params: unknown[]) {
  const rows = await query(`
    SELECT d.id, d.asset_tag, d.serial, d.status, d.installed_on, dm.name AS model, dm.device_type AS type, m.name AS manufacturer,
           f.name AS facility, loc.room_id, loc.room, loc.location_path AS location,
           u.running_hours, u.cases, u.last_used_at,
           coalesce(ms.worst, 'current') AS maintenance_status
    FROM device d
    JOIN device_model dm ON dm.id = d.model_id
    JOIN manufacturer m  ON m.id = dm.manufacturer_id
    JOIN facility f      ON f.id = d.facility_id
    LEFT JOIN v_device_location_now loc ON loc.device_id = d.id
    LEFT JOIN v_device_usage u ON u.device_id = d.id
    LEFT JOIN LATERAL (
      SELECT status AS worst FROM v_maintenance_status s WHERE s.device_id = d.id
      ORDER BY array_position(ARRAY['overdue','in_grace','due_soon','current'], s.status) LIMIT 1
    ) ms ON true
    WHERE ${where}
    ORDER BY f.name, dm.device_type, d.asset_tag`, params);
  return rows.map(camel);
}
