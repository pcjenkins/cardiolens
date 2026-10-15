-- Read models the API queries. Views keep the business definitions (what "bypass time" or
-- "overdue" means) in one place, next to the data, instead of copied into each resolver.

-- Full path of every location, e.g. "Heart Tower / Floor 3 / Cardiac OR Suite", via a recursive CTE.
CREATE OR REPLACE VIEW v_location_path AS
WITH RECURSIVE walk AS (
  SELECT l.id, l.facility_id, l.parent_id, l.kind, l.name, 1 AS depth, l.name::text AS path, ARRAY[l.id] AS ids
  FROM location l WHERE l.parent_id IS NULL
  UNION ALL
  SELECT c.id, c.facility_id, c.parent_id, c.kind, c.name, w.depth + 1, w.path || ' / ' || c.name, w.ids || c.id
  FROM location c JOIN walk w ON c.parent_id = w.id
)
SELECT w.*, f.name AS facility, hs.name AS health_system
FROM walk w
JOIN facility f ON f.id = w.facility_id
JOIN health_system hs ON hs.id = f.health_system_id;

-- One row per case with everything the lists and dashboards need.
-- Times come from milestones; lowest temperature from the phase aggregates for captured cases,
-- or from the migrated summary for legacy cases.
CREATE OR REPLACE VIEW v_case AS
SELECT sc.id,
       sc.procedure,
       sc.source,
       sc.scheduled_start,
       (ev.incision AT TIME ZONE f.time_zone)::date              AS case_date,
       ev.cpb_on, ev.cpb_off, ev.xclamp_on, ev.xclamp_off,
       round(extract(epoch FROM ev.cpb_off - ev.cpb_on) / 60)::int       AS bypass_min,
       round(extract(epoch FROM ev.xclamp_off - ev.xclamp_on) / 60)::int AS cross_clamp_min,
       coalesce(temp.min_temp, (sc.legacy_summary ->> 'lowest_temp_c')::real) AS lowest_temp_c,
       coalesce(tx.units, 0)                                       AS blood_units,
       (e.discharged_at::date - e.admitted_at::date)               AS los_days,
       e.outcome,
       p.id AS patient_id, p.mrn, p.sex, p.bsa_m2,
       date_part('year', age(ev.incision, p.birth_date))::int      AS patient_age,
       surg.id AS surgeon_id, surg.name AS surgeon,
       perf.id AS perfusionist_id, perf.name AS perfusionist,
       r.id AS room_id, r.name AS room, lp.path AS location_path,
       f.id AS facility_id, f.name AS facility
FROM surgical_case sc
JOIN encounter e ON e.id = sc.encounter_id
JOIN patient p   ON p.id = e.patient_id
JOIN room r      ON r.id = sc.room_id
JOIN v_location_path lp ON lp.id = r.location_id
JOIN facility f  ON f.id = e.facility_id
LEFT JOIN LATERAL (
  SELECT max(ts) FILTER (WHERE event_type = 'incision')   AS incision,
         max(ts) FILTER (WHERE event_type = 'cpb_on')     AS cpb_on,
         max(ts) FILTER (WHERE event_type = 'cpb_off')    AS cpb_off,
         max(ts) FILTER (WHERE event_type = 'xclamp_on')  AS xclamp_on,
         max(ts) FILTER (WHERE event_type = 'xclamp_off') AS xclamp_off
  FROM case_event WHERE case_id = sc.id
) ev ON true
LEFT JOIN LATERAL (
  SELECT min(acp.min) AS min_temp FROM agg_case_phase acp JOIN channel c ON c.id = acp.channel_id
  WHERE acp.case_id = sc.id AND c.code = 'T_NASO' AND acp.phase = 'cpb'
) temp ON true
LEFT JOIN LATERAL (SELECT sum(units)::int AS units FROM transfusion WHERE case_id = sc.id) tx ON true
LEFT JOIN LATERAL (
  SELECT s.id, s.name FROM case_staff cs JOIN staff s ON s.id = cs.staff_id
  WHERE cs.case_id = sc.id AND cs.role = 'primary_surgeon'
) surg ON true
LEFT JOIN LATERAL (
  SELECT s.id, s.name FROM case_staff cs JOIN staff s ON s.id = cs.staff_id
  WHERE cs.case_id = sc.id AND cs.role = 'primary_perfusionist'
) perf ON true;

-- Running hours and case counts per device, from what it actually recorded.
CREATE OR REPLACE VIEW v_device_usage AS
SELECT d.id AS device_id,
       count(DISTINCT rs.case_id)::int                                          AS cases,
       coalesce(round((sum(extract(epoch FROM rs.ended_at - rs.started_at)) / 3600)::numeric, 1), 0) AS running_hours,
       max(rs.ended_at)                                                         AS last_used_at
FROM device d LEFT JOIN recording_session rs ON rs.device_id = d.id
GROUP BY d.id;

-- Where each device is right now (range containment on the assignment).
CREATE OR REPLACE VIEW v_device_location_now AS
SELECT da.device_id, da.room_id, r.name AS room, lp.path AS location_path, lp.facility
FROM device_assignment da
JOIN room r ON r.id = da.room_id
JOIN v_location_path lp ON lp.id = r.location_id
WHERE da.during @> now();

-- Maintenance status per device per plan: time-based, usage-based, or whichever comes first.
CREATE OR REPLACE VIEW v_maintenance_status AS
SELECT d.id AS device_id, d.asset_tag, mp.id AS plan_id, mp.name AS plan, mp.regulatory,
       mp.interval_days, mp.interval_hours, mp.grace_days,
       last_wo.completed_at                                                   AS last_done_at,
       last_wo.completed_at + make_interval(days => mp.interval_days)        AS due_at,
       hrs.hours_since                                                        AS hours_since_last,
       CASE
         WHEN last_wo.completed_at IS NULL THEN 'overdue'
         WHEN mp.interval_days IS NOT NULL
              AND now() > last_wo.completed_at + make_interval(days => mp.interval_days + mp.grace_days) THEN 'overdue'
         WHEN mp.interval_hours IS NOT NULL AND hrs.hours_since > mp.interval_hours THEN 'overdue'
         WHEN mp.interval_days IS NOT NULL
              AND now() > last_wo.completed_at + make_interval(days => mp.interval_days) THEN 'in_grace'
         WHEN (mp.interval_days IS NOT NULL
               AND now() > last_wo.completed_at + make_interval(days => mp.interval_days) - make_interval(days => greatest(3, mp.interval_days / 10)))
           OR (mp.interval_hours IS NOT NULL AND hrs.hours_since > mp.interval_hours * 0.9) THEN 'due_soon'
         ELSE 'current'
       END AS status
FROM device d
JOIN maintenance_plan mp ON mp.device_model_id = d.model_id
LEFT JOIN LATERAL (
  SELECT wo.completed_at FROM work_order wo
  WHERE wo.device_id = d.id AND wo.plan_id = mp.id AND wo.result IN ('pass','repaired')
  ORDER BY wo.completed_at DESC LIMIT 1
) last_wo ON true
LEFT JOIN LATERAL (
  SELECT coalesce(round((sum(extract(epoch FROM rs.ended_at - rs.started_at)) / 3600)::numeric, 1), 0) AS hours_since
  FROM recording_session rs
  WHERE rs.device_id = d.id AND rs.started_at > coalesce(last_wo.completed_at, '-infinity')
) hrs ON true
WHERE d.status <> 'retired';

-- The whole case as one JSON document, built in the database (the FOR JSON pattern, Postgres style).
-- Used for the post-case report: one round trip, shape owned by the data tier.
CREATE OR REPLACE FUNCTION case_report(p_case int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'case', to_jsonb(vc) - 'patient_id' - 'surgeon_id' - 'perfusionist_id' - 'room_id' - 'facility_id',
    'phases', (
      SELECT jsonb_object_agg(phase, channels) FROM (
        SELECT acp.phase, jsonb_object_agg(c.code, jsonb_build_object(
                 'avg', round(acp.avg::numeric, c.decimals), 'min', round(acp.min::numeric, c.decimals),
                 'max', round(acp.max::numeric, c.decimals), 'p50', round(acp.p50::numeric, c.decimals),
                 'sec_below', acp.sec_below, 'sec_above', acp.sec_above, 'unit', c.unit)) AS channels
        FROM agg_case_phase acp JOIN channel c ON c.id = acp.channel_id
        WHERE acp.case_id = p_case GROUP BY acp.phase) x),
    'do2i_episodes', (SELECT coalesce(jsonb_agg(to_jsonb(e)), '[]') FROM threshold_episodes(p_case, 'DO2I', 'below') e),
    'map_episodes',  (SELECT coalesce(jsonb_agg(to_jsonb(e)), '[]') FROM threshold_episodes(p_case, 'MAP', 'below') e),
    'events', (SELECT coalesce(jsonb_agg(jsonb_build_object('ts', ts, 'type', event_type, 'detail', detail) ORDER BY ts), '[]')
               FROM case_event WHERE case_id = p_case),
    'labs', (SELECT coalesce(jsonb_agg(jsonb_build_object('ts', ts, 'test', test, 'value', value, 'unit', unit) ORDER BY ts), '[]')
             FROM lab_result WHERE case_id = p_case),
    'devices', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'asset_tag', d.asset_tag, 'model', dm.name, 'serial', d.serial, 'software', rs.software_version,
                  'maintenance_ok', rs.maintenance_ok, 'maintenance_note', rs.maintenance_note)), '[]')
                FROM recording_session rs JOIN device d ON d.id = rs.device_id JOIN device_model dm ON dm.id = d.model_id
                WHERE rs.case_id = p_case),
    'disposables', (SELECT coalesce(jsonb_agg(jsonb_build_object('product', dp.name, 'kind', dp.kind, 'lot', du.lot)), '[]')
                    FROM disposable_use du JOIN disposable_product dp ON dp.id = du.product_id WHERE du.case_id = p_case)
  )
  FROM v_case vc WHERE vc.id = p_case
$$;
